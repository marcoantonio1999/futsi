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
from .automatic_attendance_clips import *
from .automatic_attendance_jobs import *
from .automatic_attendance_downloads import *
from .automatic_attendance_domain import *
from .automatic_attendance_evidence import *

from .automatic_attendance_state import *
from .automatic_attendance_clips import *
from .automatic_attendance_jobs import *
from .automatic_attendance_downloads import *
from .automatic_attendance_domain import *
from .automatic_attendance_processor import process_video_for_session
from .automatic_attendance_proxy import scan_frame_proxy_candidate_windows
from .automatic_attendance_neighbors import expand_requested_path_with_neighbors, pending_video_matches_any_request


def move_finished_video(video_path: Path, job_id: str, failed: bool) -> None:
    target_dir = error_dir(job_id) if failed else processed_dir(job_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / video_path.name
    shutil.move(str(video_path), str(target))
    metadata_path = sidecar_path(video_path)
    if metadata_path.exists():
        shutil.move(str(metadata_path), str(sidecar_path(target)))


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "si", "on"}


def archive_video_metadata(video_path: Path, job_id: str, failed: bool = False) -> None:
    metadata_path = sidecar_path(video_path)
    if not metadata_path.exists():
        return
    target_dir = (error_dir(job_id) if failed else processed_dir(job_id)) / "metadata"
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(metadata_path), str(target_dir / metadata_path.name))


def delete_materialized_video(video_path: Path) -> None:
    metadata_path = sidecar_path(video_path)
    for path in [video_path, metadata_path]:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass


def finalize_local_video(video_path: Path, job_id: str, failed: bool = False) -> None:
    if failed and env_flag("AUTO_ATTENDANCE_KEEP_FAILED_VIDEO", False):
        move_finished_video(video_path, job_id, failed=True)
        return
    archive_video_metadata(video_path, job_id, failed=failed)
    delete_materialized_video(video_path)


def wait_for_download_thread(thread: threading.Thread, state: dict, job: dict, phase_label: str) -> Path:
    while thread.is_alive():
        update_job(job, phase="downloading_original", phase_label=phase_label)
        thread.join(timeout=5)
    if state.get("error"):
        raise RuntimeError(str(state["error"]))
    path = state.get("path")
    if not path:
        raise RuntimeError("No se obtuvo el video original descargado.")
    return Path(path)


def start_original_download(video_item: dict) -> tuple[threading.Thread, dict]:
    state: dict = {}

    def runner() -> None:
        try:
            state["path"] = materialize_remote_video(video_item, None, source_kind="full_video")
        except Exception as exc:
            state["error"] = exc

    thread = threading.Thread(target=runner, name=f"auto-attendance-original-download-{uuid4().hex[:8]}", daemon=True)
    thread.start()
    return thread, state


def empty_proxy_session_result(session, detail: str, proxy_scan: dict | None = None) -> dict:
    return {
        "session": summarize_session(session),
        "marked": [],
        "review": [],
        "off_roster": [],
        "unknown_faces": [],
        "failed": False,
        "detail": detail,
        "processing_video_source": "frame_proxy_1fps",
        "proxy_scan": proxy_scan or {},
    }


def camera_label_from_metadata(metadata: dict) -> str:
    configured = str(metadata.get("camera_label") or metadata.get("camera_name") or "").strip()
    if configured:
        return configured
    camera_id = str(metadata.get("camera_id") or "").strip()
    if not camera_id:
        return ""
    match = re.search(r"(\d+)$", camera_id)
    return f"Camara {match.group(1)}" if match else camera_id.replace("_", " ")


def camera_result_context(metadata: dict) -> dict:
    return {
        "camera_id": str(metadata.get("camera_id") or "").strip(),
        "camera_label": camera_label_from_metadata(metadata),
    }


def annotate_session_result_with_camera(session_result: dict, metadata: dict) -> dict:
    context = camera_result_context(metadata)
    session_result.update(context)
    for list_name in ("marked", "review", "off_roster", "unknown_faces"):
        for item in session_result.get(list_name) or []:
            item.setdefault("source_camera_id", context["camera_id"])
            item.setdefault("source_camera_label", context["camera_label"])
    return session_result


