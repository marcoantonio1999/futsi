from __future__ import annotations

import json

from django.db import connection
from django.utils import timezone

from .automatic_attendance_clip_sessions import metadata_for_video_clip_row, video_clip_session_cache
from .automatic_attendance_clips import pending_video_matches_request, video_clips_table_exists


NEIGHBOR_MAX_GAP_SECONDS = 15 * 60


def video_clip_id_from_request(requested_path: str | None) -> str:
    value = str(requested_path or "").strip()
    return value.split(":", 1)[1] if value.startswith("video_clip:") else ""


def base_video_clip_rows_for_neighbor_lookup(clip_id: str) -> list[dict]:
    if not clip_id or not video_clips_table_exists():
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select id, local_file_name, drive_file_id, drive_web_url, drive_remote_path, size_bytes,
                   uploaded_at, created_at, processed_at, error_message, attendance_session_id,
                   match_id, metadata, camera_id, clip_type, recording_started_at, recording_ended_at,
                   duration_seconds, status, recording_progress_percent, upload_progress_percent,
                   last_heartbeat_at, last_error_at, recorded_at, deleted_at
              from public.video_clips
             where deleted_at is null
               and coalesce(recording_started_at, recorded_at, created_at) between (
                    select coalesce(recording_started_at, recorded_at, created_at) - interval '1 day'
                      from public.video_clips
                     where id = %s
               ) and (
                    select coalesce(recording_started_at, recorded_at, created_at) + interval '1 day'
                      from public.video_clips
                     where id = %s
               )
               and (drive_remote_path is not null or drive_file_id is not null)
             order by coalesce(recording_started_at, recorded_at, created_at), created_at, id
            """,
            [clip_id, clip_id],
        )
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def expanded_neighbor_clip_ids(clip_id: str) -> list[str]:
    rows = base_video_clip_rows_for_neighbor_lookup(clip_id)
    if not rows:
        return [clip_id] if clip_id else []

    session_cache = video_clip_session_cache(rows)
    metadata_by_id = {str(row["id"]): metadata_for_video_clip_row(row, session_cache=session_cache) for row in rows}
    selected_row = next((row for row in rows if str(row["id"]) == str(clip_id)), None)
    if not selected_row:
        return [clip_id]

    selected_metadata = metadata_by_id.get(str(clip_id), {})
    selected_site_id = str(selected_metadata.get("site_id") or "")
    selected_camera_id = str(selected_row.get("camera_id") or "")

    compatible_rows = []
    for row in rows:
        metadata = metadata_by_id.get(str(row["id"]), {})
        if selected_site_id and str(metadata.get("site_id") or "") != selected_site_id:
            continue
        if selected_camera_id and str(row.get("camera_id") or "") != selected_camera_id:
            continue
        compatible_rows.append(row)

    selected_index = next((index for index, row in enumerate(compatible_rows) if str(row["id"]) == str(clip_id)), -1)
    if selected_index < 0:
        return [clip_id]

    neighbors = []
    selected_start = selected_row.get("recording_started_at") or selected_row.get("recorded_at") or selected_row.get("created_at")
    selected_end = selected_row.get("recording_ended_at") or selected_start
    if selected_index > 0 and _is_previous_neighbor(compatible_rows[selected_index - 1], selected_start):
        neighbors.append(str(compatible_rows[selected_index - 1]["id"]))
    neighbors.append(str(clip_id))
    if selected_index + 1 < len(compatible_rows) and _is_next_neighbor(compatible_rows[selected_index + 1], selected_start, selected_end):
        neighbors.append(str(compatible_rows[selected_index + 1]["id"]))
    return list(dict.fromkeys(neighbors))


def _is_previous_neighbor(row: dict, selected_start) -> bool:
    row_start = row.get("recording_started_at") or row.get("recorded_at") or row.get("created_at")
    row_end = row.get("recording_ended_at") or row_start
    if row_start is None or selected_start is None:
        return True
    if not (_time_distance(row_start, selected_start) > 0 and row_start < selected_start):
        return False
    return row_end is None or row_end <= selected_start and _time_distance(row_end, selected_start) <= NEIGHBOR_MAX_GAP_SECONDS


def _is_next_neighbor(row: dict, selected_start, selected_end) -> bool:
    row_start = row.get("recording_started_at") or row.get("recorded_at") or row.get("created_at")
    if row_start is None or selected_start is None:
        return True
    selected_end = selected_end or selected_start
    if not (_time_distance(row_start, selected_start) > 0 and row_start > selected_start):
        return False
    return row_start >= selected_end and _time_distance(row_start, selected_end) <= NEIGHBOR_MAX_GAP_SECONDS


def related_session_camera_clip_ids(clip_id: str) -> list[str]:
    rows = base_video_clip_rows_for_neighbor_lookup(clip_id)
    if not rows:
        return [clip_id] if clip_id else []

    session_cache = video_clip_session_cache(rows)
    metadata_by_id = {str(row["id"]): metadata_for_video_clip_row(row, session_cache=session_cache) for row in rows}
    selected_row = next((row for row in rows if str(row["id"]) == str(clip_id)), None)
    if not selected_row:
        return [clip_id]

    selected_metadata = metadata_by_id.get(str(clip_id), {})
    selected_site_id = str(selected_metadata.get("site_id") or "")
    selected_camera_id = str(selected_row.get("camera_id") or "")
    selected_session_id = str(selected_metadata.get("session_id") or selected_row.get("attendance_session_id") or "")
    selected_match_id = str(selected_metadata.get("match_id") or selected_row.get("match_id") or "")
    selected_start = selected_row.get("recording_started_at") or selected_row.get("recorded_at") or selected_row.get("created_at")
    selected_end = selected_row.get("recording_ended_at") or selected_start

    related = []
    fallback_by_camera: dict[str, list[dict]] = {}
    for row in rows:
        metadata = metadata_by_id.get(str(row["id"]), {})
        if selected_site_id and str(metadata.get("site_id") or "") != selected_site_id:
            continue
        row_id = str(row["id"])
        if row_id == str(clip_id):
            related.append(row_id)
            continue
        row_camera_id = str(row.get("camera_id") or "")
        if selected_camera_id and row_camera_id == selected_camera_id:
            continue
        row_session_id = str(metadata.get("session_id") or row.get("attendance_session_id") or "")
        row_match_id = str(metadata.get("match_id") or row.get("match_id") or "")
        same_session = bool(selected_session_id and row_session_id == selected_session_id)
        same_match = bool(selected_match_id and row_match_id == selected_match_id)
        if not same_session and not same_match:
            continue
        row_start = row.get("recording_started_at") or row.get("recorded_at") or row.get("created_at")
        row_end = row.get("recording_ended_at") or row_start
        if selected_start and row_end and row_end <= selected_start:
            if same_session:
                fallback_by_camera.setdefault(row_camera_id, []).append(row)
            continue
        if selected_end and row_start and row_start >= selected_end:
            if same_session:
                fallback_by_camera.setdefault(row_camera_id, []).append(row)
            continue
        related.append(row_id)

    related_cameras = {str(row.get("camera_id") or "") for row in rows if str(row["id"]) in related}
    for camera_id, candidates in fallback_by_camera.items():
        if not camera_id or camera_id in related_cameras:
            continue
        closest = min(candidates, key=lambda row: _time_distance(selected_start, row.get("recording_started_at") or row.get("recorded_at") or row.get("created_at")))
        related.append(str(closest["id"]))

    return list(dict.fromkeys(related or [clip_id]))


def _time_distance(left, right) -> float:
    if left is None or right is None:
        return 0
    try:
        return abs((right - left).total_seconds())
    except Exception:
        try:
            return abs(float(right) - float(left))
        except Exception:
            return 0


def expanded_multicamera_neighbor_clip_ids(clip_id: str) -> list[str]:
    clip_ids = []
    for root_id in related_session_camera_clip_ids(clip_id):
        clip_ids.extend(expanded_neighbor_clip_ids(root_id))
    return list(dict.fromkeys(clip_ids or ([clip_id] if clip_id else [])))


def reset_clip_ids_for_neighbor_processing(clip_ids: list[str], root_clip_id: str) -> None:
    if not clip_ids or not video_clips_table_exists():
        return
    marker = {
        "single_clip_neighbor_expansion": {
            "root_video_clip_id": root_clip_id,
            "clip_ids": clip_ids,
            "prepared_at": timezone.now().isoformat(),
        }
    }
    with connection.cursor() as cursor:
        cursor.execute(
            """
            update public.video_clips
               set processed_at = null,
                   status = 'uploaded',
                   error_message = null,
                   updated_at = now(),
                   metadata = coalesce(metadata, '{}'::jsonb) || %s::jsonb
             where id = any(%s::uuid[])
               and deleted_at is null
               and status in ('uploaded', 'processed', 'failed')
            """,
            [json.dumps(marker), clip_ids],
        )


def expand_requested_path_with_neighbors(requested_path: str | None, reset: bool = True) -> list[str]:
    if not requested_path:
        return []
    clip_id = video_clip_id_from_request(requested_path)
    if not clip_id:
        return [requested_path]
    clip_ids = expanded_multicamera_neighbor_clip_ids(clip_id)
    if reset:
        reset_clip_ids_for_neighbor_processing(clip_ids, clip_id)
    return [f"video_clip:{item}" for item in clip_ids]


def pending_video_matches_any_request(item: dict, requested_paths: list[str] | None) -> bool:
    if not requested_paths:
        return True
    return any(pending_video_matches_request(item, requested_path) for requested_path in requested_paths)
