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


def safe_filename(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", text).strip("_") or "item"


def evidence_url(request, job_id: str, evidence_path: str) -> str:
    if not evidence_path:
        return ""
    parsed_storage_uri = parse_storage_uri(evidence_path)
    if parsed_storage_uri:
        bucket, object_path = parsed_storage_uri
        path = f"/api/automatic-attendance/evidence-storage/{quote(bucket)}/{quote(object_path, safe='/')}"
        return request.build_absolute_uri(path) if request else path
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


def comparison_person_key(item: dict) -> str:
    raw_key = item.get("person_key")
    if raw_key:
        return str(raw_key)
    person_type_value = item.get("person_type") or "student"
    return f"{person_type_value}:{comparison_student_id(item)}"


def comparison_similarity(item: dict) -> float:
    try:
        return float(item.get("similarity", item.get("best_similarity", 0)) or 0)
    except (TypeError, ValueError):
        return 0.0


def dedupe_comparison_payload(items: list[dict], excluded_keys: set[str] | None = None) -> list[dict]:
    excluded_keys = excluded_keys or set()
    by_student: dict[str, dict] = {}
    for item in items or []:
        item_key = comparison_person_key(item)
        if not item_key or item_key in excluded_keys:
            continue
        current = by_student.get(item_key)
        item_hits = int(item.get("hits") or item.get("count") or 1)
        if current is None:
            next_item = dict(item)
            next_item["hits"] = item_hits
            by_student[item_key] = next_item
            continue
        current["hits"] = int(current.get("hits") or current.get("count") or 1) + item_hits
        if comparison_similarity(item) > comparison_similarity(current):
            next_item = dict(item)
            next_item["hits"] = current["hits"]
            by_student[item_key] = next_item
    return sorted(by_student.values(), key=comparison_similarity, reverse=True)


def normalize_job_comparisons(job: dict) -> dict:
    for result in job.get("results", []) or []:
        for session_result in result.get("sessions", []) or []:
            marked = dedupe_comparison_payload(session_result.get("marked", []) or [])
            marked_keys = {comparison_person_key(item) for item in marked}
            off_roster = dedupe_comparison_payload(session_result.get("off_roster", []) or [], excluded_keys=marked_keys)
            off_roster_keys = {comparison_person_key(item) for item in off_roster}
            review = dedupe_comparison_payload(session_result.get("review", []) or [], excluded_keys=marked_keys | off_roster_keys)
            session_result["marked"] = marked
            session_result["off_roster"] = off_roster
            session_result["review"] = review
    return job


def hydrate_job_evidence_urls(job: dict, request) -> dict:
    hydrated = normalize_job_comparisons(json.loads(json.dumps(job)))
    job_id = hydrated.get("id", "")
    for result in hydrated.get("results", []) or []:
        for session_result in result.get("sessions", []) or []:
            for key in ["marked", "review", "off_roster", "unknown_faces"]:
                for item in session_result.get(key, []) or []:
                    item["evidence_url"] = evidence_url(request, job_id, item.get("evidence_path", ""))
    return hydrated


def upload_evidence_to_storage(local_path: Path, job: dict, session: AttendanceSession, category: str, filename: str) -> str:
    object_path = (
        f"jobs/{job['id']}/session_{session.id}/{category}/"
        f"{timezone.now().strftime('%Y%m%dT%H%M%S')}_{filename}"
    )
    try:
        return upload_private_file(EVIDENCE_BUCKET, object_path, local_path, upsert=True)
    except Exception as exc:
        job.setdefault("evidence_upload_errors", []).append(
            {
                "path": str(local_path),
                "bucket": EVIDENCE_BUCKET,
                "object_path": object_path,
                "error": str(exc),
                "at": timezone.now().isoformat(),
            }
        )
        return str(local_path)


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
    return upload_evidence_to_storage(output_path, job, session, category, filename)


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
    return upload_evidence_to_storage(output_path, job, session, "unknown", filename)
