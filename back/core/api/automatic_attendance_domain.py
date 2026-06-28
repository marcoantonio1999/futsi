from __future__ import annotations

import html
import http.cookiejar
import json
import os
import re
import shutil
import subprocess
import threading
import time as time_module
from collections.abc import Sequence
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import close_old_connections, connection
from django.http import FileResponse
from django.utils import timezone
from django.utils.text import get_valid_filename, slugify
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .common import *
from core.services.match_sessions import ensure_match_attendance_sessions
from core.services.face_insight import build_student_database, detect_embeddings, student_reference_path
from core.services.supabase_storage import download_private_file, parse_storage_uri, upload_private_file

from .automatic_attendance_state import *


def summarize_session(session: AttendanceSession) -> dict:
    return {
        "id": session.id,
        "site": session.site_id,
        "site_name": session.site.name,
        "date": session.date.isoformat(),
        "starts_at": session.starts_at.isoformat() if session.starts_at else None,
        "ends_at": session.ends_at.isoformat() if session.ends_at else None,
        "duration_minutes": session.duration_minutes,
        "session_type": session.session_type,
        "group_name": session.group_name,
        "match": session.match_id,
        "match_name": f"{session.match.home_team.name} vs {session.match.away_team.name}" if session.match_id else "",
        "team": session.team_id,
        "team_name": session.team.name if session.team_id else "",
        "tournament": session.tournament_id,
        "tournament_name": session.tournament.name if session.tournament_id else "",
    }


def get_or_create_match_sessions(match: Match, user: User) -> list[AttendanceSession]:
    return ensure_match_attendance_sessions(match, user)


def resolve_sessions(video_path: Path, metadata: dict, user: User) -> list[AttendanceSession]:
    session_id = metadata.get("session_id")
    if session_id:
        return list(AttendanceSession.objects.select_related("site").filter(id=session_id, closed_at__isnull=True))

    site_id = metadata.get("site_id")
    if not site_id:
        return []

    recorded_date = metadata.get("recorded_date")
    if recorded_date:
        try:
            session_date = datetime.fromisoformat(recorded_date).date()
        except ValueError:
            session_date = timezone.localdate()
    else:
        session_date = datetime.fromtimestamp(video_path.stat().st_mtime, tz=timezone.get_current_timezone()).date()

    existing_sessions = list(
        AttendanceSession.objects.select_related("site")
        .filter(site_id=site_id, date=session_date, closed_at__isnull=True)
        .order_by("starts_at", "id")
    )

    matches = (
        Match.objects.select_related("site", "tournament", "round", "home_team", "away_team")
        .filter(site_id=site_id, played_on=session_date)
        .exclude(status="canceled")
        .order_by("starts_at", "id")
    )
    match_sessions = []
    for match in matches:
        match_sessions.extend(get_or_create_match_sessions(match, user))

    sessions_by_id = {session.id: session for session in existing_sessions + match_sessions}
    return sorted(sessions_by_id.values(), key=lambda session: (session.starts_at or time.min, session.id))


def roster_for_session(session: AttendanceSession) -> Sequence[object]:
    if session.session_type == "tournament_match":
        team_ids = []
        if session.team_id:
            team_ids = [session.team_id]
        elif session.match_id:
            team_ids = [session.match.home_team_id, session.match.away_team_id]
        registered_students = list(
            Student.objects.filter(
                tournament_registrations__tournament=session.tournament,
                tournament_registrations__team_id__in=team_ids,
                tournament_registrations__status="registered",
                status__in=ACTIVE_STUDENT_STATUSES,
            ).distinct()
        )
        if registered_students:
            return registered_students
        return list(Player.objects.select_related("team").filter(team_id__in=team_ids, is_active=True))

    roster = Student.objects.filter(site=session.site, status__in=ACTIVE_STUDENT_STATUSES)
    if session.group_name:
        roster = roster.filter(group_name=session.group_name)
    return list(roster)


def person_type(person: object) -> str:
    return "player" if isinstance(person, Player) else "student"


def person_key(person: object) -> str:
    return f"{person_type(person)}:{getattr(person, 'id', '')}"


