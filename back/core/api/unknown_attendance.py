from __future__ import annotations

import json
import hashlib
import os
import pickle
import shutil
import subprocess
import threading
import time as time_module
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, time, timedelta
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from uuid import uuid4

from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections, connection
from django.http import FileResponse
from django.utils.dateparse import parse_date, parse_datetime
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .common import IsOperationsOrCoachRole, Player, Student
from core.api.automatic_attendance import download_drive_file, rclone_executable
from core.services.face_insight import build_student_database, detect_embeddings
from core.services.supabase_storage import download_private_file, parse_storage_uri, upload_private_file


ACTIVE_STUDENT_STATUSES = ["trial", "active", "paused", "injured"]
CAPTURE_TABLE = "unknown_attendance_captures"
SUBJECT_TABLE = "unknown_attendance_subjects"
FACE_BUCKET = os.getenv("UNKNOWN_ATTENDANCE_FACE_BUCKET", "unknown-attendance-faces")
LOCAL_FACE_URI_PREFIX = "local://"
JOB_LOCK = threading.RLock()
TABLE_EXISTS_CACHE: dict[str, bool] = {}
STATUS_CACHE_SECONDS = int(os.getenv("UNKNOWN_ATTENDANCE_STATUS_CACHE_SECONDS", "10"))


def unknown_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "unknown_attendance"


def jobs_dir() -> Path:
    return unknown_root() / "jobs"


def temp_dir() -> Path:
    return unknown_root() / "tmp"


def job_download_dir(job_id: str) -> Path:
    return temp_dir() / "jobs" / job_id


def cache_dir() -> Path:
    return unknown_root() / "cache"


def pending_faces_dir() -> Path:
    return unknown_root() / "pending_faces"


def ensure_dirs() -> None:
    for folder in [jobs_dir(), temp_dir(), cache_dir(), pending_faces_dir()]:
        folder.mkdir(parents=True, exist_ok=True)


def job_path(job_id: str) -> Path:
    return jobs_dir() / f"{job_id}.json"


def read_json(path: Path, default):
    try:
        raw = path.read_text(encoding="utf-8-sig")
        return json.loads(raw)
    except Exception:
        return default


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.{uuid4().hex}.tmp")
    raw = json.dumps(payload, ensure_ascii=True, indent=2)
    last_error = None
    with JOB_LOCK:
        tmp_path.write_text(raw, encoding="utf-8")
        for attempt in range(12):
            try:
                os.replace(tmp_path, path)
                return
            except PermissionError as exc:
                last_error = exc
                time_module.sleep(0.05 * (attempt + 1))
        try:
            tmp_path.unlink()
        except OSError:
            pass
    if last_error:
        raise last_error


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


def compact_job(job: dict | None) -> dict | None:
    if not job:
        return None
    return {
        "id": job.get("id"),
        "status": job.get("status"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "completed_at": job.get("completed_at"),
        "current_capture": job.get("current_capture"),
        "phase": job.get("phase"),
        "phase_label": job.get("phase_label"),
        "total": job.get("total", 0),
        "processed": job.get("processed", 0),
        "percent": job.get("percent", 0),
        "detail": job.get("detail"),
        "results": [],
    }


def active_job() -> dict | None:
    ensure_dirs()
    stale_minutes = int(os.getenv("UNKNOWN_ATTENDANCE_JOB_STALE_MINUTES", "20"))
    for path in sorted(jobs_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        job = read_json(path, None)
        if job and job.get("status") in {"queued", "processing"}:
            updated_at = parse_datetime(str(job.get("updated_at") or "")) if job.get("updated_at") else None
            if updated_at and timezone.is_naive(updated_at):
                updated_at = timezone.make_aware(updated_at, timezone.get_current_timezone())
            if updated_at and (timezone.now() - updated_at).total_seconds() > stale_minutes * 60:
                update_job(job, status="error", detail="Trabajo marcado como atorado por inactividad.", completed_at=timezone.now().isoformat())
                continue
            return job
    return None


def table_exists(table_name: str) -> bool:
    if table_name in TABLE_EXISTS_CACHE:
        return TABLE_EXISTS_CACHE[table_name]
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass(%s)", [f"public.{table_name}"])
        exists = bool(cursor.fetchone()[0])
    TABLE_EXISTS_CACHE[table_name] = exists
    return exists


def normalize_metadata(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return {}


def compact_metadata(metadata: dict) -> dict:
    compact = dict(metadata or {})
    compact.pop("embedding", None)
    unknown_subjects = compact.get("unknown_subjects")
    if isinstance(unknown_subjects, list):
        compact["unknown_subjects"] = unknown_subjects[:3]
    known_matches = compact.get("known_matches")
    if isinstance(known_matches, list):
        compact["known_matches"] = known_matches[:3]
    rejected_faces = compact.get("rejected_faces")
    if isinstance(rejected_faces, list):
        compact["rejected_faces"] = rejected_faces[:3]
        compact["rejected_faces_count"] = len(rejected_faces)
    return compact


def captured_date_bounds(captured_date: str | None):
    if not captured_date:
        return None
    date_value = parse_date(str(captured_date))
    if not date_value:
        return None
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(date_value, time.min), tz)
    return start, start + timedelta(days=1)


def pending_filters(captured_date: str | None = None) -> tuple[list[str], list]:
    filters = [
        "deleted_at is null",
        "processed_at is null",
        "status = 'uploaded'",
        "(drive_remote_path is not null or drive_file_id is not null)",
    ]
    params = []
    bounds = captured_date_bounds(captured_date)
    if bounds:
        filters.append("captured_at >= %s and captured_at < %s")
        params.extend(bounds)
    return filters, params


def fetch_pending_capture_count(captured_date: str | None = None) -> int:
    if not table_exists(CAPTURE_TABLE):
        return 0
    filters, params = pending_filters(captured_date)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select count(*)
              from public.{CAPTURE_TABLE}
             where {" and ".join(filters)}
            """,
            params,
        )
        return int(cursor.fetchone()[0] or 0)


def fetch_pending_capture_stats(captured_date: str | None = None) -> dict:
    cache_key = f"unknown_attendance:pending_stats:{captured_date or 'all'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    if not table_exists(CAPTURE_TABLE):
        return {"count": 0, "summary": None}
    filters, params = pending_filters(captured_date)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            with pending_rows as (
                select captured_at,
                       size_bytes,
                       metadata,
                       coalesce(metadata #>> '{{zip,remote_file}}', drive_remote_path) as zip_remote,
                       case
                         when metadata ? 'zip' and (metadata #>> '{{zip,zip_size_bytes}}') ~ '^\\d+$'
                           then (metadata #>> '{{zip,zip_size_bytes}}')::bigint
                         else size_bytes
                       end as effective_size
                  from public.{CAPTURE_TABLE}
                 where {" and ".join(filters)}
            ),
            zip_packages as (
                select zip_remote, max(effective_size) as zip_size
                  from pending_rows
                 where metadata ? 'zip'
                   and coalesce(zip_remote, '') <> ''
                 group by zip_remote
            )
            select min(captured_at),
                   max(captured_at),
                   count(*),
                   coalesce(sum(size_bytes) filter (where not (metadata ? 'zip')), 0)
                     + coalesce((select sum(zip_size) from zip_packages), 0)
              from pending_rows
            """,
            params,
        )
        first_at, last_at, count, total_bytes = cursor.fetchone()
    if not count:
        payload = {"count": 0, "summary": None}
        cache.set(cache_key, payload, STATUS_CACHE_SECONDS)
        return payload
    summary = {
        "first_captured_at": first_at.isoformat() if first_at else None,
        "last_captured_at": last_at.isoformat() if last_at else None,
        "count": int(count or 0),
        "total_bytes": int(total_bytes or 0),
    }
    payload = {"count": int(count or 0), "summary": summary}
    cache.set(cache_key, payload, STATUS_CACHE_SECONDS)
    return payload


def fetch_pending_capture_summary(captured_date: str | None = None) -> dict | None:
    return fetch_pending_capture_stats(captured_date)["summary"]


def fetch_pending_captures(limit: int | None = 100, captured_date: str | None = None) -> list[dict]:
    if not table_exists(CAPTURE_TABLE):
        return []
    filters, params = pending_filters(captured_date)
    limit_clause = ""
    if limit is not None:
        limit_clause = "limit %s"
        params.append(limit)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select id, subject_id, camera_id, site_id, captured_at, local_file_name,
                   local_original_path, drive_remote_path, drive_file_id, drive_web_url,
                   size_bytes, status, upload_progress_percent, uploaded_at,
                   processed_at, error_message, metadata, created_at, updated_at
              from public.{CAPTURE_TABLE}
             where {" and ".join(filters)}
             order by captured_at asc
             {limit_clause}
            """,
            params,
        )
        columns = [column[0] for column in cursor.description]
        rows = []
        for row in cursor.fetchall():
            item = dict(zip(columns, row))
            item["metadata"] = compact_metadata(normalize_metadata(item.get("metadata")))
            rows.append(item)
        return rows


def fetch_recent_captures(limit: int = 80, captured_date: str | None = None) -> list[dict]:
    cache_key = f"unknown_attendance:recent:{limit}:{captured_date or 'all'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    if not table_exists(CAPTURE_TABLE):
        return []
    filters = ["c.deleted_at is null"]
    params = []
    bounds = captured_date_bounds(captured_date)
    if bounds:
        filters.append("c.captured_at >= %s and c.captured_at < %s")
        params.extend(bounds)
    params.append(limit)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select c.id, c.subject_id, c.camera_id, c.site_id, c.captured_at, c.local_file_name,
                   c.drive_remote_path, c.drive_file_id, c.drive_web_url, c.size_bytes,
                   c.status, c.upload_progress_percent, c.uploaded_at, c.processed_at,
                   c.error_message, c.metadata, c.created_at, c.updated_at,
                   s.temporary_name, s.status as subject_status
              from public.{CAPTURE_TABLE} c
              left join public.{SUBJECT_TABLE} s on s.id = c.subject_id
             where {" and ".join(filters)}
             order by coalesce(c.processed_at, c.uploaded_at, c.created_at) desc
             limit %s
            """,
            params,
        )
        columns = [column[0] for column in cursor.description]
        rows = []
        for row in cursor.fetchall():
            item = dict(zip(columns, row))
            item["metadata"] = compact_metadata(normalize_metadata(item.get("metadata")))
            item["image_url"] = face_image_url(None, item["metadata"].get("face_crop_uri", ""))
            rows.append(item)
    cache.set(cache_key, rows, STATUS_CACHE_SECONDS)
    return rows


