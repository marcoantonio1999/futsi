from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time as time_module
import html
import http.cookiejar
from collections.abc import Sequence
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import close_old_connections, connection
from django.utils import timezone
from django.utils.text import get_valid_filename, slugify

from .common import *
from core.services.match_sessions import ensure_match_attendance_sessions
from core.services.face_insight import build_student_database, detect_embeddings, student_reference_path


VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}
ACTIVE_STUDENT_STATUSES = ["trial", "active", "paused", "injured"]
JOB_LOCK = threading.Lock()


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


def read_job(job_id: str) -> dict | None:
    path = job_path(job_id)
    if not path.exists():
        return None
    return read_json(path, None)


def update_job(job: dict, **updates) -> dict:
    job.update(updates)
    job["updated_at"] = timezone.now().isoformat()
    write_json(job_path(job["id"]), job)
    return job


def active_job() -> dict | None:
    ensure_dirs()
    for path in sorted(jobs_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        job = read_json(path, None)
        if job and job.get("status") in {"queued", "processing"}:
            return job
    return None


def infer_metadata(video_path: Path, metadata: dict) -> dict:
    inferred = dict(metadata)
    if not inferred.get("site_id"):
        try:
            relative_parent = video_path.parent.relative_to(pending_dir())
            parent_parts = [part for part in relative_parent.parts if part not in {"", "."}]
        except ValueError:
            parent_parts = []
        sites = list(Site.objects.all())
        for part in parent_parts:
            if str(part).isdigit() and any(site.id == int(part) for site in sites):
                inferred["site_id"] = str(part)
                inferred["site_source"] = "folder"
                break
            normalized_part = slugify(part)
            site = next((item for item in sites if slugify(item.name) == normalized_part), None)
            if site:
                inferred["site_id"] = str(site.id)
                inferred["site_source"] = "folder"
                break

    if not inferred.get("recorded_date"):
        match = re.search(r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})", video_path.name)
        if match:
            inferred["recorded_date"] = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
            inferred["date_source"] = "filename"
    return inferred


def pending_videos() -> list[dict]:
    ensure_dirs()
    videos = []
    for path in sorted(pending_dir().rglob("*"), key=lambda item: item.stat().st_mtime):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        metadata = infer_metadata(path, read_json(sidecar_path(path), {}))
        videos.append(
            {
                "filename": path.name,
                "path": str(path),
                "source": "local",
                "size": path.stat().st_size,
                "modified_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.get_current_timezone()).isoformat(),
                "metadata": metadata,
            }
        )
    return videos + remote_pending_videos()


def video_clips_table_exists() -> bool:
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass('public.video_clips')")
        return bool(cursor.fetchone()[0])


def remote_pending_videos() -> list[dict]:
    if not video_clips_table_exists():
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select id, local_file_name, drive_file_id, drive_web_url, drive_remote_path, size_bytes,
                   uploaded_at, created_at, attendance_session_id, match_id, metadata, camera_id,
                   clip_type, recording_started_at, recording_ended_at, duration_seconds
            from public.video_clips
            where processed_at is null
              and deleted_at is null
              and status in ('uploaded', 'pending')
            order by coalesce(uploaded_at, created_at) asc
            """
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    videos = []
    for row in rows:
        raw_metadata = row.get("metadata") or {}
        if isinstance(raw_metadata, str):
            raw_metadata = read_json_from_text(raw_metadata, {})
        metadata = dict(raw_metadata or {})
        sidecar = metadata.get("sidecar") if isinstance(metadata.get("sidecar"), dict) else {}
        if row.get("attendance_session_id") and not metadata.get("session_id"):
            metadata["session_id"] = row["attendance_session_id"]
        if sidecar.get("attendance_session_id") and not metadata.get("session_id"):
            metadata["session_id"] = sidecar["attendance_session_id"]
        if sidecar.get("site_id") and not metadata.get("site_id"):
            metadata["site_id"] = sidecar["site_id"]
        if row.get("recording_started_at") and not metadata.get("recorded_date"):
            metadata["recorded_date"] = timezone.localtime(row["recording_started_at"]).date().isoformat()
        if sidecar.get("recording_started_at") and not metadata.get("recorded_date"):
            try:
                metadata["recorded_date"] = datetime.fromisoformat(str(sidecar["recording_started_at"]).replace("Z", "+00:00")).date().isoformat()
            except ValueError:
                pass
        metadata.update(
            {
                "source": "video_clips",
                "video_clip_id": str(row["id"]),
                "drive_file_id": row.get("drive_file_id"),
                "drive_web_url": row.get("drive_web_url"),
                "drive_remote_path": row.get("drive_remote_path"),
                "camera_id": row.get("camera_id"),
                "clip_type": row.get("clip_type"),
                "match_id": row.get("match_id"),
            }
        )
        videos.append(
            {
                "filename": row.get("local_file_name") or f"{row['id']}.mp4",
                "path": f"video_clip:{row['id']}",
                "source": "drive",
                "size": row.get("size_bytes") or 0,
                "modified_at": (row.get("uploaded_at") or row.get("created_at") or timezone.now()).isoformat(),
                "metadata": metadata,
            }
        )
    return videos


def video_clip_item_from_row(row: dict, reprocessable: bool = False) -> dict:
    raw_metadata = row.get("metadata") or {}
    if isinstance(raw_metadata, str):
        raw_metadata = read_json_from_text(raw_metadata, {})
    metadata = dict(raw_metadata or {})
    sidecar = metadata.get("sidecar") if isinstance(metadata.get("sidecar"), dict) else {}
    if row.get("attendance_session_id") and not metadata.get("session_id"):
        metadata["session_id"] = row["attendance_session_id"]
    if sidecar.get("attendance_session_id") and not metadata.get("session_id"):
        metadata["session_id"] = sidecar["attendance_session_id"]
    if sidecar.get("site_id") and not metadata.get("site_id"):
        metadata["site_id"] = sidecar["site_id"]
    if row.get("recording_started_at") and not metadata.get("recorded_date"):
        metadata["recorded_date"] = timezone.localtime(row["recording_started_at"]).date().isoformat()
    if sidecar.get("recording_started_at") and not metadata.get("recorded_date"):
        try:
            metadata["recorded_date"] = datetime.fromisoformat(str(sidecar["recording_started_at"]).replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            pass
    metadata.update(
        {
            "source": "video_clips",
            "video_clip_id": str(row["id"]),
            "drive_file_id": row.get("drive_file_id"),
            "drive_web_url": row.get("drive_web_url"),
            "drive_remote_path": row.get("drive_remote_path"),
            "camera_id": row.get("camera_id"),
            "clip_type": row.get("clip_type"),
            "match_id": row.get("match_id"),
            "status": row.get("status"),
            "processed_at": row.get("processed_at").isoformat() if row.get("processed_at") else None,
            "error_message": row.get("error_message"),
            "recording_started_at": row.get("recording_started_at").isoformat() if row.get("recording_started_at") else metadata.get("recording_started_at"),
            "recording_ended_at": row.get("recording_ended_at").isoformat() if row.get("recording_ended_at") else metadata.get("recording_ended_at"),
            "duration_seconds": row.get("duration_seconds") or metadata.get("duration_seconds"),
        }
    )
    return {
        "filename": row.get("local_file_name") or f"{row['id']}.mp4",
        "path": f"video_clip:{row['id']}",
        "source": "drive",
        "size": row.get("size_bytes") or 0,
        "modified_at": (row.get("uploaded_at") or row.get("created_at") or timezone.now()).isoformat(),
        "reprocessable": reprocessable,
        "metadata": metadata,
    }


def recent_reprocessable_videos() -> list[dict]:
    if not video_clips_table_exists():
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select id, local_file_name, drive_file_id, drive_web_url, drive_remote_path, size_bytes,
                   uploaded_at, created_at, processed_at, error_message, attendance_session_id,
                   match_id, metadata, camera_id, clip_type, recording_started_at, recording_ended_at,
                   duration_seconds, status
            from public.video_clips
            where processed_at is not null
              and deleted_at is null
              and status in ('processed', 'failed')
            order by processed_at desc
            limit 25
            """
        )
        columns = [column[0] for column in cursor.description]
        return [video_clip_item_from_row(dict(zip(columns, row)), reprocessable=True) for row in cursor.fetchall()]


