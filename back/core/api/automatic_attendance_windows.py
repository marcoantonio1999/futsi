from __future__ import annotations

import os
from datetime import datetime, timedelta

from django.utils import timezone


def parse_metadata_datetime(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return timezone.localtime(parsed)


def session_datetime(session, value) -> datetime | None:
    if not session.date or not value:
        return None
    parsed = datetime.combine(session.date, value)
    if parsed.tzinfo is None:
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return timezone.localtime(parsed)


def session_core_interval(session) -> tuple[datetime, datetime] | None:
    starts_at = session_datetime(session, session.starts_at)
    if not starts_at:
        return None
    if session.ends_at:
        ends_at = session_datetime(session, session.ends_at)
        if ends_at and ends_at <= starts_at:
            ends_at += timedelta(days=1)
    else:
        ends_at = starts_at + timedelta(minutes=max(1, int(session.duration_minutes or 120)))
    return (starts_at, ends_at) if ends_at else None


def session_padding_minutes(session) -> int:
    configured = os.getenv("AUTO_ATTENDANCE_SESSION_PAD_MINUTES")
    if configured is None:
        configured = os.getenv("AUTO_ATTENDANCE_MATCH_PAD_MINUTES", "10") if session.session_type == "tournament_match" else "0"
    try:
        return max(0, int(configured))
    except (TypeError, ValueError):
        return 10 if session.session_type == "tournament_match" else 0


def recording_interval_from_metadata(metadata: dict, total_duration: float | None = None) -> tuple[datetime, datetime] | None:
    started_at = parse_metadata_datetime(metadata.get("recording_started_at"))
    ended_at = parse_metadata_datetime(metadata.get("recording_ended_at"))
    if not started_at:
        return None
    if not ended_at and total_duration:
        ended_at = started_at + timedelta(seconds=max(0, float(total_duration)))
    if not ended_at:
        return None
    if ended_at <= started_at:
        ended_at += timedelta(days=1)
    return started_at, ended_at


def overlap_seconds(left_start: datetime, left_end: datetime, right_start: datetime, right_end: datetime) -> float:
    start = max(left_start, right_start)
    end = min(left_end, right_end)
    return max(0.0, (end - start).total_seconds())


def session_window_for_recording(session, recording_start: datetime, recording_end: datetime) -> dict | None:
    core = session_core_interval(session)
    if not core:
        return None
    core_start, core_end = core
    pad = session_padding_minutes(session)
    padded_start = core_start - timedelta(minutes=pad)
    padded_end = core_end + timedelta(minutes=pad)
    overlap_start = max(padded_start, recording_start)
    overlap_end = min(padded_end, recording_end)
    if overlap_end <= overlap_start:
        return None

    core_seconds = max(1.0, (core_end - core_start).total_seconds())
    core_covered = overlap_seconds(core_start, core_end, recording_start, recording_end)
    allow_partial = core_covered < core_seconds * 0.8
    start_seconds = max(0.0, (overlap_start - recording_start).total_seconds())
    end_seconds = max(start_seconds, (overlap_end - recording_start).total_seconds())
    core_start_seconds = (core_start - recording_start).total_seconds()
    core_end_seconds = (core_end - recording_start).total_seconds()
    label_scope = "extension local" if allow_partial else "sesion extendida"
    return {
        "start_seconds": round(start_seconds, 3),
        "end_seconds": round(end_seconds, 3),
        "core_start_seconds": round(core_start_seconds, 3),
        "core_end_seconds": round(core_end_seconds, 3),
        "core_covered_seconds": round(core_covered, 3),
        "core_seconds": round(core_seconds, 3),
        "allow_partial": allow_partial,
        "padding_minutes": pad,
        "label": (
            f"{label_scope} {core_start.strftime('%H:%M')}-{core_end.strftime('%H:%M')} "
            f"({round(start_seconds / 60)}-{round(end_seconds / 60)} min del video)"
        ),
    }


def metadata_session_windows(metadata: dict) -> dict:
    raw = metadata.get("_automatic_attendance_session_windows")
    return raw if isinstance(raw, dict) else {}
