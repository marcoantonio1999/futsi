from __future__ import annotations

import os
from pathlib import Path

from .automatic_attendance_jobs import update_job
from .automatic_attendance_scan import face_quality, resolve_video_window
from core.services.face_insight import detect_face_boxes


def merge_candidate_seconds(candidate_seconds: list[float], padding_seconds: float, total_duration: float) -> list[dict]:
    if not candidate_seconds:
        return []
    max_gap_seconds = max(0.0, float(os.getenv("AUTO_ATTENDANCE_DETAIL_WINDOW_MERGE_GAP_SECONDS", "2")))
    max_windows = max(1, int(os.getenv("AUTO_ATTENDANCE_DETAIL_MAX_WINDOWS", "240")))
    windows: list[dict] = []
    for second in sorted(set(round(float(value), 3) for value in candidate_seconds)):
        start = max(0.0, second - padding_seconds)
        end = min(total_duration or second + padding_seconds, second + padding_seconds + 1.0)
        if windows and start <= windows[-1]["end_second"] + max_gap_seconds:
            windows[-1]["end_second"] = max(windows[-1]["end_second"], end)
            windows[-1]["candidate_count"] += 1
            continue
        windows.append({"start_second": round(start, 3), "end_second": round(end, 3), "candidate_count": 1})
    if len(windows) <= max_windows:
        return windows
    return sorted(windows, key=lambda item: item["candidate_count"], reverse=True)[:max_windows]


def scan_frame_proxy_candidate_windows(proxy_path: Path, session, job: dict, metadata: dict) -> dict:
    import cv2

    providers = os.getenv("AUTO_ATTENDANCE_PROVIDERS", os.getenv("FACE_PROVIDERS", "auto"))
    sample_every = max(1, int(os.getenv("AUTO_ATTENDANCE_FRAME_PROXY_SAMPLE_EVERY", "1")))
    progress_every = max(1, int(os.getenv("AUTO_ATTENDANCE_FRAME_PROXY_PROGRESS_EVERY", "25")))
    padding_seconds = max(0.0, float(os.getenv("AUTO_ATTENDANCE_DETAIL_WINDOW_PADDING_SECONDS", "2")))
    preview_limit = max(1, int(os.getenv("AUTO_ATTENDANCE_PROXY_CANDIDATE_PREVIEW_LIMIT", "80")))
    max_scan_dimension = max(0, int(os.getenv("AUTO_ATTENDANCE_PROXY_SCAN_MAX_DIMENSION", "1280")))

    def proxy_scan_frame(frame):
        if not max_scan_dimension:
            return frame
        height, width = frame.shape[:2]
        largest = max(width, height)
        if largest <= max_scan_dimension:
            return frame
        scale = max_scan_dimension / largest
        return cv2.resize(frame, (max(1, int(width * scale)), max(1, int(height * scale))), interpolation=cv2.INTER_AREA)

    capture = cv2.VideoCapture(str(proxy_path))
    if not capture.isOpened():
        return {"failed": True, "detail": "No se pudo abrir el proxy 1 FPS.", "candidate_windows": []}

    try:
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        window = resolve_video_window(capture, session, metadata, total_frames, fps)
        if window.get("error_detail"):
            return {
                "failed": True,
                "detail": window["error_detail"],
                "candidate_windows": [],
                "window": window["window_label"],
                "total_frames": total_frames,
                "duration_seconds": round(window["total_duration"], 2) if window["total_duration"] else 0,
            }

        start_frame = int(window["start_frame"])
        end_frame = int(window["end_frame"])
        total_duration = float(window["total_duration"] or 0)
        window_total = max(end_frame - start_frame, 1)
        candidate_seconds: list[float] = []
        sampled_frames = 0
        rejected_quality_faces = 0
        raw_faces = 0

        update_job(
            job,
            phase="proxy_scan",
            phase_label="Buscando segundos candidatos en proxy 1 FPS",
            processing_video_source="frame_proxy_1fps",
            proxy_scan_frame=start_frame,
            proxy_scan_total_frames=window_total,
            proxy_candidate_seconds=0,
            percent=0,
        )

        capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        frame_index = start_frame
        while frame_index <= end_frame:
            ok, frame = capture.read()
            if not ok:
                break
            if (frame_index - start_frame) % sample_every != 0:
                frame_index += 1
                continue

            scan_frame = proxy_scan_frame(frame)
            detections = detect_face_boxes(scan_frame, providers_key=providers)
            sampled_frames += 1
            accepted_faces = 0
            for face in detections:
                raw_faces += 1
                quality_ok, _quality = face_quality(scan_frame, face)
                if quality_ok:
                    accepted_faces += 1
                else:
                    rejected_quality_faces += 1
            if accepted_faces:
                candidate_seconds.append(round(frame_index / max(fps, 1.0), 3))

            if sampled_frames % progress_every == 0 or frame_index >= end_frame:
                done = max(frame_index - start_frame, 0)
                update_job(
                    job,
                    phase="proxy_scan",
                    phase_label="Buscando segundos candidatos en proxy 1 FPS",
                    proxy_scan_frame=frame_index,
                    proxy_scan_total_frames=window_total,
                    proxy_sampled_frames=sampled_frames,
                    proxy_raw_faces=raw_faces,
                    proxy_rejected_faces=rejected_quality_faces,
                    proxy_candidate_seconds=len(candidate_seconds),
                    proxy_candidate_seconds_preview=candidate_seconds[-preview_limit:],
                    proxy_scan_max_dimension=max_scan_dimension,
                    percent=min(35, round((done / window_total) * 35, 1)),
                )
            frame_index += 1

        candidate_windows = merge_candidate_seconds(candidate_seconds, padding_seconds, total_duration)
        update_job(
            job,
            phase="proxy_scan",
            phase_label=f"Proxy listo: {len(candidate_windows)} ventanas candidatas",
            proxy_sampled_frames=sampled_frames,
            proxy_raw_faces=raw_faces,
            proxy_rejected_faces=rejected_quality_faces,
            proxy_candidate_seconds=len(candidate_seconds),
            proxy_candidate_seconds_preview=candidate_seconds[-preview_limit:],
            proxy_candidate_windows=len(candidate_windows),
            proxy_candidate_windows_preview=candidate_windows[:24],
            proxy_scan_max_dimension=max_scan_dimension,
            percent=35,
        )
        return {
            "failed": False,
            "candidate_windows": candidate_windows,
            "candidate_seconds_count": len(candidate_seconds),
            "candidate_seconds_preview": candidate_seconds[-preview_limit:],
            "sampled_frames": sampled_frames,
            "raw_faces": raw_faces,
            "rejected_quality_faces": rejected_quality_faces,
            "total_frames": total_frames,
            "duration_seconds": round(total_duration, 2) if total_duration else None,
            "window": window["window_label"],
        }
    finally:
        capture.release()
