from datetime import timedelta
from hashlib import sha256
from io import BytesIO
import logging
import unicodedata
from uuid import uuid4

from PIL import Image, ImageStat, UnidentifiedImageError
from django.db import transaction
from django.http import HttpResponse, Http404, HttpResponseRedirect
from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, serializers
from rest_framework.exceptions import ValidationError, PermissionDenied, APIException
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView
from core.enrollment_models import PlayerEnrollmentInvitation, PlayerEnrollment, PlayerEnrollmentDocument
from core.models import Team, Tournament, Site
from core.domain_serializers.sports import TeamSerializer, TournamentSerializer

from core.enrollment_terms import TERMS_VERSION, TERMS
from core.enrollment_access import enrollment_site_ids
from core.services import enrollment_storage, enrollment_r2
from core.services.enrollment_images import PHOTO_MAX_BYTES, compress_document_photo
from core.services.team_capacity import assert_capacity, capacity_guard
from core.services.player_blacklist import assert_not_blacklisted
from core.services.player_sanctions import enrollment_sanctions, assert_withdrawal_allowed, assert_no_pending_sanction

logger = logging.getLogger(__name__)
ENROLLMENT_FILE_MAX_BYTES = 20_000_000


def enrollment_invitation_expired(invitation):
    return timezone.now() >= invitation.expires_at


def enrollment_sites(user):
    rows = Site.objects.filter(is_active=True)
    site_ids = enrollment_site_ids(user)
    return rows if site_ids is None else rows.filter(pk__in=site_ids)


def enrollment_staff(user):
    return user.is_authenticated and (user.role in {"admin", "owner", "dev"} or "player_enrollments_only" in (user.section_permissions or []))


class EnrollmentStaffPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return enrollment_staff(request.user)


def invitations_for(user):
    rows = PlayerEnrollmentInvitation.objects.all()
    if enrollment_site_ids(user) is not None:
        return rows.filter(team_record__tournament__site__in=enrollment_sites(user))
    # Emilio administers enrollments across all sites, including links issued
    # by other operators. Other collaborators retain their own-link scope.
    return rows if user.username.casefold() == 'emilio' or user.role in {"admin", "owner", "dev"} else rows.filter(created_by=user)


class EnrollmentThrottle(SimpleRateThrottle):
    scope = "player_enrollment"
    rate = "20/hour"
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def private_r2_redirect(path, request=None):
    url = enrollment_r2.signed_url(path, expires=120)
    response = Response({'url': url}) if request is not None and request.query_params.get('delivery') == 'direct' else HttpResponseRedirect(url)
    response['Cache-Control'] = 'private, no-store'
    response['Referrer-Policy'] = 'no-referrer'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


UPLOAD_SALT = 'enrollment.r2-upload.v1'


def confirm_r2_uploads(receipts, invitation, kinds):
    if not enrollment_r2.enabled() or not isinstance(receipts, list) or len(receipts) != len(kinds):
        raise ValidationError('Adjunta todos los documentos requeridos, sin repetirlos.')
    claims = []
    try:
        for receipt in receipts:
            claim = signing.loads(receipt, salt=UPLOAD_SALT, max_age=1200)
            if claim['invitation'] != invitation.pk or claim['purpose'] != invitation.purpose:
                raise ValueError()
            expected_prefix = f'pending/{invitation.pk}/{invitation.purpose}/'
            if not enrollment_r2.object_key(claim['path']).startswith(expected_prefix):
                raise ValueError()
            claims.append(claim)
        if sorted(c['kind'] for c in claims) != sorted(kinds):
            raise ValueError()
    except (signing.BadSignature, KeyError, TypeError, ValueError):
        raise ValidationError('La carga venció o no corresponde a este formulario. Selecciona los archivos de nuevo.') from None
    validated = []
    # Validate every file before copying or creating any database record.
    for claim in claims:
        content = enrollment_r2.request(claim['path'])
        if len(content) != claim['size'] or sha256(content).hexdigest() != claim['sha256']:
            raise ValidationError('La integridad de un documento no coincide. Vuelve a cargarlo.')
        _, mime = validated_file(SimpleUploadedFile('archivo', content), claim['kind'], transform=False)
        if mime != claim['mime']:
            raise ValidationError('El tipo de un documento no coincide con su contenido.')
        validated.append((claim, mime))
    documents = []
    try:
        for claim, mime in validated:
            destination = enrollment_r2.reference(f"inscripciones/{invitation.pk}/{uuid4().hex}/{claim['kind']}/{claim['sha256']}")
            documents.append(dict(kind=claim['kind'], storage_path=destination, content=b'', content_type=mime, sha256=claim['sha256']))
            enrollment_r2.copy(claim['path'], destination, mime)
        for claim, _ in validated:
            try:
                enrollment_r2.delete(claim['path'])
            except Exception:
                logger.warning('ENROLLMENT_R2_TEMPORARY_CLEANUP_FAILED')
        return documents
    except Exception:
        for doc in documents:
            try:
                enrollment_r2.delete(doc['storage_path'])
            except Exception:
                logger.warning('ENROLLMENT_R2_UNCOMMITTED_COPY_CLEANUP_FAILED')
        raise


