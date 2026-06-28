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


def parse_session_id_from_filename(filename: str | None) -> int | None:
    match = re.search(r"(?:^|[^a-z0-9])session[_-](\d+)(?=[^0-9]|$)", (filename or "").lower())
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def int_or_none(value) -> int | None:
    if value in {None, ""}:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def video_clip_session_candidate_ids(row: dict, metadata: dict, sidecar: dict) -> list[int]:
    row_session_id = int_or_none(row.get("attendance_session_id"))
    sidecar_session_id = int_or_none(sidecar.get("attendance_session_id") or metadata.get("session_id"))
    filename_session_id = parse_session_id_from_filename(row.get("local_file_name"))
    candidates = []
    if filename_session_id:
        candidates.append(filename_session_id)
    if row_session_id:
        candidates.append(row_session_id)
    if sidecar_session_id:
        candidates.append(sidecar_session_id)
    return list(dict.fromkeys(candidates))


def video_clip_session_cache(rows: list[dict]) -> dict[int, AttendanceSession]:
    session_ids: set[int] = set()
    for row in rows:
        raw_metadata = row.get("metadata") or {}
        if isinstance(raw_metadata, str):
            raw_metadata = read_json_from_text(raw_metadata, {})
        metadata = dict(raw_metadata or {})
        sidecar = metadata.get("sidecar") if isinstance(metadata.get("sidecar"), dict) else {}
        session_ids.update(video_clip_session_candidate_ids(row, metadata, sidecar))
    if not session_ids:
        return {}
    return {
        session.id: session
        for session in AttendanceSession.objects.select_related("site", "team", "tournament").filter(id__in=session_ids, closed_at__isnull=True)
    }


def resolve_video_clip_session(row: dict, metadata: dict, sidecar: dict, session_cache: dict[int, AttendanceSession] | None = None) -> tuple[AttendanceSession | None, dict]:
    row_session_id = int_or_none(row.get("attendance_session_id"))
    sidecar_session_id = int_or_none(sidecar.get("attendance_session_id") or metadata.get("session_id"))
    filename_session_id = parse_session_id_from_filename(row.get("local_file_name"))
    conflicts: dict[str, object] = {}

    candidates: list[tuple[str, int]] = []
    if filename_session_id:
        candidates.append(("filename", filename_session_id))
    if row_session_id:
        candidates.append(("video_clips.attendance_session_id", row_session_id))
    if sidecar_session_id:
        candidates.append(("sidecar", sidecar_session_id))

    seen: set[int] = set()
    for source, session_id in candidates:
        if session_id in seen:
            continue
        seen.add(session_id)
        if session_cache is None:
            session = AttendanceSession.objects.select_related("site", "team", "tournament").filter(id=session_id, closed_at__isnull=True).first()
        else:
            session = session_cache.get(session_id)
        if not session:
            continue
        if filename_session_id and row_session_id and filename_session_id != row_session_id:
            conflicts["filename_session_id"] = filename_session_id
            conflicts["row_attendance_session_id"] = row_session_id
            conflicts["resolution"] = source
        if sidecar_session_id and session.id != sidecar_session_id:
            conflicts["sidecar_attendance_session_id"] = sidecar_session_id
        return session, conflicts
    return None, conflicts


def metadata_for_video_clip_row(row: dict, repair: bool = False, session_cache: dict[int, AttendanceSession] | None = None) -> dict:
    raw_metadata = row.get("metadata") or {}
    if isinstance(raw_metadata, str):
        raw_metadata = read_json_from_text(raw_metadata, {})
    metadata = dict(raw_metadata or {})
    sidecar = metadata.get("sidecar") if isinstance(metadata.get("sidecar"), dict) else {}
    session, conflicts = resolve_video_clip_session(row, metadata, sidecar, session_cache=session_cache)

    if session:
        metadata["session_id"] = session.id
        metadata["site_id"] = session.site_id
        metadata["recorded_date"] = session.date.isoformat()
        if repair and int_or_none(row.get("attendance_session_id")) != session.id:
            was_processed = row.get("status") in {"processed", "failed"} or row.get("processed_at") is not None
            repair_metadata = {"session_repair": conflicts or {"resolution": "filename"}}
            if was_processed:
                repair_metadata["needs_reprocess_after_session_repair"] = True
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    update public.video_clips
                       set attendance_session_id = %s,
                           match_id = %s,
                           processed_at = case when %s then null else processed_at end,
                           status = case when %s then 'uploaded' else status end,
                           error_message = case when %s then null else error_message end,
                           metadata = coalesce(metadata, '{}'::jsonb) || %s::jsonb,
                           updated_at = now()
                     where id = %s
                       and deleted_at is null
                    """,
                    [
                        session.id,
                        session.match_id,
                        was_processed,
                        was_processed,
                        was_processed,
                        json.dumps(repair_metadata),
                        row["id"],
                    ],
                )
            row["attendance_session_id"] = session.id
            row["match_id"] = session.match_id
            if was_processed:
                row["processed_at"] = None
                row["status"] = "uploaded"
                row["error_message"] = None
    elif sidecar.get("site_id") and not metadata.get("site_id"):
        metadata["site_id"] = sidecar["site_id"]

    if conflicts:
        metadata["session_conflict"] = conflicts
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
            "recording_started_at": row.get("recording_started_at").isoformat() if row.get("recording_started_at") else metadata.get("recording_started_at"),
            "recording_ended_at": row.get("recording_ended_at").isoformat() if row.get("recording_ended_at") else metadata.get("recording_ended_at"),
            "duration_seconds": row.get("duration_seconds") or metadata.get("duration_seconds"),
        }
    )
    return metadata


def repair_video_clip_session_links(limit: int = 200) -> None:
    if not video_clips_table_exists():
        return
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select id, local_file_name, drive_file_id, drive_web_url, drive_remote_path, size_bytes,
                   uploaded_at, created_at, processed_at, error_message, attendance_session_id,
                   match_id, metadata, camera_id, clip_type, recording_started_at, recording_ended_at,
                   duration_seconds, status, recording_progress_percent, upload_progress_percent,
                   last_heartbeat_at, last_error_at
              from public.video_clips
             where deleted_at is null
               and local_file_name ~* '(^|[^a-z0-9])session[_-][0-9]+'
             order by updated_at desc
             limit %s
            """,
            [limit],
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    session_cache = video_clip_session_cache(rows)
    for row in rows:
        metadata_for_video_clip_row(row, repair=True, session_cache=session_cache)
