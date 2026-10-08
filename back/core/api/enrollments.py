from datetime import timedelta
from hashlib import sha256
from io import BytesIO

from PIL import Image, ImageStat, UnidentifiedImageError
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView
from core.enrollment_models import PlayerEnrollmentInvitation, PlayerEnrollment, PlayerEnrollmentDocument

from core.enrollment_terms import TERMS_VERSION, TERMS


def enrollment_staff(user):
    return user.is_authenticated and (user.role in {"admin", "owner", "dev"} or "player_enrollments_only" in (user.section_permissions or []))


class EnrollmentStaffPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return enrollment_staff(request.user)


def invitations_for(user):
    rows = PlayerEnrollmentInvitation.objects.all()
    return rows if user.role in {"admin", "owner", "dev"} else rows.filter(created_by=user)


class EnrollmentThrottle(SimpleRateThrottle):
    scope = "player_enrollment"
    rate = "20/hour"
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def is_minor(birth_date):
    today = timezone.localdate()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day)) < 18


class EnrollmentInput(serializers.Serializer):
    name = serializers.CharField(max_length=160)
    birth_date = serializers.DateField()
    team = serializers.CharField(max_length=120)
    category = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    tournament = serializers.CharField(max_length=120)
    identity_type = serializers.ChoiceField(choices=["ine", "passport", "military_card", "minor"])
    phone = serializers.RegexField(r"^\+?[0-9 ()-]{8,30}$")
    phone_secondary = serializers.RegexField(r"^\+?[0-9 ()-]{8,30}$")
    guardian_name = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    payment_reference = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    document_checklist = serializers.ListField(child=serializers.ChoiceField(choices=["credential", "waiver", "other", "birth_certificate", "curp", "guardian_ine"]), required=False, default=list)
    accepted_terms = serializers.BooleanField()
    def validate(self, data):
        if data["birth_date"] > timezone.localdate() or data["birth_date"].year < timezone.localdate().year - 110:
            raise ValidationError("Revisa la fecha de nacimiento.")
        if not data.pop("accepted_terms"):
            raise ValidationError("Debes aceptar los compromisos del formato.")
        if is_minor(data["birth_date"]) and not data["guardian_name"]:
            raise ValidationError("Para menores es obligatorio el nombre del padre o tutor.")
        if is_minor(data["birth_date"]) != (data["identity_type"] == "minor"):
            raise ValidationError("Revisa el tipo de documentación según la edad del jugador.")
        return data


def validated_file(upload, kind):
    if not upload:
        raise ValidationError(f"Falta adjuntar {kind}.")
    limit = 500_000 if "signature" in kind else 3_000_000
    if upload.size > limit:
        raise ValidationError("El documento es demasiado grande (INE: máximo 3 MB; firma: 500 KB).")
    content = upload.read(limit + 1)
    if len(content) > limit:
        raise ValidationError("El documento es demasiado grande.")
    if content.startswith(b"%PDF-") and "signature" not in kind and kind != "player_photo":
        return content, "application/pdf"
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format not in {"JPEG", "PNG"} or image.width * image.height > 16_000_000:
                raise ValidationError("Usa una imagen JPG o PNG de tamaño moderado.")
            image.verify()
        with Image.open(BytesIO(content)) as image:
            if "signature" in kind:
                if image.width < 100 or image.height < 40:
                    raise ValidationError("La firma es demasiado pequeña.")
                background = Image.new("RGB", image.size, "white")
                rgba = image.convert("RGBA")
                background.paste(rgba, mask=rgba.getchannel("A"))
                if max(ImageStat.Stat(background).stddev) < 2:
                    raise ValidationError("Dibuja la firma antes de continuar.")
            if kind == "player_photo":
                image = image.convert("RGB")
                image.thumbnail((400, 500))
                output = BytesIO(); image.save(output, "JPEG", quality=85)
                return output.getvalue(), "image/jpeg"
            return content, "image/png" if image.format == "PNG" else "image/jpeg"
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValidationError("El archivo no es una imagen válida. Usa JPG, PNG o PDF para el INE.")


