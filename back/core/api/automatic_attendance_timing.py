from __future__ import annotations

from datetime import datetime, timedelta


def seconds_to_clock(seconds: float | int | None) -> str:
    if seconds is None:
        return ""
    total = max(0, int(round(float(seconds))))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def signed_seconds_to_clock(seconds: float | int | None) -> str:
    if seconds is None:
        return ""
    value = float(seconds)
    sign = "-" if value < 0 else "+"
    return f"{sign}{seconds_to_clock(abs(value))}"


def frame_second(frame_index: int | float | None, fps: float | int | None) -> float | None:
    if frame_index is None or not fps:
        return None
    try:
        numeric_fps = float(fps)
        if numeric_fps <= 0:
            return None
        return max(0.0, float(frame_index) / numeric_fps)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def window_phase(video_second: float | None, window: dict) -> str:
    if video_second is None:
        return "unknown"
    core_start = window.get("core_start_seconds")
    core_end = window.get("core_end_seconds")
    try:
        core_start = float(core_start)
        core_end = float(core_end)
    except (TypeError, ValueError):
        return "core"
    if video_second < core_start:
        return "pre_padding"
    if video_second > core_end:
        return "post_padding"
    return "core"


def observed_datetime_for_session(session, session_second: float | None) -> datetime | None:
    if session_second is None or not getattr(session, "date", None) or not getattr(session, "starts_at", None):
        return None
    try:
        starts_at = datetime.combine(session.date, session.starts_at)
        return starts_at + timedelta(seconds=float(session_second))
    except (TypeError, ValueError, OverflowError):
        return None


def frame_time_payload(frame_index: int | float | None, fps: float | int | None, window: dict, session=None) -> dict:
    video_second = frame_second(frame_index, fps)
    core_start = window.get("core_start_seconds")
    session_second = None
    try:
        if video_second is not None and core_start is not None:
            session_second = video_second - float(core_start)
    except (TypeError, ValueError):
        session_second = None
    observed_at = observed_datetime_for_session(session, session_second)
    phase = window_phase(video_second, window)
    return {
        "video_second": round(video_second, 3) if video_second is not None else None,
        "video_time": seconds_to_clock(video_second),
        "session_second": round(session_second, 3) if session_second is not None else None,
        "session_time": signed_seconds_to_clock(session_second),
        "observed_at": observed_at.isoformat() if observed_at else "",
        "observed_date": observed_at.date().isoformat() if observed_at else "",
        "observed_time": observed_at.strftime("%H:%M:%S") if observed_at else "",
        "window_phase": phase,
        "in_core_window": phase == "core",
    }


def group_time_summary(group: dict, fps: float | int | None, window: dict) -> dict:
    faces = group.get("faces") or []
    core_hits = 0
    padding_hits = 0
    for face in faces:
        phase = window_phase(frame_second(face.get("frame_index"), fps), window)
        if phase == "core":
            core_hits += 1
        elif phase in {"pre_padding", "post_padding"}:
            padding_hits += 1
    return {
        "core_hit_count": core_hits,
        "padding_hit_count": padding_hits,
        "padding_only": bool(padding_hits and not core_hits),
    }
