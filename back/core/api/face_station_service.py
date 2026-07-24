from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.domain_serializers.attendance import attendance_window_bounds, match_team_ids, student_is_in_session_roster
from core.models import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceSessionType,
    FaceRecognitionAttempt,
    FaceStationEvent,
    FaceStationEventStatus,
    Player,
    PlayerAttendanceRecord,
    Student,
    StudentTournamentRegistration,
    User,
    UserRole,
)
from core.services.face_insight import student_reference_path


ACTIVE_STUDENT_STATUSES = ["trial", "active", "paused", "injured"]
SESSION_GRACE_MINUTES = int(getattr(settings, "FACE_STATION_SESSION_GRACE_MINUTES", 60))
MATCH_SESSION_TYPES = {AttendanceSessionType.TOURNAMENT_MATCH, "league_match"}
FACE_STATION_COLLABORATOR_ROLES = {
    UserRole.ADMIN,
    UserRole.DEV,
    UserRole.ACCOUNTING,
    UserRole.OWNER,
    UserRole.SITE_COORDINATOR,
    UserRole.CASHIER,
    UserRole.COACH,
    UserRole.COLLABORATOR,
}


def person_key(person_type: str, person_id: int) -> str:
    return f"{person_type}:{person_id}"


def person_display_name(person) -> str:
    configured = str(getattr(person, "full_name", "") or "").strip()
    if configured:
        return configured
    get_full_name = getattr(person, "get_full_name", None)
    if callable(get_full_name):
        configured = str(get_full_name() or "").strip()
    return configured or str(getattr(person, "username", "") or "").strip()


def serialize_station_person(request, device, person_type: str, person) -> dict:
    configured_photo_url = str(
        getattr(person, "photo_url", "")
        or getattr(person, "avatar_url", "")
        or ""
    ).strip()
    configured_photo = getattr(person, "photo", None)
    configured_photo_name = str(getattr(configured_photo, "name", "") or "").strip()
    reference_source = configured_photo_url or configured_photo_name
    reference_available = bool(reference_source)
    reference_timestamp = (
        getattr(person, "updated_at", None)
        or getattr(person, "date_joined", None)
    )
    reference_timestamp_value = (
        reference_timestamp.isoformat()
        if reference_timestamp
        else ""
    )
    return {
        "key": person_key(person_type, person.id),
        "type": person_type,
        "id": person.id,
        "name": person_display_name(person),
        "site_id": device.site_id,
        "group_name": (
            person.get_role_display()
            if person_type == "collaborator" and hasattr(person, "get_role_display")
            else getattr(person, "group_name", "") or ""
        ),
        "team_name": getattr(getattr(person, "team", None), "name", "") or "",
        "reference_version": f"{reference_timestamp_value}:{reference_source}",
        "reference_available": reference_available,
        "photo_url": (
            request.build_absolute_uri(
                f"/api/face-station/people/{person_type}/{person.id}/photo/"
            )
            if reference_available
            else ""
        ),
    }


def registration_matches_session(registration: dict, session: AttendanceSession) -> bool:
    if session.tournament_id and registration["tournament_id"] != session.tournament_id:
        return False
    if session.team_id:
        return registration["team_id"] == session.team_id
    if session.match_id:
        return registration["team_id"] in match_team_ids(session.match)
    return True


def session_roster(
    session: AttendanceSession,
    students: list[Student],
    players: list[Player],
    registrations_by_student: dict[int, list[dict]] | None = None,
) -> list[str]:
    roster: list[str] = []
    if session.session_type == AttendanceSessionType.ACADEMY_CLASS:
        roster.extend(
            person_key("student", student.id)
            for student in students
            if not session.group_name or student.group_name == session.group_name
        )
        return roster

    if session.session_type not in MATCH_SESSION_TYPES:
        return roster

    if session.session_type == AttendanceSessionType.TOURNAMENT_MATCH and registrations_by_student is None:
        registrations_by_student = {}
        registrations = StudentTournamentRegistration.objects.filter(
            student_id__in=[student.id for student in students],
            status="registered",
        ).values("student_id", "tournament_id", "team_id")
        for registration in registrations:
            registrations_by_student.setdefault(registration["student_id"], []).append(registration)

    if session.session_type == AttendanceSessionType.TOURNAMENT_MATCH:
        roster.extend(
            person_key("student", student.id)
            for student in students
            if any(
                registration_matches_session(registration, session)
                for registration in registrations_by_student.get(student.id, [])
            )
        )

    allowed_team_ids = match_team_ids(session.match) if session.match_id else set()
    for player in players:
        if session.team_id and player.team_id != session.team_id:
            continue
        if allowed_team_ids and player.team_id not in allowed_team_ids:
            continue
        if session.tournament_id and player.team.tournament_id != session.tournament_id:
            continue
        roster.append(person_key("player", player.id))
    return roster