class PublicEnrollmentView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [EnrollmentThrottle]
    def get(self, request, token):
        invitation = get_object_or_404(PlayerEnrollmentInvitation, token=token)
        if invitation.expires_at < timezone.now():
            return Response({"detail": "El enlace venció. Pide a Emilio uno nuevo."}, status=410)
        if PlayerEnrollment.objects.filter(invitation=invitation).exists():
            return Response({"completed": True})
        return Response({"team": invitation.team, "category": invitation.category, "tournament": invitation.tournament, "terms_version": TERMS_VERSION, "terms": TERMS})

    def post(self, request, token):
        serializer = EnrollmentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        kinds = ["player_photo", "player_signature"]
        if is_minor(fields["birth_date"]):
            kinds.extend(["minor_credential", "curp", "guardian_ine_front", "guardian_ine_back", "guardian_signature"])
        elif fields["identity_type"] == "ine":
            kinds.extend(["ine_front", "ine_back"])
        else:
            kinds.append("identity_document")
        files = [(kind, *validated_file(request.FILES.get(kind), kind)) for kind in kinds]
        with transaction.atomic():
            invitation = get_object_or_404(PlayerEnrollmentInvitation.objects.select_for_update(), token=token)
            if invitation.expires_at < timezone.now():
                return Response({"detail": "El enlace venció. Pide uno nuevo."}, status=410)
            if PlayerEnrollment.objects.filter(invitation=invitation).exists():
                return Response({"detail": "Esta inscripción ya fue recibida.", "completed": True}, status=409)
            checklist = fields.pop("document_checklist", [])
            row = PlayerEnrollment.objects.create(invitation=invitation, terms_version=TERMS_VERSION, terms_text=TERMS, document_checklist=checklist, **fields)
            PlayerEnrollmentDocument.objects.bulk_create([
                PlayerEnrollmentDocument(enrollment=row, kind=kind, content=content, content_type=mime, sha256=sha256(content).hexdigest())
                for kind, content, mime in files
            ])
        return Response({"completed": True, "folio": row.pk}, status=201)


class EnrollmentAdminView(APIView):
    permission_classes = [EnrollmentStaffPermission]
    def get(self, request):
        try:
            page = max(1, min(int(request.query_params.get("page", 1)), 100000))
        except (ValueError, TypeError):
            raise ValidationError("Página inválida.")
        rows = PlayerEnrollment.objects.filter(invitation__in=invitations_for(request.user)).prefetch_related("documents")
        for field in ("team", "tournament"):
            if request.query_params.get(field):
                rows = rows.filter(**{field: request.query_params[field][:120]})
        search = request.query_params.get("search", "")[:160]
        if search:
            rows = rows.filter(name__icontains=search)
        # Never fetch binary contents in the history query.
        from django.db.models import Prefetch
        rows = rows.prefetch_related(None).prefetch_related(Prefetch("documents", queryset=PlayerEnrollmentDocument.objects.defer("content")))
        count = rows.count()
        result = []
        for row in rows[(page - 1) * 25:page * 25]:
            result.append({"id": row.pk, "name": row.name, "birth_date": row.birth_date, "team": row.team, "category": row.category, "tournament": row.tournament, "identity_type": row.identity_type, "terms_text": row.terms_text, "phone": row.phone, "phone_secondary": row.phone_secondary, "guardian_name": row.guardian_name, "payment_reference": row.payment_reference, "document_checklist": row.document_checklist, "signed_at": row.signed_at, "terms_version": row.terms_version, "status": "Inscrito", "documents": [{"id": doc.pk, "kind": doc.kind, "sha256": doc.sha256} for doc in row.documents.all()]})
        response = Response({"results": result, "count": count, "page": page})
        response["Cache-Control"] = "no-store"
        return response

    def post(self, request):
        class InvitationInput(serializers.Serializer):
            tournament = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
            team = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
            category = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
        serializer = InvitationInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = PlayerEnrollmentInvitation.objects.create(created_by=request.user, expires_at=timezone.now() + timedelta(days=30), **serializer.validated_data)
        return Response({"token": row.token, "expires_at": row.expires_at}, status=201)


class EnrollmentDocumentView(APIView):
    permission_classes = [EnrollmentStaffPermission]
    def get(self, request, pk):
        doc = get_object_or_404(PlayerEnrollmentDocument, pk=pk, enrollment__invitation__in=invitations_for(request.user))
        extension = {"image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf"}[doc.content_type]
        response = HttpResponse(bytes(doc.content), content_type=doc.content_type)
        response["Content-Disposition"] = f'attachment; filename="inscripcion-{doc.enrollment_id}-{doc.kind}.{extension}"'
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
