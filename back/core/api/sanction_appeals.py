"""Staff-mediated private appeals and administrator payment acknowledgement."""
from datetime import timedelta
from hashlib import sha256
from io import BytesIO
from uuid import uuid4
from PIL import Image, ImageOps, UnidentifiedImageError
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import PlayerSanction, AuditLog
from core.api.sanctions import SanctionPermission
from core.api.disciplinary import scoped_sanctions, can_manage_blacklist, can_decide_appeals, status_of
from core.services import enrollment_storage


def private_response(response):
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


class SanctionAppealView(APIView):
    permission_classes = [SanctionPermission]

    def post(self, request, pk):
        source = get_object_or_404(scoped_sanctions(request.user), pk=pk)
        if source.appeal_status != 'none':
            raise ValidationError('Esta sanción ya tiene una apelación registrada.')
        reason = serializers.CharField(allow_blank=True, max_length=4000).run_validation(request.data.get('reason', ''))
        photo = request.FILES.get('letter')
        if not photo or photo.size > 20_000_000:
            raise ValidationError('Adjunta una foto de la carta (máximo 20 MB antes de comprimir).')
        try:
            with Image.open(photo) as image:
                if image.format not in {'JPEG', 'PNG', 'WEBP'}:
                    raise ValueError()
                if image.width * image.height > 30_000_000:
                    raise ValueError()
                image.load()
                image = ImageOps.exif_transpose(image).convert('RGB')
                image.thumbnail((2400, 2400))
                output = BytesIO()
                image.save(output, 'JPEG', quality=85, optimize=True)
                content = output.getvalue()
                if len(content) > 3_000_000:
                    raise ValueError()
        except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
            raise ValidationError('La carta debe ser una foto válida y legible (JPG, PNG o WebP).')
        path = f'sanction-appeals/{source.pk}/{uuid4().hex}.jpg'
        try:
            path = enrollment_storage.upload_document(path, content, 'image/jpeg') or path
            with transaction.atomic():
                row = get_object_or_404(scoped_sanctions(request.user).select_for_update(of=('self',)), pk=pk)
                if row.appeal_status != 'none':
                    raise ValidationError('Esta sanción ya tiene una apelación registrada. No se reemplazó su carta.')
                row.appeal_status = 'pending'
                row.appeal_reason = reason
                row.appeal_letter_path = path
                row.appeal_letter_sha256 = sha256(content).hexdigest()
                row.appeal_submitted_at = timezone.now()
                row.appeal_submitted_by = request.user
                row.save(update_fields=['appeal_status','appeal_reason','appeal_letter_path','appeal_letter_sha256','appeal_submitted_at','appeal_submitted_by'])
        except Exception:
            enrollment_storage.delete_document(path)
            raise
        return private_response(Response({'completed': True}, status=201))

    def get(self, request, pk):
        row = get_object_or_404(scoped_sanctions(request.user).exclude(appeal_letter_path=''), pk=pk)
        from core.services.enrollment_r2 import PREFIX
        if row.appeal_letter_path.startswith(PREFIX) and request.query_params.get('delivery') == 'direct':
            from core.api.enrollments import private_r2_redirect
            return private_r2_redirect(row.appeal_letter_path, request)
        try:
            content = enrollment_storage.read_document(row.appeal_letter_path)
            if sha256(content).hexdigest() != row.appeal_letter_sha256:
                raise ValueError()
        except Exception:
            return private_response(Response({'detail':'La carta no está disponible. Intenta nuevamente.'},status=503))
        return private_response(HttpResponse(content, content_type='image/jpeg'))


class SanctionDecisionView(APIView):
    permission_classes = [SanctionPermission]

    def post(self, request, pk):
        action = serializers.ChoiceField(choices=['accepted','rejected','payment']).run_validation(request.data.get('action'))
        if (action == 'payment' and not can_manage_blacklist(request.user)) or (action != 'payment' and not can_decide_appeals(request.user)):
            raise PermissionDenied('No tienes permiso para realizar esta acción.')
        if action != 'accepted' and 'return_on' in request.data:
            raise ValidationError('La fecha de regreso solo se modifica al aceptar la apelación.')
        with transaction.atomic():
            row = get_object_or_404(scoped_sanctions(request.user).select_for_update(of=('self',)), pk=pk)
            if action == 'payment':
                folio = serializers.CharField(min_length=1,max_length=100,trim_whitespace=True).run_validation(request.data.get('folio'))
                if any(ord(char)<32 for char in folio):
                    raise ValidationError('El folio contiene caracteres inválidos.')
                if row.payment_folio and row.payment_folio != folio:
                    raise ValidationError('Ya existe otro folio registrado. No se puede sobrescribir.')
                if not row.payment_folio:
                    row.payment_folio=folio
                    row.payment_recorded_by=request.user
                    row.payment_recorded_at=timezone.now()
                    row.save(update_fields=['payment_folio','payment_recorded_by','payment_recorded_at'])
            else:
                reason = (serializers.CharField(allow_blank=True,max_length=2000).run_validation(request.data.get('reason', '')) if action == 'accepted'
                          else serializers.CharField(min_length=3,max_length=2000).run_validation(request.data.get('reason')))
                if row.appeal_status != 'pending':
                    raise ValidationError('Solo se puede decidir una apelación pendiente; la decisión registrada no se sobrescribe.')
                date_fields = []
                if action == 'accepted' and 'return_on' in request.data:
                    return_on = serializers.DateField().run_validation(request.data['return_on'])
                    if return_on <= row.starts_on:
                        raise ValidationError({'return_on': 'La fecha de regreso debe ser posterior al inicio de la sanción.'})
                    ends_on = return_on - timedelta(days=1)
                    if ends_on != row.ends_on:
                        previous = {'starts_on': row.starts_on.isoformat(), 'ends_on': row.ends_on.isoformat() if row.ends_on else None,
                                    'duration_unit': row.duration_unit, 'duration_value': row.duration_value}
                        row.ends_on = ends_on
                        row.duration_unit = 'dates'
                        row.duration_value = None
                        date_fields = ['ends_on', 'duration_unit', 'duration_value']
                        AuditLog.objects.create(actor=request.user, action='sanction_appeal_return_changed',
                            table_name=PlayerSanction._meta.db_table, record_id=str(row.pk), previous_values=previous,
                            new_values={'starts_on': row.starts_on.isoformat(), 'ends_on': ends_on.isoformat(),
                                        'return_on': return_on.isoformat(), 'duration_unit': 'dates', 'duration_value': None})
                row.appeal_status=action
                row.appeal_decision_reason=reason
                row.appeal_decided_by=request.user
                row.appeal_decided_at=timezone.now()
                row.save(update_fields=['appeal_status','appeal_decision_reason','appeal_decided_by','appeal_decided_at', *date_fields])
        return private_response(Response({'completed':True,'status':status_of(row)}))
