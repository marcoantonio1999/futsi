from __future__ import annotations

import os
from datetime import datetime

from django.utils import timezone

from .automatic_attendance_windows import (
    metadata_session_windows,
    recording_interval_from_metadata,
    session_core_interval,
    session_padding_minutes,
)


def resolve_video_window(capture, session, metadata: dict, total_frames: int, fps: float) -> dict:
    total_duration = total_frames / fps if total_frames and fps else 0
    long_video_threshold = int(os.getenv("AUTO_ATTENDANCE_LONG_VIDEO_SECONDS", "14400"))
    pre_minutes = int(os.getenv("AUTO_ATTENDANCE_SESSION_PRE_MINUTES", "0"))
    padding_minutes = session_padding_minutes(session)
    window_minutes = max(1, int(session.duration_minutes or os.getenv("AUTO_ATTENDANCE_SESSION_DURATION_MINUTES", "120")))
    requested_window_seconds = window_minutes * 60
    min_coverage_ratio = float(os.getenv("AUTO_ATTENDANCE_MIN_WINDOW_COVERAGE_RATIO", "0.80"))
    start_frame = 0
    end_frame = total_frames
    window_label = "video completo"

    def coverage_error(covered_core_seconds: float | None) -> str:
        if covered_core_seconds is None or not requested_window_seconds:
            return ""
        if covered_core_seconds >= requested_window_seconds * min_coverage_ratio:
            return ""
        return (
            f"El video no cubre suficiente la sesion {session.starts_at.strftime('%H:%M')}. "
            f"Cubre {round(covered_core_seconds / 60, 1)} de {round(requested_window_seconds / 60, 1)} min esperados; "
            f"el archivo dura {round(total_duration / 60, 1)} min."
        )

    def apply_window(
        start_seconds: float,
        end_seconds: float,
        label: str,
        covered_core_seconds: float | None,
        allow_partial: bool = False,
        core_start_seconds: float | None = None,
        core_end_seconds: float | None = None,
    ) -> dict | None:
        nonlocal start_frame, end_frame, window_label
        if total_duration:
            start_seconds = max(0.0, min(total_duration, start_seconds))
            end_seconds = max(0.0, min(total_duration, end_seconds))
        if total_duration and start_seconds >= total_duration:
            return {
                "total_duration": total_duration,
                "start_frame": 0,
                "end_frame": 0,
                "window_label": "fuera del video",
                "error_detail": (
                    f"El video no cubre la sesion {session.starts_at.strftime('%H:%M')}. "
                    f"La ventana empieza en el minuto {round(start_seconds / 60)} del archivo, "
                    f"pero el archivo dura {round(total_duration / 60, 1)} min."
                ),
            }
        if end_seconds <= start_seconds:
            return {
                "total_duration": total_duration,
                "start_frame": 0,
                "end_frame": 0,
                "window_label": "fuera del video",
                "error_detail": f"El video no tiene segundos utiles para la sesion {session.starts_at.strftime('%H:%M')}.",
            }
        insufficient_coverage = "" if allow_partial else coverage_error(covered_core_seconds)
        if insufficient_coverage:
            return {
                "total_duration": total_duration,
                "start_frame": 0,
                "end_frame": 0,
                "window_label": "video incompleto",
                "error_detail": insufficient_coverage,
            }
        start_frame = int(start_seconds * fps)
        end_frame = int(end_seconds * fps)
        capture.set(1, start_frame)
        window_label = label
        if core_start_seconds is not None:
            metadata["_automatic_attendance_core_start_seconds"] = round(float(core_start_seconds), 3)
        if core_end_seconds is not None:
            metadata["_automatic_attendance_core_end_seconds"] = round(float(core_end_seconds), 3)
        return None

    override = metadata_session_windows(metadata).get(str(session.id))
    if override:
        early = apply_window(
            float(override.get("start_seconds") or 0),
            float(override.get("end_seconds") or 0),
            str(override.get("label") or "sesion extendida"),
            float(override.get("core_covered_seconds") or 0),
            allow_partial=bool(override.get("allow_partial")),
            core_start_seconds=float(override.get("core_start_seconds")) if override.get("core_start_seconds") is not None else None,
            core_end_seconds=float(override.get("core_end_seconds")) if override.get("core_end_seconds") is not None else None,
        )
        if early:
            return early
        return {
            "total_duration": total_duration,
            "start_frame": start_frame,
            "end_frame": end_frame,
            "window_label": window_label,
            "error_detail": "",
            "core_start_seconds": metadata.get("_automatic_attendance_core_start_seconds"),
            "core_end_seconds": metadata.get("_automatic_attendance_core_end_seconds"),
        }

    recording_started_at = metadata.get("recording_started_at")
    if recording_started_at and session.starts_at:
        try:
            recording = recording_interval_from_metadata(metadata, total_duration)
            core = session_core_interval(session)
            if not recording or not core:
                raise ValueError("metadata incompleta")
            recording_start, _recording_end = recording
            core_start, core_end = core
            start_seconds = (core_start - recording_start).total_seconds() - ((pre_minutes + padding_minutes) * 60)
            end_seconds = (core_end - recording_start).total_seconds() + (padding_minutes * 60)
            core_start_seconds = (core_start - recording_start).total_seconds()
            core_end_seconds = (core_end - recording_start).total_seconds()
            covered_core_seconds = max(0.0, min(total_duration, core_end_seconds) - max(0.0, core_start_seconds)) if total_duration else requested_window_seconds
            early = apply_window(
                start_seconds,
                end_seconds,
                f"sesion extendida {session.starts_at.strftime('%H:%M')}-{(session.ends_at.strftime('%H:%M') if session.ends_at else f'{window_minutes} min')} ({round(max(0, start_seconds) / 60)}-{round(min(total_duration or end_seconds, end_seconds) / 60)} min del video)",
                covered_core_seconds,
                core_start_seconds=core_start_seconds,
                core_end_seconds=core_end_seconds,
            )
            if early:
                return early
        except (TypeError, ValueError, OverflowError):
            pass
    elif total_duration >= long_video_threshold and session.starts_at:
        session_seconds = (session.starts_at.hour * 3600) + (session.starts_at.minute * 60) + session.starts_at.second
        start_seconds = max(0, session_seconds - ((pre_minutes + padding_minutes) * 60))
        end_seconds = min(total_duration, session_seconds + (window_minutes * 60) + (padding_minutes * 60))
        covered_core_seconds = max(0.0, min(total_duration, session_seconds + requested_window_seconds) - max(0.0, session_seconds))
        early = apply_window(
            start_seconds,
            end_seconds,
            f"{round(start_seconds / 60)}-{round(end_seconds / 60)} min",
            covered_core_seconds,
            core_start_seconds=session_seconds,
            core_end_seconds=session_seconds + requested_window_seconds,
        )
        if early:
            return early
    return {
        "total_duration": total_duration,
        "start_frame": start_frame,
        "end_frame": end_frame,
        "window_label": window_label,
        "error_detail": "",
        "core_start_seconds": metadata.get("_automatic_attendance_core_start_seconds"),
        "core_end_seconds": metadata.get("_automatic_attendance_core_end_seconds"),
    }


def face_quality(frame, face) -> tuple[bool, dict]:
    import cv2

    x1, y1, x2, y2 = face.bbox
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
    face_width = max(0, x2 - x1)
    face_height = max(0, y2 - y1)
    crop = frame[y1:y2, x1:x2]
    blur = 0.0
    if crop.size:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    min_det_score = float(os.getenv("AUTO_ATTENDANCE_MIN_DET_SCORE", "0.45"))
    min_face_size = int(os.getenv("AUTO_ATTENDANCE_MIN_FACE_SIZE", "80"))
    min_blur = float(os.getenv("AUTO_ATTENDANCE_MIN_BLUR", "5"))
    quality = {
        "det_score": round(float(face.det_score), 4),
        "face_width": int(face_width),
        "face_height": int(face_height),
        "blur": round(float(blur), 2),
        "score": round(float(face.det_score) + min(face_width, face_height) / 100.0 + min(blur, 250.0) / 250.0, 4),
    }
    ok = face.det_score >= min_det_score and face_width >= min_face_size and face_height >= min_face_size and blur >= min_blur
    return ok, quality