class EnrollmentUploadThrottle(EnrollmentThrottle):
    scope = 'player_enrollment_upload'


class EnrollmentUploadView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [EnrollmentUploadThrottle]

    def post(self, request, token, purpose):
        if not enrollment_r2.enabled():
            raise Http404()
        invitation = get_object_or_404(PlayerEnrollmentInvitation.objects.select_related('team_record__tournament'), token=token, purpose=purpose)
        if enrollment_invitation_expired(invitation) or invitation.used_at or PlayerEnrollment.objects.filter(invitation=invitation).exists():
            raise ValidationError('Este enlace ya fue utilizado o venció.')
        if not invitation.team_record_id or not invitation.team_record.is_active or not invitation.team_record.tournament.is_active:
            raise ValidationError('El equipo o torneo ya no está disponible.')
        if purpose == 'enroll':
            assert_capacity(invitation.team_record)
        class Item(serializers.Serializer):
            kind = serializers.ChoiceField(choices=['player_photo', 'player_signature', 'guardian_signature', 'ine_front', 'ine_back', 'identity_document', 'minor_credential', 'curp', 'guardian_ine_front', 'guardian_ine_back', 'withdrawal_signature'])
            size = serializers.IntegerField(min_value=1, max_value=ENROLLMENT_FILE_MAX_BYTES)
            mime = serializers.ChoiceField(choices=['image/jpeg', 'image/png', 'application/pdf'])
            sha256 = serializers.RegexField(r'^[a-f0-9]{64}$')
        items = Item(data=request.data.get('files'), many=True)
        items.is_valid(raise_exception=True)
        files = items.validated_data
        if not 1 <= len(files) <= 6 or len({f['kind'] for f in files}) != len(files):
            raise ValidationError('Selecciona hasta seis documentos distintos.')
        for file in files:
            if (purpose == 'withdraw') != (file['kind'] == 'withdrawal_signature'):
                raise ValidationError('Documento no permitido para este enlace.')
            if 'signature' in file['kind'] and (file['size'] > 500_000 or file['mime'] != 'image/png'):
                raise ValidationError('La firma debe ser PNG y pesar menos de 500 KB.')
            if file['kind'] == 'player_photo' and (file['size'] > PHOTO_MAX_BYTES or file['mime'] != 'image/jpeg'):
                raise ValidationError('La selfie debe ser JPG y pesar hasta 3 MB.')
        result = []
        for file in files:
            path = enrollment_r2.reference(f"pending/{invitation.pk}/{purpose}/{uuid4().hex}/{file['kind']}")
            # Signed create-once header prevents changing a validated object.
            headers = {'Content-Type': file['mime'], 'If-None-Match': '*', 'Cache-Control': 'private, no-store'}
            claim = {**file, 'path': path, 'invitation': invitation.pk, 'purpose': purpose}
            result.append({'kind': file['kind'], 'url': enrollment_r2.signed_url(path, 'PUT', expires=600, headers={**headers, 'Content-Length': str(file['size'])}),
                'headers': headers, 'receipt': signing.dumps(claim, salt=UPLOAD_SALT)})
        response = Response({'files': result})
        response['Cache-Control'] = 'no-store'
        return response


def is_minor(birth_date):
    today = timezone.localdate()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day)) < 18


