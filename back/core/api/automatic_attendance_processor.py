from __future__ import annotations

import html
import http.cookiejar
import json
import os
import queue
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
from .automatic_attendance_detection import detect_face_boxes_hybrid, detect_faces_hybrid
from .automatic_attendance_results import build_video_session_result
from .automatic_attendance_scan import face_quality, resolve_video_window
from .automatic_attendance_timing import frame_time_payload, group_time_summary
from .automatic_attendance_windows import metadata_session_windows


def process_video_for_session(video_path: Path, session: AttendanceSession, user: User, job: dict, metadata: dict | None = None, reference_cache: dict | None = None) -> dict:
    import cv2
    import numpy as np

    providers = os.getenv("AUTO_ATTENDANCE_PROVIDERS", os.getenv("FACE_PROVIDERS", "auto"))
    threshold = float(os.getenv("AUTO_ATTENDANCE_THRESHOLD", os.getenv("FACE_MATCH_THRESHOLD", "0.35")))
    min_margin = float(os.getenv("AUTO_ATTENDANCE_MIN_MARGIN", os.getenv("FACE_MATCH_MIN_MARGIN", "0.03")))
    min_hits = int(os.getenv("AUTO_ATTENDANCE_MIN_HITS", "2"))
    sample_every = max(1, int(os.getenv("AUTO_ATTENDANCE_SAMPLE_EVERY", "10")))
    review_threshold = float(os.getenv("AUTO_ATTENDANCE_REVIEW_THRESHOLD", "0.22"))
    duplicate_guard_similarity = float(os.getenv("AUTO_ATTENDANCE_DUPLICATE_GUARD", "0.50"))
    max_review_items = int(os.getenv("AUTO_ATTENDANCE_MAX_REVIEW_ITEMS", "24"))
    max_unknown_items = int(os.getenv("AUTO_ATTENDANCE_MAX_UNKNOWN_ITEMS", "24"))
    unknown_duplicate_similarity = float(os.getenv("AUTO_ATTENDANCE_UNKNOWN_DUPLICATE_GUARD", "0.38"))
    try:
        detection_max_dimension = max(0, int(os.getenv("AUTO_ATTENDANCE_DETECT_MAX_DIMENSION", "1280")))
    except (TypeError, ValueError):
        detection_max_dimension = 1280

    expected_keys = expected_roster_keys(session)
    comparison_people = list(comparison_roster_for_session(session))
    reference_cache_hits = 0
    skipped = []
    enrolled_people = []
    reference_matrix = np.empty((0, 512), dtype=np.float32)
    reference_cache = reference_cache if reference_cache is not None else {}
    reference_cache_key = (
        session.id,
        providers,
        tuple(person_key(person) for person in comparison_people),
    )

    def on_reference_progress(done: int, total: int, name: str, cached: bool) -> None:
        nonlocal reference_cache_hits
        if cached:
            reference_cache_hits += 1
        if done == total or done % 10 == 0:
            update_job(
                job,
                phase="preparing",
                phase_label=f"Cargando referencias de rostros {done}/{total}",
                reference_processed=done,
                reference_total=total,
                reference_cached=reference_cache_hits,
                reference_current=name,
            )

    cached_references = reference_cache.get(reference_cache_key)
    if cached_references:
        enrolled_people = cached_references["enrolled_people"]
        reference_matrix = cached_references["reference_matrix"]
        skipped = cached_references["skipped"]
        reference_cache_hits = int(cached_references.get("reference_cache_hits") or 0)
        update_job(
            job,
            phase="preparing",
            phase_label=f"Referencias del partido reutilizadas: {len(enrolled_people)} validas",
            reference_processed=len(comparison_people),
            reference_total=len(comparison_people),
            reference_valid=len(enrolled_people),
            reference_cached=reference_cache_hits,
            reference_reused=True,
        )
    elif comparison_people:
        update_job(
            job,
            phase="preparing",
            phase_label=f"Cargando referencias del partido 0/{len(comparison_people)}",
            reference_processed=0,
            reference_total=len(comparison_people),
            reference_cached=0,
        )
        enrolled_people, reference_matrix, skipped = build_student_database(
            comparison_people,
            providers_key=providers,
            progress_callback=on_reference_progress,
        )
        reference_cache[reference_cache_key] = {
            "enrolled_people": enrolled_people,
            "reference_matrix": reference_matrix,
            "skipped": skipped,
            "reference_cache_hits": reference_cache_hits,
        }
        update_job(
            job,
            phase="preparing",
            phase_label=f"Referencias del partido listas: {len(enrolled_people)} validas ({reference_cache_hits} cacheadas)",
            reference_processed=len(comparison_people),
            reference_total=len(comparison_people),
            reference_valid=len(enrolled_people),
            reference_cached=reference_cache_hits,
        )
    else:
        update_job(
            job,
            phase="preparing",
            phase_label="Sin referencias del partido; analizando rostros como desconocidos",
            reference_processed=0,
            reference_total=0,
            reference_valid=0,
            reference_cached=0,
        )
    update_job(job, phase="preparing", phase_label="Abriendo video local")

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return {"session": summarize_session(session), "marked": [], "review": [], "off_roster": [], "unknown_faces": [], "failed": True, "detail": "No se pudo abrir el video."}

    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    metadata = metadata or {}
    processing_video_source = str(metadata.get("processing_video_source") or "")
    is_frame_proxy = processing_video_source == "frame_proxy_1fps"
    analysis_video_metadata = metadata.get("processing_analysis_video") if isinstance(metadata.get("processing_analysis_video"), dict) else {}
    if not analysis_video_metadata and isinstance(metadata.get("analysis_video"), dict):
        analysis_video_metadata = metadata.get("analysis_video") or {}
    is_analysis_mod8_video = processing_video_source == "analysis_video_mod8" or analysis_video_metadata.get("package_type") == "video_frame_index_mod8"
    timing_fps = float(analysis_video_metadata.get("source_fps_estimate") or 30) if is_analysis_mod8_video else fps
    detail_candidate_windows = metadata.get("detail_candidate_windows") if isinstance(metadata.get("detail_candidate_windows"), list) else []
    use_detail_windows = bool(detail_candidate_windows) and not is_frame_proxy
    if is_analysis_mod8_video:
        original_duration = float(analysis_video_metadata.get("original_duration_seconds") or metadata.get("duration_seconds") or 0)
        override = metadata_session_windows(metadata).get(str(session.id))
        window = {
            "total_duration": original_duration or (total_frames / fps if total_frames and fps else 0),
            "start_frame": 0,
            "end_frame": total_frames,
            "window_label": "video de analisis mod8 completo",
            "error_detail": "",
        }
        if override:
            window["core_start_seconds"] = override.get("core_start_seconds")
            window["core_end_seconds"] = override.get("core_end_seconds")
    else:
        window = resolve_video_window(capture, session, metadata, total_frames, fps)
    if window.get("error_detail"):
        capture.release()
        return {
            "session": summarize_session(session),
            "marked": [],
            "review": [],
            "off_roster": [],
            "unknown_faces": [],
            "failed": True,
            "detail": window["error_detail"],
            "total_frames": total_frames,
            "duration_seconds": round(window["total_duration"], 2) if window["total_duration"] else 0,
            "window": window["window_label"],
        }
    total_duration = window["total_duration"]
    start_frame = window["start_frame"]
    end_frame = window["end_frame"]
    window_label = window["window_label"]

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
        processing_video_source=processing_video_source or "full_video",
        process_analysis_frame_interval=int(analysis_video_metadata.get("frame_interval_source_frames") or 0) if is_analysis_mod8_video else None,
        process_candidate_windows_total=len(detail_candidate_windows) if use_detail_windows else 0,
        process_window_seconds=round(window_seconds, 2) if window_seconds else None,
        process_detection_max_dimension=detection_max_dimension,
    )

    frame_index = start_frame
    sampled_frames = 0
    rejected_quality_faces = 0
    video_face_groups = []

    def normalize_embedding(embedding):
        query = embedding.astype(np.float32)
        return query / max(np.linalg.norm(query), 1e-12)

    def candidate_identity_key(person: object) -> str:
        name = slugify(str(getattr(person, "full_name", "") or "")).strip("-").lower()
        if person_type(person) == "player" and name:
            return f"player-name:{name}"
        return person_identity_key(person)

    def ranked_candidates(embedding) -> tuple[list[dict], float, float]:
        if reference_matrix.size == 0:
            return [], 0.0, 0.0
        query = normalize_embedding(embedding)
        similarities = reference_matrix @ query
        order = np.argsort(-similarities)
        grouped: dict[str, dict] = {}
        for index in order:
            person = enrolled_people[int(index)]
            similarity = float(similarities[int(index)])
            key = candidate_identity_key(person)
            current = grouped.get(key)
            if current is None:
                grouped[key] = {"student": person, "similarity": similarity}
                continue
            current_is_expected = person_key(current["student"]) in expected_keys
            next_is_expected = person_key(person) in expected_keys
            if similarity > current["similarity"] or (next_is_expected and not current_is_expected):
                grouped[key] = {"student": person, "similarity": similarity}
        candidates = sorted(grouped.values(), key=lambda item: item["similarity"], reverse=True)[:3]
        best = float(candidates[0]["similarity"]) if candidates else 0.0
        second = float(candidates[1]["similarity"]) if len(candidates) > 1 else -1.0
        margin = best - second
        return candidates, best, margin

    def make_observation_from_group(group: dict, face_sample: dict, candidates: list[dict], best_similarity: float, margin: float, reason: str = "") -> dict:
        person = candidates[0]["student"]
        time_payload = frame_time_payload(face_sample["frame_index"], timing_fps, window, session=session)
        time_summary = group_time_summary(group, timing_fps, window)
        def candidate_payload(candidate_person, similarity: float) -> dict:
            identity_members = person_identity_members(candidate_person)
            return {
                "student_id": candidate_person.id,
                "student_name": candidate_person.full_name,
                "person_id": candidate_person.id,
                "person_type": person_type(candidate_person),
                "person_key": person_key(candidate_person),
                "team_id": person_team_id(candidate_person),
                "team_name": person_team_name(candidate_person),
                "is_expected_roster": person_key(candidate_person) in expected_keys,
                "similarity": round(similarity, 4),
                "identity_duplicate_count": len(identity_members),
                "identity_duplicates": [
                    {
                        "person_id": member.id,
                        "person_type": person_type(member),
                        "person_key": person_key(member),
                        "student_name": member.full_name,
                        "team_id": person_team_id(member),
                        "team_name": person_team_name(member),
                        "is_expected_roster": person_key(member) in expected_keys,
                    }
                    for member in identity_members
                    if person_key(member) != person_key(candidate_person)
                ],
            }
        return {
            "student": person,
            "person_type": person_type(person),
            "person_key": person_key(person),
            "is_expected_roster": person_key(person) in expected_keys,
            "count": int(group.get("count") or 1),
            "best_similarity": best_similarity,
            "margin": margin,
            "best_frame": face_sample["frame"],
            "best_bbox": face_sample["bbox"],
            "best_frame_index": face_sample["frame_index"],
            **time_payload,
            **time_summary,
            "embedding": group["centroid"],
            "group_id": group["group_id"],
            "quality": face_sample.get("quality", {}),
            "reason": reason,
            "candidates": [
                candidate_payload(item["student"], item["similarity"])
                for item in candidates
            ],
        }

    def make_unknown_observation_from_group(group: dict, face_sample: dict, best_similarity: float) -> dict:
        time_payload = frame_time_payload(face_sample["frame_index"], timing_fps, window, session=session)
        time_summary = group_time_summary(group, timing_fps, window)
        return {
            "count": int(group.get("count") or 1),
            "best_similarity": best_similarity,
            "best_frame": face_sample["frame"],
            "best_bbox": face_sample["bbox"],
            "best_frame_index": face_sample["frame_index"],
            **time_payload,
            **time_summary,
            "embedding": group["centroid"],
            "group_id": group["group_id"],
            "quality": face_sample.get("quality", {}),
        }

    video_cluster_similarity = float(os.getenv("AUTO_ATTENDANCE_VIDEO_CLUSTER_SIMILARITY", "0.52"))
    group_top_faces = max(1, int(os.getenv("AUTO_ATTENDANCE_CLUSTER_TOP_FACES", "3")))
    max_face_groups = max(1, int(os.getenv("AUTO_ATTENDANCE_MAX_FACE_GROUPS", "80")))
    next_video_group_id = 1

    def add_video_face(face, frame, frame_index: int, quality: dict) -> None:
        nonlocal next_video_group_id
        query = normalize_embedding(face.embedding)
        sample = {
            "embedding": query,
            "frame": frame.copy(),
            "bbox": face.bbox,
            "frame_index": frame_index,
            "quality": quality,
        }
        best_group = None
        best_group_similarity = -1.0
        for group in video_face_groups:
            centroid_similarity = float(np.dot(query, group["centroid"]))
            sample_similarity = max(float(np.dot(query, existing["embedding"])) for existing in group["faces"])
            similarity = max(centroid_similarity, sample_similarity)
            if similarity > best_group_similarity:
                best_group_similarity = similarity
                best_group = group
        if best_group and best_group_similarity >= video_cluster_similarity:
            best_group["count"] += 1
            best_group["sum_embedding"] = best_group["sum_embedding"] + query
            centroid = best_group["sum_embedding"] / max(best_group["count"], 1)
            best_group["centroid"] = centroid / max(np.linalg.norm(centroid), 1e-12)
            best_group["faces"].append(sample)
            best_group["faces"] = sorted(best_group["faces"], key=lambda item: item.get("quality", {}).get("score", 0), reverse=True)[:group_top_faces]
            return
        if len(video_face_groups) >= max_face_groups:
            smallest_group = min(video_face_groups, key=lambda item: (item["count"], item["faces"][0].get("quality", {}).get("score", 0)))
            if quality.get("score", 0) <= smallest_group["faces"][0].get("quality", {}).get("score", 0):
                return
            video_face_groups.remove(smallest_group)
        video_face_groups.append(
            {
                "group_id": next_video_group_id,
                "count": 1,
                "sum_embedding": query.copy(),
                "centroid": query,
                "faces": [sample],
            }
        )
        next_video_group_id += 1

    def process_detected_faces(frame, frame_index: int, detections) -> None:
        nonlocal rejected_quality_faces
        for face in detections:
            quality_ok, quality = face_quality(frame, face)
            if not quality_ok:
                rejected_quality_faces += 1
                continue
            add_video_face(face, frame, frame_index, quality)

    def detect_frame_faces(frame):
        return detect_faces_hybrid(frame, providers_key=providers, max_dimension=detection_max_dimension)

    def detect_frame_face_boxes(frame):
        return detect_face_boxes_hybrid(frame, providers_key=providers, max_dimension=detection_max_dimension)

    use_second_probe = os.getenv("AUTO_ATTENDANCE_SECOND_PROBE", "1").lower() not in {"0", "false", "no", "off"}
    use_window_pipeline = os.getenv("AUTO_ATTENDANCE_WINDOW_PIPELINE", "1").lower() not in {"0", "false", "no", "off"}
    window_queue_size = max(1, int(os.getenv("AUTO_ATTENDANCE_WINDOW_QUEUE_SIZE", "1")))
    dense_frame_stride = max(1, int(os.getenv("AUTO_ATTENDANCE_DENSE_FRAME_STRIDE", "8")))
    frames_per_second = max(1, int(round(fps or 30)))
    probe_window_seconds = max(1, int(os.getenv("AUTO_ATTENDANCE_PROBE_WINDOW_SECONDS", "4")))
    frames_per_probe_window = max(1, int(round((fps or 30) * probe_window_seconds)))
    probed_seconds = 0
    active_seconds = 0
    skipped_seconds = 0
    pipeline_windows_read = 0
    pipeline_windows_processed = 0
    capture_released_by_pipeline = False

    try:
        if is_analysis_mod8_video and fps:
            frame_interval = max(1, int(analysis_video_metadata.get("frame_interval_source_frames") or 8))
            source_fps = float(analysis_video_metadata.get("source_fps_estimate") or 30)
            progress_every = max(1, int(os.getenv("AUTO_ATTENDANCE_ANALYSIS_PROGRESS_EVERY", "30")))
            update_job(
                job,
                phase="processing",
                phase_label="Procesando video de analisis mod8 con buffer por segundo",
                process_pipeline_enabled=True,
                process_pipeline_read_mode="analysis-video-mod8-buffer",
                process_analysis_frame_interval=frame_interval,
                process_analysis_source_fps=round(source_fps, 3),
                process_total_frames=total_frames,
                percent=0,
            )

            def source_frame_for_analysis_index(analysis_index: int) -> int:
                return int(analysis_index * frame_interval)

            def source_second_for_analysis_index(analysis_index: int) -> int:
                return int(source_frame_for_analysis_index(analysis_index) // max(source_fps, 1.0))

            def flush_analysis_second(buffer: list[tuple[int, int, object]], force_progress: bool = False) -> None:
                nonlocal sampled_frames, probed_seconds, active_seconds, skipped_seconds, frame_index, pipeline_windows_processed
                if not buffer:
                    return
                probe_analysis_index, probe_source_frame, probe_frame = buffer[-1]
                probed_seconds += 1
                frame_index = probe_source_frame
                probe_detections = detect_frame_face_boxes(probe_frame)
                sampled_frames += 1
                accepted_probe_detections = [face for face in probe_detections if face_quality(probe_frame, face)[0]]
                if not accepted_probe_detections:
                    skipped_seconds += 1
                    pipeline_windows_processed += 1
                else:
                    active_seconds += 1
                    processed_indices = set()
                    for sample_analysis_index, sample_source_frame, sample_frame in buffer:
                        detections = detect_frame_faces(sample_frame)
                        sampled_frames += 1
                        process_detected_faces(sample_frame, sample_source_frame, detections)
                        processed_indices.add(sample_analysis_index)
                    if probe_analysis_index not in processed_indices:
                        process_detected_faces(probe_frame, probe_source_frame, probe_detections)
                    pipeline_windows_processed += 1

                if force_progress or sampled_frames % progress_every == 0:
                    update_job(
                        job,
                        frame=probe_analysis_index,
                        process_frame=probe_analysis_index,
                        process_total_frames=total_frames,
                        process_sampled_frames=sampled_frames,
                        process_probed_seconds=probed_seconds,
                        process_active_seconds=active_seconds,
                        process_skipped_seconds=skipped_seconds,
                        process_face_groups=len(video_face_groups),
                        process_rejected_faces=rejected_quality_faces,
                        process_pipeline_enabled=True,
                        process_pipeline_windows_read=probed_seconds,
                        process_pipeline_windows_processed=pipeline_windows_processed,
                        process_pipeline_read_mode="analysis-video-mod8-buffer",
                        process_analysis_frame_interval=frame_interval,
                        process_analysis_source_fps=round(source_fps, 3),
                        processing_video_source=processing_video_source,
                        phase="processing",
                        phase_label="Procesando video de analisis mod8 con buffer por segundo",
                        percent=min(99, round((probe_analysis_index / max(total_frames, 1)) * 100, 1)),
                    )

            capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            analysis_index = start_frame
            current_second = None
            second_buffer: list[tuple[int, int, object]] = []
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if end_frame and analysis_index > end_frame:
                    break
                source_second = source_second_for_analysis_index(analysis_index)
                if current_second is None:
                    current_second = source_second
                if source_second != current_second:
                    flush_analysis_second(second_buffer)
                    second_buffer = []
                    current_second = source_second
                second_buffer.append((analysis_index, source_frame_for_analysis_index(analysis_index), frame.copy()))
                analysis_index += 1
            flush_analysis_second(second_buffer, force_progress=True)
        elif use_detail_windows and fps:
            detail_frame_stride = max(1, int(os.getenv("AUTO_ATTENDANCE_DETAIL_FRAME_STRIDE", "6")))
            session_start_second = start_frame / max(fps, 1.0)
            session_end_second = end_frame / max(fps, 1.0)
            normalized_windows = []
            for window_item in detail_candidate_windows:
                try:
                    window_start_second = max(session_start_second, float(window_item.get("start_second")))
                    window_end_second = min(session_end_second, float(window_item.get("end_second")))
                except (TypeError, ValueError, AttributeError):
                    continue
                if window_end_second <= window_start_second:
                    continue
                normalized_windows.append(
                    {
                        "start_second": window_start_second,
                        "end_second": window_end_second,
                        "start_frame": max(start_frame, int(window_start_second * fps)),
                        "end_frame": min(end_frame, int(window_end_second * fps) + 1),
                    }
                )

            total_detail_frames = (
                sum(max(((item["end_frame"] - item["start_frame"]) + detail_frame_stride - 1) // detail_frame_stride, 1) for item in normalized_windows)
                or 1
            )
            processed_detail_frames = 0
            update_job(
                job,
                phase="processing",
                phase_label=f"Procesando original en {len(normalized_windows)} ventanas candidatas",
                process_candidate_windows_total=len(normalized_windows),
                process_candidate_windows_done=0,
                process_pipeline_read_mode="detail-from-proxy",
                processing_video_source=processing_video_source or "full_video_detail_from_proxy",
                process_detail_frame_stride=detail_frame_stride,
                percent=35,
            )

            for window_number, window_item in enumerate(normalized_windows, start=1):
                capture.set(cv2.CAP_PROP_POS_FRAMES, window_item["start_frame"])
                current_frame = window_item["start_frame"]
                window_has_faces = False
                while current_frame <= window_item["end_frame"]:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    if (current_frame - window_item["start_frame"]) % detail_frame_stride == 0:
                        detections = detect_frame_faces(frame)
                        sampled_frames += 1
                        if detections:
                            window_has_faces = True
                        process_detected_faces(frame, current_frame, detections)
                        processed_detail_frames += 1
                    if sampled_frames and sampled_frames % 30 == 0:
                        update_job(
                            job,
                            frame=current_frame,
                            process_frame=current_frame,
                            process_total_frames=total_detail_frames,
                            process_sampled_frames=sampled_frames,
                            process_face_groups=len(video_face_groups),
                            process_rejected_faces=rejected_quality_faces,
                            process_candidate_windows_total=len(normalized_windows),
                            process_candidate_windows_done=window_number - 1,
                            process_pipeline_read_mode="detail-from-proxy",
                            process_detail_frame_stride=detail_frame_stride,
                            phase="processing",
                            phase_label=f"Procesando original en ventana {window_number}/{len(normalized_windows)}",
                            percent=min(99, 35 + round((processed_detail_frames / total_detail_frames) * 64, 1)),
                        )
                    current_frame += 1
                covered_seconds = max(1, int(round(window_item["end_second"] - window_item["start_second"])))
                probed_seconds += covered_seconds
                if window_has_faces:
                    active_seconds += covered_seconds
                else:
                    skipped_seconds += covered_seconds
                update_job(
                    job,
                    frame=min(window_item["end_frame"], end_frame),
                    process_frame=min(window_item["end_frame"], end_frame),
                    process_total_frames=total_detail_frames,
                    process_sampled_frames=sampled_frames,
                    process_probed_seconds=probed_seconds,
                    process_active_seconds=active_seconds,
                    process_skipped_seconds=skipped_seconds,
                    process_face_groups=len(video_face_groups),
                    process_rejected_faces=rejected_quality_faces,
                    process_candidate_windows_total=len(normalized_windows),
                    process_candidate_windows_done=window_number,
                    process_pipeline_read_mode="detail-from-proxy",
                    process_detail_frame_stride=detail_frame_stride,
                    phase="processing",
                    phase_label=f"Procesando original en ventana {window_number}/{len(normalized_windows)}",
                    percent=min(99, 35 + round((processed_detail_frames / total_detail_frames) * 64, 1)),
                )
        elif is_frame_proxy and fps:
            proxy_sample_every = max(1, int(os.getenv("AUTO_ATTENDANCE_FRAME_PROXY_SAMPLE_EVERY", "1")))
            proxy_progress_every = max(1, int(os.getenv("AUTO_ATTENDANCE_FRAME_PROXY_PROGRESS_EVERY", "10")))
            window_total = max(end_frame - start_frame, 1)
            capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            frame_index = start_frame
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if end_frame and frame_index > end_frame:
                    break
                if (frame_index - start_frame) % proxy_sample_every != 0:
                    frame_index += 1
                    continue
                detections = detect_frame_faces(frame)
                sampled_frames += 1
                probed_seconds += max(1, int(round(proxy_sample_every / max(fps, 1))))
                if detections:
                    active_seconds += max(1, int(round(proxy_sample_every / max(fps, 1))))
                    process_detected_faces(frame, frame_index, detections)
                else:
                    skipped_seconds += max(1, int(round(proxy_sample_every / max(fps, 1))))

                if sampled_frames % proxy_progress_every == 0 or frame_index >= end_frame:
                    window_done = max(frame_index - start_frame, 0)
                    update_job(
                        job,
                        frame=frame_index,
                        process_frame=frame_index,
                        process_total_frames=window_total,
                        process_sampled_frames=sampled_frames,
                        process_probed_seconds=probed_seconds,
                        process_active_seconds=active_seconds,
                        process_skipped_seconds=skipped_seconds,
                        process_face_groups=len(video_face_groups),
                        process_rejected_faces=rejected_quality_faces,
                        process_pipeline_enabled=False,
                        process_pipeline_read_mode="frame-proxy-1fps",
                        processing_video_source=processing_video_source,
                        phase="processing",
                        phase_label="Analizando proxy 1 FPS desde Drive",
                        percent=min(99, round((window_done / window_total) * 100, 1)),
                    )
                frame_index += 1
        elif use_second_probe and fps:
            window_total = max(end_frame - start_frame, 1)

            def update_probe_window_progress(current_frame: int, queue_size: int = 0) -> None:
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
                    process_face_groups=len(video_face_groups),
                    process_rejected_faces=rejected_quality_faces,
                    process_pipeline_enabled=use_window_pipeline,
                    process_pipeline_queue_size=queue_size,
                    process_pipeline_windows_read=pipeline_windows_read,
                    process_pipeline_windows_processed=pipeline_windows_processed,
                    process_pipeline_read_mode="grab-sampled",
                    phase="processing",
                    phase_label=(
                        f"Pipeline lectura/deteccion en bloques de {probe_window_seconds} segundos"
                        if use_window_pipeline
                        else f"Lectura secuencial en bloques de {probe_window_seconds} segundos con deteccion previa"
                    ),
                    percent=min(99, round((window_done / window_total) * 100, 1)),
                )

            def read_probe_window(current_frame: int):
                probe_window_start = current_frame
                probe_window_end = min(end_frame, probe_window_start + frames_per_probe_window - 1)
                probe_window_frames = max(1, probe_window_end - probe_window_start + 1)
                probe_frame = min(probe_window_end, probe_window_start + probe_window_frames // 2)
                dense_samples = []
                probe_image = None
                while current_frame <= probe_window_end:
                    needs_dense_sample = (current_frame - probe_window_start) % dense_frame_stride == 0
                    needs_probe_frame = current_frame == probe_frame
                    if needs_dense_sample or needs_probe_frame:
                        ok, frame = capture.read()
                        if not ok:
                            break
                        stored_frame = frame.copy()
                        if needs_dense_sample:
                            dense_samples.append((current_frame, stored_frame))
                        if needs_probe_frame:
                            probe_image = stored_frame
                    else:
                        ok = capture.grab()
                        if not ok:
                            break
                    current_frame += 1

                last_frame_read = current_frame - 1
                if last_frame_read < probe_window_start:
                    return None, current_frame
                if probe_image is None:
                    if not dense_samples:
                        return None, current_frame
                    probe_frame, probe_image = dense_samples[len(dense_samples) // 2]
                return {
                    "probe_window_start": probe_window_start,
                    "probe_window_end": probe_window_end,
                    "probe_frame": probe_frame,
                    "probe_image": probe_image,
                    "dense_samples": dense_samples,
                    "last_frame_read": last_frame_read,
                }, current_frame

            def process_probe_window(window_item: dict, queue_size: int = 0) -> None:
                nonlocal sampled_frames, probed_seconds, active_seconds, skipped_seconds, frame_index, pipeline_windows_processed
                probe_frame = window_item["probe_frame"]
                probe_image = window_item["probe_image"]
                dense_samples = window_item["dense_samples"]
                last_frame_read = window_item["last_frame_read"]
                frames_read = max(last_frame_read - window_item["probe_window_start"] + 1, 1)
                probe_window_duration = max(1, int(round(frames_read / max(fps, 1))))
                probed_seconds += probe_window_duration
                frame_index = probe_frame
                probe_detections = detect_frame_face_boxes(probe_image)
                sampled_frames += 1
                accepted_probe_detections = [face for face in probe_detections if face_quality(probe_image, face)[0]]
                if not accepted_probe_detections:
                    skipped_seconds += probe_window_duration
                    frame_index = last_frame_read
                    pipeline_windows_processed += 1
                    update_probe_window_progress(last_frame_read, queue_size=queue_size)
                    return
                active_seconds += probe_window_duration

                processed_indices = set()
                for sample_frame_index, sample_frame in dense_samples:
                    detections = detect_frame_faces(sample_frame)
                    sampled_frames += 1
                    process_detected_faces(sample_frame, sample_frame_index, detections)
                    processed_indices.add(sample_frame_index)

                if probe_frame not in processed_indices:
                    process_detected_faces(probe_image, probe_frame, detect_frame_faces(probe_image))

                frame_index = last_frame_read
                pipeline_windows_processed += 1
                update_probe_window_progress(last_frame_read, queue_size=queue_size)

            if use_window_pipeline:
                capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
                capture_released_by_pipeline = True
                window_queue = queue.Queue(maxsize=window_queue_size)
                sentinel = object()
                producer_errors = []

                def produce_windows() -> None:
                    nonlocal pipeline_windows_read
                    current_frame = start_frame
                    try:
                        while current_frame <= end_frame:
                            window_item, current_frame = read_probe_window(current_frame)
                            if window_item is None:
                                break
                            pipeline_windows_read += 1
                            window_queue.put(window_item)
                    except Exception as exc:
                        producer_errors.append(exc)
                    finally:
                        try:
                            capture.release()
                        finally:
                            window_queue.put(sentinel)

                producer = threading.Thread(target=produce_windows, name=f"auto-attendance-reader-{job.get('id', '')[:8]}", daemon=True)
                producer.start()
                while True:
                    window_item = window_queue.get()
                    if window_item is sentinel:
                        break
                    process_probe_window(window_item, queue_size=window_queue.qsize())
                producer.join(timeout=5)
                if producer_errors:
                    raise producer_errors[0]
            else:
                capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
                current_frame = start_frame
                while current_frame <= end_frame:
                    window_item, current_frame = read_probe_window(current_frame)
                    if window_item is None:
                        break
                    pipeline_windows_read += 1
                    process_probe_window(window_item)
        else:
            capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            frame_index = start_frame
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if end_frame and frame_index > end_frame:
                    break
                if (frame_index - start_frame) % sample_every != 0:
                    frame_index += 1
                    continue
                sampled_frames += 1
                process_detected_faces(frame, frame_index, detect_frame_faces(frame))

                if sampled_frames % 5 == 0 and total_frames:
                    window_total = max(end_frame - start_frame, 1)
                    window_done = max(frame_index - start_frame, 0)
                    update_job(
                        job,
                        frame=frame_index,
                        process_frame=frame_index,
                        process_total_frames=window_total,
                        process_sampled_frames=sampled_frames,
                        process_face_groups=len(video_face_groups),
                        process_rejected_faces=rejected_quality_faces,
                        phase="processing",
                        phase_label="Procesando frames del video",
                        percent=min(99, round((window_done / window_total) * 100, 1)),
                    )
                frame_index += 1
    finally:
        if not capture_released_by_pipeline:
            capture.release()

    accepted_observations = []
    review_observations = []
    unknown_observations = []
    for group in sorted(video_face_groups, key=lambda item: item["count"], reverse=True):
        best_match = None
        for face_sample in group["faces"]:
            candidates, best_similarity, margin = ranked_candidates(face_sample["embedding"])
            if not candidates:
                continue
            candidate_match = {
                "face_sample": face_sample,
                "candidates": candidates,
                "best_similarity": best_similarity,
                "margin": margin,
            }
            if best_match is None or best_similarity > best_match["best_similarity"]:
                best_match = candidate_match
        if best_match is None or best_match["best_similarity"] < review_threshold:
            unknown_observations.append(make_unknown_observation_from_group(group, group["faces"][0], best_match["best_similarity"] if best_match else 0.0))
            continue
        if best_match["best_similarity"] >= threshold and best_match["margin"] >= min_margin:
            accepted_observations.append(
                make_observation_from_group(
                    group,
                    best_match["face_sample"],
                    best_match["candidates"],
                    best_match["best_similarity"],
                    best_match["margin"],
                )
            )
        else:
            reason = "Similitud baja" if best_match["best_similarity"] < threshold else "Margen bajo contra el segundo candidato"
            review_observations.append(
                make_observation_from_group(
                    group,
                    best_match["face_sample"],
                    best_match["candidates"],
                    best_match["best_similarity"],
                    best_match["margin"],
                    reason,
                )
            )

    return build_video_session_result(
        session=session,
        user=user,
        video_path=video_path,
        job=job,
        skipped=skipped,
        accepted_observations=accepted_observations,
        review_observations=review_observations,
        unknown_observations=unknown_observations,
        scan_metrics={
            "sampled_frames": sampled_frames,
            "probed_seconds": probed_seconds,
            "active_seconds": active_seconds,
            "skipped_seconds": skipped_seconds,
            "face_groups": len(video_face_groups),
            "rejected_quality_faces": rejected_quality_faces,
            "total_frames": total_frames,
            "total_duration": total_duration,
            "window_label": window_label,
            "use_second_probe": use_second_probe,
            "probe_window_seconds": probe_window_seconds,
            "dense_frame_stride": dense_frame_stride,
            "video_cluster_similarity": video_cluster_similarity,
            "group_top_faces": group_top_faces,
            "max_face_groups": max_face_groups,
            "processing_video_source": processing_video_source or "full_video",
            "frame_proxy": is_frame_proxy,
            "analysis_video_mod8": is_analysis_mod8_video,
            "analysis_frame_interval": int(analysis_video_metadata.get("frame_interval_source_frames") or 0) if is_analysis_mod8_video else 0,
            "detail_candidate_windows": len(detail_candidate_windows) if use_detail_windows else 0,
            "detection_max_dimension": detection_max_dimension,
        },
        threshold=threshold,
        min_margin=min_margin,
        min_hits=min_hits,
        review_threshold=review_threshold,
        duplicate_guard_similarity=duplicate_guard_similarity,
        max_review_items=max_review_items,
        max_unknown_items=max_unknown_items,
    )