def fetch_capture(capture_id: str) -> dict | None:
    if not table_exists(CAPTURE_TABLE):
        return None
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select id, subject_id, camera_id, site_id, captured_at, local_file_name,
                   local_original_path, drive_remote_path, drive_file_id, drive_web_url,
                   size_bytes, status, upload_progress_percent, uploaded_at,
                   processed_at, error_message, metadata, created_at, updated_at
              from public.{CAPTURE_TABLE}
             where id = %s
               and deleted_at is null
             limit 1
            """,
            [capture_id],
        )
        row = cursor.fetchone()
        if not row:
            return None
        columns = [column[0] for column in cursor.description]
        item = dict(zip(columns, row))
        item["metadata"] = normalize_metadata(item.get("metadata"))
        return item


def fetch_subjects(limit: int = 80, captured_date: str | None = None) -> list[dict]:
    cache_key = f"unknown_attendance:subjects:{limit}:{captured_date or 'all'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    if not table_exists(SUBJECT_TABLE):
        return []
    filters = ["s.status <> 'deleted'", "coalesce(s.metadata->>'face_crop_uri', capture_image.face_crop_uri, '') <> ''"]
    params = []
    capture_time_params = []
    capture_time_filter = ""
    bounds = captured_date_bounds(captured_date)
    if bounds:
        filters.append("s.last_seen_at >= %s and s.last_seen_at < %s")
        params.extend(bounds)
        capture_time_filter = "and c.captured_at >= %s and c.captured_at < %s"
        capture_time_params.extend(bounds)
    query_params = capture_time_params + params + [limit]
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select s.id, s.camera_id, s.site_id, s.temporary_name, s.status, s.first_seen_at,
                   s.last_seen_at, s.capture_count, s.matched_person_type, s.matched_student_id,
                   s.matched_player_id, s.notes, s.metadata, s.created_at, s.updated_at,
                   capture_times.appearance_count,
                   capture_times.day_first_seen_at,
                   capture_times.day_last_seen_at,
                   capture_times.appearance_times,
                   coalesce(s.metadata->>'face_crop_uri', capture_image.face_crop_uri) as face_crop_uri
              from public.{SUBJECT_TABLE} s
              left join lateral (
                    select count(*) as appearance_count,
                           min(c.captured_at) as day_first_seen_at,
                           max(c.captured_at) as day_last_seen_at,
                           array_agg(c.captured_at order by c.captured_at) as appearance_times
                      from public.{CAPTURE_TABLE} c
                     where c.subject_id = s.id
                       and c.deleted_at is null
                       {capture_time_filter}
                  ) capture_times on true
              left join lateral (
                    select c.metadata->>'face_crop_uri' as face_crop_uri
                      from public.{CAPTURE_TABLE} c
                     where c.subject_id = s.id
                       and c.metadata ? 'face_crop_uri'
                       and c.metadata->>'face_crop_uri' is not null
                     order by coalesce(c.processed_at, c.updated_at, c.created_at) desc
                     limit 1
                  ) capture_image on true
             where {" and ".join(filters)}
             order by s.last_seen_at desc
             limit %s
            """,
            query_params,
        )
        columns = [column[0] for column in cursor.description]
        rows = []
        for row in cursor.fetchall():
            item = dict(zip(columns, row))
            item["metadata"] = compact_metadata(normalize_metadata(item.get("metadata")))
            item["image_url"] = face_image_url(None, item.get("face_crop_uri") or item["metadata"].get("face_crop_uri", ""))
            item["appearance_count"] = int(item.get("appearance_count") or 0)
            for key in ["day_first_seen_at", "day_last_seen_at"]:
                if item.get(key):
                    item[key] = item[key].isoformat()
            item["appearance_times"] = [
                value.isoformat() if hasattr(value, "isoformat") else str(value)
                for value in (item.get("appearance_times") or [])[:12]
            ]
            rows.append(item)
        cache.set(cache_key, rows, STATUS_CACHE_SECONDS)
        return rows


