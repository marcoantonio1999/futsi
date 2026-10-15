import calendar
from decimal import Decimal
from datetime import timedelta
from uuid import uuid4
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, permissions
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import Team, Player, PlayerSanction, Tournament
from core.enrollment_models import PlayerEnrollment
from core.sanction_catalog import CATALOG, BY_CODE
from core.api.enrollments import enrollment_staff
from core.services.player_blacklist import lock_identity, identity_key


class SanctionPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and (user.role in {'admin','owner','dev','site_coordinator'}
            or (user.username.casefold() == 'emilio' and enrollment_staff(user)))


def allowed_teams(user):
    rows = Team.objects.filter(is_active=True, tournament__is_active=True, tournament__site__is_active=True)
    if user.role in {'site_coordinator', 'cashier'}:
        rows = rows.filter(tournament__site_id=user.primary_site_id)
    return rows


def calculate_end(start, unit, value):
    if unit in {'days', 'weeks'}:
        return start + timedelta(days=value * (7 if unit == 'weeks' else 1) - 1)
    months = value * (12 if unit == 'years' else 1)
    year, month = divmod(start.year * 12 + start.month - 1 + months, 12)
    if year > 9999:
        raise ValidationError('La duración es demasiado larga.')
    boundary = start.replace(year=year, month=month + 1, day=min(start.day, calendar.monthrange(year, month + 1)[1]))
    return boundary - timedelta(days=1)


class SanctionInput(serializers.Serializer):
    team_id = serializers.IntegerField(min_value=1)
    member_type = serializers.ChoiceField(choices=['enrollment', 'player'])
    member_id = serializers.IntegerField(min_value=1)
    offense_code = serializers.ChoiceField(choices=list(BY_CODE))
    reason = serializers.CharField(min_length=3, max_length=2000)
    fine_amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'), required=False, allow_null=True)
    incident_on = serializers.DateField()
    starts_on = serializers.DateField()
    duration_unit = serializers.ChoiceField(choices=['days','weeks','months','years','dates','indefinite'])
    duration_value = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    ends_on = serializers.DateField(required=False)
    request_id = serializers.UUIDField(default=uuid4)

    def validate(self, data):
        if data['incident_on'] > timezone.localdate():
            raise ValidationError('La fecha del incidente no puede estar en el futuro.')
        if data['starts_on'] < data['incident_on']:
            raise ValidationError('La sanción no puede comenzar antes del incidente.')
        unit = data['duration_unit']
        if unit == 'indefinite':
            data['duration_value'] = None; data['ends_on'] = None
        elif unit == 'dates':
            if not data.get('ends_on') or data['ends_on'] < data['starts_on']:
                raise ValidationError('Selecciona una fecha final igual o posterior al inicio.')
            data['duration_value'] = None
        else:
            if not data.get('duration_value'):
                raise ValidationError('Indica la duración elegida por el coordinador.')
            try:
                data['ends_on'] = calculate_end(data['starts_on'], unit, data['duration_value'])
            except (OverflowError, ValueError):
                raise ValidationError('La duración es demasiado larga.')
        return data


class PlayerSanctionView(APIView):
    permission_classes = [SanctionPermission]

    def get(self, request):
        members = []
        if request.query_params.get('team_id'):
            pk = serializers.IntegerField(min_value=1).run_validation(request.query_params['team_id'])
            team = get_object_or_404(allowed_teams(request.user), pk=pk)
            members = [{'id':row.pk, 'type':'enrollment', 'name':row.name, 'is_delegate':row.is_delegate} for row in PlayerEnrollment.objects.filter(team_record=team, withdrawn_at__isnull=True).only('id','name','is_delegate')]
            members += [{'id':row.pk, 'type':'player', 'name':row.full_name, 'is_delegate':False} for row in Player.objects.filter(team=team,is_active=True).only('id','full_name')]
        response = Response({'catalog':CATALOG, 'members':sorted(members,key=lambda row:row['name'].casefold())})
        response['Cache-Control'] = 'no-store'
        return response

    def post(self, request):
        serializer = SanctionInput(data=request.data); serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        team_id, member_id, member_type = data.pop('team_id'), data.pop('member_id'), data.pop('member_type')
        team = get_object_or_404(allowed_teams(request.user),pk=team_id)
        offense = BY_CODE[data['offense_code']]
        with transaction.atomic():
            Tournament.objects.select_for_update().get(pk=team.tournament_id)
            team = get_object_or_404(allowed_teams(request.user).select_for_update(),pk=team.pk)
            if member_type == 'enrollment':
                member = get_object_or_404(PlayerEnrollment.objects.select_for_update(),pk=member_id,team_record=team,withdrawn_at__isnull=True)
                lock_identity(member.identity_key or identity_key(member.name, member.birth_date))
                member_fields = {'enrollment':member,'player':None,'player_name':member.name}
            else:
                member = get_object_or_404(Player.objects.select_for_update(),pk=member_id,team=team,is_active=True)
                member_fields = {'player':member,'enrollment':None,'player_name':member.full_name}
            values = {**data,**member_fields,'team':team,'created_by':request.user,
                'offense_label':offense['label'],'recommended_duration':offense['recommendation']}
            request_id = values.pop('request_id')
            row, created = PlayerSanction.objects.get_or_create(request_id=request_id,defaults=values)
            if not created and any(getattr(row,field) != value for field,value in values.items()):
                raise ValidationError('La solicitud ya fue registrada con otros datos. Recarga antes de registrar otra sanción.')
        return Response({'id':row.pk,'player_name':row.player_name,'offense':row.offense_label,
            'recommendation':row.recommended_duration,'starts_on':row.starts_on,'ends_on':row.ends_on,
            'duration_unit':row.duration_unit,'duration_value':row.duration_value,'reason':row.reason,
            'applied_by':request.user.username},status=201 if created else 200)
