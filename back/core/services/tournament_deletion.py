"""Delete a reviewed tournament and its dependent records, never academy students."""
import hashlib
import json
from collections.abc import Mapping

from django.core import signing
from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import APIException, ValidationError

from core.models import (
    Tournament, Team, Round, Match, StudentTournamentRegistration, Player,
    AttendanceSession, AttendanceRecord, PlayerAttendanceRecord, FaceRecognitionAttempt,
    FaceStationEvent, FaceStationUnknownLink, FaceStationDailyPresence, FaceStationDailyReport,
    Charge, Payment, Discount, Invoice, HistoricalImportRow, AuditLog,
)
from .student_deletion import collect_owned_files, cleanup_files

SALT = "futsi.tournament-deletion.v1"


class TournamentChanged(APIException):
    status_code = 409
    default_detail = "Los datos del torneo cambiaron. Actualiza el detalle y vuelve a confirmar."


def deletion_plan(tournament, *, lock=False):
    groups = []

    def add(model, label, condition):
        query = model.objects.filter(condition).order_by("pk")
        rows = list(query.select_for_update() if lock else query)
        groups.append({"model": model, "label": label, "rows": rows})
        return [row.pk for row in rows]

    teams = add(Team, "Equipos", Q(tournament=tournament))
    rounds = add(Round, "Jornadas", Q(tournament=tournament))
    registrations = add(StudentTournamentRegistration, "Inscripciones de alumnos", Q(tournament=tournament) | Q(team_id__in=teams))
    players = add(Player, "Jugadores de equipos de adultos", Q(team_id__in=teams))
    matches = add(Match, "Partidos y marcadores", Q(tournament=tournament) | Q(round_id__in=rounds) | Q(home_team_id__in=teams) | Q(away_team_id__in=teams))
    sessions = add(AttendanceSession, "Sesiones del torneo", Q(tournament=tournament) | Q(team_id__in=teams) | Q(round_id__in=rounds) | Q(match_id__in=matches))
    charges = add(Charge, "Cargos del torneo", Q(tournament_registration_id__in=registrations) | Q(team_id__in=teams))
    payments = add(Payment, "Pagos del torneo", Q(charge_id__in=charges) | Q(team_id__in=teams))
    add(Discount, "Descuentos del torneo", Q(charge_id__in=charges) | Q(team_id__in=teams))
    add(Invoice, "Facturas vinculadas", Q(charge_id__in=charges) | Q(payment_id__in=payments))
    add(AttendanceRecord, "Asistencias del torneo", Q(session_id__in=sessions) | Q(team_id__in=teams))
    add(PlayerAttendanceRecord, "Asistencias de jugadores", Q(session_id__in=sessions) | Q(player_id__in=players))
    add(FaceRecognitionAttempt, "Reconocimientos del torneo", Q(session_id__in=sessions))
    add(FaceStationEvent, "Eventos vinculados de FaceGuard", Q(session_id__in=sessions) | Q(player_id__in=players))
    add(FaceStationUnknownLink, "Vínculos de jugadores en FaceGuard", Q(player_id__in=players))
    keys = [f"player:{pk}" for pk in players]
    add(FaceStationDailyPresence, "Presencias de jugadores", Q(canonical_person_key__in=keys) | Q(subject_key__in=keys))
    groups.append({"model": Tournament, "label": "Torneo", "rows": [tournament]})
    history = Q(pk__in=[])
    for group in groups:
        history |= Q(target_table=group["model"]._meta.db_table, target_id__in=[str(row.pk) for row in group["rows"]])
    add(HistoricalImportRow, "Filas de importaciones vinculadas", history)
    files = collect_owned_files(groups)
    fingerprint = hashlib.sha256(json.dumps({
        "records": [[group["model"]._meta.label, [[row.pk, {field.attname: getattr(row, field.attname) for field in row._meta.fields}] for row in group["rows"]]] for group in groups],
        "files": files,
    }, sort_keys=True, default=str).encode()).hexdigest()
    return {"groups": groups, "files": files, "fingerprint": fingerprint}


def preview(tournament, actor):
    plan = deletion_plan(tournament)
    return {
        "tournament_id": tournament.pk, "full_name": tournament.name,
        "items": [{"label": group["label"], "count": len(group["rows"])} for group in plan["groups"] if group["rows"]],
        "file_count": len(plan["files"]),
        "confirmation_token": signing.dumps({"tournament": tournament.pk, "actor": actor.pk, "fingerprint": plan["fingerprint"]}, salt=SALT),
    }


def permanently_delete(tournament, actor, payload):
    if not isinstance(payload, Mapping) or not isinstance(payload.get("confirmation_token"), str):
        raise ValidationError("Revisa los datos asociados antes de confirmar la eliminación.")
    try:
        confirmation = signing.loads(payload["confirmation_token"], salt=SALT, max_age=600)
    except signing.BadSignature as exc:
        raise ValidationError("La confirmación venció o no es válida. Actualiza el detalle.") from exc
    if confirmation.get("tournament") != tournament.pk or confirmation.get("actor") != actor.pk:
        raise ValidationError("La confirmación no corresponde a este torneo o usuario.")
    with transaction.atomic():
        tournament = Tournament.objects.select_for_update().get(pk=tournament.pk)
        if str(payload.get("confirmation_name", "")).strip() != tournament.name.strip():
            raise ValidationError("Escribe el nombre del torneo para confirmar su eliminación definitiva.")
        plan = deletion_plan(tournament, lock=True)
        if confirmation.get("fingerprint") != plan["fingerprint"]:
            raise TournamentChanged()
        by_model = {group["model"]: [row.pk for row in group["rows"]] for group in plan["groups"]}
        report_ids = FaceStationDailyPresence.objects.filter(pk__in=by_model[FaceStationDailyPresence]).values_list("report_id", flat=True)
        reports = list(FaceStationDailyReport.objects.select_for_update().filter(pk__in=report_ids).order_by("pk"))
        order = [HistoricalImportRow, Invoice, Discount, Payment, Charge, StudentTournamentRegistration,
                 AttendanceRecord, PlayerAttendanceRecord, FaceRecognitionAttempt, FaceStationEvent,
                 FaceStationUnknownLink, FaceStationDailyPresence, AttendanceSession, Match, Round, Player, Team, Tournament]
        for model in order:
            ids = by_model[model]
            AuditLog.objects.filter(table_name=model._meta.db_table, record_id__in=[str(pk) for pk in ids]).delete()
            model.objects.filter(pk__in=ids).delete()
        for report in reports:
            report.row_count = report.presences.count()
            report.save(update_fields=["row_count", "updated_at"])
        audit = AuditLog.objects.create(actor=actor, action="tournament_deleted", table_name="tournaments", record_id=str(tournament.pk),
            metadata={"site_id": tournament.site_id, "counts": {group["model"]._meta.db_table: len(group["rows"]) for group in plan["groups"]}, "pending_files": plan["files"]})
    return cleanup_files(audit)