class EnrollmentInput(serializers.Serializer):
    given_names = serializers.CharField(max_length=80, label="Nombre(s)")
    paternal_surname = serializers.CharField(max_length=80, label="Apellido paterno")
    maternal_surname = serializers.CharField(max_length=80, label="Apellido materno")
    birth_date = serializers.DateField()
    identity_type = serializers.ChoiceField(choices=["ine", "passport", "military_card", "minor"])
    phone = serializers.RegexField(r"^\+?[0-9 ()-]{8,30}$")
    phone_secondary = serializers.RegexField(r"^\+?[0-9 ()-]{8,30}$", required=False, allow_blank=True, default="")
    guardian_name = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    payment_reference = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    document_checklist = serializers.ListField(child=serializers.ChoiceField(choices=["credential", "waiver", "other", "birth_certificate", "curp", "guardian_ine"]), required=False, default=list)
    accepted_terms = serializers.BooleanField()
    def validate(self, data):
        parts = []
        for field in ("given_names", "paternal_surname", "maternal_surname"):
            value = " ".join(data.pop(field).split())
            if not any(char.isalpha() for char in value) or any(
                not (char.isalpha() or char in " '-’." or unicodedata.category(char).startswith('M'))
                for char in value
            ):
                raise ValidationError({field: "Escribe el nombre o apellido, sin números ni símbolos."})
            parts.append(value)
        data["name"] = " ".join(parts)
        if len(data["name"]) > 160:
            raise ValidationError("El nombre completo puede tener hasta 160 caracteres.")
        if data["birth_date"] > timezone.localdate() or data["birth_date"].year < timezone.localdate().year - 110:
            raise ValidationError("Revisa la fecha de nacimiento.")
        if not data.pop("accepted_terms"):
            raise ValidationError("Debes aceptar los compromisos del formato.")
        if is_minor(data["birth_date"]) and not data["guardian_name"]:
            raise ValidationError("Para menores es obligatorio el nombre del padre o tutor.")
        if is_minor(data["birth_date"]) != (data["identity_type"] == "minor"):
            raise ValidationError("Revisa el tipo de documentación según la edad del jugador.")
        return data


def validated_file(upload, kind, *, transform=True):
    if not upload:
        raise ValidationError(f"Falta adjuntar {kind}.")
    limit = 500_000 if "signature" in kind else ENROLLMENT_FILE_MAX_BYTES
    if upload.size > limit:
        raise ValidationError("La firma supera 500 KB." if "signature" in kind else "Cada foto o documento puede pesar hasta 20 MB.")
    content = upload.read(limit + 1)
    if len(content) > limit:
        raise ValidationError("El documento es demasiado grande.")
    if content.startswith(b"%PDF-") and "signature" not in kind and kind != "player_photo":
        return content, "application/pdf"
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format not in {"JPEG", "PNG"} or image.width * image.height > 60_000_000:
                raise ValidationError("Usa una imagen JPG o PNG de tamaño moderado.")
            image.verify()
        with Image.open(BytesIO(content)) as image:
            if "signature" in kind:
                if image.width > 2000 or image.height > 1000 or image.width * image.height > 2_000_000:
                    raise ValidationError('La firma tiene dimensiones demasiado grandes. Dibújala nuevamente en el formulario.')
                if image.width < 100 or image.height < 40:
                    raise ValidationError("La firma es demasiado pequeña.")
                background = Image.new("RGB", image.size, "white")
                rgba = image.convert("RGBA")
                background.paste(rgba, mask=rgba.getchannel("A"))
                if max(ImageStat.Stat(background).stddev) < 2:
                    raise ValidationError("Dibuja la firma antes de continuar.")
            if not transform:
                if max(image.size) > 2400:
                    raise ValidationError('La imagen tiene dimensiones demasiado grandes. Vuelve a seleccionarla desde el formulario.')
                if kind == 'player_photo' and min(image.size) < 1000:
                    raise ValidationError({'player_photo': 'Usa una selfie de al menos 1000 × 1000 píxeles, sin ampliar una foto pequeña.'})
                return content, "image/png" if image.format == "PNG" else "image/jpeg"
            if kind == "player_photo":
                from PIL import ImageOps
                image = ImageOps.exif_transpose(image).convert("RGB")
                image.thumbnail((2400, 2400))
                output = BytesIO(); image.save(output, "JPEG", quality=85)
                return output.getvalue(), "image/jpeg"
            if "signature" not in kind and len(content) > PHOTO_MAX_BYTES:
                return compress_document_photo(content), "image/jpeg"
            return content, "image/png" if image.format == "PNG" else "image/jpeg"
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValidationError("El archivo no es una imagen válida. Usa JPG, PNG o PDF para el INE.")


