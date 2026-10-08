"""Remove a team assignment without deleting any client or their documents."""
from hashlib import sha256
from django.core import signing
from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError
from core.models import Team, Player, StudentTournamentRegistration, Match, AttendanceSession, AttendanceRecord, Charge, Payment, Discount, AuditLog
from core.enrollment_models import PlayerEnrollmentInvitation, PlayerEnrollment

SALT = "futsi.team-deletion.v1"


def plan(team):
    players = list(Player.objects.filter(team=team).order_by('pk').values_list('pk', 'updated_at'))
    registrations = list(StudentTournamentRegistration.objects.filter(team=team).order_by('pk').values_list('pk', 'updated_at'))
    if (Match.objects.filter(Q(home_team=team) | Q(away_team=team)).exists()
        or AttendanceSession.objects.filter(team=team).exists()
        or AttendanceRecord.objects.filter(team=team).exists()
        or Charge.objects.filter(team=team).exists()
        or Payment.objects.filter(team=team).exists()
        or Discount.objects.filter(team=team).exists()
        or PlayerEnrollmentInvitation.objects.filter(team_record=team).exists()
        or PlayerEnrollment.objects.filter(team_record=team).exists()):
        raise ValidationError('Este equipo tiene partidos, movimientos o enlaces de inscripción. No se elimina para conservar ese historial; primero revisa sus registros.')
    fingerprint = sha256(repr((team.pk, team.name, team.updated_at, players, registrations)).encode()).hexdigest()
    return players, registrations, fingerprint


def preview(team, actor):
    players, registrations, fingerprint = plan(team)
    return {'full_name': team.name, 'items': [{'label': 'Equipo', 'count': 1}], 'file_count': 0,
        'preserved_player_count': len(players), 'preserved_registration_count': len(registrations),
        'confirmation_token': signing.dumps({'team': team.pk, 'actor': actor.pk, 'fingerprint': fingerprint}, salt=SALT)}


def permanently_delete(team, actor, payload):
    try:
        confirmation = signing.loads(payload.get('confirmation_token', ''), salt=SALT, max_age=600)
    except (signing.BadSignature, TypeError):
        raise ValidationError('Revisa el detalle y confirma de nuevo.')
    with transaction.atomic():
        team = Team.objects.select_for_update().get(pk=team.pk)
        if confirmation.get('team') != team.pk or confirmation.get('actor') != actor.pk or payload.get('confirmation_name', '').strip() != team.name.strip():
            raise ValidationError('Escribe el nombre del equipo para confirmar.')
        list(Player.objects.select_for_update().filter(team=team))
        list(StudentTournamentRegistration.objects.select_for_update().filter(team=team))
        players, registrations, fingerprint = plan(team)
        if fingerprint != confirmation.get('fingerprint'):
            raise ValidationError('El equipo cambió. Actualiza el detalle antes de confirmar.')
        audit = AuditLog.objects.create(actor=actor, action='team_deleted', table_name='teams', record_id=str(team.pk),
            metadata={'site_id': team.tournament.site_id, 'team_name': team.name,
                      'preserved_player_ids': [pk for pk, _ in players], 'preserved_registration_ids': [pk for pk, _ in registrations]})
        Player.objects.filter(team=team).update(team=None)
        StudentTournamentRegistration.objects.filter(team=team).update(team=None)
        team.delete()
        return {'deletion_id': audit.pk, 'cleanup_pending': 0, 'cleanup_items': []}