def fetch_daily_reports(limit: int = 45) -> list[dict]:
    cache_key = f"unknown_attendance:daily_reports:{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    if not table_exists(CAPTURE_TABLE):
        return []
    tz_name = timezone.get_current_timezone_name()
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            with capture_rows as (
                select (captured_at at time zone %s)::date as captured_date,
                       captured_at,
                       size_bytes,
                       status,
                       processed_at,
                       metadata,
                       coalesce(metadata #>> '{{zip,remote_file}}', drive_remote_path) as zip_remote,
                       case
                         when metadata ? 'zip' and (metadata #>> '{{zip,zip_size_bytes}}') ~ '^\\d+$'
                           then (metadata #>> '{{zip,zip_size_bytes}}')::bigint
                         else size_bytes
                       end as effective_size
                  from public.{CAPTURE_TABLE}
                 where deleted_at is null
            ),
            zip_packages as (
                select captured_date, zip_remote, max(effective_size) as zip_size
                  from capture_rows
                 where metadata ? 'zip'
                   and coalesce(zip_remote, '') <> ''
                 group by 1, 2
            ),
            capture_days as (
                select captured_date,
                       min(captured_at) as first_captured_at,
                       max(captured_at) as last_captured_at,
                       count(*) as total_captures,
                       coalesce(sum(size_bytes) filter (where not (metadata ? 'zip')), 0)
                         + coalesce((select sum(zip_size) from zip_packages zp where zp.captured_date = cr.captured_date), 0) as total_bytes,
                       count(*) filter (where status = 'uploaded' and processed_at is null) as pending_count,
                       count(*) filter (where processed_at is not null or status in ('failed', 'matched_known', 'unknown_confirmed')) as processed_count,
                       count(*) filter (where status = 'matched_known') as matched_known_count,
                       count(*) filter (where status = 'unknown_confirmed') as unknown_confirmed_count,
                       count(*) filter (where status = 'failed') as failed_count
                  from capture_rows cr
                 group by 1
            ),
            subject_days as (
                select (last_seen_at at time zone %s)::date as captured_date,
                       count(*) filter (where status <> 'deleted') as candidate_subjects,
                       count(*) filter (
                           where status <> 'deleted'
                             and exists (
                                 select 1
                                   from public.{CAPTURE_TABLE} c
                                  where c.subject_id = s.id
                                    and coalesce(c.metadata->>'face_crop_uri', '') <> ''
                             )
                       ) as visual_subjects,
                       count(*) filter (where status <> 'deleted' and coalesce(metadata->>'accepted_at', '') <> '') as accepted_subjects
                  from public.{SUBJECT_TABLE} s
                 group by 1
            )
            select coalesce(c.captured_date, s.captured_date) as captured_date,
                   c.first_captured_at,
                   c.last_captured_at,
                   coalesce(c.total_captures, 0) as total_captures,
                   coalesce(c.total_bytes, 0) as total_bytes,
                   coalesce(c.pending_count, 0) as pending_count,
                   coalesce(c.processed_count, 0) as processed_count,
                   coalesce(c.matched_known_count, 0) as matched_known_count,
                   coalesce(c.unknown_confirmed_count, 0) as unknown_confirmed_count,
                   coalesce(c.failed_count, 0) as failed_count,
                   coalesce(s.candidate_subjects, 0) as candidate_subjects,
                   coalesce(s.visual_subjects, 0) as visual_subjects,
                   coalesce(s.accepted_subjects, 0) as accepted_subjects
              from capture_days c
              full outer join subject_days s on s.captured_date = c.captured_date
             order by captured_date desc
             limit %s
            """,
            [tz_name, tz_name, limit],
        )
        columns = [column[0] for column in cursor.description]
        rows = []
        for row in cursor.fetchall():
            item = dict(zip(columns, row))
            rows.append(
                {
                    "date": item["captured_date"].isoformat() if item.get("captured_date") else "",
                    "first_captured_at": item["first_captured_at"].isoformat() if item.get("first_captured_at") else None,
                    "last_captured_at": item["last_captured_at"].isoformat() if item.get("last_captured_at") else None,
                    "total_captures": int(item.get("total_captures") or 0),
                    "total_bytes": int(item.get("total_bytes") or 0),
                    "pending_count": int(item.get("pending_count") or 0),
                    "processed_count": int(item.get("processed_count") or 0),
                    "matched_known_count": int(item.get("matched_known_count") or 0),
                    "unknown_confirmed_count": int(item.get("unknown_confirmed_count") or 0),
                    "failed_count": int(item.get("failed_count") or 0),
                    "candidate_subjects": int(item.get("candidate_subjects") or 0),
                    "visual_subjects": int(item.get("visual_subjects") or 0),
                    "accepted_subjects": int(item.get("accepted_subjects") or 0),
                }
            )
    cache.set(cache_key, rows, STATUS_CACHE_SECONDS)
    return rows


def face_image_url(request, uri: str) -> str:
    if (uri or "").startswith(LOCAL_FACE_URI_PREFIX):
        object_path = uri[len(LOCAL_FACE_URI_PREFIX) :].lstrip("/")
        path = f"/api/unknown-attendance/faces/{quote(object_path, safe='/')}"
        return request.build_absolute_uri(path) if request else path
    parsed = parse_storage_uri(uri or "")
    if not parsed:
        return ""
    bucket, object_path = parsed
    path = f"/api/automatic-attendance/evidence-storage/{quote(bucket)}/{quote(object_path, safe='/')}"
    return request.build_absolute_uri(path) if request else path


def local_face_uri_to_path(uri: str) -> Path | None:
    if not (uri or "").startswith(LOCAL_FACE_URI_PREFIX):
        return None
    object_path = uri[len(LOCAL_FACE_URI_PREFIX) :].lstrip("/")
    root = pending_faces_dir().resolve()
    candidate = (root / object_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def local_face_uri_from_path(path: Path) -> str:
    root = pending_faces_dir().resolve()
    relative_path = path.resolve().relative_to(root).as_posix()
    return f"{LOCAL_FACE_URI_PREFIX}{relative_path}"


def hydrate_urls(payload: dict, request) -> dict:
    for key in ["pending", "recent", "subjects"]:
        for item in payload.get(key, []) or []:
            item["image_url"] = face_image_url(request, item.get("face_crop_uri") or normalize_metadata(item.get("metadata")).get("face_crop_uri", ""))
    for result in payload.get("results", []) or []:
        for item in result.get("processed", []) or []:
            item["image_url"] = face_image_url(request, item.get("face_crop_uri", "")) or capture_image_url(request, item.get("capture_id", ""))
    for key in ["active_job"]:
        if payload.get(key):
            hydrate_job_urls(payload[key], request)
    for job in payload.get("jobs", []) or []:
        hydrate_job_urls(job, request)
    return payload


def hydrate_job_urls(job: dict, request) -> dict:
    for result in job.get("results", []) or []:
        for item in result.get("processed", []) or []:
            item["image_url"] = face_image_url(request, item.get("face_crop_uri", "")) or capture_image_url(request, item.get("capture_id", ""))
    return job


def capture_image_url(request, capture_id: str) -> str:
    if not capture_id:
        return ""
    path = f"/api/unknown-attendance/captures/{quote(str(capture_id))}/image/"
    return request.build_absolute_uri(path) if request else path


def capture_download_path(capture: dict, target_dir: Path | None = None) -> Path:
    root = target_dir or temp_dir()
    return root / f"{capture['id']}-{capture.get('local_file_name') or 'capture.jpg'}"


def materialize_capture(capture: dict, target_dir: Path | None = None) -> Path:
    ensure_dirs()
    if target_dir:
        target_dir.mkdir(parents=True, exist_ok=True)
    target = capture_download_path(capture, target_dir)
    if target.exists() and target.stat().st_size > 0:
        return target
    drive_remote_path = capture.get("drive_remote_path") or ""
    drive_file_id = capture.get("drive_file_id") or ""
    rclone_path = rclone_executable()
    zip_remote_path = capture_zip_remote_path(capture)
    if zip_remote_path and rclone_path:
        zip_path = zip_package_download_path(zip_remote_path, capture, target.parent)
        if not zip_path.exists() or zip_path.stat().st_size <= 0:
            command = [rclone_path, "copyto", zip_remote_path, str(zip_path), "--drive-acknowledge-abuse"]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=600)
            if completed.returncode:
                raise RuntimeError((completed.stdout + completed.stderr).strip()[:1000] or "rclone no pudo descargar el ZIP de capturas.")
        return extract_capture_from_zip(capture, zip_path, target.parent)
    if drive_remote_path and rclone_path:
        command = [rclone_path, "copyto", drive_remote_path, str(target), "--drive-acknowledge-abuse"]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=180)
        if completed.returncode:
            raise RuntimeError((completed.stdout + completed.stderr).strip()[:1000] or "rclone no pudo descargar la captura.")
    elif drive_file_id:
        download_drive_file(drive_file_id, target)
    else:
        raise RuntimeError("La captura no tiene drive_remote_path ni drive_file_id.")
    return target


def split_drive_remote_path(remote_path: str) -> tuple[str, str] | None:
    if not remote_path or "/" not in remote_path:
        return None
    parent, _, filename = remote_path.rpartition("/")
    if not parent or not filename:
        return None
    return parent, filename


def capture_zip_metadata(capture: dict) -> dict:
    metadata = normalize_metadata(capture.get("metadata"))
    zip_metadata = metadata.get("zip") if isinstance(metadata, dict) else None
    return zip_metadata if isinstance(zip_metadata, dict) else {}


def capture_zip_remote_path(capture: dict) -> str:
    zip_metadata = capture_zip_metadata(capture)
    remote_path = zip_metadata.get("remote_file") or capture.get("drive_remote_path") or ""
    return str(remote_path) if str(remote_path).lower().endswith(".zip") else ""


def capture_zip_entry_name(capture: dict) -> str:
    entry_name = capture_zip_metadata(capture).get("entry_name") or ""
    return str(entry_name).replace("\\", "/").lstrip("/")


def safe_zip_entry_name(entry_name: str) -> str:
    normalized = str(entry_name or "").replace("\\", "/").lstrip("/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise RuntimeError("Entrada ZIP invalida para la captura.")
    return path.as_posix()


def zip_package_download_path(remote_path: str, capture: dict, target_dir: Path) -> Path:
    zip_metadata = capture_zip_metadata(capture)
    raw_name = zip_metadata.get("zip_file_name") or Path(remote_path).name or "captures.zip"
    safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in str(raw_name))[:180] or "captures.zip"
    digest = hashlib.sha1(str(remote_path).encode("utf-8")).hexdigest()[:12]
    package_dir = target_dir / "packages"
    package_dir.mkdir(parents=True, exist_ok=True)
    return package_dir / f"{digest}-{safe_name}"


def extract_capture_from_zip(capture: dict, zip_path: Path, target_dir: Path) -> Path:
    target = capture_download_path(capture, target_dir)
    if target.exists() and target.stat().st_size > 0:
        return target
    entry_name = safe_zip_entry_name(capture_zip_entry_name(capture))
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
        selected_entry = entry_name if entry_name in names else ""
        if not selected_entry:
            basename_matches = [name for name in names if PurePosixPath(str(name).replace("\\", "/")).name == PurePosixPath(entry_name).name]
            if len(basename_matches) == 1:
                selected_entry = basename_matches[0]
        if not selected_entry:
            raise RuntimeError(f"La captura {entry_name} no existe dentro del ZIP.")
        with archive.open(selected_entry) as source, target.open("wb") as destination:
            shutil.copyfileobj(source, destination)
    if not target.exists() or target.stat().st_size <= 0:
        raise RuntimeError("No se pudo extraer la captura del ZIP.")
    return target


def known_roster() -> list[object]:
    people: list[object] = list(Student.objects.filter(status__in=ACTIVE_STUDENT_STATUSES))
    people.extend(Player.objects.filter(is_active=True).select_related("team", "team__tournament"))
    by_reference: dict[str, object] = {}
    for person in people:
        photo_url = getattr(person, "photo_url", "") or ""
        photo_name = getattr(getattr(person, "photo", None), "name", "") or ""
        reference_key = photo_url or photo_name
        if not reference_key:
            continue
        by_reference.setdefault(reference_key, person)
    return list(by_reference.values())


def known_cache_path(providers_key: str) -> Path:
    safe_key = "".join(char if char.isalnum() else "_" for char in providers_key)[:80]
    return cache_dir() / f"known_embeddings_{safe_key}.pkl"


def known_roster_signature(people: list[object]) -> list[tuple[str, int, str]]:
    signature = []
    for person in people:
        person_type = "player" if isinstance(person, Player) else "student"
        photo_ref = getattr(person, "photo_url", "") or getattr(getattr(person, "photo", None), "name", "") or ""
        signature.append((person_type, int(person.id), photo_ref))
    return sorted(signature)


def build_known_database_cached(providers_key: str):
    ensure_dirs()
    people = known_roster()
    signature = known_roster_signature(people)
    path = known_cache_path(providers_key)
    cached = read_json(path.with_suffix(".meta.json"), None)
    if path.exists():
        try:
            with path.open("rb") as handle:
                payload = pickle.load(handle)
            if cached and cached.get("signature") == signature:
                return payload["people"], payload["matrix"], payload["skipped"]
            cached_count = int(cached.get("count", 0)) if isinstance(cached, dict) else 0
            if cached_count and cached_count == len(payload.get("people", [])):
                write_json(path.with_suffix(".meta.json"), {"signature": signature, "created_at": timezone.now().isoformat(), "count": cached_count, "migrated_from_previous_signature": True})
                return payload["people"], payload["matrix"], payload["skipped"]
        except Exception:
            pass
    enrolled_people, reference_matrix, skipped = build_student_database(people, providers_key=providers_key)
    with path.open("wb") as handle:
        pickle.dump({"people": enrolled_people, "matrix": reference_matrix, "skipped": skipped}, handle)
    write_json(path.with_suffix(".meta.json"), {"signature": signature, "created_at": timezone.now().isoformat(), "count": len(enrolled_people)})
    return enrolled_people, reference_matrix, skipped


def person_label(person: object) -> str:
    if isinstance(person, Player):
        team_name = person.team.name if getattr(person, "team_id", None) else "Equipo adulto"
        return f"{person.full_name} ({team_name})"
    return getattr(person, "full_name", str(person))


def ranked_known(embedding, people: list[object], matrix):
    import numpy as np

    if matrix.size == 0:
        return None, 0.0, 0.0
    query = embedding.astype("float32")
    query = query / max(np.linalg.norm(query), 1e-12)
    similarities = matrix @ query
    best_idx = int(np.argmax(similarities))
    best = float(similarities[best_idx])
    second = float(np.partition(similarities, -2)[-2]) if len(similarities) > 1 else -1.0
    return people[best_idx], best, best - second


def face_quality(image, face) -> tuple[bool, dict, object]:
    import cv2
    import numpy as np

    x1, y1, x2, y2 = face.bbox
    height, width = image.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
    face_width = max(0, x2 - x1)
    face_height = max(0, y2 - y1)
    crop = image[y1:y2, x1:x2]
    blur = 0.0
    if crop.size:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        band = crop[int(crop.shape[0] * 0.22) : int(crop.shape[0] * 0.62), int(crop.shape[1] * 0.18) : int(crop.shape[1] * 0.82)]
        if band.size:
            very_white_mask = (band[:, :, 0] > 238) & (band[:, :, 1] > 238) & (band[:, :, 2] > 238)
            white_mask = (band[:, :, 0] > 220) & (band[:, :, 1] > 220) & (band[:, :, 2] > 220)
            band_gray = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY)
            edge_ratio = float((cv2.Canny(band_gray, 80, 180) > 0).mean())
            very_white_ratio = float(very_white_mask.mean())
            white_ratio = float(white_mask.mean())
        else:
            edge_ratio = 0.0
            very_white_ratio = 0.0
            white_ratio = 0.0
        exposure_roi = crop[int(crop.shape[0] * 0.18) : int(crop.shape[0] * 0.82), int(crop.shape[1] * 0.14) : int(crop.shape[1] * 0.86)]
        if exposure_roi.size:
            exposure_gray = cv2.cvtColor(exposure_roi, cv2.COLOR_BGR2GRAY)
            mean_luma = float(exposure_gray.mean())
            median_luma = float(np.median(exposure_gray))
            dark_ratio = float((exposure_gray < 55).mean())
            very_dark_ratio = float((exposure_gray < 35).mean())
        else:
            mean_luma = 0.0
            median_luma = 0.0
            dark_ratio = 1.0
            very_dark_ratio = 1.0
    else:
        edge_ratio = 0.0
        very_white_ratio = 0.0
        white_ratio = 0.0
        mean_luma = 0.0
        median_luma = 0.0
        dark_ratio = 1.0
        very_dark_ratio = 1.0
    max_center_white = float(os.getenv("UNKNOWN_ATTENDANCE_MAX_CENTER_WHITE_RATIO", "0.085"))
    has_text_overlay = (
        very_white_ratio >= max_center_white
        or (very_white_ratio >= 0.04 and edge_ratio >= 0.02)
        or (white_ratio >= 0.10 and edge_ratio >= 0.04)
    )
    min_mean_luma = float(os.getenv("UNKNOWN_ATTENDANCE_MIN_MEAN_LUMA", "70"))
    min_median_luma = float(os.getenv("UNKNOWN_ATTENDANCE_MIN_MEDIAN_LUMA", "60"))
    max_dark_ratio = float(os.getenv("UNKNOWN_ATTENDANCE_MAX_DARK_RATIO", "0.60"))
    is_underexposed = mean_luma < min_mean_luma or median_luma < min_median_luma or dark_ratio > max_dark_ratio
    quality = {
        "det_score": round(float(face.det_score), 4),
        "face_width": face_width,
        "face_height": face_height,
        "blur": round(blur, 2),
        "center_white_ratio": round(white_ratio, 4),
        "center_very_white_ratio": round(very_white_ratio, 4),
        "center_edge_ratio": round(edge_ratio, 4),
        "mean_luma": round(mean_luma, 2),
        "median_luma": round(median_luma, 2),
        "dark_ratio": round(dark_ratio, 4),
        "very_dark_ratio": round(very_dark_ratio, 4),
    }
    if has_text_overlay:
        quality["rejection_reason"] = "overlay_text"
    elif is_underexposed:
        quality["rejection_reason"] = "underexposed"
    min_score = float(os.getenv("UNKNOWN_ATTENDANCE_MIN_DET_SCORE", "0.80"))
    min_face_size = int(os.getenv("UNKNOWN_ATTENDANCE_MIN_FACE_SIZE", "120"))
    min_blur = float(os.getenv("UNKNOWN_ATTENDANCE_MIN_BLUR", "80"))
    ok = (
        face.det_score >= min_score
        and face_width >= min_face_size
        and face_height >= min_face_size
        and blur >= min_blur
        and not has_text_overlay
        and not is_underexposed
    )
    return ok, quality, crop


def subject_embeddings() -> list[dict]:
    if not table_exists(SUBJECT_TABLE):
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select id, temporary_name, metadata
              from public.{SUBJECT_TABLE}
             where status in ('pending_review', 'processing')
               and metadata ? 'embedding'
            """
        )
        rows = []
        for subject_id, name, metadata in cursor.fetchall():
            meta = normalize_metadata(metadata)
            embedding = meta.get("embedding")
            if isinstance(embedding, list) and embedding:
                rows.append({"id": subject_id, "name": name, "metadata": meta, "embedding": embedding})
        return rows


def find_unknown_subject(embedding) -> dict | None:
    import numpy as np

    query = embedding.astype("float32")
    query = query / max(np.linalg.norm(query), 1e-12)
    threshold = float(os.getenv("UNKNOWN_ATTENDANCE_DUPLICATE_THRESHOLD", "0.55"))
    best = None
    for subject in subject_embeddings():
        stored = np.asarray(subject["embedding"], dtype=np.float32)
        stored = stored / max(np.linalg.norm(stored), 1e-12)
        similarity = float(np.dot(query, stored))
        if similarity >= threshold and (best is None or similarity > best["similarity"]):
            best = {**subject, "similarity": similarity}
    return best


def save_face_crop_local(crop, capture: dict, subject_id, face_index: int = 0) -> str:
    import cv2

    output_path = pending_faces_dir() / "subjects" / str(subject_id) / "captures" / f"{capture['id']}-{face_index}.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    resized = cv2.resize(crop, (240, 240))
    if not cv2.imwrite(str(output_path), resized):
        raise RuntimeError("No se pudo guardar el recorte local de desconocido.")
    return local_face_uri_from_path(output_path)


def upload_consolidated_face(subject_id: str, face_crop_uri: str) -> str:
    object_path = f"subjects/{subject_id}/profile.jpg"
    local_path = local_face_uri_to_path(face_crop_uri)
    if local_path and local_path.exists():
        return upload_private_file(FACE_BUCKET, object_path, local_path, upsert=True)

    parsed = parse_storage_uri(face_crop_uri or "")
    if parsed:
        bucket, source_path = parsed
        if bucket == FACE_BUCKET and source_path == object_path:
            return face_crop_uri
        downloaded_path = Path(download_private_file(bucket, source_path, suffix=Path(source_path).suffix or ".jpg"))
        try:
            return upload_private_file(FACE_BUCKET, object_path, downloaded_path, upsert=True)
        finally:
            try:
                downloaded_path.unlink()
            except OSError:
                pass
    else:
        raise RuntimeError("El recorte local del desconocido ya no existe.")


def update_capture(capture_id, status_value: str, metadata: dict, subject_id=None, error_message: str | None = None) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            update public.{CAPTURE_TABLE}
               set subject_id = %s,
                   status = %s,
                   processed_at = now(),
                   last_error_at = case when %s is null then last_error_at else now() end,
                   error_message = %s,
                   metadata = coalesce(metadata, '{{}}'::jsonb) || %s::jsonb,
                   updated_at = now()
             where id = %s
            """,
            [subject_id, status_value, error_message, error_message, json.dumps(metadata), capture_id],
        )
    cache.clear()


def create_subject(capture: dict, embedding, quality: dict) -> tuple[object, str, dict]:
    metadata = {
        "embedding": [round(float(value), 6) for value in embedding.tolist()],
        "quality": quality,
        "first_capture_id": str(capture["id"]),
    }
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            insert into public.{SUBJECT_TABLE}
                (camera_id, site_id, first_seen_at, last_seen_at, capture_count, metadata)
            values (%s, %s, %s, %s, 0, %s::jsonb)
            returning id, temporary_name, metadata
            """,
            [
                capture.get("camera_id") or "dahua_cancha_1",
                capture.get("site_id"),
                capture.get("captured_at") or timezone.now(),
                capture.get("captured_at") or timezone.now(),
                json.dumps(metadata),
            ],
        )
        subject_id, name, stored_metadata = cursor.fetchone()
    return subject_id, name, normalize_metadata(stored_metadata)


def update_subject(
    subject_id,
    capture: dict,
    face_crop_uri: str,
    embedding,
    quality: dict,
    best_similarity: float | None = None,
    current_metadata: dict | None = None,
) -> None:
    current_metadata = current_metadata or {}
    accepted_face_uri = current_metadata.get("face_crop_uri") if current_metadata.get("accepted_at") else ""
    metadata_patch = {
        "embedding": [round(float(value), 6) for value in embedding.tolist()],
        "quality": quality,
        "best_capture_id": str(capture["id"]),
    }
    if accepted_face_uri and parse_storage_uri(accepted_face_uri):
        metadata_patch["face_crop_uri"] = accepted_face_uri
        metadata_patch["last_local_face_crop_uri"] = face_crop_uri
    else:
        metadata_patch["face_crop_uri"] = face_crop_uri
    if best_similarity is not None:
        metadata_patch["duplicate_similarity"] = round(best_similarity, 4)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            update public.{SUBJECT_TABLE}
               set last_seen_at = greatest(last_seen_at, %s),
                   capture_count = capture_count + 1,
                   metadata = coalesce(metadata, '{{}}'::jsonb) || %s::jsonb,
                   updated_at = now()
             where id = %s
            """,
            [capture.get("captured_at") or timezone.now(), json.dumps(metadata_patch), subject_id],
        )
    cache.clear()


def fetch_subject(subject_id: str) -> dict | None:
    if not table_exists(SUBJECT_TABLE):
        return None
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select id, temporary_name, status, metadata
              from public.{SUBJECT_TABLE}
             where id = %s
               and status <> 'deleted'
            """,
            [subject_id],
        )
        row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "temporary_name": row[1],
        "status": row[2],
        "metadata": normalize_metadata(row[3]),
    }


