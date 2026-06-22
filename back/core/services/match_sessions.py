from datetime import datetime, timedelta

from django.db.models import Q

from core.models import AttendanceSession, Match, User


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


def ensure_match_attendance_sessions(match: Match, user: User | None = None) -> list[AttendanceSession]:
    captured_by = default_session_user(match, user)
    if not captured_by:
        return []

    sessions = []
    ends_at = match_ends_at(match)
    for team in [match.home_team, match.away_team]:
        session, _created = AttendanceSession.objects.get_or_create(
            match=match,
            team=team,
            defaults={
                "site": match.site,
                "session_type": "tournament_match",
                "date": match.played_on,
                "starts_at": match.starts_at,
                "ends_at": ends_at,
                "duration_minutes": match.duration_minutes,
                "tournament": match.tournament,
                "round": match.round,
                "group_name": team.name,
                "captured_by": captured_by,
            },
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
            "group_name": team.name,
        }
        for field, value in expected.items():
            if getattr(session, field) != value:
                setattr(session, field, value)
                updates.append(field)
        if updates:
            session.save(update_fields=[*updates, "updated_at"])
        sessions.append(session)
    return sessions
