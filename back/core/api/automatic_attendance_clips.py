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
from .automatic_attendance_clip_sessions import *


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


def local_video_clip_states(clip_ids: set[str]) -> dict[str, dict]:
    if not clip_ids:
        return {}
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass('public.video_clips')")
        if not cursor.fetchone()[0]:
            return {}
        cursor.execute(
            """
            select id::text, status, processed_at, deleted_at
              from public.video_clips
             where id = any(%s)
            """,
            [list(clip_ids)],
        )
        columns = [column[0] for column in cursor.description]
        return {row[0]: dict(zip(columns, row)) for row in cursor.fetchall()}


def pending_videos() -> list[dict]:
    ensure_dirs()
    local_candidates = []
    local_clip_ids = set()
    for path in sorted(pending_dir().rglob("*"), key=lambda item: item.stat().st_mtime):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        metadata = infer_metadata(path, read_json(sidecar_path(path), {}))
        clip_id = str(metadata.get("video_clip_id") or "").strip()
        if clip_id:
            local_clip_ids.add(clip_id)
        local_candidates.append(
            {
                "filename": path.name,
                "path": str(path),
                "source": "local",
                "size": path.stat().st_size,
                "modified_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.get_current_timezone()).isoformat(),
                "metadata": metadata,
            }
        )
    clip_states = local_video_clip_states(local_clip_ids)
    videos = []
    materialized_clip_ids = set()
    for item in local_candidates:
        clip_id = str((item.get("metadata") or {}).get("video_clip_id") or "").strip()
        if clip_id:
            state = clip_states.get(clip_id)
            if not state or state.get("deleted_at") or state.get("processed_at") or state.get("status") != "uploaded":
                continue
            materialized_clip_ids.add(clip_id)
        videos.append(item)
    remotes = [item for item in remote_pending_videos() if str((item.get("metadata") or {}).get("video_clip_id") or "").strip() not in materialized_clip_ids]
    return videos + remotes


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
                   clip_type, status, recording_started_at, recording_ended_at, duration_seconds
            from public.video_clips
            where processed_at is null
              and deleted_at is null
              and status = 'uploaded'
              and (drive_remote_path is not null or drive_file_id is not null)
            order by coalesce(uploaded_at, created_at) asc
            """
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    session_cache = video_clip_session_cache(rows)
    videos = []
    for row in rows:
        metadata = metadata_for_video_clip_row(row, session_cache=session_cache)
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


def numeric_percent(value) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, min(100.0, float(value)))
    except (TypeError, ValueError):
        return None


def video_clip_monitor_items() -> list[dict]:
    if not video_clips_table_exists():
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select vc.id, vc.local_file_name, vc.camera_id, vc.clip_type, vc.status,
                   vc.local_original_path, vc.drive_remote_path, vc.drive_file_id, vc.drive_web_url,
                   vc.size_bytes, vc.recorded_at, vc.uploaded_at, vc.processed_at, vc.deleted_at,
                   vc.error_message, vc.metadata, vc.created_at, vc.updated_at,
                   vc.attendance_session_id, vc.match_id, vc.recording_started_at,
                   vc.recording_ended_at, vc.duration_seconds, vc.recording_progress_percent,
                   vc.upload_progress_percent, vc.last_heartbeat_at, vc.last_error_at,
                   s.name as site_name, ses.site_id, ses.date as session_date,
                   ses.starts_at as session_starts_at, ses.ends_at as session_ends_at,
                   ses.group_name as session_group_name, ses.session_type,
                   team.name as team_name, tournament.name as tournament_name
              from public.video_clips vc
              left join attendance_sessions ses on ses.id = vc.attendance_session_id
              left join sites s on s.id = ses.site_id
              left join teams team on team.id = ses.team_id
              left join tournaments tournament on tournament.id = ses.tournament_id
             where vc.deleted_at is null
               and (
                    vc.processed_at is null
                    or vc.updated_at >= now() - interval '36 hours'
                    or vc.recorded_at >= now() - interval '36 hours'
               )
             order by coalesce(vc.recording_started_at, vc.recorded_at, vc.created_at) desc
             limit 80
            """
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    session_cache = video_clip_session_cache(rows)
    items = []
    for row in rows:
        metadata = metadata_for_video_clip_row(row, session_cache=session_cache)
        session_label_parts = []
        if row.get("site_name"):
            session_label_parts.append(row["site_name"])
        if row.get("session_date"):
            session_label_parts.append(str(row["session_date"]))
        if row.get("session_starts_at"):
            session_label_parts.append(str(row["session_starts_at"])[:5])
        if row.get("team_name") or row.get("session_group_name"):
            session_label_parts.append(row.get("team_name") or row.get("session_group_name"))
        items.append(
            {
                "id": str(row["id"]),
                "filename": row.get("local_file_name") or f"{row['id']}.mp4",
                "camera_id": row.get("camera_id") or "",
                "clip_type": row.get("clip_type") or "",
                "status": row.get("status") or "",
                "size": row.get("size_bytes") or 0,
                "recorded_at": row.get("recorded_at").isoformat() if row.get("recorded_at") else None,
                "uploaded_at": row.get("uploaded_at").isoformat() if row.get("uploaded_at") else None,
                "processed_at": row.get("processed_at").isoformat() if row.get("processed_at") else None,
                "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
                "recording_started_at": row.get("recording_started_at").isoformat() if row.get("recording_started_at") else None,
                "recording_ended_at": row.get("recording_ended_at").isoformat() if row.get("recording_ended_at") else None,
                "duration_seconds": row.get("duration_seconds"),
                "recording_progress_percent": numeric_percent(row.get("recording_progress_percent")),
                "upload_progress_percent": numeric_percent(row.get("upload_progress_percent")),
                "last_heartbeat_at": row.get("last_heartbeat_at").isoformat() if row.get("last_heartbeat_at") else None,
                "last_error_at": row.get("last_error_at").isoformat() if row.get("last_error_at") else None,
                "error_message": row.get("error_message") or "",
                "drive_remote_path": row.get("drive_remote_path") or "",
                "drive_file_id": row.get("drive_file_id") or "",
                "drive_web_url": row.get("drive_web_url") or "",
                "attendance_session_id": row.get("attendance_session_id"),
                "match_id": row.get("match_id"),
                "site_id": row.get("site_id"),
                "site_name": row.get("site_name") or metadata.get("site_name") or "",
                "team_name": row.get("team_name") or "",
                "tournament_name": row.get("tournament_name") or "",
                "session_label": " - ".join(session_label_parts),
                "processable": row.get("status") == "uploaded" and bool(row.get("drive_remote_path") or row.get("drive_file_id")),
                "metadata": metadata,
            }
        )
    return items


def video_clip_item_from_row(row: dict, reprocessable: bool = False, session_cache: dict[int, AttendanceSession] | None = None) -> dict:
    metadata = metadata_for_video_clip_row(row, session_cache=session_cache)
    metadata.update(
        {
            "processed_at": row.get("processed_at").isoformat() if row.get("processed_at") else None,
            "error_message": row.get("error_message"),
            "recording_progress_percent": numeric_percent(row.get("recording_progress_percent")),
            "upload_progress_percent": numeric_percent(row.get("upload_progress_percent")),
            "last_heartbeat_at": row.get("last_heartbeat_at").isoformat() if row.get("last_heartbeat_at") else None,
            "last_error_at": row.get("last_error_at").isoformat() if row.get("last_error_at") else None,
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
                   duration_seconds, status, recording_progress_percent, upload_progress_percent,
                   last_heartbeat_at, last_error_at
            from public.video_clips
            where processed_at is not null
              and deleted_at is null
              and status in ('processed', 'failed')
            order by processed_at desc
            limit 25
            """
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    session_cache = video_clip_session_cache(rows)
    return [video_clip_item_from_row(row, reprocessable=True, session_cache=session_cache) for row in rows]


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
