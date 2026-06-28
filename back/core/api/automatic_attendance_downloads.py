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
from .automatic_attendance_jobs import update_job


def rclone_executable() -> str:
    configured = os.getenv("RCLONE_EXE", "").strip()
    candidates = [
        configured,
        shutil.which("rclone") or "",
        str(Path.home() / "scoop" / "shims" / "rclone.exe"),
        "C:\\Program Files\\rclone\\rclone.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    winget_packages = Path(os.getenv("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if winget_packages.exists():
        for candidate in winget_packages.glob("Rclone.Rclone_*\\**\\rclone.exe"):
            return str(candidate)
    return ""


def download_observed_bytes(target: Path) -> int:
    candidates = [target]
    if target.parent.exists():
        candidates.extend(target.parent.glob(f"{target.name}*"))
    sizes = []
    for candidate in candidates:
        try:
            if candidate.exists() and candidate.is_file():
                sizes.append(candidate.stat().st_size)
        except OSError:
            pass
    return max(sizes or [0])


def format_rclone_tail(log_path: Path) -> str:
    try:
        payload = log_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    lines = [line.strip() for line in payload.splitlines() if line.strip()]
    return "\n".join(lines[-20:])[:2000]


def materialize_remote_video(item: dict, job: dict | None = None) -> Path:
    metadata = dict(item.get("metadata") or {})
    clip_id = metadata.get("video_clip_id")
    if not clip_id:
        raise RuntimeError("El video remoto no tiene video_clip_id.")
    site_folder = str(metadata.get("site_id") or "sin-sede")
    filename = f"{timezone.now().strftime('%Y%m%d-%H%M%S')}-{str(clip_id)[:8]}-{get_valid_filename(item['filename'])}"
    target = pending_dir() / site_folder / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    drive_remote_path = metadata.get("download_drive_remote_path") or metadata.get("drive_remote_path") or ""
    drive_file_id = metadata.get("drive_file_id") or ""

    rclone_path = rclone_executable()
    if drive_remote_path and rclone_path:
        total_bytes = int(item.get("size") or 0)
        log_path = jobs_dir() / f"{job['id']}-rclone.log" if job else target.with_suffix(target.suffix + ".rclone.log")
        if job:
            update_job(
                job,
                download_percent=0,
                downloaded_bytes=0,
                download_total_bytes=total_bytes,
                download_speed_bps=0,
                download_average_bps=0,
                download_eta_seconds=None,
                download_log_path=str(log_path),
                phase="downloading",
                phase_label="Descargando video desde Drive",
                current_video=f"Descargando {item['filename']}",
            )
        command = [
            rclone_path,
            "copyto",
            drive_remote_path,
            str(target),
            "--drive-acknowledge-abuse",
            "--stats",
            "1s",
            "--stats-one-line",
            "--checkers",
            "8",
            "--transfers",
            "1",
        ]
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8", errors="ignore") as log_file:
            process = subprocess.Popen(command, stdout=log_file, stderr=subprocess.STDOUT, text=True)
            started_at = time_module.monotonic()
            last_checked_at = started_at
            last_downloaded = 0
            last_percent = -1.0
            while process.poll() is None:
                if time_module.monotonic() - started_at > 3600:
                    process.kill()
                    raise RuntimeError("La descarga con rclone excedio 60 minutos.")
                now = time_module.monotonic()
                downloaded = download_observed_bytes(target)
                elapsed = max(now - started_at, 0.001)
                interval = max(now - last_checked_at, 0.001)
                speed_bps = max(0, int((downloaded - last_downloaded) / interval))
                average_bps = max(0, int(downloaded / elapsed))
                eta_seconds = int((total_bytes - downloaded) / average_bps) if total_bytes and average_bps else None
                percent = round((downloaded / total_bytes) * 100, 1) if total_bytes else 0
                if job and (percent != last_percent or speed_bps > 0):
                    last_percent = percent
                    phase_label = "Verificando descarga local" if total_bytes and downloaded >= total_bytes else "Descargando video desde Drive"
                    update_job(
                        job,
                        download_percent=percent,
                        downloaded_bytes=downloaded,
                        download_total_bytes=total_bytes,
                        download_speed_bps=speed_bps,
                        download_average_bps=average_bps,
                        download_eta_seconds=eta_seconds,
                        phase="downloading",
                        phase_label=phase_label,
                    )
                last_checked_at = now
                last_downloaded = downloaded
                time_module.sleep(1)
            return_code = process.wait()
        if return_code:
            raise RuntimeError((format_rclone_tail(log_path) or "rclone no pudo descargar el video.").strip()[:1000])
        if job:
            final_size = download_observed_bytes(target)
            elapsed = max(time_module.monotonic() - started_at, 0.001)
            update_job(
                job,
                download_percent=100,
                downloaded_bytes=final_size,
                download_total_bytes=total_bytes,
                download_speed_bps=0,
                download_average_bps=int(final_size / elapsed),
                download_eta_seconds=0,
                download_log_tail=format_rclone_tail(log_path),
                last_download_summary=f"{format(final_size / (1024 * 1024), '.1f')} MB descargados en {format(elapsed, '.1f')}s",
                phase="preparing",
                phase_label="Descarga completa; preparando archivo local",
            )
    elif drive_file_id:
        raise RuntimeError("El archivo de Drive no es descargable sin rclone. Instala rclone o configura RCLONE_EXE para usar el remoto dahua_drive.")
    else:
        raise RuntimeError("El video remoto no tiene drive_remote_path ni drive_file_id.")

    write_json(sidecar_path(target), metadata)
    return target


def download_drive_file(file_id: str, target: Path) -> None:
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    url = f"https://drive.google.com/uc?export=download&id={quote(file_id)}"
    response = opener.open(Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0"}), timeout=3600)
    content_type = response.headers.get("Content-Type", "")
    disposition = response.headers.get("Content-Disposition", "")
    if "text/html" in content_type and "attachment" not in disposition.lower():
        html_payload = response.read().decode("utf-8", errors="ignore")
        confirm_url = extract_drive_confirm_url(html_payload)
        if not confirm_url:
            raise RuntimeError("Drive no entrego el archivo. Revisa permisos del archivo o configura rclone para dahua_drive.")
        response = opener.open(Request(confirm_url, method="GET", headers={"User-Agent": "Mozilla/5.0"}), timeout=3600)
        content_type = response.headers.get("Content-Type", "")
        disposition = response.headers.get("Content-Disposition", "")
        if "text/html" in content_type and "attachment" not in disposition.lower():
            raise RuntimeError("Drive devolvio HTML en vez del video. Revisa permisos del archivo o configura rclone para dahua_drive.")

    with target.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)


def extract_drive_confirm_url(payload: str) -> str:
    match = re.search(r'href="([^"]*?/uc\?export=download[^"]+)"', payload)
    if not match:
        match = re.search(r'href="([^"]*?confirm=[^"]+)"', payload)
    if not match:
        return ""
    href = html.unescape(match.group(1))
    if href.startswith("http"):
        return href
    return f"https://drive.google.com{href}"