def process_drive_video_with_proxy_pipeline(video_item: dict, user: User, job: dict, reference_cache: dict | None = None) -> tuple[dict, bool, list[Path]]:
    failed = False
    materialized_paths: list[Path] = []
    source_metadata = dict(video_item.get("metadata") or {})
    video_result = {
        "video": video_item["filename"],
        "sessions": [],
        "processing_video_source": "proxy_then_original",
        "pipeline": "proxy_1fps_then_original_detail",
        **camera_result_context(source_metadata),
    }
    original_thread: threading.Thread | None = None
    original_state: dict = {}
    original_path: Path | None = None

    try:
        update_job(
            job,
            current_video=f"Descargando proxy 1 FPS de {video_item['filename']}",
            current_video_started_at=timezone.now().isoformat(),
            phase="downloading",
            phase_label="Descargando proxy 1 FPS desde Drive",
        )
        proxy_path = materialize_remote_video(video_item, job, source_kind="frame_proxy_1fps")
        materialized_paths.append(proxy_path)
        proxy_metadata = infer_metadata(proxy_path, read_json(sidecar_path(proxy_path), {}))
        video_result["proxy_video"] = proxy_path.name

        sessions = resolve_sessions(proxy_path, proxy_metadata, user)
        update_job(job, current_video=video_item["filename"], current_video_started_at=timezone.now().isoformat())
        if not sessions:
            failed = True
            video_result["detail"] = "No se encontro sesion abierta para este proxy."
            return video_result, failed, materialized_paths

        original_thread, original_state = start_original_download(video_item)
        for session in sessions:
            proxy_scan = scan_frame_proxy_candidate_windows(proxy_path, session, job, proxy_metadata)
            if proxy_scan.get("failed"):
                failed = True
                video_result["sessions"].append(
                    annotate_session_result_with_camera(
                        {
                            "session": summarize_session(session),
                            "marked": [],
                            "review": [],
                            "off_roster": [],
                            "unknown_faces": [],
                            "failed": True,
                            "detail": proxy_scan.get("detail") or "Fallo el escaneo del proxy.",
                            "proxy_scan": proxy_scan,
                        },
                        proxy_metadata,
                    )
                )
                continue

            candidate_windows = proxy_scan.get("candidate_windows") or []
            video_result.setdefault("proxy_scans", []).append(
                {
                    "session": summarize_session(session),
                    "candidate_windows": len(candidate_windows),
                    "candidate_seconds": proxy_scan.get("candidate_seconds_count", 0),
                    "sampled_frames": proxy_scan.get("sampled_frames", 0),
                }
            )
            if not candidate_windows:
                video_result["sessions"].append(annotate_session_result_with_camera(empty_proxy_session_result(session, "Proxy 1 FPS sin rostros candidatos.", proxy_scan), proxy_metadata))
                continue

            if original_path is None:
                original_path = wait_for_download_thread(
                    original_thread,
                    original_state,
                    job,
                    "Esperando descarga del video original para revisar ventanas candidatas",
                )
                materialized_paths.append(original_path)
                video_result["original_video"] = original_path.name

            original_metadata = infer_metadata(original_path, read_json(sidecar_path(original_path), {}))
            original_metadata.update(
                {
                    "processing_video_source": "full_video_detail_from_proxy",
                    "detail_candidate_windows": candidate_windows,
                    "proxy_scan": proxy_scan,
                    "proxy_video_filename": proxy_path.name,
                }
            )
            session_result = process_video_for_session(original_path, session, user, job, original_metadata, reference_cache=reference_cache)
            annotate_session_result_with_camera(session_result, original_metadata)
            session_result["proxy_scan"] = {
                "candidate_windows": len(candidate_windows),
                "candidate_seconds": proxy_scan.get("candidate_seconds_count", 0),
                "sampled_frames": proxy_scan.get("sampled_frames", 0),
            }
            video_result["sessions"].append(session_result)
            if session_result.get("failed"):
                failed = True
    except Exception as exc:
        failed = True
        video_result["detail"] = str(exc)
    finally:
        if original_thread and original_thread.is_alive():
            try:
                original_path = wait_for_download_thread(
                    original_thread,
                    original_state,
                    job,
                    "Terminando descarga del video original antes de limpiar",
                )
                if original_path not in materialized_paths:
                    materialized_paths.append(original_path)
            except Exception as exc:
                if not video_result.get("detail"):
                    video_result["detail"] = str(exc)
    return video_result, failed, materialized_paths


def sort_videos_for_processing(videos: list[dict]) -> list[dict]:
    def sort_key(item: dict) -> tuple:
        metadata = item.get("metadata") or {}
        return (
            str(metadata.get("recorded_date") or ""),
            str(metadata.get("site_id") or ""),
            str(metadata.get("match_id") or ""),
            str(metadata.get("session_id") or ""),
            str(metadata.get("recording_started_at") or item.get("modified_at") or ""),
            str(metadata.get("camera_id") or ""),
            str(item.get("filename") or ""),
        )

    return sorted(videos, key=sort_key)


