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
from .automatic_attendance_results import build_video_session_result
from .automatic_attendance_scan import face_quality, resolve_video_window


def process_video_for_session(video_path: Path, session: AttendanceSession, user: User, job: dict, metadata: dict | None = None) -> dict:
    import cv2
    import numpy as np

    update_job(job, phase="preparing", phase_label="Cargando referencias de rostros")

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

    roster = roster_for_session(session)
    expected_keys = expected_roster_keys(session)
    reference_status = roster_reference_status(session)
    comparison_status = comparison_reference_status(session)
    if comparison_status["configured_count"] == 0:
        return {
            "session": summarize_session(session),
            "marked": [],
            "review": [],
            "off_roster": [],
            "unknown_faces": [],
            "failed": False,
            "detail": "Sesion omitida: no hay fotos locales o privadas configuradas para comparar.",
            "skipped": comparison_status["missing"][:10],
        }

    enrolled_people, reference_matrix, skipped = build_student_database(comparison_roster_for_session(session), providers_key=providers)
    if reference_matrix.size == 0:
        return {"session": summarize_session(session), "marked": [], "review": [], "off_roster": [], "unknown_faces": [], "failed": True, "detail": "No hay fotos validas para comparar.", "skipped": skipped[:10]}

    update_job(job, phase="preparing", phase_label="Abriendo video local")

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return {"session": summarize_session(session), "marked": [], "review": [], "off_roster": [], "unknown_faces": [], "failed": True, "detail": "No se pudo abrir el video."}

    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    metadata = metadata or {}
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
        process_window_seconds=round(window_seconds, 2) if window_seconds else None,
    )

    frame_index = start_frame
    sampled_frames = 0
    rejected_quality_faces = 0
    video_face_groups = []

    def normalize_embedding(embedding):
        query = embedding.astype(np.float32)
        return query / max(np.linalg.norm(query), 1e-12)

    def ranked_candidates(embedding) -> tuple[list[dict], float, float]:
        query = normalize_embedding(embedding)
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

    def make_observation_from_group(group: dict, face_sample: dict, candidates: list[dict], best_similarity: float, margin: float, reason: str = "") -> dict:
        person = candidates[0]["student"]
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
            "embedding": group["centroid"],
            "group_id": group["group_id"],
            "quality": face_sample.get("quality", {}),
            "reason": reason,
            "candidates": [
                {
                    "student_id": item["student"].id,
                    "student_name": item["student"].full_name,
                    "person_id": item["student"].id,
                    "person_type": person_type(item["student"]),
                    "person_key": person_key(item["student"]),
                    "team_id": person_team_id(item["student"]),
                    "team_name": person_team_name(item["student"]),
                    "is_expected_roster": person_key(item["student"]) in expected_keys,
                    "similarity": round(item["similarity"], 4),
                }
                for item in candidates
            ],
        }

    def make_unknown_observation_from_group(group: dict, face_sample: dict, best_similarity: float) -> dict:
        return {
            "count": int(group.get("count") or 1),
            "best_similarity": best_similarity,
            "best_frame": face_sample["frame"],
            "best_bbox": face_sample["bbox"],
            "best_frame_index": face_sample["frame_index"],
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

    use_second_probe = os.getenv("AUTO_ATTENDANCE_SECOND_PROBE", "1").lower() not in {"0", "false", "no", "off"}
    dense_frame_stride = max(1, int(os.getenv("AUTO_ATTENDANCE_DENSE_FRAME_STRIDE", "8")))
    frames_per_second = max(1, int(round(fps or 30)))
    probe_window_seconds = max(1, int(os.getenv("AUTO_ATTENDANCE_PROBE_WINDOW_SECONDS", "4")))
    frames_per_probe_window = max(1, int(round((fps or 30) * probe_window_seconds)))
    probed_seconds = 0
    active_seconds = 0
    skipped_seconds = 0

    try:
        if use_second_probe and fps:
            probe_window_start = start_frame
            window_total = max(end_frame - start_frame, 1)

            def update_probe_window_progress(current_frame: int) -> None:
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
                    phase="processing",
                    phase_label=f"Procesando en bloques de {probe_window_seconds} segundos con deteccion previa",
                    percent=min(99, round((window_done / window_total) * 100, 1)),
                )

            while probe_window_start <= end_frame:
                probe_window_end = min(end_frame, probe_window_start + frames_per_probe_window - 1)
                probe_window_frames = max(1, probe_window_end - probe_window_start + 1)
                probe_window_duration = max(1, int(round(probe_window_frames / max(fps, 1))))
                probe_frame = min(probe_window_end, probe_window_start + probe_window_frames // 2)
                capture.set(cv2.CAP_PROP_POS_FRAMES, probe_frame)
                ok, probe_image = capture.read()
                if not ok:
                    break

                probed_seconds += probe_window_duration
                frame_index = probe_frame
                probe_detections = detect_embeddings(probe_image, providers_key=providers)
                if not probe_detections:
                    sampled_frames += 1
                    skipped_seconds += probe_window_duration
                    frame_index = probe_window_end
                    update_probe_window_progress(frame_index)
                    probe_window_start += frames_per_probe_window
                    continue
                active_seconds += probe_window_duration

                capture.set(cv2.CAP_PROP_POS_FRAMES, probe_window_start)
                current_frame = probe_window_start
                while current_frame <= probe_window_end:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    if (current_frame - probe_window_start) % dense_frame_stride == 0:
                        if current_frame == probe_frame:
                            detections = probe_detections
                            frame_to_store = probe_image
                        else:
                            detections = detect_embeddings(frame, providers_key=providers)
                            frame_to_store = frame
                        sampled_frames += 1
                        process_detected_faces(frame_to_store, current_frame, detections)
                    current_frame += 1

                frame_index = probe_window_end
                update_probe_window_progress(frame_index)
                probe_window_start += frames_per_probe_window
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
                        process_face_groups=len(video_face_groups),
                        process_rejected_faces=rejected_quality_faces,
                        phase="processing",
                        phase_label="Procesando frames del video",
                        percent=min(99, round((window_done / window_total) * 100, 1)),
                    )
    finally:
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
        },
        threshold=threshold,
        min_margin=min_margin,
        min_hits=min_hits,
        review_threshold=review_threshold,
        duplicate_guard_similarity=duplicate_guard_similarity,
        max_review_items=max_review_items,
        max_unknown_items=max_unknown_items,
    )
