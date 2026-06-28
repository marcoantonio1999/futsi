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


def process_pending_worker(job_id: str, user_id: int, target_path: str | None = None) -> None:
    close_old_connections()
    job = read_job(job_id)
    if not job:
        return

    try:
        user = User.objects.get(id=user_id)
        videos = pending_videos()
        if target_path:
            videos = [item for item in videos if item.get("path") == target_path]
        update_job(job, status="processing", total=len(videos), processed=0, percent=0, results=[])
        results = []

        for index, video_item in enumerate(videos, start=1):
            clip_id = (video_item.get("metadata") or {}).get("video_clip_id")
            failed = False
            video_path = None
            video_result = {"video": video_item["filename"], "sessions": []}
            try:
                if video_item.get("source") == "drive":
                    update_job(job, current_video=f"Descargando {video_item['filename']}", processed=index - 1, percent=0)
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
            except Exception as exc:
                failed = True
                video_result["detail"] = f"No se pudo preparar el video remoto: {exc}"
                results.append(video_result)
                update_job(job, processed=index, percent=round((index / max(len(videos), 1)) * 100, 1), results=results)
                continue

            update_job(
                job,
                current_video=video_path.name,
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
                        session_result = process_video_for_session(video_path, session, user, job, metadata)
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
        update_job(job, status="error", detail=str(exc), completed_at=timezone.now().isoformat())
    finally:
        close_old_connections()
