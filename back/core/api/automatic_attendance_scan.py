from __future__ import annotations

import os
from datetime import datetime

from django.utils import timezone


def resolve_video_window(capture, session, metadata: dict, total_frames: int, fps: float) -> dict:
    total_duration = total_frames / fps if total_frames and fps else 0
    long_video_threshold = int(os.getenv("AUTO_ATTENDANCE_LONG_VIDEO_SECONDS", "14400"))
    pre_minutes = int(os.getenv("AUTO_ATTENDANCE_SESSION_PRE_MINUTES", "0"))
    window_minutes = max(1, int(session.duration_minutes or os.getenv("AUTO_ATTENDANCE_SESSION_DURATION_MINUTES", "120")))
    requested_window_seconds = window_minutes * 60
    min_coverage_ratio = float(os.getenv("AUTO_ATTENDANCE_MIN_WINDOW_COVERAGE_RATIO", "0.80"))
    start_frame = 0
    end_frame = total_frames
    window_label = "video completo"

    def coverage_error(start_seconds: float, end_seconds: float) -> str:
        if not total_duration or not requested_window_seconds:
            return ""
        covered_seconds = max(0, end_seconds - start_seconds)
        if covered_seconds >= requested_window_seconds * min_coverage_ratio:
            return ""
        return (
            f"El video no cubre suficiente la sesion {session.starts_at.strftime('%H:%M')}. "
            f"Cubre {round(covered_seconds / 60, 1)} de {round(requested_window_seconds / 60, 1)} min esperados; "
            f"el archivo dura {round(total_duration / 60, 1)} min."
        )

    recording_started_at = metadata.get("recording_started_at")
    if recording_started_at and session.starts_at:
        try:
            recording_start = datetime.fromisoformat(str(recording_started_at).replace("Z", "+00:00"))
            session_start = datetime.combine(session.date, session.starts_at)
            if session_start.tzinfo is None:
                session_start = timezone.make_aware(session_start, timezone.get_current_timezone())
            if recording_start.tzinfo is None:
                recording_start = timezone.make_aware(recording_start, timezone.get_current_timezone())
            recording_start = timezone.localtime(recording_start)
            session_start = timezone.localtime(session_start)
            start_seconds = max(0, (session_start - recording_start).total_seconds() - (pre_minutes * 60))
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
            end_seconds = min(total_duration, start_seconds + (window_minutes * 60))
            insufficient_coverage = coverage_error(start_seconds, end_seconds)
            if insufficient_coverage:
                return {
                    "total_duration": total_duration,
                    "start_frame": 0,
                    "end_frame": 0,
                    "window_label": "video incompleto",
                    "error_detail": insufficient_coverage,
                }
            if start_seconds < total_duration and end_seconds > start_seconds:
                start_frame = int(start_seconds * fps)
                end_frame = int(end_seconds * fps)
                capture.set(1, start_frame)
                window_label = f"sesion {session.starts_at.strftime('%H:%M')}-{(session.ends_at.strftime('%H:%M') if session.ends_at else f'{window_minutes} min')} ({round(start_seconds / 60)}-{round(end_seconds / 60)} min del video)"
        except (TypeError, ValueError, OverflowError):
            pass
    elif total_duration >= long_video_threshold and session.starts_at:
        session_seconds = (session.starts_at.hour * 3600) + (session.starts_at.minute * 60) + session.starts_at.second
        start_seconds = max(0, session_seconds - (pre_minutes * 60))
        end_seconds = min(total_duration, session_seconds + (window_minutes * 60))
        insufficient_coverage = coverage_error(start_seconds, end_seconds)
        if insufficient_coverage:
            return {
                "total_duration": total_duration,
                "start_frame": 0,
                "end_frame": 0,
                "window_label": "video incompleto",
                "error_detail": insufficient_coverage,
            }
        if start_seconds < total_duration and end_seconds > start_seconds:
            start_frame = int(start_seconds * fps)
            end_frame = int(end_seconds * fps)
            capture.set(1, start_frame)
            window_label = f"{round(start_seconds / 60)}-{round(end_seconds / 60)} min"
    return {
        "total_duration": total_duration,
        "start_frame": start_frame,
        "end_frame": end_frame,
        "window_label": window_label,
        "error_detail": "",
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
    min_face_size = int(os.getenv("AUTO_ATTENDANCE_MIN_FACE_SIZE", "24"))
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