def bootstrap_payload(request, device) -> dict:
    today = timezone.localdate()
    students = list(
        Student.objects.filter(site=device.site, status__in=ACTIVE_STUDENT_STATUSES)
        .select_related("guardian")
        .order_by("full_name")
    )
    players = list(
        Player.objects.filter(team__tournament__site=device.site, is_active=True)
        .select_related("team", "team__tournament")
        .order_by("full_name")
    )
    collaborators = list(
        User.objects.filter(
            primary_site=device.site,
            is_active=True,
            role__in=FACE_STATION_COLLABORATOR_ROLES,
        )
        .exclude(pk=device.service_user_id)
        .order_by("first_name", "last_name", "username")
    )
    sessions = list(
        AttendanceSession.objects.filter(
            site=device.site,
            date__gte=today - timedelta(days=2),
            date__lte=today + timedelta(days=2),
        )
        .select_related("match", "match__home_team", "match__away_team", "team", "tournament")
        .order_by("date", "starts_at")
    )
    registrations_by_student: dict[int, list[dict]] = {}
    registrations = StudentTournamentRegistration.objects.filter(
        student_id__in=[student.id for student in students],
        status="registered",
    ).values("student_id", "tournament_id", "team_id")
    for registration in registrations:
        registrations_by_student.setdefault(registration["student_id"], []).append(registration)

    return {
        "device": {
            "id": str(device.public_id),
            "name": device.name,
            "camera_id": device.camera_id,
            "site_id": device.site_id,
            "site_name": device.site.name,
            "settings": device.settings,
        },
        "server_time": timezone.now().isoformat(),
        "people": [
            *[
                serialize_station_person(request, device, "student", student)
                for student in students
            ],
            *[
                serialize_station_person(request, device, "player", player)
                for player in players
            ],
            *[
                serialize_station_person(request, device, "collaborator", collaborator)
                for collaborator in collaborators
            ],
        ],
        "sessions": [
            {
                "id": session.id,
                "type": session.session_type,
                "date": session.date.isoformat(),
                "starts_at": session.starts_at.isoformat() if session.starts_at else None,
                "ends_at": session.ends_at.isoformat() if session.ends_at else None,
                "duration_minutes": session.duration_minutes,
                "label": session.group_name or str(session.tournament or "Sesion"),
                "closed": bool(session.closed_at),
                "roster": session_roster(session, students, players, registrations_by_student),
            }
            for session in sessions
        ],
        "recognition": {
            "model": "buffalo_l",
            "known_threshold": float(device.settings.get("known_threshold", 0.45)),
            "min_margin": float(device.settings.get("min_margin", 0.03)),
            "unknown_threshold": float(device.settings.get("unknown_threshold", 0.55)),
        },
    }


def person_for_device(device, person_type: str, person_id: int):
    if person_type == "student":
        return Student.objects.filter(pk=person_id, site=device.site, status__in=ACTIVE_STUDENT_STATUSES).first()
    if person_type == "player":
        return Player.objects.filter(pk=person_id, team__tournament__site=device.site, is_active=True).first()
    if person_type == "collaborator":
        return User.objects.filter(
            pk=person_id,
            primary_site=device.site,
            is_active=True,
            role__in=FACE_STATION_COLLABORATOR_ROLES,
        ).exclude(pk=device.service_user_id).first()
    return None


def person_in_session(person_type: str, person, session: AttendanceSession) -> bool:
    if person_type == "collaborator":
        return False
    if person_type == "student":
        return student_is_in_session_roster(person, session)
    if session.session_type not in MATCH_SESSION_TYPES:
        return False
    if session.team_id:
        return person.team_id == session.team_id
    if session.match_id:
        return person.team_id in match_team_ids(session.match)
    if session.tournament_id:
        return person.team.tournament_id == session.tournament_id
    return person.team.tournament.site_id == session.site_id


def timestamp_in_session(occurred_at, session: AttendanceSession) -> bool:
    start, end = attendance_window_bounds(session)
    if not start or not end:
        return session.date == timezone.localtime(occurred_at).date()
    grace = timedelta(minutes=SESSION_GRACE_MINUTES)
    return start - grace <= occurred_at <= end + grace


