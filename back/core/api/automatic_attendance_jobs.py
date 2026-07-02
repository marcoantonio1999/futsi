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
from .automatic_attendance_clips import video_clips_table_exists


class JobCancelled(Exception):
    pass


def read_job(job_id: str) -> dict | None:
    path = job_path(job_id)
    if not path.exists():
        return None
    return read_json(path, None)


def update_job(job: dict, **updates) -> dict:
    job.update(updates)
    job["updated_at"] = timezone.now().isoformat()
    job["worker_pid"] = PROCESS_ID
    if job.get("status") in JOB_ACTIVE_STATUSES:
        job["heartbeat_at"] = job["updated_at"]
    write_json(job_path(job["id"]), job)
    return job


def job_cancel_requested(job: dict) -> bool:
    current = read_job(str(job.get("id") or ""))
    return bool((current or job).get("cancel_requested"))


def raise_if_job_cancelled(job: dict) -> None:
    if job_cancel_requested(job):
        raise JobCancelled(JOB_CANCELED_DETAIL)


def request_job_cancel(job: dict, user_id: int | None = None) -> dict:
    now = timezone.now().isoformat()
    job.update(
        {
            "cancel_requested": True,
            "cancel_requested_at": now,
            "cancel_requested_by": user_id,
            "phase_label": "Cancelando procesamiento",
            "detail": "Cancelacion solicitada. El worker se detendra en el siguiente punto seguro.",
            "updated_at": now,
            "heartbeat_at": now,
            "worker_pid": PROCESS_ID,
        }
    )
    write_json(job_path(job["id"]), job)
    return job


def parse_job_datetime(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def job_last_heartbeat(job: dict) -> datetime | None:
    return parse_job_datetime(job.get("heartbeat_at")) or parse_job_datetime(job.get("updated_at")) or parse_job_datetime(job.get("created_at"))


def job_belongs_to_previous_backend(job: dict) -> bool:
    if job.get("status") not in JOB_ACTIVE_STATUSES:
        return False
    last_seen = job_last_heartbeat(job)
    if not last_seen:
        return True
    try:
        worker_pid = int(job.get("worker_pid") or 0)
    except (TypeError, ValueError):
        worker_pid = 0
    return worker_pid != PROCESS_ID and last_seen < PROCESS_STARTED_AT


def job_is_stale(job: dict) -> bool:
    if job.get("status") not in JOB_ACTIVE_STATUSES:
        return False
    if job_belongs_to_previous_backend(job):
        return True
    last_seen = job_last_heartbeat(job)
    if not last_seen:
        return True
    return (timezone.now() - last_seen).total_seconds() > JOB_STALE_AFTER_SECONDS


def interrupted_clip_ids(job: dict) -> list[str]:
    paths = list(job.get("target_paths") or [])
    if job.get("target_path"):
        paths.append(str(job.get("target_path") or ""))
    clip_ids = []
    for target_path in paths:
        target_path = str(target_path or "")
        if target_path.startswith("video_clip:"):
            clip_ids.append(target_path.split(":", 1)[1])
    return list(dict.fromkeys([clip_id for clip_id in clip_ids if clip_id]))


def reset_interrupted_video_clip(job: dict, detail: str) -> None:
    clip_ids = interrupted_clip_ids(job)
    if not clip_ids or not video_clips_table_exists():
        return
    with connection.cursor() as cursor:
        cursor.execute(
            """
            update public.video_clips
               set status = 'uploaded',
                   processed_at = null,
                   error_message = %s,
                   last_error_at = now(),
                   updated_at = now()
             where id = any(%s::uuid[])
               and deleted_at is null
               and processed_at is null
               and status in ('queued', 'processing', 'uploaded')
            """,
            [detail, clip_ids],
        )


def reset_job_processing_video_clips(job: dict, detail: str) -> None:
    if not video_clips_table_exists():
        return
    with connection.cursor() as cursor:
        cursor.execute(
            """
            update public.video_clips
               set status = 'uploaded',
                   processed_at = null,
                   error_message = %s,
                   last_error_at = now(),
                   updated_at = now()
             where deleted_at is null
               and processed_at is null
               and status in ('queued', 'processing')
               and metadata->>'automatic_attendance_processing_job_id' = %s
            """,
            [detail, str(job.get("id") or "")],
        )


def mark_job_interrupted(job: dict, detail: str = JOB_INTERRUPTED_DETAIL) -> dict:
    reset_interrupted_video_clip(job, detail)
    now = timezone.now().isoformat()
    job.update(
        {
            "status": "error",
            "phase": "error",
            "phase_label": "Procesamiento interrumpido",
            "detail": detail,
            "interrupted_at": now,
            "completed_at": now,
            "updated_at": now,
        }
    )
    write_json(job_path(job["id"]), job)
    return job


def mark_job_canceled(job: dict, detail: str = JOB_CANCELED_DETAIL) -> dict:
    reset_interrupted_video_clip(job, detail)
    reset_job_processing_video_clips(job, detail)
    now = timezone.now().isoformat()
    job.update(
        {
            "status": "canceled",
            "phase": "canceled",
            "phase_label": "Procesamiento cancelado",
            "detail": detail,
            "canceled_at": now,
            "completed_at": now,
            "updated_at": now,
            "heartbeat_at": now,
        }
    )
    write_json(job_path(job["id"]), job)
    return job


def expire_stale_jobs() -> None:
    ensure_dirs()
    for path in sorted(jobs_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        job = read_json(path, None)
        if job and job_is_stale(job):
            mark_job_interrupted(job)


def active_job() -> dict | None:
    ensure_dirs()
    expire_stale_jobs()
    for path in sorted(jobs_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        job = read_json(path, None)
        if job and job.get("status") in JOB_ACTIVE_STATUSES:
            return job
    return None
