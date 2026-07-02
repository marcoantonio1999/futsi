from datetime import datetime, timedelta

from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from core.models import AttendanceSession, AttendanceRecord, Match, PlayerAttendanceRecord, User


def default_session_user(match: Match, user: User | None = None) -> User | None:
    if user and user.is_authenticated:
        return user
    if match.updated_by_id:
        return match.updated_by
    return User.objects.filter(Q(role__in=["admin", "dev", "owner"]) | Q(is_superuser=True)).order_by("id").first()


def match_ends_at(match: Match):
    if not match.starts_at:
        return None
    duration = max(1, int(match.duration_minutes or 120))
    return (datetime.combine(match.played_on, match.starts_at) + timedelta(minutes=duration)).time()


def cancel_match_attendance_sessions(match: Match) -> None:
    sessions = AttendanceSession.objects.filter(match=match)
    for session in sessions:
        has_attendance = session.records.exists() or session.player_records.exists() or session.face_attempts.exists()
        if has_attendance:
            if session.closed_at is None:
                session.closed_at = timezone.now()
                session.save(update_fields=["closed_at", "updated_at"])
            continue
        try:
            session.delete()
        except ProtectedError:
            if session.closed_at is None:
                session.closed_at = timezone.now()
                session.save(update_fields=["closed_at", "updated_at"])


def match_group_name(match: Match) -> str:
    return f"{match.home_team.name} vs {match.away_team.name}"


def copy_session_records(source: AttendanceSession, target: AttendanceSession) -> None:
    for record in source.records.select_related("student", "team", "captured_by"):
        lookup = {"session": target}
        if record.student_id:
            lookup["student"] = record.student
        else:
            lookup["team"] = record.team
        AttendanceRecord.objects.update_or_create(
            **lookup,
            defaults={
                "status": record.status,
                "had_debt_at_capture": record.had_debt_at_capture,
                "override_reason": record.override_reason,
                "captured_by": record.captured_by,
            },
        )

    for record in source.player_records.select_related("player", "captured_by"):
        PlayerAttendanceRecord.objects.update_or_create(
            session=target,
            player=record.player,
            defaults={
                "status": record.status,
                "had_team_debt_at_capture": record.had_team_debt_at_capture,
                "override_reason": record.override_reason,
                "captured_by": record.captured_by,
            },
        )

    source.face_attempts.update(session=target)


def retire_team_match_sessions(match: Match, canonical_session: AttendanceSession) -> None:
    legacy_sessions = AttendanceSession.objects.filter(
        match=match,
        session_type="tournament_match",
        team__isnull=False,
    ).exclude(id=canonical_session.id)
    for session in legacy_sessions:
        copy_session_records(session, canonical_session)
        try:
            session.delete()
        except ProtectedError:
            if session.closed_at is None:
                session.closed_at = timezone.now()
                session.save(update_fields=["closed_at", "updated_at"])


def ensure_match_attendance_sessions(match: Match, user: User | None = None) -> list[AttendanceSession]:
    if match.status == "canceled":
        cancel_match_attendance_sessions(match)
        return []

    captured_by = default_session_user(match, user)
    if not captured_by:
        return []

    ends_at = match_ends_at(match)
    session = (
        AttendanceSession.objects.filter(
            match=match,
            session_type="tournament_match",
            team__isnull=True,
        )
        .order_by("id")
        .first()
    )
    if not session:
        session = AttendanceSession.objects.create(
            match=match,
            team=None,
            site=match.site,
            session_type="tournament_match",
            date=match.played_on,
            starts_at=match.starts_at,
            ends_at=ends_at,
            duration_minutes=match.duration_minutes,
            tournament=match.tournament,
            round=match.round,
            group_name=match_group_name(match),
            captured_by=captured_by,
        )

    updates = []
    expected = {
        "site_id": match.site_id,
        "session_type": "tournament_match",
        "date": match.played_on,
        "starts_at": match.starts_at,
        "ends_at": ends_at,
        "duration_minutes": match.duration_minutes,
        "tournament_id": match.tournament_id,
        "round_id": match.round_id,
        "team_id": None,
        "group_name": match_group_name(match),
        "closed_at": None,
    }
    for field, value in expected.items():
        if getattr(session, field) != value:
            setattr(session, field, value)
            updates.append(field)
    if updates:
        session.save(update_fields=[*updates, "updated_at"])

    retire_team_match_sessions(match, session)
    return [session]
