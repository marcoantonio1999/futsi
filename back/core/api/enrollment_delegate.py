from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.api.enrollments import EnrollmentStaffPermission, enrollment_sites, invitations_for
from core.enrollment_models import PlayerEnrollment
from core.models import Team, Tournament


class EnrollmentDelegateView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def post(self, request, pk):
        class DelegateInput(serializers.Serializer):
            enrollment_id = serializers.IntegerField(min_value=1)

        serializer = DelegateInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = get_object_or_404(Team, pk=pk, tournament__site__in=enrollment_sites(request.user))
        # Use the same lock order as enrollment and withdrawal, so a player
        # cannot be selected while another request withdraws that player.
        with transaction.atomic():
            tournament = get_object_or_404(Tournament.objects.select_for_update(), pk=target.tournament_id)
            team = get_object_or_404(Team.objects.select_for_update(), pk=pk, tournament=tournament)
            if not team.is_active or not tournament.is_active:
                raise ValidationError('El equipo o torneo ya no está disponible.')
            row = get_object_or_404(
                PlayerEnrollment.objects.select_for_update(),
                pk=serializer.validated_data['enrollment_id'], team_record=team,
                withdrawn_at__isnull=True, invitation__in=invitations_for(request.user),
            )
            PlayerEnrollment.objects.filter(team_record=team, is_delegate=True).exclude(pk=row.pk).update(is_delegate=False)
            if not row.is_delegate:
                row.is_delegate = True
                row.save(update_fields=['is_delegate'])
            team.representative_name = row.name
            team.representative_phone = row.phone
            # A prior delegate's email must not remain attached to the new one.
            team.representative_email = ''
            team.save(update_fields=['representative_name', 'representative_phone', 'representative_email'])
        response = Response({'id': row.pk, 'name': row.name, 'is_delegate': True})
        response['Cache-Control'] = 'no-store'
        return response
