"""Signed temporary permits, issued in person or by a single-use public invitation."""
from datetime import timedelta
from hashlib import sha256
from uuid import uuid4
import re

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, serializers
from rest_framework.exceptions import ValidationError, NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from core.enrollment_models import PlayerTemporaryPermit, PlayerPermitInvitation
from core.enrollment_access import enrollment_site_ids
from core.models import Team, Tournament
from core.services import enrollment_storage
from .enrollments import (EnrollmentStaffPermission, EnrollmentThrottle, enrollment_staff,
                          enrollment_sites, validated_file, private_r2_redirect)

TERMS_VERSION = 'temporary-permit-v1'
TERMS = [
    'Equipo que utilice jugador con permiso podrá perder su partido si el equipo contrario juega bajo protesta, ya que la administración no puede acreditar la edad e identidad del jugador.',
    'Válido por 24 horas desde su emisión, hasta la fecha y hora de vencimiento indicadas.',
    'Acepto jugar bajo mi propio riesgo, deslindando de toda responsabilidad a la liga y a su personal por cualquier eventualidad de mi persona.',
]


class PermitInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    team_id = serializers.IntegerField(min_value=1, required=False)
    name = serializers.CharField(max_length=160, min_length=2)
    photo = serializers.FileField()
    signature = serializers.FileField()
    accepted = serializers.BooleanField()

    def validate_name(self, value):
        value = ' '.join(value.split())
        if not any(char.isalpha() for char in value):
            raise ValidationError('Escribe el nombre completo del jugador.')
        return value

    def validate_accepted(self, value):
        if value is not True:
            raise ValidationError('Acepta las condiciones del permiso antes de firmar y continuar.')
        return value


def permits_for(user):
    rows = PlayerTemporaryPermit.objects.filter(site__in=enrollment_sites(user))
    if enrollment_site_ids(user) is None and user.username.casefold() != 'emilio' and user.role not in {'admin', 'owner', 'dev'}:
        rows = rows.filter(created_by=user)
    return rows


def payload(row):
    return dict(id=row.pk, folio=f'P-{row.pk:06d}', name=row.name, team=row.team_name,
                tournament=row.tournament_name, issued_at=row.issued_at, expires_at=row.expires_at,
                terms=row.terms_text, source=row.source,
                status='active' if row.issued_at <= timezone.now() < row.expires_at else 'expired')


def locked_team(pk, user):
    team = get_object_or_404(Team.objects.select_related('tournament'), pk=pk,
                            tournament__site__in=enrollment_sites(user))
    get_object_or_404(Tournament.objects.select_for_update(), pk=team.tournament_id, is_active=True,
                     site__in=enrollment_sites(user))
    return get_object_or_404(Team.objects.select_for_update().select_related('tournament'),
                            pk=team.pk, tournament_id=team.tournament_id, is_active=True)


def issue(values, team_id, creator, invitation_token=None):
    paths = []
    try:
        with transaction.atomic():
            team = locked_team(team_id, creator)
            invitation = None
            if invitation_token:
                invitation = get_object_or_404(PlayerPermitInvitation.objects.select_for_update(),
                                               token=invitation_token, team=team, created_by=creator)
            existing = PlayerTemporaryPermit.objects.filter(request_id=values['request_id']).first()
            if existing:
                if (existing.created_by_id != creator.pk or existing.team_id != team.pk or existing.name != values['name']
                    or existing.invitation_id != (invitation.pk if invitation else None)):
                    raise ValidationError('La solicitud ya se utilizó para otro permiso.')
                return existing, False
            if invitation and (invitation.used_at or timezone.now() >= invitation.expires_at):
                raise ValidationError('El enlace de permiso ya fue utilizado o venció. Solicita uno nuevo.')
            # Validate both documents before writing any object.
            photo, mime = validated_file(values['photo'], 'player_photo')
            signature, signature_mime = validated_file(values['signature'], 'player_signature')
            key = f'permits/{uuid4().hex}'
            photo_path = enrollment_storage.upload_document(key+'/photo.jpg', photo, mime); paths.append(photo_path)
            signature_path = enrollment_storage.upload_document(key+'/signature.png', signature, signature_mime); paths.append(signature_path)
            now = timezone.now()
            row = PlayerTemporaryPermit.objects.create(request_id=values['request_id'], name=values['name'],
                team=team, site=team.tournament.site, team_name=team.name, tournament_name=team.tournament.name,
                created_by=creator, issued_at=now, expires_at=now+timedelta(hours=24), invitation=invitation,
                source='online' if invitation else 'local', terms_version=TERMS_VERSION, terms_text=TERMS,
                photo_storage_path=photo_path, photo_content_type=mime, photo_sha256=sha256(photo).hexdigest(),
                signature_storage_path=signature_path, signature_content_type=signature_mime, signature_sha256=sha256(signature).hexdigest())
            if invitation:
                invitation.used_at = now; invitation.save(update_fields=['used_at'])
        return row, True
    except Exception:
        for path in paths:
            try:
                enrollment_storage.delete_document(path)
            except Exception:
                pass
        raise