class PublicEnrollmentView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [EnrollmentThrottle]
    def get(self, request, token):
        invitation = get_object_or_404(PlayerEnrollmentInvitation.objects.select_related('team_record__tournament'), token=token, purpose='enroll')
        if enrollment_invitation_expired(invitation):
            return Response({"detail": "El enlace venció. Pide a Emilio uno nuevo."}, status=410)
        if PlayerEnrollment.objects.filter(invitation=invitation).exists():
            return Response({"completed": True})
        if not invitation.team_record_id:
            return Response({"detail": "Este enlace necesita un equipo y torneo registrados. Pide un enlace nuevo."}, status=410)
        assert_capacity(invitation.team_record)
        first = not PlayerEnrollment.objects.filter(team_record=invitation.team_record).exists()
        return Response({"direct_upload": enrollment_r2.enabled(), "team": invitation.team, "team_id": invitation.team_record_id, "tournament": invitation.tournament, "tournament_id": invitation.team_record.tournament_id, "max_players_per_team": invitation.team_record.tournament.max_players_per_team, "is_delegate": first, "delegate_name": '', "delegate_phone": '', "terms_version": TERMS_VERSION, "terms": TERMS})

    def post(self, request, token):
        serializer = EnrollmentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        assert_not_blacklisted(fields['name'], fields['birth_date'])
        assert_no_pending_sanction(fields['name'], fields['birth_date'])
        kinds = ["player_photo"]
        if is_minor(fields["birth_date"]):
            kinds.extend(["minor_credential", "curp", "guardian_ine_front", "guardian_ine_back", "guardian_signature"])
        elif fields["identity_type"] == "ine":
            kinds.extend(["player_signature", "ine_front", "ine_back"])
        else:
            kinds.extend(["player_signature", "identity_document"])
        direct = request.data.get('uploaded_documents')
        files = [] if direct is not None else [(kind, *validated_file(request.FILES.get(kind), kind)) for kind in kinds]
        # Reject invalid invitations before transferring any private files.
        invitation = get_object_or_404(PlayerEnrollmentInvitation, token=token, purpose='enroll')
        if enrollment_invitation_expired(invitation):
            return Response({"detail": "El enlace venció. Pide uno nuevo."}, status=410)
        if PlayerEnrollment.objects.filter(invitation=invitation).exists():
            return Response({"detail": "Esta inscripción ya fue recibida.", "completed": True}, status=409)
        if invitation.team_record_id:
            assert_capacity(invitation.team_record)
        paths = []
        documents = []
        batch = uuid4().hex
        try:
            if direct is not None:
                documents = confirm_r2_uploads(direct, invitation, kinds)
                paths = [doc['storage_path'] for doc in documents]
            for kind, content, mime in files:
                digest = sha256(content).hexdigest()
                path = f"inscripciones/{invitation.pk}/{batch}/{kind}/{digest}"
                paths.append(path)
                saved_path = enrollment_storage.upload_document(path, content, mime)
                if saved_path:
                    paths[-1] = path = saved_path
                documents.append(dict(kind=kind, storage_path=path, content=b"", content_type=mime, sha256=digest))
            return self.save_enrollment(request, token, fields, documents=documents)
        except Exception as exc:
            for path in paths:
                try:
                    enrollment_storage.delete_document(path)
                except Exception:
                    logger.exception("ENROLLMENT_STORAGE_CLEANUP_FAILED")
            if isinstance(exc, (APIException, Http404)):
                raise
            logger.exception("ENROLLMENT_STORAGE_SAVE_FAILED")
            return Response({"detail": "No se pudieron guardar los archivos. Intenta nuevamente."}, status=503)

    def save_enrollment(self, request, token, fields, documents):
        with transaction.atomic():
            invitation = get_object_or_404(PlayerEnrollmentInvitation.objects.select_for_update(of=('self',)).select_related('team_record__tournament'), token=token, purpose='enroll')
            if enrollment_invitation_expired(invitation):
                raise ValidationError("El enlace venció. Pide uno nuevo.")
            if PlayerEnrollment.objects.filter(invitation=invitation).exists():
                raise ValidationError("Esta inscripción ya fue recibida.")
            if not invitation.team_record_id or not invitation.team_record.is_active or not invitation.team_record.tournament.is_active:
                raise ValidationError('El equipo o torneo del enlace ya no está disponible. Solicita un enlace nuevo.')
            fields.update(team=invitation.team, tournament=invitation.tournament, team_record=invitation.team_record)
            checklist = fields.pop("document_checklist", [])
            with capacity_guard(invitation.team_record, "enrollment") as team:
                fields['identity_key'] = assert_not_blacklisted(fields['name'], fields['birth_date'], locked=True)
                assert_no_pending_sanction(fields['name'], fields['birth_date'])
                first = not PlayerEnrollment.objects.filter(team_record=team).exists()
                # Team-creation contact fields are provisional, not an enrollment.
                # The locked first completed enrollment establishes the delegate.
                fields['is_delegate'] = first
                row = PlayerEnrollment.objects.create(invitation=invitation, terms_version=TERMS_VERSION, terms_text=TERMS, document_checklist=checklist, **fields)
                if first:
                    team.representative_name = row.name
                    team.representative_phone = row.phone
                    team.save(update_fields=['representative_name', 'representative_phone'])
                PlayerEnrollmentDocument.objects.bulk_create([
                    PlayerEnrollmentDocument(enrollment=row, **document)
                    for document in documents
                ])
        return Response({"completed": True, "folio": row.pk}, status=201)