def resolve_session(device, person_type: str, person, occurred_at, requested_id=None):
    if person_type == "collaborator":
        return None
    queryset = AttendanceSession.objects.filter(site=device.site).select_related(
        "match", "match__home_team", "match__away_team", "team", "tournament"
    )
    if requested_id:
        session = queryset.filter(pk=requested_id).first()
        if session and person_in_session(person_type, person, session) and timestamp_in_session(occurred_at, session):
            return session
        return None

    local_date = timezone.localtime(occurred_at).date()
    candidates = queryset.filter(date__gte=local_date - timedelta(days=1), date__lte=local_date + timedelta(days=1))
    matches = [
        session
        for session in candidates
        if person_in_session(person_type, person, session) and timestamp_in_session(occurred_at, session)
    ]
    if not matches:
        return None
    return min(
        matches,
        key=lambda session: abs((attendance_window_bounds(session)[0] or occurred_at) - occurred_at),
    )


def parse_event(data: dict) -> dict:
    event_id = UUID(str(data.get("event_id", "")))
    occurred_at = parse_datetime(str(data.get("occurred_at", "")))
    if not occurred_at:
        raise ValueError("occurred_at debe ser una fecha ISO valida.")
    if timezone.is_naive(occurred_at):
        occurred_at = timezone.make_aware(occurred_at, timezone.get_current_timezone())
    return {
        "event_id": event_id,
        "person_type": str(data.get("person_type", "")),
        "person_id": int(data.get("person_id")),
        "occurred_at": occurred_at,
        "session_id": int(data["session_id"]) if data.get("session_id") else None,
        "detection_count": max(1, min(100000, int(data.get("detection_count", 1)))),
        "similarity": max(-1.0, min(1.0, float(data.get("similarity", 0)))),
        "source_subject_id": str(data.get("source_subject_id", ""))[:80],
        "metadata": data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
    }


@transaction.atomic
def sync_detection_event(device, raw_event: dict) -> dict:
    event = parse_event(raw_event)
    existing = FaceStationEvent.objects.select_related("session").filter(event_id=event["event_id"]).first()
    if existing:
        return {"event_id": str(existing.event_id), "status": existing.status, "session_id": existing.session_id, "duplicate": True}

    person = person_for_device(device, event["person_type"], event["person_id"])
    if not person:
        raise ValueError("La persona no pertenece al padron activo de esta estacion.")
    session = resolve_session(
        device,
        event["person_type"],
        person,
        event["occurred_at"],
        requested_id=event["session_id"],
    )
    event_status = (
        FaceStationEventStatus.SYNCED
        if session or event["person_type"] == "collaborator"
        else FaceStationEventStatus.NO_SESSION
    )
    create_values = {
        "event_id": event["event_id"],
        "device": device,
        "person_type": event["person_type"],
        "occurred_at": event["occurred_at"],
        "detection_count": event["detection_count"],
        "similarity": event["similarity"],
        "source_subject_id": event["source_subject_id"],
        "session": session,
        "status": event_status,
        "metadata": event["metadata"],
        event["person_type"]: person,
    }
    saved_event = FaceStationEvent.objects.create(**create_values)
    if not session:
        return {"event_id": str(saved_event.event_id), "status": saved_event.status, "session_id": None, "duplicate": False}

    if event["person_type"] == "student":
        had_debt = person.charges.filter(status__in=["pending", "partial"]).exists()
        AttendanceRecord.objects.update_or_create(
            session=session,
            student=person,
            defaults={"status": "present", "had_debt_at_capture": had_debt, "captured_by": device.service_user},
        )
        FaceRecognitionAttempt.objects.create(
            session=session,
            student=person,
            captured_by=device.service_user,
            matched=True,
            confidence=event["similarity"],
            engine="insightface-station",
            notes=f"Estacion {device.name}; evento {event['event_id']}.",
        )
    else:
        had_debt = person.team.charges.filter(status__in=["pending", "partial"]).exists()
        PlayerAttendanceRecord.objects.update_or_create(
            session=session,
            player=person,
            defaults={"status": "present", "had_team_debt_at_capture": had_debt, "captured_by": device.service_user},
        )
    return {"event_id": str(saved_event.event_id), "status": saved_event.status, "session_id": session.id, "duplicate": False}


def person_photo_response(device, person_type: str, person_id: int):
    person = person_for_device(device, person_type, person_id)
    if not person:
        raise LookupError("Persona no encontrada.")
    reference_path = student_reference_path(person)
    if not reference_path:
        raise LookupError("La persona no tiene foto de referencia.")
    path = Path(reference_path)
    payload = path.read_bytes()
    try:
        path.resolve().relative_to(Path(settings.MEDIA_ROOT).resolve())
    except ValueError:
        path.unlink(missing_ok=True)
    response = HttpResponse(payload, content_type="image/jpeg")
    response["Cache-Control"] = "private, max-age=86400"
    return response