class EnrollmentPermitView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def get(self, request):
        rows = permits_for(request.user)
        tournaments = list(rows.order_by('tournament_name').values_list('tournament_name', flat=True).distinct())
        tournament = request.query_params.get('tournament', '').strip()[:140]
        team = request.query_params.get('team', '').strip()[:140]
        if tournament:
            rows = rows.filter(tournament_name=tournament)
        teams = list(rows.order_by('team_name').values_list('team_name', flat=True).distinct())
        if team:
            rows = rows.filter(team_name=team)
        search = request.query_params.get('search', '').strip()[:160]
        if search:
            match = re.fullmatch(r'(?:P-)?0*(\d+)', search, re.IGNORECASE)
            condition = Q(name__icontains=search)
            if match and len(match.group(1)) <= 19 and int(match.group(1)) < 2**63:
                condition |= Q(pk=int(match.group(1)))
            rows = rows.filter(condition)
        dates = {}
        for field in ('date_from', 'date_to'):
            if request.query_params.get(field):
                dates[field] = serializers.DateField().run_validation(request.query_params[field])
        if dates.get('date_from') and dates.get('date_to') and dates['date_from'] > dates['date_to']:
            raise ValidationError('La fecha inicial no puede ser posterior a la final.')
        if 'date_from' in dates:
            rows = rows.filter(issued_at__date__gte=dates['date_from'])
        if 'date_to' in dates:
            rows = rows.filter(issued_at__date__lte=dates['date_to'])
        status = request.query_params.get('status', '')
        if status not in {'', 'active', 'expired'}:
            raise ValidationError('Estado inválido.')
        now = timezone.now()
        if status == 'active':
            rows = rows.filter(issued_at__lte=now, expires_at__gt=now)
        elif status == 'expired':
            rows = rows.filter(expires_at__lte=now)
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except ValueError:
            raise ValidationError('Página inválida.')
        response = Response({'results': [payload(row) for row in rows[(page-1)*20:page*20]], 'count': rows.count(), 'filters': {'tournaments': tournaments, 'teams': teams}})
        response['Cache-Control'] = 'private, no-store'
        return response

    def post(self, request):
        serializer = PermitInput(data=request.data); serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        if not values.get('team_id'):
            raise ValidationError({'team_id': 'Selecciona un equipo.'})
        row, created = issue(values, values['team_id'], request.user)
        return Response(payload(row), status=201 if created else 200)


class EnrollmentPermitInvitationView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def post(self, request):
        field = serializers.IntegerField(min_value=1)
        team_id = field.run_validation(request.data.get('team_id'))
        with transaction.atomic():
            team = locked_team(team_id, request.user)
            row = PlayerPermitInvitation.objects.create(team=team, created_by=request.user,
                                                         expires_at=timezone.now()+timedelta(days=7))
        response = Response({'token': row.token, 'expires_at': row.expires_at}, status=201)
        response['Cache-Control'] = 'private, no-store'
        return response


class PublicEnrollmentPermitView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [EnrollmentThrottle]

    def invitation(self, token):
        row = get_object_or_404(PlayerPermitInvitation.objects.select_related('team__tournament', 'created_by'), token=token)
        creator = row.created_by
        if (not creator.is_active or not enrollment_staff(creator) or not row.team.is_active or not row.team.tournament.is_active
            or not enrollment_sites(creator).filter(pk=row.team.tournament.site_id).exists()):
            raise NotFound()
        return row

    def get(self, request, token):
        row = self.invitation(token)
        if row.used_at or timezone.now() >= row.expires_at:
            return Response({'detail': 'Este enlace ya fue utilizado o venció. Solicita uno nuevo.'}, status=410)
        response = Response({'team': row.team.name, 'tournament': row.team.tournament.name,
                             'terms': TERMS, 'terms_version': TERMS_VERSION})
        response['Cache-Control'] = 'private, no-store'
        response['Referrer-Policy'] = 'no-referrer'
        return response

    def post(self, request, token):
        invitation = self.invitation(token)
        serializer = PermitInput(data=request.data); serializer.is_valid(raise_exception=True)
        row, created = issue(serializer.validated_data, invitation.team_id, invitation.created_by, invitation_token=token)
        response = Response(payload(row), status=201 if created else 200)
        response['Cache-Control'] = 'private, no-store'
        return response


class EnrollmentPermitPhotoView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def get(self, request, pk, kind='photo'):
        row = get_object_or_404(permits_for(request.user), pk=pk)
        prefix = 'signature' if kind == 'signature' else 'photo'
        path = getattr(row, prefix+'_storage_path')
        if path.startswith('r2://'):
            return private_r2_redirect(path, request)
        response = HttpResponse(enrollment_storage.read_document(path), content_type=getattr(row, prefix+'_content_type'))
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