class EnrollmentAdminView(APIView):
    permission_classes = [EnrollmentStaffPermission]
    def get(self, request):
        try:
            page = max(1, min(int(request.query_params.get("page", 1)), 100000))
        except (ValueError, TypeError):
            raise ValidationError("Página inválida.")
        rows = PlayerEnrollment.objects.filter(invitation__in=invitations_for(request.user)).select_related('team_record__tournament').prefetch_related("documents")
        enrollment_id = request.query_params.get('enrollment_id')
        if enrollment_id is not None:
            if not enrollment_id.isdecimal() or int(enrollment_id) < 1:
                raise ValidationError('Inscripción inválida.')
            rows = rows.filter(pk=int(enrollment_id))
        withdrawal_history = request.query_params.get('withdrawn_only') == 'true'
        withdrawal_filters = None
        if withdrawal_history:
            rows = rows.filter(withdrawn_at__isnull=False).order_by('-withdrawn_at', '-pk')
            withdrawal_filters = {
                'tournaments': list(rows.order_by().values('tournament', 'team_record__tournament_id').distinct()),
                'teams': list(rows.order_by().values('team', 'team_record_id', 'team_record__tournament_id').distinct()),
            }
            date_field = serializers.DateField()
            dates = {}
            for key in ('date_from', 'date_to'):
                value = request.query_params.get(key)
                if value:
                    dates[key] = date_field.run_validation(value)
            if dates.get('date_from') and dates.get('date_to') and dates['date_from'] > dates['date_to']:
                raise ValidationError('La fecha inicial no puede ser posterior a la final.')
            if 'date_from' in dates:
                rows = rows.filter(withdrawn_at__date__gte=dates['date_from'])
            if 'date_to' in dates:
                rows = rows.filter(withdrawn_at__date__lte=dates['date_to'])
        if request.query_params.get('active_only') == 'true':
            rows = rows.filter(withdrawn_at__isnull=True, team_record__is_active=True,
                               team_record__tournament__is_active=True).order_by('-is_delegate', 'signed_at', 'id')
            from core.enrollment_models import PlayerBlacklistEntry
            from django.db.models import Q
            exclusions=PlayerBlacklistEntry.objects.filter(is_active=True)
            rows = rows.exclude(Q(identity_key__in=exclusions.values('identity_key')) | Q(pk__in=exclusions.filter(source_sanction__enrollment_id__isnull=False).values('source_sanction__enrollment_id')))
        for field in ("team", "tournament"):
            if request.query_params.get(field):
                rows = rows.filter(**{field: request.query_params[field][:140]})
        for field in ('team_id', 'tournament_id'):
            value = request.query_params.get(field)
            if value:
                if not value.isdigit():
                    raise ValidationError('Selecciona un equipo y torneo válidos.')
                rows = rows.filter(**{('team_record_id' if field == 'team_id' else 'team_record__tournament_id'): int(value)})
        search = request.query_params.get("search", "")[:160]
        if search:
            rows = rows.filter(name__icontains=search)
        # Never fetch binary contents in the history query.
        from django.db.models import Prefetch
        rows = rows.prefetch_related(None).prefetch_related(Prefetch("documents", queryset=PlayerEnrollmentDocument.objects.defer("content")))
        count = rows.count()
        result = []
        page_rows = list(rows[(page - 1) * 25:page * 25])
        sanctions = enrollment_sanctions(page_rows)
        for row in page_rows:
            result.append({"id": row.pk, "name": row.name, "birth_date": row.birth_date, "team": row.team, "team_id": row.team_record_id, "tournament": row.tournament, "tournament_id": row.team_record.tournament_id if row.team_record_id else None, "identity_type": row.identity_type, "terms_text": row.terms_text, "phone": row.phone, "phone_secondary": row.phone_secondary, "guardian_name": row.guardian_name, "payment_reference": row.payment_reference, "document_checklist": row.document_checklist, "signed_at": row.signed_at, "terms_version": row.terms_version, "status": "Inscrito", "documents": [{"id": doc.pk, "kind": doc.kind, "sha256": doc.sha256} for doc in row.documents.all()]})
            result[-1].update(is_delegate=row.is_delegate, withdrawn_at=row.withdrawn_at, status='Baja' if row.withdrawn_at else 'Inscrito')
            result[-1]['sanctions'] = sanctions[row.pk]
        body = {"results": result, "count": count, "page": page}
        if withdrawal_history:
            body['withdrawal_filters'] = withdrawal_filters
        response = Response(body)
        response["Cache-Control"] = "no-store"
        return response

    def post(self, request):
        class InvitationInput(serializers.Serializer):
            purpose = serializers.ChoiceField(choices=['enroll', 'withdraw'], default='enroll')
            tournament_id = serializers.PrimaryKeyRelatedField(queryset=Tournament.objects.filter(is_active=True, site__is_active=True))
            team_id = serializers.PrimaryKeyRelatedField(queryset=Team.objects.filter(is_active=True).select_related('tournament'))
            def validate(self, data):
                if data['team_id'].tournament_id != data['tournament_id'].pk:
                    raise ValidationError('El equipo debe pertenecer al torneo seleccionado.')
                return data
        serializer = InvitationInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        team = serializer.validated_data['team_id']
        tournament = serializer.validated_data['tournament_id']
        if not enrollment_sites(request.user).filter(pk=tournament.site_id).exists():
            raise PermissionDenied('La sede no está disponible para inscripciones.')
        purpose = serializer.validated_data['purpose']
        if purpose == 'enroll':
            assert_capacity(team)
        elif not PlayerEnrollment.objects.filter(team_record=team, withdrawn_at__isnull=True).exists():
            raise ValidationError('Este equipo no tiene integrantes inscritos para dar de baja.')
        validity = timedelta(days=7) if purpose == 'withdraw' else timedelta(days=30)
        row = PlayerEnrollmentInvitation.objects.create(created_by=request.user, expires_at=timezone.now() + validity, team_record=team, team=team.name, tournament=tournament.name, purpose=purpose)
        return Response({"token": row.token, "expires_at": row.expires_at}, status=201)


