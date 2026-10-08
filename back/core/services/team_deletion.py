"""Remove a team assignment without deleting any client or their documents."""
from hashlib import sha256
import json
from django.core import signing
from django.db import connection, transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError
from core.models import Team, Player, StudentTournamentRegistration, Match, AttendanceSession, AttendanceRecord, Charge, Payment, Discount, AuditLog
from core.enrollment_models import PlayerEnrollmentInvitation, PlayerEnrollment

SALT = "futsi.team-deletion.v1"


def linked_clips(matches, sessions, *, lock=False):
    # FaceGuard owns this table outside Django's model registry.
    if 'video_clips' not in connection.introspection.table_names():
        return []
    conditions, params = [], []
    for column, rows in [('match_id', matches), ('attendance_session_id', sessions)]:
        if rows:
            conditions.append(f"{column} IN ({','.join(['%s'] * len(rows))})")
            params.extend(row.pk for row in rows)
    if not conditions:
        return []
    suffix = ' FOR UPDATE' if lock and connection.vendor == 'postgresql' else ''
    with connection.cursor() as cursor:
        cursor.execute('SELECT id, status, match_id, attendance_session_id, metadata FROM video_clips WHERE '
                       + ' OR '.join(conditions) + ' ORDER BY id' + suffix, params)
        clips = cursor.fetchall()
    if any(row[1] not in {'deleted', 'processed', 'failed'} for row in clips):
        raise ValidationError('Estos partidos tienen grabaciones o procesos de video pendientes. Espera a que terminen antes de eliminar el equipo.')
    return clips


def plan(team, *, lock=False):
    players = list(Player.objects.filter(team=team).order_by('pk').values_list('pk', 'updated_at'))
    registrations = list(StudentTournamentRegistration.objects.filter(team=team).order_by('pk').values_list('pk', 'updated_at'))
    match_query = Match.objects.filter(Q(home_team=team) | Q(away_team=team)).order_by('pk')
    matches = list(match_query.select_for_update() if lock else match_query)
    session_query = AttendanceSession.objects.filter(Q(team=team) | Q(match_id__in=[m.pk for m in matches])).order_by('pk')
    sessions = list(session_query.select_for_update() if lock else session_query)
    clips = linked_clips(matches, sessions, lock=lock)
    if any(m.status != 'scheduled' or m.home_goals or m.away_goals for m in matches):
        raise ValidationError('El equipo tiene partidos con actividad o resultados registrados. No se elimina su historial.')
    for session in sessions:
        if session.closed_at or any(relation.related_model.objects.filter(**{relation.field.attname: session.pk}).exists()
                                    for relation in AttendanceSession._meta.related_objects):
            raise ValidationError('El equipo tiene sesiones con asistencias, reconocimientos u otra actividad registrada. No se elimina su historial.')
    for match in matches:
        if any(relation.related_model is not AttendanceSession
               and relation.related_model.objects.filter(**{relation.field.attname: match.pk}).exists()
               for relation in Match._meta.related_objects):
            raise ValidationError('El equipo tiene datos registrados en sus partidos. No se elimina su historial.')
    if (AttendanceRecord.objects.filter(team=team).exists()
        or Charge.objects.filter(team=team).exists()
        or Payment.objects.filter(team=team).exists()
        or Discount.objects.filter(team=team).exists()
        or PlayerEnrollmentInvitation.objects.filter(team_record=team).exists()
        or PlayerEnrollment.objects.filter(team_record=team).exists()):
        raise ValidationError('Este equipo tiene partidos, movimientos o enlaces de inscripción. No se elimina para conservar ese historial; primero revisa sus registros.')
    scheduled_records = [(row._meta.label, [(field.attname, getattr(row, field.attname)) for field in row._meta.fields]) for row in matches + sessions]
    fingerprint = sha256(repr((team.pk, team.name, team.updated_at, players, registrations, scheduled_records,
                              json.dumps(clips, sort_keys=True, default=str))).encode()).hexdigest()
    return players, registrations, fingerprint, matches, sessions, clips


def preview(team, actor):
    players, registrations, fingerprint, matches, sessions, clips = plan(team)
    items = [{'label': 'Equipo', 'count': 1}]
    if matches:
        items.append({'label': 'Partidos programados sin resultados', 'count': len(matches)})
    if sessions:
        items.append({'label': 'Sesiones sin actividad registrada', 'count': len(sessions)})
    return {'full_name': team.name, 'items': items, 'file_count': 0,
        'preserved_player_count': len(players), 'preserved_registration_count': len(registrations),
        'preserved_video_count': len(clips),
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
        players, registrations, fingerprint, matches, sessions, clips = plan(team, lock=True)
        if fingerprint != confirmation.get('fingerprint'):
            raise ValidationError('El equipo cambió. Actualiza el detalle antes de confirmar.')
        audit = AuditLog.objects.create(actor=actor, action='team_deleted', table_name='teams', record_id=str(team.pk),
            metadata={'site_id': team.tournament.site_id, 'team_name': team.name,
                      'preserved_player_ids': [pk for pk, _ in players], 'preserved_registration_ids': [pk for pk, _ in registrations],
                      'deleted_scheduled_match_ids': [row.pk for row in matches], 'deleted_empty_session_ids': [row.pk for row in sessions],
                      'preserved_video_clip_ids': [str(row[0]) for row in clips]})
        with connection.cursor() as cursor:
            for clip_id, _, match_id, session_id, metadata in clips:
                metadata = json.loads(metadata) if isinstance(metadata, str) else dict(metadata or {})
                metadata['team_deletion_evidence'] = {'team_id': team.pk, 'match_id': match_id,
                    'attendance_session_id': session_id, 'deletion_id': audit.pk}
                json_value = '%s::jsonb' if connection.vendor == 'postgresql' else '%s'
                cursor.execute(f'UPDATE video_clips SET match_id=NULL, attendance_session_id=NULL, metadata={json_value} WHERE id=%s',
                               [json.dumps(metadata), clip_id])
        Player.objects.filter(team=team).update(team=None)
        StudentTournamentRegistration.objects.filter(team=team).update(team=None)
        AttendanceSession.objects.filter(pk__in=[row.pk for row in sessions]).delete()
        Match.objects.filter(pk__in=[row.pk for row in matches]).delete()
        team.delete()
        return {'deletion_id': audit.pk, 'cleanup_pending': 0, 'cleanup_items': []}
