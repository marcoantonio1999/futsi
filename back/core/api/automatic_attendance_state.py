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



VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}


EVIDENCE_BUCKET = os.getenv("AUTO_ATTENDANCE_EVIDENCE_BUCKET", "automatic-attendance-evidence")


ACTIVE_STUDENT_STATUSES = ["trial", "active", "paused", "injured"]


JOB_LOCK = threading.Lock()


PROCESS_ID = os.getpid()


PROCESS_STARTED_AT = timezone.now()


JOB_ACTIVE_STATUSES = {"queued", "processing"}


JOB_STALE_AFTER_SECONDS = int(os.getenv("AUTO_ATTENDANCE_JOB_STALE_SECONDS", "600"))


JOB_INTERRUPTED_DETAIL = "Procesamiento interrumpido: el backend se reinicio o el worker dejo de enviar heartbeat."


JOB_CANCELED_DETAIL = "Procesamiento cancelado por el usuario."


def automatic_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "automatic_attendance"


def pending_dir() -> Path:
    return automatic_root() / "pendientes"


def processed_dir(job_id: str) -> Path:
    return automatic_root() / "procesados" / job_id


def error_dir(job_id: str) -> Path:
    return automatic_root() / "errores" / job_id


def jobs_dir() -> Path:
    return automatic_root() / "jobs"


def ensure_dirs() -> None:
    for folder in [pending_dir(), jobs_dir()]:
        folder.mkdir(parents=True, exist_ok=True)


def is_local_enabled() -> bool:
    env_enabled = os.getenv("AUTOMATIC_ATTENDANCE_LOCAL_ENABLED", "").lower() in {"1", "true", "yes", "si"}
    return (settings.DEBUG or env_enabled) and not getattr(settings, "IS_RENDER", False)


def sidecar_path(video_path: Path) -> Path:
    return video_path.with_suffix(video_path.suffix + ".json")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return default


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.{uuid4().hex}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    last_error = None
    for _ in range(5):
        try:
            tmp_path.replace(path)
            return
        except PermissionError as exc:
            last_error = exc
            time_module.sleep(0.05)
    raise last_error


def job_path(job_id: str) -> Path:
    return jobs_dir() / f"{job_id}.json"


def read_json_from_text(value: str, default):
    try:
        return json.loads(value)
    except Exception:
        return default