class PublicWithdrawalView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [EnrollmentThrottle]

    def invitation(self, token):
        invitation = get_object_or_404(PlayerEnrollmentInvitation.objects.select_related('team_record__tournament'), token=token, purpose='withdraw')
        if invitation.used_at or invitation.expires_at < timezone.now():
            raise ValidationError('Este enlace de baja ya fue utilizado o venció.')
        if not invitation.team_record_id or not invitation.team_record.is_active or not invitation.team_record.tournament.is_active:
            raise ValidationError('El equipo o torneo ya no está disponible.')
        return invitation

    def get(self, request, token):
        invitation = self.invitation(token)
        from django.db.models import Exists, OuterRef
        photos = PlayerEnrollmentDocument.objects.filter(enrollment_id=OuterRef('pk'), kind='player_photo')
        rows = list(PlayerEnrollment.objects.filter(team_record=invitation.team_record, withdrawn_at__isnull=True).annotate(has_photo=Exists(photos)).order_by('signed_at', 'id'))
        sanctions = enrollment_sanctions(rows)
        response = Response({'direct_upload': enrollment_r2.enabled(), 'team': invitation.team, 'tournament': invitation.tournament,
            'players': [{'id': row.pk, 'name': row.name, 'is_delegate': row.is_delegate, 'has_photo': row.has_photo,
                         'sanctions': sanctions[row.pk], 'can_withdraw': not sanctions[row.pk]} for row in rows]})
        response['Cache-Control'] = 'no-store'
        return response

    def post(self, request, token):
        class Input(serializers.Serializer):
            enrollment_id = serializers.IntegerField(min_value=1, required=False)
            enrollment_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=100, required=False)
            accepted = serializers.BooleanField()
            def validate(self, data):
                if 'enrollment_id' in data and 'enrollment_ids' in data:
                    raise ValidationError('Envía una sola lista de integrantes.')
                ids = data.get('enrollment_ids', [data['enrollment_id']] if 'enrollment_id' in data else [])
                if not ids or len(ids) != len(set(ids)):
                    raise ValidationError('Selecciona integrantes sin repetirlos.')
                data['enrollment_ids'] = ids
                return data
        serializer = Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not serializer.validated_data['accepted']:
            raise ValidationError('Confirma la baja antes de firmar.')
        invitation = self.invitation(token)
        ids = serializer.validated_data['enrollment_ids']
        def selected_rows(team, locked=False):
            rows = PlayerEnrollment.objects.filter(pk__in=ids, team_record=team, withdrawn_at__isnull=True).order_by('pk')
            if locked:
                rows = rows.select_for_update()
            rows = list(rows)
            if len(rows) != len(ids):
                raise Http404('Uno de los integrantes no pertenece al equipo o ya fue dado de baja.')
            assert_withdrawal_allowed(rows)
            return rows
        selected_rows(invitation.team_record)
        direct = request.data.get('uploaded_documents')
        content, mime = (b'', 'image/png') if direct is not None else validated_file(request.FILES.get('withdrawal_signature'), 'withdrawal_signature')
        path = ''
        try:
            if direct is not None:
                doc = confirm_r2_uploads(direct, invitation, ['withdrawal_signature'])[0]
                path, mime, digest = doc['storage_path'], doc['content_type'], doc['sha256']
            else:
                path = f'bajas/{invitation.pk}/{uuid4().hex}/firma.png'
                path = enrollment_storage.upload_document(path, content, mime) or path
                digest = sha256(content).hexdigest()
            with transaction.atomic():
                # Same lock order as admissions: invitation, tournament, then team.
                locked = PlayerEnrollmentInvitation.objects.select_for_update().get(pk=invitation.pk)
                if locked.used_at or locked.expires_at < timezone.now():
                    raise ValidationError('Este enlace de baja ya fue utilizado o venció.')
                Tournament.objects.select_for_update().get(pk=invitation.team_record.tournament_id)
                team = Team.objects.select_for_update().get(pk=invitation.team_record_id)
                if not team.is_active or not team.tournament.is_active:
                    raise ValidationError('El equipo o torneo ya no está disponible.')
                rows = selected_rows(team, locked=True)
                withdrawn_at = timezone.now()
                for row in rows:
                    row.withdrawn_at = withdrawn_at
                    row.save(update_fields=['withdrawn_at'])
                PlayerEnrollmentDocument.objects.bulk_create([
                    PlayerEnrollmentDocument(enrollment=row, kind='withdrawal_signature', storage_path=path, content=b'', content_type=mime, sha256=digest)
                    for row in rows
                ])
                locked.used_at = withdrawn_at
                locked.save(update_fields=['used_at'])
            return Response({'completed': True, 'name': rows[0].name if len(rows) == 1 else None,
                'players': [{'id': row.pk, 'name': row.name} for row in rows], 'count': len(rows), 'withdrawn_at': withdrawn_at})
        except Exception as exc:
            try:
                if path:
                    enrollment_storage.delete_document(path)
            except Exception:
                logger.exception('WITHDRAWAL_STORAGE_CLEANUP_FAILED')
            if isinstance(exc, (APIException, Http404)):
                raise
            logger.exception('WITHDRAWAL_SAVE_FAILED')
            return Response({'detail': 'No se pudo guardar la baja. Intenta nuevamente.'}, status=503)