def cleanup_subject_local_faces(subject_id: str) -> None:
    subject_dir = (pending_faces_dir() / "subjects" / str(subject_id)).resolve()
    root = pending_faces_dir().resolve()
    try:
        subject_dir.relative_to(root)
    except ValueError:
        return
    shutil.rmtree(subject_dir, ignore_errors=True)


def accept_subject(subject_id: str) -> dict:
    subject = fetch_subject(subject_id)
    if not subject:
        raise LookupError("Desconocido no encontrado.")
    metadata = subject["metadata"]
    face_crop_uri = metadata.get("face_crop_uri") or ""
    if not face_crop_uri:
        raise RuntimeError("El desconocido no tiene recorte consolidado para aceptar.")
    storage_uri = upload_consolidated_face(str(subject_id), face_crop_uri)
    accepted_at = timezone.now().isoformat()
    metadata_patch = {"face_crop_uri": storage_uri, "accepted_at": accepted_at}
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            update public.{SUBJECT_TABLE}
               set metadata = coalesce(metadata, '{{}}'::jsonb) || %s::jsonb,
                   updated_at = now()
             where id = %s
            """,
            [json.dumps(metadata_patch), subject_id],
        )
        cursor.execute(
            f"""
            update public.{CAPTURE_TABLE}
               set metadata = coalesce(metadata, '{{}}'::jsonb) || %s::jsonb,
                   updated_at = now()
             where subject_id = %s
               and metadata->>'face_crop_uri' like %s
            """,
            [json.dumps({"face_crop_uri": storage_uri}), subject_id, f"{LOCAL_FACE_URI_PREFIX}%"],
        )
    cleanup_subject_local_faces(str(subject_id))
    cache.clear()
    return {
        "id": str(subject_id),
        "temporary_name": subject["temporary_name"],
        "status": subject["status"],
        "face_crop_uri": storage_uri,
        "accepted_at": accepted_at,
        "image_url": face_image_url(None, storage_uri),
    }


def download_captures_for_job(job: dict, captures: list[dict]) -> tuple[dict[str, Path], list[dict]]:
    target_dir = job_download_dir(job["id"])
    target_dir.mkdir(parents=True, exist_ok=True)
    workers = max(1, min(32, int(os.getenv("UNKNOWN_ATTENDANCE_DOWNLOAD_WORKERS", "8"))))
    downloaded: dict[str, Path] = {}
    failures: list[dict] = []
    completed = 0
    rclone_path = rclone_executable()

    zip_groups: dict[str, list[dict]] = {}
    groups: dict[str, list[tuple[dict, str]]] = {}
    fallback_captures: list[dict] = []
    for capture in captures:
        target = capture_download_path(capture, target_dir)
        if target.exists() and target.stat().st_size > 0:
            downloaded[str(capture["id"])] = target
            completed += 1
            continue
        zip_remote_path = capture_zip_remote_path(capture)
        if zip_remote_path and capture_zip_entry_name(capture):
            zip_groups.setdefault(zip_remote_path, []).append(capture)
            continue
        remote_parts = split_drive_remote_path(capture.get("drive_remote_path") or "")
        if rclone_path and remote_parts:
            parent, filename = remote_parts
            groups.setdefault(parent, []).append((capture, filename))
        else:
            fallback_captures.append(capture)

    def download_one(capture: dict) -> tuple[dict, Path]:
        return capture, materialize_capture(capture, target_dir)

    update_job(job, phase="download", phase_label=f"Descargando {len(captures)} capturas desde Drive", processed=0, percent=0)
    for zip_remote_path, group in zip_groups.items():
        package_path = zip_package_download_path(zip_remote_path, group[0], target_dir)
        if not rclone_path:
            detail = "rclone no esta disponible para descargar el ZIP de capturas."
            for capture in group:
                completed += 1
                update_capture(capture["id"], "failed", {"download_error": detail}, error_message=detail)
                failures.append({"capture_id": str(capture["id"]), "status": "failed", "detail": detail})
            continue
        try:
            if not package_path.exists() or package_path.stat().st_size <= 0:
                update_job(
                    job,
                    phase="download",
                    phase_label=f"Descargando ZIP {package_path.name} ({len(group)} capturas)",
                    current_capture=group[0].get("local_file_name"),
                    processed=completed,
                    percent=round((completed / max(len(captures), 1)) * 35, 1),
                )
                command = [rclone_path, "copyto", zip_remote_path, str(package_path), "--drive-acknowledge-abuse"]
                completed_process = subprocess.run(command, capture_output=True, text=True, timeout=max(600, len(group) * 30))
                if completed_process.returncode:
                    raise RuntimeError((completed_process.stdout + completed_process.stderr).strip()[:1000] or "rclone no pudo descargar el ZIP de capturas.")
            for capture in group:
                try:
                    local_path = extract_capture_from_zip(capture, package_path, target_dir)
                    downloaded[str(capture["id"])] = local_path
                except Exception as exc:
                    detail = str(exc)
                    update_capture(capture["id"], "failed", {"download_error": detail}, error_message=detail)
                    failures.append({"capture_id": str(capture["id"]), "status": "failed", "detail": detail})
                completed += 1
                if completed % 20 == 0 or completed == len(captures):
                    update_job(
                        job,
                        phase="download",
                        phase_label=f"Extrayendo ZIPs {completed}/{len(captures)} capturas",
                        current_capture=capture.get("local_file_name"),
                        processed=completed,
                        percent=round((completed / max(len(captures), 1)) * 35, 1),
                    )
        except Exception as exc:
            detail = str(exc)
            for capture in group:
                completed += 1
                update_capture(capture["id"], "failed", {"download_error": detail}, error_message=detail)
                failures.append({"capture_id": str(capture["id"]), "status": "failed", "detail": detail})
            update_job(job, detail=f"Descarga ZIP fallo: {detail}", processed=completed, percent=round((completed / max(len(captures), 1)) * 35, 1))

    for parent, group in groups.items():
        file_list = target_dir / f"rclone-files-{uuid4().hex}.txt"
        file_list.write_text("\n".join(filename for _, filename in group), encoding="utf-8")
        try:
            command = [
                rclone_path,
                "copy",
                parent,
                str(target_dir),
                "--files-from",
                str(file_list),
                "--drive-acknowledge-abuse",
                "--transfers",
                str(workers),
                "--checkers",
                str(workers),
                "--ignore-existing",
            ]
            timeout_seconds = max(300, len(group) * 10)
            started_at = time_module.monotonic()
            base_completed = completed
            last_seen_count = -1
            last_update_at = 0.0
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                while process.poll() is None:
                    elapsed = time_module.monotonic() - started_at
                    if elapsed > timeout_seconds:
                        process.kill()
                        raise subprocess.TimeoutExpired(command, timeout_seconds)

                    seen_count = 0
                    latest_capture_name = None
                    for capture, filename in group:
                        batch_path = target_dir / filename
                        local_path = capture_download_path(capture, target_dir)
                        if (batch_path.exists() and batch_path.stat().st_size > 0) or (local_path.exists() and local_path.stat().st_size > 0):
                            seen_count += 1
                            latest_capture_name = capture.get("local_file_name")

                    now = time_module.monotonic()
                    if seen_count != last_seen_count or now - last_update_at >= 10:
                        last_seen_count = seen_count
                        last_update_at = now
                        update_job(
                            job,
                            phase="download",
                            phase_label=f"Descargando {base_completed + seen_count}/{len(captures)} capturas desde Drive",
                            current_capture=latest_capture_name,
                            processed=base_completed + seen_count,
                            percent=round(((base_completed + seen_count) / max(len(captures), 1)) * 35, 1),
                        )
                    time_module.sleep(2)
                stdout, stderr = process.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate()
                detail = (stdout + stderr).strip()[:1000] or "rclone excedio el tiempo maximo de descarga del lote."
                for capture, _ in group:
                    fallback_captures.append(capture)
                update_job(job, detail=f"Descarga batch fallo; usando fallback individual: {detail}")
                continue

            if process.returncode:
                detail = (stdout + stderr).strip()[:1000] or "rclone no pudo descargar el lote."
                for capture, _ in group:
                    fallback_captures.append(capture)
                update_job(job, detail=f"Descarga batch fallo; usando fallback individual: {detail}")
            else:
                for capture, _ in group:
                    _, filename = split_drive_remote_path(capture.get("drive_remote_path") or "") or ("", capture.get("local_file_name") or "")
                    batch_path = target_dir / filename
                    local_path = capture_download_path(capture, target_dir)
                    if batch_path.exists() and batch_path.stat().st_size > 0:
                        if batch_path.resolve() != local_path.resolve():
                            if local_path.exists():
                                batch_path.unlink(missing_ok=True)
                            else:
                                batch_path.replace(local_path)
                        downloaded[str(capture["id"])] = local_path
                    else:
                        fallback_captures.append(capture)
                    completed += 1
                    if completed % 20 == 0 or completed == len(captures):
                        update_job(
                            job,
                            current_capture=capture.get("local_file_name"),
                            processed=completed,
                            percent=round((completed / max(len(captures), 1)) * 35, 1),
                        )
        finally:
            try:
                file_list.unlink()
            except OSError:
                pass

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_capture = {executor.submit(download_one, capture): capture for capture in fallback_captures if str(capture["id"]) not in downloaded}
        for future in as_completed(future_to_capture):
            capture = future_to_capture[future]
            completed += 1
            try:
                _, local_path = future.result()
                downloaded[str(capture["id"])] = local_path
                current_capture = capture.get("local_file_name")
            except Exception as exc:
                current_capture = capture.get("local_file_name")
                detail = str(exc)
                update_capture(capture["id"], "failed", {"download_error": detail}, error_message=detail)
                failures.append({"capture_id": str(capture["id"]), "status": "failed", "detail": detail})
            update_job(
                job,
                current_capture=current_capture,
                processed=completed,
                percent=round((completed / max(len(captures), 1)) * 35, 1),
            )
    return downloaded, failures


def process_capture(capture: dict, people: list[object], matrix, local_path: Path | None = None, cleanup_local: bool = True) -> dict:
    import cv2

    local_path = local_path or materialize_capture(capture)
    captured_at = capture.get("captured_at")
    captured_at_value = captured_at.isoformat() if hasattr(captured_at, "isoformat") else captured_at
    try:
        image = cv2.imread(str(local_path))
        if image is None:
            raise RuntimeError("No se pudo leer la imagen descargada.")
        faces = detect_embeddings(image, providers_key=os.getenv("UNKNOWN_ATTENDANCE_PROVIDERS", os.getenv("AUTO_ATTENDANCE_PROVIDERS", "auto")))
        if not faces:
            detail = "Calidad rechazada: se detectaron 0 caras."
            update_capture(capture["id"], "failed", {"quality_rejection": detail}, error_message=detail)
            return {"capture_id": str(capture["id"]), "captured_at": captured_at_value, "status": "failed", "detail": detail}

        known_threshold = float(os.getenv("UNKNOWN_ATTENDANCE_KNOWN_THRESHOLD", os.getenv("FACE_MATCH_THRESHOLD", "0.35")))
        known_margin_threshold = float(os.getenv("UNKNOWN_ATTENDANCE_KNOWN_MIN_MARGIN", "0.03"))

        known_matches = []
        unknown_matches = []
        rejected_faces = []

        for face_index, face in enumerate(faces):
            quality_ok, quality, crop = face_quality(image, face)
            if not quality_ok or crop is None or crop.size == 0:
                rejected_faces.append({"face_index": face_index, "quality": quality})
                continue

            known_person, known_similarity, known_margin = ranked_known(face.embedding, people, matrix)
            if known_person and known_similarity >= known_threshold and known_margin >= known_margin_threshold:
                known_matches.append({
                    "face_index": face_index,
                    "type": "player" if isinstance(known_person, Player) else "student",
                    "id": known_person.id,
                    "name": person_label(known_person),
                    "similarity": round(known_similarity, 4),
                    "margin": round(known_margin, 4),
                    "quality": quality,
                })
                continue

            existing = find_unknown_subject(face.embedding)
            if existing:
                subject_id = existing["id"]
                subject_name = existing["name"]
                duplicate_similarity = existing["similarity"]
                subject_metadata = existing["metadata"]
            else:
                subject_id, subject_name, subject_metadata = create_subject(capture, face.embedding, quality)
                duplicate_similarity = None

            accepted_face_uri = subject_metadata.get("face_crop_uri") if subject_metadata.get("accepted_at") else ""
            if accepted_face_uri and parse_storage_uri(accepted_face_uri):
                face_crop_uri = accepted_face_uri
            else:
                face_crop_uri = save_face_crop_local(crop, capture, subject_id, face_index)
            update_subject(subject_id, capture, face_crop_uri, face.embedding, quality, duplicate_similarity, subject_metadata)
            unknown_matches.append({
                "face_index": face_index,
                "face_crop_uri": face_crop_uri,
                "quality": quality,
                "unknown_subject": {
                    "id": str(subject_id),
                    "temporary_name": subject_name,
                    "duplicate_similarity": round(duplicate_similarity, 4) if duplicate_similarity is not None else None,
                },
            })

        if unknown_matches:
            first_unknown = unknown_matches[0]
            update_capture(
                capture["id"],
                "unknown_confirmed",
                {
                    "quality": first_unknown["quality"],
                    "face_crop_uri": first_unknown["face_crop_uri"],
                    "unknown_subject": first_unknown["unknown_subject"],
                    "unknown_subjects": unknown_matches,
                    "known_matches": known_matches,
                    "rejected_faces": rejected_faces,
                },
                subject_id=first_unknown["unknown_subject"]["id"],
            )
            return {
                "capture_id": str(capture["id"]),
                "captured_at": captured_at_value,
                "status": "unknown_confirmed",
                "unknown_count": len(unknown_matches),
                "known_count": len(known_matches),
                "rejected_count": len(rejected_faces),
                "subject_id": first_unknown["unknown_subject"]["id"],
                "subject_name": first_unknown["unknown_subject"]["temporary_name"],
                "face_crop_uri": first_unknown["face_crop_uri"],
                "quality": first_unknown["quality"],
            }

        if known_matches:
            best_known = max(known_matches, key=lambda item: item["similarity"])
            metadata = {
                "quality": best_known["quality"],
                "known_match": best_known,
                "known_matches": known_matches,
                "rejected_faces": rejected_faces,
            }
            update_capture(capture["id"], "matched_known", metadata)
            return {
                "capture_id": str(capture["id"]),
                "captured_at": captured_at_value,
                "status": "matched_known",
                "known_count": len(known_matches),
                "rejected_count": len(rejected_faces),
                "known_name": best_known["name"],
                "similarity": best_known["similarity"],
                "quality": best_known["quality"],
            }

        detail = "Calidad rechazada: no hubo rostros con calidad suficiente."
        update_capture(capture["id"], "failed", {"quality_rejection": detail, "rejected_faces": rejected_faces}, error_message=detail)
        return {"capture_id": str(capture["id"]), "captured_at": captured_at_value, "status": "failed", "detail": detail, "rejected_count": len(rejected_faces)}
    finally:
        if cleanup_local:
            try:
                local_path.unlink()
            except OSError:
                pass


def process_worker(job_id: str, capture_id: str | None = None, captured_date: str | None = None) -> None:
    close_old_connections()
    job = read_job(job_id)
    if not job:
        return
    try:
        captures = fetch_pending_captures(limit=None, captured_date=captured_date)
        if capture_id:
            captures = [item for item in captures if str(item["id"]) == str(capture_id)]
        update_job(job, status="processing", total=len(captures), processed=0, percent=0, results=[{"processed": []}])
        downloaded, download_failures = download_captures_for_job(job, captures)
        results = list(download_failures)
        providers_key = os.getenv("UNKNOWN_ATTENDANCE_PROVIDERS", os.getenv("AUTO_ATTENDANCE_PROVIDERS", "auto"))
        update_job(job, phase="references", phase_label="Preparando embeddings conocidos sin fotos duplicadas", processed=len(results), percent=35)
        people, matrix, skipped = build_known_database_cached(providers_key)
        process_targets = [capture for capture in captures if str(capture["id"]) in downloaded]
        update_job(job, phase="captures", phase_label="Analizando capturas desde disco local", processed=len(results), percent=35)
        for index, capture in enumerate(process_targets, start=1):
            processed_count = len(results)
            update_job(
                job,
                current_capture=capture.get("local_file_name"),
                processed=processed_count,
                percent=round(35 + (((index - 1) / max(len(process_targets), 1)) * 65), 1),
            )
            try:
                result = process_capture(capture, people, matrix, local_path=downloaded[str(capture["id"])], cleanup_local=False)
            except Exception as exc:
                result = {"capture_id": str(capture["id"]), "status": "failed", "detail": str(exc)}
                update_capture(capture["id"], "failed", {"processing_error": str(exc)}, error_message=str(exc))
            results.append(result)
            update_job(
                job,
                processed=len(results),
                percent=round(35 + ((index / max(len(process_targets), 1)) * 65), 1),
                results=[{"processed": results, "skipped_references": skipped[:20]}],
            )
        update_job(job, status="done", phase="done", current_capture=None, completed_at=timezone.now().isoformat(), percent=100, results=[{"processed": results, "skipped_references": skipped[:20]}])
    except Exception as exc:
        update_job(job, status="error", detail=str(exc), completed_at=timezone.now().isoformat())
    finally:
        latest_job = read_job(job_id) or job
        should_cleanup_downloads = (
            latest_job.get("status") == "done"
            and os.getenv("UNKNOWN_ATTENDANCE_KEEP_DOWNLOADED", "false").lower() not in {"1", "true", "yes", "si", "on"}
        )
        if should_cleanup_downloads:
            shutil.rmtree(job_download_dir(job_id), ignore_errors=True)
        close_old_connections()


class UnknownAttendanceStatusView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request):
        ensure_dirs()
        captured_date = request.query_params.get("captured_date") or None
        if captured_date and not parse_date(str(captured_date)):
            return Response({"detail": "captured_date debe tener formato YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            pending_limit = max(0, min(100, int(request.query_params.get("pending_limit", "25"))))
        except (TypeError, ValueError):
            pending_limit = 25
        try:
            recent_limit = max(0, min(80, int(request.query_params.get("recent_limit", "24"))))
        except (TypeError, ValueError):
            recent_limit = 24
        try:
            subject_limit = max(0, min(80, int(request.query_params.get("subject_limit", "24"))))
        except (TypeError, ValueError):
            subject_limit = 24
        try:
            report_limit = max(0, min(90, int(request.query_params.get("report_limit", "45"))))
        except (TypeError, ValueError):
            report_limit = 45
        captured_date_text = str(captured_date) if captured_date else None
        current_job = active_job()
        latest_jobs = [compact_job(read_json(path, {})) for path in sorted(jobs_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[:10]]
        pending_stats = fetch_pending_capture_stats(captured_date_text)
        payload = {
            "enabled": not getattr(settings, "IS_RENDER", False),
            "daily_reports": fetch_daily_reports(limit=report_limit) if report_limit else [],
            "pending_count": pending_stats["count"],
            "pending_summary": pending_stats["summary"],
            "pending": fetch_pending_captures(limit=pending_limit, captured_date=captured_date_text) if pending_limit else [],
            "recent": fetch_recent_captures(limit=recent_limit, captured_date=captured_date_text) if recent_limit else [],
            "subjects": fetch_subjects(limit=subject_limit, captured_date=captured_date_text) if subject_limit else [],
            "active_job": compact_job(current_job),
            "jobs": latest_jobs,
            "thresholds": {
                "min_det_score": float(os.getenv("UNKNOWN_ATTENDANCE_MIN_DET_SCORE", "0.80")),
                "min_face_size": int(os.getenv("UNKNOWN_ATTENDANCE_MIN_FACE_SIZE", "120")),
                "min_blur": float(os.getenv("UNKNOWN_ATTENDANCE_MIN_BLUR", "80")),
                "known_similarity": float(os.getenv("UNKNOWN_ATTENDANCE_KNOWN_THRESHOLD", os.getenv("FACE_MATCH_THRESHOLD", "0.35"))),
                "duplicate_similarity": float(os.getenv("UNKNOWN_ATTENDANCE_DUPLICATE_THRESHOLD", "0.55")),
            },
        }
        return Response(hydrate_urls(payload, request))


class UnknownAttendanceProcessView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request):
        ensure_dirs()
        capture_id = request.data.get("capture_id") or None
        captured_date = request.data.get("captured_date") or None
        if captured_date and not parse_date(str(captured_date)):
            return Response({"detail": "captured_date debe tener formato YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
        pending = fetch_pending_captures(limit=None, captured_date=str(captured_date) if captured_date else None)
        if capture_id:
            pending = [item for item in pending if str(item["id"]) == str(capture_id)]
        if not pending:
            return Response({"detail": "No hay capturas desconocidas pendientes."}, status=status.HTTP_400_BAD_REQUEST)
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
                "capture_id": capture_id,
                "captured_date": captured_date,
                "total": len(pending),
                "processed": 0,
                "percent": 0,
                "results": [],
            }
            write_json(job_path(job["id"]), job)
            thread = threading.Thread(target=process_worker, args=(job["id"], capture_id, captured_date), daemon=True)
            thread.start()
        return Response(job, status=status.HTTP_202_ACCEPTED)


class UnknownAttendanceCaptureImageView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, capture_id: str):
        capture = fetch_capture(capture_id)
        if not capture:
            return Response({"detail": "Captura no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        try:
            local_path = materialize_capture(capture)
        except Exception as exc:
            return Response({"detail": f"No se pudo preparar la evidencia: {exc}"}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(open(local_path, "rb"), content_type="image/jpeg")


class UnknownAttendanceLocalFaceImageView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, object_path: str):
        uri = f"{LOCAL_FACE_URI_PREFIX}{object_path}"
        local_path = local_face_uri_to_path(uri)
        if not local_path or not local_path.exists():
            return Response({"detail": "Recorte local no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(open(local_path, "rb"), content_type="image/jpeg")


class UnknownAttendanceSubjectAcceptView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request, subject_id: str):
        try:
            result = accept_subject(subject_id)
        except LookupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)
