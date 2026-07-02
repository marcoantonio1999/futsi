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

from .automatic_attendance_domain import mark_present, person_key, person_team_id, person_team_name, person_type, summarize_session
from .automatic_attendance_evidence import save_match_evidence, save_unknown_evidence


def normalize_embedding(embedding):
    import numpy as np

    query = embedding.astype(np.float32)
    return query / max(np.linalg.norm(query), 1e-12)


def build_video_session_result(
    *,
    session: AttendanceSession,
    user: User,
    video_path: Path,
    job: dict,
    skipped: list,
    accepted_observations: list[dict],
    review_observations: list[dict],
    unknown_observations: list[dict],
    scan_metrics: dict,
    threshold: float,
    min_margin: float,
    min_hits: int,
    review_threshold: float,
    duplicate_guard_similarity: float,
    max_review_items: int,
    max_unknown_items: int,
) -> dict:
    import numpy as np

    sampled_frames = scan_metrics["sampled_frames"]
    probed_seconds = scan_metrics["probed_seconds"]
    active_seconds = scan_metrics["active_seconds"]
    skipped_seconds = scan_metrics["skipped_seconds"]
    face_groups_count = scan_metrics["face_groups"]
    rejected_quality_faces = scan_metrics["rejected_quality_faces"]
    total_frames = scan_metrics["total_frames"]
    total_duration = scan_metrics["total_duration"]
    window_label = scan_metrics["window_label"]
    use_second_probe = scan_metrics["use_second_probe"]
    probe_window_seconds = scan_metrics["probe_window_seconds"]
    dense_frame_stride = scan_metrics["dense_frame_stride"]
    video_cluster_similarity = scan_metrics["video_cluster_similarity"]
    group_top_faces = scan_metrics["group_top_faces"]
    max_face_groups = scan_metrics["max_face_groups"]
    processing_video_source = scan_metrics.get("processing_video_source") or "full_video"
    frame_proxy = bool(scan_metrics.get("frame_proxy"))
    analysis_video_mod8 = bool(scan_metrics.get("analysis_video_mod8"))
    analysis_frame_interval = int(scan_metrics.get("analysis_frame_interval") or 0)
    detail_candidate_windows = int(scan_metrics.get("detail_candidate_windows") or 0)
    hits: dict[str, dict] = {}
    off_roster_hits: dict[str, dict] = {}
    accepted_assignments = []
    duplicate_rejections = []
    for observation in sorted(accepted_observations, key=lambda item: item["best_similarity"], reverse=True):
        person = observation["student"]
        is_expected = bool(observation.get("is_expected_roster", True))
        if not is_expected and observation.get("padding_only"):
            continue
        query = normalize_embedding(observation["embedding"])
        conflict = None
        for assignment in accepted_assignments:
            if assignment["person_key"] != person_key(person) and float(np.dot(query, assignment["embedding"])) >= duplicate_guard_similarity:
                conflict = assignment
                break
        if conflict:
            observation["reason"] = f"Posible mismo rostro ya asignado a {conflict['person_name']}"
            duplicate_rejections.append(observation)
            continue
        accepted_assignments.append({"person_key": person_key(person), "person_name": person.full_name, "embedding": query})
        target_hits = hits if is_expected else off_roster_hits
        entry = target_hits.setdefault(
            person_key(person),
            {
                "student": person,
                "person_type": person_type(person),
                "person_key": person_key(person),
                "is_expected_roster": is_expected,
                "count": 0,
                "core_hit_count": 0,
                "padding_hit_count": 0,
                "best_similarity": 0.0,
                "margin": 0.0,
                "best_frame": None,
                "best_bbox": None,
                "best_frame_index": 0,
                "video_second": None,
                "video_time": "",
                "session_second": None,
                "session_time": "",
                "observed_at": "",
                "observed_date": "",
                "observed_time": "",
                "window_phase": "unknown",
                "candidates": observation["candidates"],
                "group_ids": [],
            },
        )
        entry["count"] += int(observation.get("count") or 1)
        entry["core_hit_count"] += int(observation.get("core_hit_count") or 0)
        entry["padding_hit_count"] += int(observation.get("padding_hit_count") or 0)
        entry["group_ids"].append(observation.get("group_id"))
        if observation["best_similarity"] > entry["best_similarity"]:
            entry.update(
                {
                    "best_similarity": observation["best_similarity"],
                    "margin": observation["margin"],
                    "best_frame": observation["best_frame"],
                    "best_bbox": observation["best_bbox"],
                    "best_frame_index": observation["best_frame_index"],
                    "video_second": observation.get("video_second"),
                    "video_time": observation.get("video_time", ""),
                    "session_second": observation.get("session_second"),
                    "session_time": observation.get("session_time", ""),
                    "observed_at": observation.get("observed_at", ""),
                    "observed_date": observation.get("observed_date", ""),
                    "observed_time": observation.get("observed_time", ""),
                    "window_phase": observation.get("window_phase", "unknown"),
                    "candidates": observation["candidates"],
                    "quality": observation.get("quality", {}),
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
                "person_id": person.id,
                "person_type": person_type(person),
                "person_key": person_key(person),
                "team_id": person_team_id(person),
                "team_name": person_team_name(person),
                "hits": entry["count"],
                "similarity": round(entry["best_similarity"], 4),
                "margin": round(entry["margin"], 4),
                "frame": entry.get("best_frame_index", 0),
                "video_second": entry.get("video_second"),
                "video_time": entry.get("video_time", ""),
                "session_second": entry.get("session_second"),
                "session_time": entry.get("session_time", ""),
                "observed_at": entry.get("observed_at", ""),
                "observed_date": entry.get("observed_date", ""),
                "observed_time": entry.get("observed_time", ""),
                "window_phase": entry.get("window_phase", "unknown"),
                "core_hit_count": entry.get("core_hit_count", 0),
                "padding_hit_count": entry.get("padding_hit_count", 0),
                "evidence_path": evidence_path,
                "candidates": entry.get("candidates", []),
                "group_ids": [group_id for group_id in entry.get("group_ids", []) if group_id is not None],
            }
        )

    off_roster_payload = []
    for entry in sorted(off_roster_hits.values(), key=lambda item: item["best_similarity"], reverse=True):
        person = entry["student"]
        evidence_path = save_match_evidence(entry, session, job, "off_roster")
        off_roster_payload.append(
            {
                "student_id": person.id,
                "student_name": person.full_name,
                "person_id": person.id,
                "person_type": person_type(person),
                "person_key": person_key(person),
                "team_id": person_team_id(person),
                "team_name": person_team_name(person),
                "hits": entry["count"],
                "similarity": round(entry["best_similarity"], 4),
                "margin": round(entry["margin"], 4),
                "frame": entry.get("best_frame_index", 0),
                "video_second": entry.get("video_second"),
                "video_time": entry.get("video_time", ""),
                "session_second": entry.get("session_second"),
                "session_time": entry.get("session_time", ""),
                "observed_at": entry.get("observed_at", ""),
                "observed_date": entry.get("observed_date", ""),
                "observed_time": entry.get("observed_time", ""),
                "window_phase": entry.get("window_phase", "unknown"),
                "core_hit_count": entry.get("core_hit_count", 0),
                "padding_hit_count": entry.get("padding_hit_count", 0),
                "reason": "Detectado por video, pero no pertenece al roster esperado de esta sesion.",
                "evidence_path": evidence_path,
                "candidates": entry.get("candidates", []),
                "group_ids": [group_id for group_id in entry.get("group_ids", []) if group_id is not None],
            }
        )

    review.extend(review_observations)
    review.extend(duplicate_rejections)
    review_payload = []
    review_by_student: dict[str, dict] = {}
    marked_keys = {item.get("person_key") or f"student:{item['student_id']}" for item in marked}
    off_roster_keys = {item.get("person_key") or f"student:{item['student_id']}" for item in off_roster_payload}
    for entry in sorted(review, key=lambda item: item["best_similarity"], reverse=True):
        person = entry["student"]
        entry_key = person_key(person)
        if entry_key in marked_keys or entry_key in off_roster_keys:
            continue
        current = review_by_student.get(entry_key)
        entry_count = int(entry.get("count") or 1)
        if current is None:
            entry["count"] = entry_count
            review_by_student[entry_key] = entry
            continue
        current["count"] = int(current.get("count") or 1) + entry_count
        if entry["best_similarity"] > current["best_similarity"]:
            entry["count"] = current["count"]
            review_by_student[entry_key] = entry

    for entry in sorted(review_by_student.values(), key=lambda item: item["best_similarity"], reverse=True)[:max_review_items]:
        person = entry["student"]
        evidence_path = save_match_evidence(entry, session, job, "review")
        review_payload.append(
            {
                "student_id": person.id,
                "student_name": person.full_name,
                "person_id": person.id,
                "person_type": person_type(person),
                "person_key": person_key(person),
                "team_id": person_team_id(person),
                "team_name": person_team_name(person),
                "similarity": round(entry["best_similarity"], 4),
                "margin": round(entry.get("margin", 0.0), 4),
                "hits": entry.get("count", 1),
                "frame": entry.get("best_frame_index", 0),
                "video_second": entry.get("video_second"),
                "video_time": entry.get("video_time", ""),
                "session_second": entry.get("session_second"),
                "session_time": entry.get("session_time", ""),
                "observed_at": entry.get("observed_at", ""),
                "observed_date": entry.get("observed_date", ""),
                "observed_time": entry.get("observed_time", ""),
                "window_phase": entry.get("window_phase", "unknown"),
                "core_hit_count": entry.get("core_hit_count", 0),
                "padding_hit_count": entry.get("padding_hit_count", 0),
                "reason": entry.get("reason", "Requiere revision"),
                "evidence_path": evidence_path,
                "candidates": entry.get("candidates", []),
            }
        )

    unknown_payload = []
    for index, entry in enumerate(sorted(unknown_observations, key=lambda item: item["count"], reverse=True)[:max_unknown_items], start=1):
        evidence_path = save_unknown_evidence(entry, session, job)
        unknown_payload.append(
            {
                "unknown_id": index,
                "hits": entry.get("count", 1),
                "similarity": round(entry.get("best_similarity", 0.0), 4),
                "frame": entry.get("best_frame_index", 0),
                "video_second": entry.get("video_second"),
                "video_time": entry.get("video_time", ""),
                "session_second": entry.get("session_second"),
                "session_time": entry.get("session_time", ""),
                "observed_at": entry.get("observed_at", ""),
                "observed_date": entry.get("observed_date", ""),
                "observed_time": entry.get("observed_time", ""),
                "window_phase": entry.get("window_phase", "unknown"),
                "core_hit_count": entry.get("core_hit_count", 0),
                "padding_hit_count": entry.get("padding_hit_count", 0),
                "evidence_path": evidence_path,
                "group_id": entry.get("group_id"),
                "quality": entry.get("quality", {}),
            }
        )

    duration = round(total_duration, 2) if total_duration else None
    return {
        "session": summarize_session(session),
        "marked": marked,
        "review": review_payload,
        "off_roster": off_roster_payload,
        "unknown_faces": unknown_payload,
        "sampled_frames": sampled_frames,
        "probed_seconds": probed_seconds,
        "active_seconds": active_seconds,
        "skipped_seconds": skipped_seconds,
        "face_groups": face_groups_count,
        "rejected_quality_faces": rejected_quality_faces,
        "clustered_pipeline": True,
        "processing_video_source": processing_video_source,
        "frame_proxy": frame_proxy,
        "analysis_video_mod8": analysis_video_mod8,
        "analysis_frame_interval": analysis_frame_interval,
        "detail_candidate_windows": detail_candidate_windows,
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
            "probe_window_seconds": probe_window_seconds,
            "dense_frame_stride": dense_frame_stride,
            "video_cluster_similarity": video_cluster_similarity,
            "cluster_top_faces": group_top_faces,
            "max_face_groups": max_face_groups,
            "min_det_score": float(os.getenv("AUTO_ATTENDANCE_MIN_DET_SCORE", "0.45")),
            "min_face_size": int(os.getenv("AUTO_ATTENDANCE_MIN_FACE_SIZE", "80")),
            "min_blur": float(os.getenv("AUTO_ATTENDANCE_MIN_BLUR", "5")),
        },
    }