class WithdrawalPhotoThrottle(EnrollmentThrottle):
    scope = 'player_withdrawal_photo'
    rate = '120/hour'


class PublicWithdrawalPhotoView(PublicWithdrawalView):
    http_method_names = ['get', 'head', 'options']
    throttle_classes = [WithdrawalPhotoThrottle]

    def get(self, request, token, pk):
        invitation = self.invitation(token)
        doc = get_object_or_404(PlayerEnrollmentDocument, enrollment_id=pk,
            enrollment__team_record=invitation.team_record, enrollment__withdrawn_at__isnull=True,
            kind='player_photo', content_type__in=['image/png', 'image/jpeg'])
        if doc.storage_path.startswith(enrollment_r2.PREFIX):
            return private_r2_redirect(doc.storage_path, request)
        try:
            content = enrollment_storage.read_document(doc.storage_path) if doc.storage_path else bytes(doc.content)
            if sha256(content).hexdigest() != doc.sha256:
                raise RuntimeError('Integridad del archivo incorrecta.')
        except Exception:
            logger.exception('WITHDRAWAL_PHOTO_READ_FAILED document_id=%s', doc.pk)
            return Response({'detail': 'Foto no disponible.'}, status=503)
        response = HttpResponse(content, content_type=doc.content_type)
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        response['Referrer-Policy'] = 'no-referrer'
        return response


class EnrollmentCatalogView(APIView):
    """Usa los modelos y validadores existentes de Torneos/Equipos."""
    permission_classes = [EnrollmentStaffPermission]
    def get(self, request):
        sites = enrollment_sites(request.user)
        tournaments = Tournament.objects.filter(site__in=sites).order_by('name', 'id')
        teams = Team.objects.filter(is_active=True, tournament__is_active=True, tournament__site__in=sites).order_by('name', 'id')
        return Response({'sites': list(sites.values('id','name')), 'deletable_tournament_ids': [],
                         'tournaments': TournamentSerializer(tournaments, many=True).data,
                         'teams': list(teams.values('id','name','tournament','is_active'))})
    def post(self, request):
        kind = request.data.get('kind')
        allowed = {'tournament': {'site','name','billing_type','starts_on','expected_weeks','is_active','football_format'},
                   'team': {'tournament','name','representative_name','representative_phone','representative_email','is_active'}}
        if kind not in allowed:
            raise ValidationError('Elige crear un equipo o un torneo.')
        data = {key: value for key,value in request.data.items() if key in allowed[kind]}
        serializer = (TournamentSerializer if kind == 'tournament' else TeamSerializer)(data=data)
        serializer.is_valid(raise_exception=True)
        site = serializer.validated_data['site'] if kind == 'tournament' else serializer.validated_data['tournament'].site
        if not enrollment_sites(request.user).filter(pk=site.pk).exists():
            raise PermissionDenied('La sede no está disponible para inscripciones.')
        if kind == 'tournament' and not serializer.validated_data['site'].is_active:
            raise ValidationError('Selecciona una sede activa.')
        if kind == 'team':
            # Same lock as tournament editing: an empty tournament cannot move
            # to another site between permission validation and adding its team.
            with transaction.atomic():
                tournament = get_object_or_404(Tournament.objects.select_for_update(), pk=serializer.validated_data['tournament'].pk,
                    site__in=enrollment_sites(request.user))
                if not tournament.is_active or not tournament.site.is_active:
                    raise ValidationError('Selecciona un torneo activo.')
                serializer.save(tournament=tournament)
        else:
            serializer.save()
        return Response(serializer.data, status=201)