def process_pending_worker(job_id: str, user_id: int, target_path: str | None = None, target_paths: list[str] | None = None) -> None:
    close_old_connections()
    job = read_job(job_id)
    if not job:
        return

    try:
        user = User.objects.get(id=user_id)
        target_paths = target_paths or (expand_requested_path_with_neighbors(target_path) if target_path else [])
        videos = pending_videos()
        if target_path:
            videos = [item for item in videos if pending_video_matches_any_request(item, target_paths)]
        videos = sort_videos_for_processing(videos)
        update_job(
            job,
            status="processing",
            total=len(videos),
            processed=0,
            percent=0,
            results=[],
            target_paths=target_paths,
            neighbor_expanded=bool(target_paths and len(target_paths) > 1),
        )
        results = []
        reference_cache: dict = {}

        for index, video_item in enumerate(videos, start=1):
            clip_id = (video_item.get("metadata") or {}).get("video_clip_id")
            if clip_id:
                mark_video_clip_processing(str(clip_id), job_id)
            source_metadata = dict(video_item.get("metadata") or {})
            failed = False
            video_path = None
            video_result = {"video": video_item["filename"], "sessions": [], **camera_result_context(source_metadata)}
            materialized_paths: list[Path] = []
            try:
                if video_item.get("source") == "drive" and frame_proxy_package(video_item.get("metadata") or {}) and env_flag("AUTO_ATTENDANCE_PROXY_DETAIL_PIPELINE", False):
                    video_result, failed, materialized_paths = process_drive_video_with_proxy_pipeline(video_item, user, job, reference_cache=reference_cache)
                    results.append(video_result)
                    for path in materialized_paths:
                        finalize_local_video(path, job_id, failed=failed)
                    if clip_id:
                        mark_video_clip_processed(str(clip_id), failed=failed, error_message=video_result.get("detail", ""))
                    update_job(job, processed=index, percent=round((index / max(len(videos), 1)) * 100, 1), results=results)
                    continue
                elif video_item.get("source") == "drive":
                    update_job(job, current_video=f"Descargando {video_item['filename']}", current_video_started_at=timezone.now().isoformat(), processed=index - 1, percent=0)
                    video_path = materialize_remote_video(video_item, job)
                else:
                    video_path = Path(video_item["path"])
                if not video_path.exists():
                    failed = True
                    video_result["detail"] = "El archivo pendiente no existe."
                    results.append(video_result)
                    if clip_id:
                        mark_video_clip_processed(str(clip_id), failed=True, error_message=video_result["detail"])
                    update_job(job, processed=index, percent=round((index / max(len(videos), 1)) * 100, 1), results=results)
                    continue
                metadata = infer_metadata(video_path, read_json(sidecar_path(video_path), {}))
                video_result.update(camera_result_context(metadata))
                video_result["processing_video_source"] = metadata.get("processing_video_source") or "full_video"
                video_result["materialized_video"] = video_path.name
            except Exception as exc:
                failed = True
                video_result["detail"] = f"No se pudo preparar el video remoto: {exc}"
                results.append(video_result)
                if clip_id:
                    mark_video_clip_processed(str(clip_id), failed=True, error_message=video_result["detail"])
                update_job(job, processed=index, percent=round((index / max(len(videos), 1)) * 100, 1), results=results)
                continue

            update_job(
                job,
                current_video=video_path.name,
                current_video_started_at=timezone.now().isoformat(),
                processed=index - 1,
                percent=0,
                phase="preparing",
                phase_label="Preparando analisis del video",
            )
            try:
                sessions = resolve_sessions(video_path, metadata, user)
                if not sessions:
                    failed = True
                    video_result["detail"] = "No se encontro sesion abierta para este video."
                else:
                    for session in sessions:
                        session_result = process_video_for_session(video_path, session, user, job, metadata, reference_cache=reference_cache)
                        annotate_session_result_with_camera(session_result, metadata)
                        video_result["sessions"].append(session_result)
                        if session_result.get("failed"):
                            failed = True
            except Exception as exc:
                failed = True
                video_result["detail"] = str(exc)
            results.append(video_result)
            finalize_local_video(video_path, job_id, failed=failed)
            if clip_id:
                mark_video_clip_processed(str(clip_id), failed=failed, error_message=video_result.get("detail", ""))
            update_job(job, processed=index, percent=round((index / max(len(videos), 1)) * 100, 1), results=results)

        update_job(job, status="done", phase="done", phase_label="Procesamiento terminado", current_video=None, percent=100, completed_at=timezone.now().isoformat(), results=results)
    except Exception as exc:
        detail = str(exc)
        reset_interrupted_video_clip(job, detail)
        update_job(job, status="error", phase="error", phase_label="Procesamiento interrumpido", detail=detail, completed_at=timezone.now().isoformat())
    finally:
        close_old_connections()