def person_team_id(person: object) -> int | None:
    return getattr(person, "team_id", None)


def person_team_name(person: object) -> str:
    team = getattr(person, "team", None)
    return getattr(team, "name", "") if team else ""


def expected_roster_keys(session: AttendanceSession) -> set[str]:
    return {person_key(person) for person in roster_for_session(session)}


def comparison_roster_for_session(session: AttendanceSession) -> Sequence[object]:
    roster = list(roster_for_session(session))
    include_off_roster = os.getenv("AUTO_ATTENDANCE_INCLUDE_OFF_ROSTER_KNOWN", "1").lower() not in {"0", "false", "no", "off"}
    if not include_off_roster or session.session_type != "tournament_match":
        return roster

    candidates: list[object] = list(roster)
    if session.tournament_id:
        candidates.extend(
            Player.objects.select_related("team")
            .filter(team__tournament_id=session.tournament_id, is_active=True)
            .order_by("team_id", "full_name", "id")
        )
        candidates.extend(
            Student.objects.filter(
                tournament_registrations__tournament_id=session.tournament_id,
                tournament_registrations__status="registered",
                status__in=ACTIVE_STUDENT_STATUSES,
            )
            .distinct()
            .order_by("full_name", "id")
        )
    elif session.match_id:
        team_ids = [session.match.home_team_id, session.match.away_team_id]
        candidates.extend(Player.objects.select_related("team").filter(team_id__in=team_ids, is_active=True))

    deduped: dict[str, object] = {}
    for person in candidates:
        deduped.setdefault(person_key(person), person)
    return list(deduped.values())


def has_configured_reference(person: object) -> bool:
    photo = getattr(person, "photo", None)
    if photo and getattr(photo, "name", ""):
        return True
    photo_url = getattr(person, "photo_url", "") or ""
    return photo_url.startswith("supabase://") or photo_url.startswith("/media/") or photo_url.startswith("media/")


def roster_reference_status(session: AttendanceSession) -> dict:
    roster = list(roster_for_session(session))
    configured = [person for person in roster if has_configured_reference(person)]
    missing = [getattr(person, "full_name", str(person)) for person in roster if not has_configured_reference(person)]
    return {
        "roster_count": len(roster),
        "configured_count": len(configured),
        "missing": missing,
    }


def comparison_reference_status(session: AttendanceSession) -> dict:
    people = list(comparison_roster_for_session(session))
    configured = [person for person in people if has_configured_reference(person)]
    missing = [getattr(person, "full_name", str(person)) for person in people if not has_configured_reference(person)]
    return {
        "roster_count": len(people),
        "configured_count": len(configured),
        "missing": missing,
    }


def team_has_debt(team: Team) -> bool:
    return team.charges.filter(status__in=["pending", "partial"]).exists()


def mark_present(
    session: AttendanceSession,
    person: object,
    user: User,
    similarity: float,
    hits: int,
    video_name: str,
    evidence_path: str = "",
    source_label: str = "Pase de lista automatico por video local",
    engine: str = "insightface-video",
) -> None:
    confidence = Decimal(str(similarity)).quantize(Decimal("0.0001"))
    if session.session_type == "tournament_match" and isinstance(person, Player):
        PlayerAttendanceRecord.objects.update_or_create(
            session=session,
            player=person,
            defaults={
                "status": "present",
                "had_team_debt_at_capture": team_has_debt(person.team),
                "override_reason": f"{source_label}: {video_name}",
                "captured_by": user,
            },
        )
        return

    student = person
    AttendanceRecord.objects.update_or_create(
        session=session,
        student=student,
        defaults={
            "status": "present",
            "had_debt_at_capture": student.charges.filter(status__in=["pending", "partial"]).exists(),
            "override_reason": f"{source_label}: {video_name}",
            "captured_by": user,
        },
    )
    FaceRecognitionAttempt.objects.create(
        session=session,
        student=student,
        captured_by=user,
        matched=True,
        confidence=confidence,
        engine=engine,
        notes=f"{source_label}. Video {video_name}. Hits: {hits}. Mejor similitud: {similarity:.4f}. Evidencia: {evidence_path}",
    )