class EnrollmentTournamentDeletionView(APIView):
    """Editable enrollment tournaments. Deletion is not an enrollment operation."""
    permission_classes = [EnrollmentStaffPermission]

    def post(self, request):
        raise PermissionDenied('No se pueden eliminar torneos desde Inscripciones.')

    def target(self, request, pk):
        return get_object_or_404(Tournament, pk=pk, site__in=enrollment_sites(request.user))

    def get(self, request, pk):
        if request.path_info.endswith('/deletion-preview/'):
            raise PermissionDenied('No se pueden eliminar torneos desde Inscripciones.')
        return Response(TournamentSerializer(self.target(request, pk)).data)

    def patch(self, request, pk):
        allowed = {'site', 'name', 'billing_type', 'starts_on', 'expected_weeks', 'is_active', 'football_format'}
        if set(request.data) - allowed:
            raise ValidationError('La solicitud contiene campos no editables.')
        with transaction.atomic():
            target = self.target(request, pk)
            target = get_object_or_404(Tournament.objects.select_for_update(), pk=target.pk, site__in=enrollment_sites(request.user))
            serializer = TournamentSerializer(target, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            site = serializer.validated_data.get('site', target.site)
            if not enrollment_sites(request.user).filter(pk=site.pk).exists():
                raise PermissionDenied('La sede no está disponible para inscripciones.')
            weeks = serializer.validated_data.get('expected_weeks', target.expected_weeks)
            if weeks is not None and weeks < 1:
                raise ValidationError({'expected_weeks': 'Indica al menos una semana.'})
            if site.pk != target.site_id and (target.teams.exists() or target.student_registrations.exists()):
                raise ValidationError({'site': 'No se puede cambiar la sede de un torneo con equipos o inscripciones.'})
            serializer.save()
        response = Response(serializer.data)
        response['Cache-Control'] = 'no-store'
        return response

    def delete(self, request, pk):
        raise PermissionDenied('No se pueden eliminar torneos desde Inscripciones.')


class EnrollmentTeamDeletionView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def target(self, request, pk):
        if request.user.username.casefold() != 'emilio' and request.user.role not in {'admin', 'owner', 'dev'}:
            raise PermissionDenied('No tienes permiso para eliminar equipos.')
        return get_object_or_404(Team.objects.select_related('tournament'), pk=pk,
            tournament__site__in=enrollment_sites(request.user))

    def get(self, request, pk):
        from core.services import team_deletion
        return Response(team_deletion.preview(self.target(request, pk), request.user))

    def delete(self, request, pk):
        from core.services import team_deletion
        try:
            return Response(team_deletion.permanently_delete(self.target(request, pk), request.user, request.data))
        except (APIException, Http404):
            raise
        except Exception:
            reference = uuid4().hex[:12]
            logger.exception('ENROLLMENT_TEAM_DELETE_FAILED reference=%s team_id=%s', reference, pk)
            return Response({'detail': f'No se pudo eliminar el equipo. Referencia del error: {reference}.'}, status=500)


class EnrollmentDocumentView(APIView):
    permission_classes = [EnrollmentStaffPermission]
    def get(self, request, pk):
        doc = get_object_or_404(PlayerEnrollmentDocument, pk=pk, enrollment__invitation__in=invitations_for(request.user))
        # Older open tabs still expect bytes; new clients explicitly request a
        # direct URL so their images do not pass through Render.
        if doc.storage_path.startswith(enrollment_r2.PREFIX) and request.query_params.get('delivery') == 'direct':
            return private_r2_redirect(doc.storage_path, request)
        extension = {"image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf"}[doc.content_type]
        try:
            content = enrollment_storage.read_document(doc.storage_path) if doc.storage_path else bytes(doc.content)
            if sha256(content).hexdigest() != doc.sha256:
                raise RuntimeError("Integridad del archivo incorrecta.")
        except Exception:
            logger.exception("ENROLLMENT_STORAGE_READ_FAILED document_id=%s", doc.pk)
            return Response({"detail": "No se pudo recuperar el documento. Intenta nuevamente."}, status=503)
        response = HttpResponse(content, content_type=doc.content_type)
        response["Content-Disposition"] = f'attachment; filename="inscripcion-{doc.enrollment_id}-{doc.kind}.{extension}"'
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