def read_json_from_text(value: str, default):
    try:
        return json.loads(value)
    except Exception:
        return default


def mark_video_clip_processed(clip_id: str, failed: bool, error_message: str = "") -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            update public.video_clips
               set processed_at = now(),
                   status = %s,
                   error_message = %s,
                   updated_at = now()
             where id = %s
            """,
            ["failed" if failed else "processed", error_message or None, clip_id],
        )


def reset_video_clip_for_reprocess(clip_id: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            update public.video_clips
               set processed_at = null,
                   status = 'uploaded',
                   error_message = null,
                   updated_at = now()
             where id = %s
               and deleted_at is null
               and status in ('processed', 'failed')
            """,
            [clip_id],
        )
        return cursor.rowcount > 0


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
    drive_remote_path = metadata.get("drive_remote_path") or ""
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
                    update_job(
                        job,
                        download_percent=percent,
                        downloaded_bytes=downloaded,
                        download_total_bytes=total_bytes,
                        download_speed_bps=speed_bps,
                        download_average_bps=average_bps,
                        download_eta_seconds=eta_seconds,
                        phase="downloading",
                        phase_label="Descargando video desde Drive",
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


def summarize_session(session: AttendanceSession) -> dict:
    return {
        "id": session.id,
        "site": session.site_id,
        "site_name": session.site.name,
        "date": session.date.isoformat(),
        "starts_at": session.starts_at.isoformat() if session.starts_at else None,
        "ends_at": session.ends_at.isoformat() if session.ends_at else None,
        "duration_minutes": session.duration_minutes,
        "session_type": session.session_type,
        "group_name": session.group_name,
        "team": session.team_id,
        "team_name": session.team.name if session.team_id else "",
        "tournament": session.tournament_id,
    }


def get_or_create_match_sessions(match: Match, user: User) -> list[AttendanceSession]:
    return ensure_match_attendance_sessions(match, user)


def resolve_sessions(video_path: Path, metadata: dict, user: User) -> list[AttendanceSession]:
    session_id = metadata.get("session_id")
    if session_id:
        return list(AttendanceSession.objects.select_related("site").filter(id=session_id, closed_at__isnull=True))

    site_id = metadata.get("site_id")
    if not site_id:
        return []

    recorded_date = metadata.get("recorded_date")
    if recorded_date:
        try:
            session_date = datetime.fromisoformat(recorded_date).date()
        except ValueError:
            session_date = timezone.localdate()
    else:
        session_date = datetime.fromtimestamp(video_path.stat().st_mtime, tz=timezone.get_current_timezone()).date()

    existing_sessions = list(
        AttendanceSession.objects.select_related("site")
        .filter(site_id=site_id, date=session_date, closed_at__isnull=True)
        .order_by("starts_at", "id")
    )

    matches = (
        Match.objects.select_related("site", "tournament", "round", "home_team", "away_team")
        .filter(site_id=site_id, played_on=session_date)
        .exclude(status="canceled")
        .order_by("starts_at", "id")
    )
    match_sessions = []
    for match in matches:
        match_sessions.extend(get_or_create_match_sessions(match, user))

    sessions_by_id = {session.id: session for session in existing_sessions + match_sessions}
    return sorted(sessions_by_id.values(), key=lambda session: (session.starts_at or time.min, session.id))


def roster_for_session(session: AttendanceSession) -> Sequence[object]:
    if session.session_type == "tournament_match" and session.team_id:
        registered_students = list(
            Student.objects.filter(
                tournament_registrations__tournament=session.tournament,
                tournament_registrations__team=session.team,
                tournament_registrations__status="registered",
                status__in=ACTIVE_STUDENT_STATUSES,
            ).distinct()
        )
        if registered_students:
            return registered_students
        return list(Player.objects.filter(team=session.team, is_active=True))

    roster = Student.objects.filter(site=session.site, status__in=ACTIVE_STUDENT_STATUSES)
    if session.group_name:
        roster = roster.filter(group_name=session.group_name)
    return list(roster)


def has_configured_reference(person: object) -> bool:
    photo = getattr(person, "photo", None)
    if photo and getattr(photo, "name", ""):
        return True
    photo_url = getattr(person, "photo_url", "") or ""
    return photo_url.startswith("supabase://") or photo_url.startswith("/media/") or photo_url.startswith("media/")


def roster_reference_status(session: AttendanceSession) -> dict:
    roster = list(roster_for_session(session))
    configured = [person for person in roster if has_configured_reference(person)]
    missing = [getattr(person, "full_name", str(person)) for person in roster if not has_configured_reference(person)]
    return {
        "roster_count": len(roster),
        "configured_count": len(configured),
        "missing": missing,
    }


def team_has_debt(team: Team) -> bool:
    return team.charges.filter(status__in=["pending", "partial"]).exists()


def safe_filename(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", text).strip("_") or "item"


def evidence_url(request, job_id: str, evidence_path: str) -> str:
    if not evidence_path:
        return ""
    try:
        relative_path = Path(evidence_path).resolve().relative_to(processed_dir(job_id).resolve()).as_posix()
    except Exception:
        return ""
    path = f"/api/automatic-attendance/evidence/{job_id}/{quote(relative_path, safe='/')}"
    return request.build_absolute_uri(path) if request else path


def comparison_student_id(item: dict) -> int:
    try:
        return int(item.get("student_id") or getattr(item.get("student"), "id", 0) or 0)
    except (TypeError, ValueError):
        return 0


def comparison_similarity(item: dict) -> float:
    try:
        return float(item.get("similarity", item.get("best_similarity", 0)) or 0)
    except (TypeError, ValueError):
        return 0.0


def dedupe_comparison_payload(items: list[dict], excluded_ids: set[int] | None = None) -> list[dict]:
    excluded_ids = excluded_ids or set()
    by_student: dict[int, dict] = {}
    for item in items or []:
        student_id = comparison_student_id(item)
        if not student_id or student_id in excluded_ids:
            continue
        current = by_student.get(student_id)
        item_hits = int(item.get("hits") or item.get("count") or 1)
        if current is None:
            next_item = dict(item)
            next_item["hits"] = item_hits
            by_student[student_id] = next_item
            continue
        current["hits"] = int(current.get("hits") or current.get("count") or 1) + item_hits
        if comparison_similarity(item) > comparison_similarity(current):
            next_item = dict(item)
            next_item["hits"] = current["hits"]
            by_student[student_id] = next_item
    return sorted(by_student.values(), key=comparison_similarity, reverse=True)


def normalize_job_comparisons(job: dict) -> dict:
    for result in job.get("results", []) or []:
        for session_result in result.get("sessions", []) or []:
            marked = dedupe_comparison_payload(session_result.get("marked", []) or [])
            marked_ids = {comparison_student_id(item) for item in marked}
            review = dedupe_comparison_payload(session_result.get("review", []) or [], excluded_ids=marked_ids)
            session_result["marked"] = marked
            session_result["review"] = review
    return job


def hydrate_job_evidence_urls(job: dict, request) -> dict:
    hydrated = normalize_job_comparisons(json.loads(json.dumps(job)))
    job_id = hydrated.get("id", "")
    for result in hydrated.get("results", []) or []:
        for session_result in result.get("sessions", []) or []:
            for key in ["marked", "review", "unknown_faces"]:
                for item in session_result.get(key, []) or []:
                    item["evidence_url"] = evidence_url(request, job_id, item.get("evidence_path", ""))
    return hydrated


def save_match_evidence(entry: dict, session: AttendanceSession, job: dict, category: str = "accepted") -> str:
    import cv2

    person = entry["student"]
    frame = entry.get("best_frame")
    bbox = entry.get("best_bbox")
    reference_path = student_reference_path(person)
    if frame is None or not bbox or not reference_path:
        return ""

    x1, y1, x2, y2 = bbox
    height, width = frame.shape[:2]
    pad = 24
    x1 = max(0, x1 - pad)
    y1 = max(0, y1 - pad)
    x2 = min(width, x2 + pad)
    y2 = min(height, y2 + pad)
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return ""

    reference = cv2.imread(str(reference_path))
    if reference is None:
        return ""
    target_size = (220, 220)
    crop_resized = cv2.resize(crop, target_size)
    reference_resized = cv2.resize(reference, target_size)
    combined = cv2.hconcat([reference_resized, crop_resized])

    evidence_dir = processed_dir(job["id"]) / "evidence" / f"session_{session.id}" / category
    evidence_dir.mkdir(parents=True, exist_ok=True)
    filename = (
        f"student_{person.id}_{safe_filename(person.full_name)}_"
        f"sim_{entry['best_similarity']:.4f}_hits_{entry['count']}_frame_{entry.get('best_frame_index', 0)}.jpg"
    )
    output_path = evidence_dir / filename
    cv2.imwrite(str(output_path), combined)
    return str(output_path)


def crop_face_from_frame(frame, bbox, pad: int = 24):
    if frame is None or not bbox:
        return None
    x1, y1, x2, y2 = bbox
    height, width = frame.shape[:2]
    x1 = max(0, x1 - pad)
    y1 = max(0, y1 - pad)
    x2 = min(width, x2 + pad)
    y2 = min(height, y2 + pad)
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    return crop


def save_unknown_evidence(entry: dict, session: AttendanceSession, job: dict) -> str:
    import cv2

    crop = crop_face_from_frame(entry.get("best_frame"), entry.get("best_bbox"))
    if crop is None:
        return ""
    crop_resized = cv2.resize(crop, (220, 220))
    evidence_dir = processed_dir(job["id"]) / "evidence" / f"session_{session.id}" / "unknown"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    filename = f"unknown_sim_{entry.get('best_similarity', 0):.4f}_frame_{entry.get('best_frame_index', 0)}.jpg"
    output_path = evidence_dir / filename
    cv2.imwrite(str(output_path), crop_resized)
    return str(output_path)


def mark_present(
    session: AttendanceSession,
    person: object,
    user: User,
    similarity: float,
    hits: int,
    video_name: str,
    evidence_path: str = "",
    source_label: str = "Pase de lista automatico por video local",
    engine: str = "insightface-video",
) -> None:
    confidence = Decimal(str(similarity)).quantize(Decimal("0.0001"))
    if session.session_type == "tournament_match" and isinstance(person, Player):
        PlayerAttendanceRecord.objects.update_or_create(
            session=session,
            player=person,
            defaults={
                "status": "present",
                "had_team_debt_at_capture": team_has_debt(person.team),
                "override_reason": f"{source_label}: {video_name}",
                "captured_by": user,
            },
        )
        return

    student = person
    AttendanceRecord.objects.update_or_create(
        session=session,
        student=student,
        defaults={
            "status": "present",
            "had_debt_at_capture": student.charges.filter(status__in=["pending", "partial"]).exists(),
            "override_reason": f"{source_label}: {video_name}",
            "captured_by": user,
        },
    )
    FaceRecognitionAttempt.objects.create(
        session=session,
        student=student,
        captured_by=user,
        matched=True,
        confidence=confidence,
        engine=engine,
        notes=f"{source_label}. Video {video_name}. Hits: {hits}. Mejor similitud: {similarity:.4f}. Evidencia: {evidence_path}",
    )


def process_video_for_session(video_path: Path, session: AttendanceSession, user: User, job: dict, metadata: dict | None = None) -> dict:
    import cv2
    import numpy as np

    providers = os.getenv("FACE_PROVIDERS", "auto")
    threshold = float(os.getenv("AUTO_ATTENDANCE_THRESHOLD", os.getenv("FACE_MATCH_THRESHOLD", "0.35")))
    min_margin = float(os.getenv("AUTO_ATTENDANCE_MIN_MARGIN", os.getenv("FACE_MATCH_MIN_MARGIN", "0.03")))
    min_hits = int(os.getenv("AUTO_ATTENDANCE_MIN_HITS", "2"))
    sample_every = max(1, int(os.getenv("AUTO_ATTENDANCE_SAMPLE_EVERY", "10")))
    review_threshold = float(os.getenv("AUTO_ATTENDANCE_REVIEW_THRESHOLD", "0.22"))
    duplicate_guard_similarity = float(os.getenv("AUTO_ATTENDANCE_DUPLICATE_GUARD", "0.50"))
    max_review_items = int(os.getenv("AUTO_ATTENDANCE_MAX_REVIEW_ITEMS", "24"))
    max_unknown_items = int(os.getenv("AUTO_ATTENDANCE_MAX_UNKNOWN_ITEMS", "24"))
    unknown_duplicate_similarity = float(os.getenv("AUTO_ATTENDANCE_UNKNOWN_DUPLICATE_GUARD", "0.38"))

    roster = roster_for_session(session)
    reference_status = roster_reference_status(session)
    if reference_status["configured_count"] == 0:
        return {
            "session": summarize_session(session),
            "marked": [],
            "review": [],
            "failed": False,
            "detail": "Sesion omitida: no tiene fotos locales o privadas configuradas para comparar.",
            "skipped": reference_status["missing"][:10],
        }

    enrolled_people, reference_matrix, skipped = build_student_database(roster, providers_key=providers)
    if reference_matrix.size == 0:
        return {"session": summarize_session(session), "marked": [], "failed": True, "detail": "No hay fotos validas para comparar.", "skipped": skipped[:10]}

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return {"session": summarize_session(session), "marked": [], "failed": True, "detail": "No se pudo abrir el video."}

    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    metadata = metadata or {}
    total_duration = total_frames / fps if total_frames and fps else 0
    long_video_threshold = int(os.getenv("AUTO_ATTENDANCE_LONG_VIDEO_SECONDS", "14400"))
    pre_minutes = int(os.getenv("AUTO_ATTENDANCE_SESSION_PRE_MINUTES", "0"))
    window_minutes = max(1, int(session.duration_minutes or os.getenv("AUTO_ATTENDANCE_SESSION_DURATION_MINUTES", "120")))
    start_frame = 0
    end_frame = total_frames
    window_label = "video completo"
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
            end_seconds = min(total_duration, start_seconds + (window_minutes * 60))
            if start_seconds < total_duration and end_seconds > start_seconds:
                start_frame = int(start_seconds * fps)
                end_frame = int(end_seconds * fps)
                capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
                window_label = f"sesion {session.starts_at.strftime('%H:%M')}-{(session.ends_at.strftime('%H:%M') if session.ends_at else f'{window_minutes} min')} ({round(start_seconds / 60)}-{round(end_seconds / 60)} min del video)"
        except (TypeError, ValueError, OverflowError):
            pass
    elif total_duration >= long_video_threshold and session.starts_at:
        session_seconds = (session.starts_at.hour * 3600) + (session.starts_at.minute * 60) + session.starts_at.second
        start_seconds = max(0, session_seconds - (pre_minutes * 60))
        end_seconds = min(total_duration, session_seconds + (window_minutes * 60))
        if start_seconds < total_duration and end_seconds > start_seconds:
            start_frame = int(start_seconds * fps)
            end_frame = int(end_seconds * fps)
            capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            window_label = f"{round(start_seconds / 60)}-{round(end_seconds / 60)} min"

    window_frames = max(end_frame - start_frame, 1)
    window_seconds = window_frames / fps if fps else None
    update_job(
        job,
        phase="processing",
        phase_label="Procesando frames del video",
        process_frame=start_frame,
        process_total_frames=window_frames,
        process_sampled_frames=0,
        process_window=window_label,
        video_duration_seconds=round(total_duration, 2) if total_duration else None,
        video_total_frames=total_frames,
        video_fps=round(fps, 3) if fps else None,
        process_window_seconds=round(window_seconds, 2) if window_seconds else None,
    )

    frame_index = start_frame
    sampled_frames = 0
    accepted_observations = []
    review_observations = []
    unknown_observations = []

    def ranked_candidates(embedding) -> tuple[list[dict], float, float]:
        query = embedding.astype(np.float32)
        query = query / max(np.linalg.norm(query), 1e-12)
        similarities = reference_matrix @ query
        order = np.argsort(-similarities)[:3]
        best = float(similarities[order[0]]) if len(order) else 0.0
        second = float(similarities[order[1]]) if len(order) > 1 else -1.0
        margin = best - second
        candidates = [
            {
                "student": enrolled_people[int(index)],
                "similarity": float(similarities[int(index)]),
            }
            for index in order
        ]
        return candidates, best, margin

    def make_observation(face, frame, frame_index: int, candidates: list[dict], best_similarity: float, margin: float, reason: str = "") -> dict:
        return {
            "student": candidates[0]["student"],
            "count": 1,
            "best_similarity": best_similarity,
            "margin": margin,
            "best_frame": frame.copy(),
            "best_bbox": face.bbox,
            "best_frame_index": frame_index,
            "embedding": face.embedding,
            "reason": reason,
            "candidates": [
                {"student_id": item["student"].id, "student_name": item["student"].full_name, "similarity": round(item["similarity"], 4)}
                for item in candidates
            ],
        }

    def make_unknown_observation(face, frame, frame_index: int, best_similarity: float) -> dict:
        return {
            "count": 1,
            "best_similarity": best_similarity,
            "best_frame": frame.copy(),
            "best_bbox": face.bbox,
            "best_frame_index": frame_index,
            "embedding": face.embedding,
        }

    def process_detected_faces(frame, frame_index: int, detections) -> None:
        nonlocal unknown_observations, review_observations
        for face in detections:
            candidates, best_similarity, margin = ranked_candidates(face.embedding)
            if not candidates or best_similarity < review_threshold:
                unknown_observations.append(make_unknown_observation(face, frame, frame_index, best_similarity))
                if len(unknown_observations) > max_unknown_items * 3:
                    unknown_observations = sorted(unknown_observations, key=lambda item: item["best_similarity"])[: max_unknown_items * 2]
                continue
            if best_similarity >= threshold and margin >= min_margin:
                accepted_observations.append(make_observation(face, frame, frame_index, candidates, best_similarity, margin))
            else:
                reason = "Similitud baja" if best_similarity < threshold else "Margen bajo contra el segundo candidato"
                review_observations.append(make_observation(face, frame, frame_index, candidates, best_similarity, margin, reason))
                if len(review_observations) > max_review_items * 3:
                    review_observations = sorted(review_observations, key=lambda item: item["best_similarity"], reverse=True)[: max_review_items * 2]

    use_second_probe = os.getenv("AUTO_ATTENDANCE_SECOND_PROBE", "1").lower() not in {"0", "false", "no", "off"}
    dense_frame_stride = max(1, int(os.getenv("AUTO_ATTENDANCE_DENSE_FRAME_STRIDE", "1")))
    frames_per_second = max(1, int(round(fps or 30)))
    probed_seconds = 0
    active_seconds = 0
    skipped_seconds = 0

    try:
        if use_second_probe and fps:
            second_start = start_frame
            window_total = max(end_frame - start_frame, 1)

            def update_second_probe_progress(current_frame: int) -> None:
                window_done = max(current_frame - start_frame, 0)
                update_job(
                    job,
                    frame=current_frame,
                    process_frame=current_frame,
                    process_total_frames=window_total,
                    process_sampled_frames=sampled_frames,
                    process_probed_seconds=probed_seconds,
                    process_active_seconds=active_seconds,
                    process_skipped_seconds=skipped_seconds,
                    phase="processing",
                    phase_label="Procesando por segundos con deteccion previa",
                    percent=min(99, round((window_done / window_total) * 100, 1)),
                )

            while second_start <= end_frame:
                second_end = min(end_frame, second_start + frames_per_second - 1)
                probe_frame = min(second_end, second_start + frames_per_second // 2)
                capture.set(cv2.CAP_PROP_POS_FRAMES, probe_frame)
                ok, probe_image = capture.read()
                if not ok:
                    break

                probed_seconds += 1
                frame_index = probe_frame
                probe_detections = detect_embeddings(probe_image, providers_key=providers)
                if not probe_detections:
                    sampled_frames += 1
                    skipped_seconds += 1
                    frame_index = second_end
                    update_second_probe_progress(frame_index)
                    second_start += frames_per_second
                    continue
                active_seconds += 1

                capture.set(cv2.CAP_PROP_POS_FRAMES, second_start)
                current_frame = second_start
                while current_frame <= second_end:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    if (current_frame - second_start) % dense_frame_stride == 0:
                        if current_frame == probe_frame:
                            detections = probe_detections
                            frame_to_store = probe_image
                        else:
                            detections = detect_embeddings(frame, providers_key=providers)
                            frame_to_store = frame
                        sampled_frames += 1
                        process_detected_faces(frame_to_store, current_frame, detections)
                    current_frame += 1

                frame_index = second_end
                update_second_probe_progress(frame_index)
                second_start += frames_per_second
        else:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                frame_index += 1
                if end_frame and frame_index > end_frame:
                    break
                if frame_index % sample_every != 0:
                    continue
                sampled_frames += 1
                process_detected_faces(frame, frame_index, detect_embeddings(frame, providers_key=providers))

                if sampled_frames % 5 == 0 and total_frames:
                    window_total = max(end_frame - start_frame, 1)
                    window_done = max(frame_index - start_frame, 0)
                    update_job(
                        job,
                        frame=frame_index,
                        process_frame=frame_index,
                        process_total_frames=window_total,
                        process_sampled_frames=sampled_frames,
                        phase="processing",
                        phase_label="Procesando frames del video",
                        percent=min(99, round((window_done / window_total) * 100, 1)),
                    )
    finally:
        capture.release()

    hits: dict[int, dict] = {}
    identity_groups = []
    duplicate_rejections = []
    for observation in sorted(accepted_observations, key=lambda item: item["best_similarity"], reverse=True):
        student = observation["student"]
        query = observation["embedding"].astype(np.float32)
        query = query / max(np.linalg.norm(query), 1e-12)
        conflict = None
        for group in identity_groups:
            if float(np.dot(query, group["embedding"])) >= duplicate_guard_similarity and group["student_id"] != student.id:
                conflict = group
                break
        if conflict:
            observation["reason"] = f"Posible mismo rostro ya asignado a {conflict['student_name']}"
            duplicate_rejections.append(observation)
            continue

        same_group = next((group for group in identity_groups if group["student_id"] == student.id and float(np.dot(query, group["embedding"])) >= duplicate_guard_similarity), None)
        if same_group is None:
            identity_groups.append({"student_id": student.id, "student_name": student.full_name, "embedding": query})

        entry = hits.setdefault(
            student.id,
            {
                "student": student,
                "count": 0,
                "best_similarity": 0.0,
                "margin": 0.0,
                "best_frame": None,
                "best_bbox": None,
                "best_frame_index": 0,
                "candidates": observation["candidates"],
            },
        )
        entry["count"] += 1
        if observation["best_similarity"] > entry["best_similarity"]:
            entry.update(
                {
                    "best_similarity": observation["best_similarity"],
                    "margin": observation["margin"],
                    "best_frame": observation["best_frame"],
                    "best_bbox": observation["best_bbox"],
                    "best_frame_index": observation["best_frame_index"],
                    "candidates": observation["candidates"],
                }
            )

    marked = []
    review = []
    for entry in hits.values():
        if entry["count"] < min_hits:
            entry["reason"] = f"Solo {entry['count']} aparicion(es); minimo requerido {min_hits}"
            review.append(entry)
            continue
        person = entry["student"]
        evidence_path = save_match_evidence(entry, session, job, "accepted")
        mark_present(session, person, user, entry["best_similarity"], entry["count"], video_path.name, evidence_path)
        marked.append(
            {
                "student_id": person.id,
                "student_name": person.full_name,
                "hits": entry["count"],
                "similarity": round(entry["best_similarity"], 4),
                "margin": round(entry["margin"], 4),
                "frame": entry.get("best_frame_index", 0),
                "evidence_path": evidence_path,
                "candidates": entry.get("candidates", []),
            }
        )

    review.extend(review_observations)
    review.extend(duplicate_rejections)
    review_payload = []
    review_by_student: dict[int, dict] = {}
    for entry in sorted(review, key=lambda item: item["best_similarity"], reverse=True):
        person = entry["student"]
        if person.id in {item["student_id"] for item in marked}:
            continue
        current = review_by_student.get(person.id)
        entry_count = int(entry.get("count") or 1)
        if current is None:
            entry["count"] = entry_count
            review_by_student[person.id] = entry
            continue
        current["count"] = int(current.get("count") or 1) + entry_count
        if entry["best_similarity"] > current["best_similarity"]:
            entry["count"] = current["count"]
            review_by_student[person.id] = entry

    for entry in sorted(review_by_student.values(), key=lambda item: item["best_similarity"], reverse=True)[:max_review_items]:
        person = entry["student"]
        evidence_path = save_match_evidence(entry, session, job, "review")
        review_payload.append(
            {
                "student_id": person.id,
                "student_name": person.full_name,
                "similarity": round(entry["best_similarity"], 4),
                "margin": round(entry.get("margin", 0.0), 4),
                "hits": entry.get("count", 1),
                "frame": entry.get("best_frame_index", 0),
                "reason": entry.get("reason", "Requiere revision"),
                "evidence_path": evidence_path,
                "candidates": entry.get("candidates", []),
            }
        )

    unknown_payload = []
    unknown_groups = []
    for entry in sorted(unknown_observations, key=lambda item: item["best_similarity"]):
        query = entry["embedding"].astype(np.float32)
        query = query / max(np.linalg.norm(query), 1e-12)
        matching_group = None
        for group in unknown_groups:
            centroid_similarity = float(np.dot(query, group["centroid"]))
            sample_similarity = max(float(np.dot(query, sample)) for sample in group["samples"])
            if max(centroid_similarity, sample_similarity) >= unknown_duplicate_similarity:
                matching_group = group
                break
        if matching_group:
            matching_group["count"] += 1
            matching_group["samples"].append(query)
            samples = np.vstack(matching_group["samples"]).astype(np.float32)
            centroid = samples.mean(axis=0)
            matching_group["centroid"] = centroid / max(np.linalg.norm(centroid), 1e-12)
            if entry["best_similarity"] < matching_group["best_similarity"]:
                matching_group.update({**entry, "embedding": query, "count": matching_group["count"], "samples": matching_group["samples"], "centroid": matching_group["centroid"]})
            continue
        unknown_groups.append({**entry, "embedding": query, "samples": [query], "centroid": query})

    for index, entry in enumerate(sorted(unknown_groups, key=lambda item: item["count"], reverse=True)[:max_unknown_items], start=1):
        evidence_path = save_unknown_evidence(entry, session, job)
        unknown_payload.append(
            {
                "unknown_id": index,
                "hits": entry.get("count", 1),
                "similarity": round(entry.get("best_similarity", 0.0), 4),
                "frame": entry.get("best_frame_index", 0),
                "evidence_path": evidence_path,
            }
        )

    duration = round(total_duration, 2) if total_duration else None
    return {
        "session": summarize_session(session),
        "marked": marked,
        "review": review_payload,
        "unknown_faces": unknown_payload,
        "sampled_frames": sampled_frames,
        "probed_seconds": probed_seconds,
        "active_seconds": active_seconds,
        "skipped_seconds": skipped_seconds,
        "total_frames": total_frames,
        "duration_seconds": duration,
        "window": window_label,
        "skipped_references": skipped[:10],
        "thresholds": {
            "similarity": threshold,
            "margin": min_margin,
            "min_hits": min_hits,
            "review_similarity": review_threshold,
            "duplicate_guard": duplicate_guard_similarity,
            "second_probe": use_second_probe,
            "dense_frame_stride": dense_frame_stride,
        },
    }


def move_finished_video(video_path: Path, job_id: str, failed: bool) -> None:
    target_dir = error_dir(job_id) if failed else processed_dir(job_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / video_path.name
    shutil.move(str(video_path), str(target))
    metadata_path = sidecar_path(video_path)
    if metadata_path.exists():
        shutil.move(str(metadata_path), str(sidecar_path(target)))


def delete_materialized_video(video_path: Path) -> None:
    metadata_path = sidecar_path(video_path)
    for path in [video_path, metadata_path]:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass


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
            if clip_id:
                delete_materialized_video(video_path)
            else:
                move_finished_video(video_path, job_id, failed)
            if clip_id:
                mark_video_clip_processed(str(clip_id), failed=failed, error_message=video_result.get("detail", ""))
            update_job(job, processed=index, percent=round((index / max(len(videos), 1)) * 100, 1), results=results)

        update_job(job, status="done", phase="done", phase_label="Procesamiento terminado", current_video=None, percent=100, completed_at=timezone.now().isoformat(), results=results)
    except Exception as exc:
        update_job(job, status="error", detail=str(exc), completed_at=timezone.now().isoformat())
    finally:
        close_old_connections()


class AutomaticAttendanceStatusView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request):
        ensure_dirs()
        latest_jobs = []
        for path in sorted(jobs_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[:5]:
            latest_jobs.append(hydrate_job_evidence_urls(read_json(path, {}), request))
        current_job = active_job()
        return Response(
            {
                "enabled": is_local_enabled(),
                "root": str(automatic_root()),
                "pending_dir": str(pending_dir()),
                "pending": pending_videos(),
                "reprocessable": recent_reprocessable_videos(),
                "active_job": hydrate_job_evidence_urls(current_job, request) if current_job else None,
                "jobs": latest_jobs,
            }
        )


class AutomaticAttendanceUploadView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request):
        if not is_local_enabled():
            return Response({"detail": "El procesamiento local no esta habilitado en este entorno."}, status=status.HTTP_403_FORBIDDEN)
        upload = request.FILES.get("video")
        if not upload:
            return Response({"detail": "Sube un archivo de video."}, status=status.HTTP_400_BAD_REQUEST)
        suffix = Path(upload.name).suffix.lower()
        if suffix not in VIDEO_EXTENSIONS:
            return Response({"detail": "Formato de video no soportado."}, status=status.HTTP_400_BAD_REQUEST)

        metadata = {
            "source": "upload",
            "original_filename": upload.name,
            "uploaded_by": request.user.id,
            "uploaded_at": timezone.now().isoformat(),
            "site_id": request.data.get("site") or None,
            "session_id": request.data.get("session") or None,
            "recorded_date": request.data.get("recorded_date") or None,
        }
        session_id = metadata.get("session_id")
        if session_id:
            session = AttendanceSession.objects.filter(id=session_id, closed_at__isnull=True).first()
            if not session:
                return Response({"detail": "La sesion seleccionada no existe o esta cerrada."}, status=status.HTTP_400_BAD_REQUEST)
            reference_status = roster_reference_status(session)
            if reference_status["configured_count"] == 0:
                return Response(
                    {
                        "detail": "La sesion seleccionada no tiene fotos locales o privadas para comparar. Selecciona una sesion con fotos cargadas.",
                        "missing": reference_status["missing"][:10],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        ensure_dirs()
        filename = f"{timezone.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}-{get_valid_filename(upload.name)}"
        site_folder = str(request.data.get("site") or "sin-sede")
        relative_path = Path("automatic_attendance") / "pendientes" / site_folder / filename
        saved_path = Path(default_storage.save(str(relative_path), upload))
        full_path = Path(settings.MEDIA_ROOT) / saved_path
        write_json(sidecar_path(full_path), metadata)
        return Response({"pending": pending_videos(), "uploaded": {"filename": full_path.name, "metadata": metadata}}, status=status.HTTP_201_CREATED)


class AutomaticAttendanceProcessView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request):
        if not is_local_enabled():
            return Response({"detail": "El procesamiento local no esta habilitado en este entorno."}, status=status.HTTP_403_FORBIDDEN)
        ensure_dirs()
        requested_path = request.data.get("path") or None
        pending = pending_videos()
        if requested_path:
            pending = [item for item in pending if item.get("path") == requested_path]
            if not pending:
                return Response({"detail": "El video pendiente seleccionado ya no existe o ya fue procesado."}, status=status.HTTP_404_NOT_FOUND)
        if not pending:
            return Response({"detail": "No hay videos pendientes por procesar."}, status=status.HTTP_400_BAD_REQUEST)
        with JOB_LOCK:
            running = active_job()
            if running:
                return Response(running, status=status.HTTP_202_ACCEPTED)
            job = {
                "id": uuid4().hex,
                "status": "queued",
                "created_at": timezone.now().isoformat(),
                "updated_at": timezone.now().isoformat(),
                "created_by": request.user.id,
                "target_path": requested_path,
                "total": len(pending),
                "processed": 0,
                "percent": 0,
                "results": [],
            }
            write_json(job_path(job["id"]), job)
            thread = threading.Thread(target=process_pending_worker, args=(job["id"], request.user.id, requested_path), daemon=True)
            thread.start()
        return Response(job, status=status.HTTP_202_ACCEPTED)


class AutomaticAttendanceReprocessClipView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request):
        if not is_local_enabled():
            return Response({"detail": "El procesamiento local no esta habilitado en este entorno."}, status=status.HTTP_403_FORBIDDEN)
        if not video_clips_table_exists():
            return Response({"detail": "No existe la tabla video_clips."}, status=status.HTTP_404_NOT_FOUND)
        clip_id = str(request.data.get("video_clip_id") or "").strip()
        if not clip_id:
            return Response({"detail": "Falta video_clip_id."}, status=status.HTTP_400_BAD_REQUEST)

        with JOB_LOCK:
            running = active_job()
            if running:
                return Response(running, status=status.HTTP_202_ACCEPTED)
            if not reset_video_clip_for_reprocess(clip_id):
                return Response({"detail": "El video no existe o no esta en estado reprocesable."}, status=status.HTTP_404_NOT_FOUND)
            requested_path = f"video_clip:{clip_id}"
            pending = [item for item in pending_videos() if item.get("path") == requested_path]
            if not pending:
                return Response({"detail": "No se pudo preparar el video para reprocesar."}, status=status.HTTP_400_BAD_REQUEST)
            job = {
                "id": uuid4().hex,
                "status": "queued",
                "created_at": timezone.now().isoformat(),
                "updated_at": timezone.now().isoformat(),
                "created_by": request.user.id,
                "target_path": requested_path,
                "reprocess": True,
                "total": 1,
                "processed": 0,
                "percent": 0,
                "results": [],
            }
            write_json(job_path(job["id"]), job)
            thread = threading.Thread(target=process_pending_worker, args=(job["id"], request.user.id, requested_path), daemon=True)
            thread.start()
        return Response(job, status=status.HTTP_202_ACCEPTED)


class AutomaticAttendanceJobView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, job_id: str):
        job = read_job(job_id)
        if not job:
            return Response({"detail": "El trabajo no existe."}, status=status.HTTP_404_NOT_FOUND)
        return Response(hydrate_job_evidence_urls(job, request))


class AutomaticAttendanceConfirmReviewView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request, job_id: str):
        job = read_job(job_id)
        if not job:
            return Response({"detail": "El trabajo no existe."}, status=status.HTTP_404_NOT_FOUND)

        try:
            session_id = int(request.data.get("session_id"))
            person_id = int(request.data.get("student_id"))
        except (TypeError, ValueError):
            return Response({"detail": "Faltan session_id o student_id validos."}, status=status.HTTP_400_BAD_REQUEST)

        frame = request.data.get("frame")
        review_item = None
        target_session_result = None
        target_video = ""
        for result in job.get("results", []) or []:
            for session_result in result.get("sessions", []) or []:
                if int(session_result.get("session", {}).get("id") or 0) != session_id:
                    continue
                review_items = session_result.get("review", []) or []
                same_person_items = [item for item in review_items if int(item.get("student_id") or 0) == person_id]
                if same_person_items:
                    matching_frame_items = [item for item in same_person_items if frame in {None, "", str(item.get("frame", "")), item.get("frame")}]
                    candidates = matching_frame_items or same_person_items
                    review_item = max(candidates, key=comparison_similarity)
                    session_result["review"] = [item for item in review_items if int(item.get("student_id") or 0) != person_id]
                    target_session_result = session_result
                    target_video = result.get("video", "")
                    break
            if review_item:
                break

        if not review_item or not target_session_result:
            return Response({"detail": "La comparacion ya no esta disponible para confirmar."}, status=status.HTTP_404_NOT_FOUND)

        try:
            session = AttendanceSession.objects.select_related("site", "team").get(id=session_id)
        except AttendanceSession.DoesNotExist:
            return Response({"detail": "La sesion no existe."}, status=status.HTTP_404_NOT_FOUND)

        person = next((item for item in roster_for_session(session) if int(getattr(item, "id", 0)) == person_id), None)
        if not person:
            return Response({"detail": "La persona ya no pertenece al roster de esta sesion."}, status=status.HTTP_400_BAD_REQUEST)

        similarity = float(review_item.get("similarity") or 0)
        hits = int(review_item.get("hits") or 1)
        evidence_path = review_item.get("evidence_path", "")
        mark_present(
            session,
            person,
            request.user,
            similarity,
            hits,
            target_video,
            evidence_path,
            source_label="Confirmacion manual de pase automatico",
            engine="insightface-video-human-confirmed",
        )

        confirmed_item = {
            **review_item,
            "manual_confirmed": True,
            "confirmed_at": timezone.now().isoformat(),
            "confirmed_by": request.user.id,
            "reason": "Confirmado manualmente",
        }
        marked_items = [item for item in target_session_result.get("marked", []) or [] if int(item.get("student_id") or 0) != person_id]
        marked_items.append(confirmed_item)
        target_session_result["marked"] = dedupe_comparison_payload(marked_items)
        normalize_job_comparisons(job)
        write_json(job_path(job_id), job)
        return Response(hydrate_job_evidence_urls(job, request))


class AutomaticAttendanceEvidenceView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, job_id: str, evidence_path: str):
        base_dir = processed_dir(job_id).resolve()
        target = (base_dir / evidence_path).resolve()
        if not str(target).startswith(str(base_dir)) or not target.exists() or not target.is_file():
            return Response({"detail": "La evidencia no existe."}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(open(target, "rb"), content_type="image/jpeg")
