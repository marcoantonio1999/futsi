from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time as time_module
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import close_old_connections
from django.http import FileResponse
from django.utils import timezone
from django.utils.text import get_valid_filename

from .common import *
from core.file_security import (
    FileSecurityError,
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS as SECURE_VIDEO_EXTENSIONS,
    VIDEO_MIME_TYPES,
    resolve_child_path,
    secure_file_response,
    validate_job_id,
    validate_upload,
)
from core.services.face_insight import build_student_database, detect_embeddings


VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}
ACTIVE_STUDENT_STATUSES = ["trial", "active", "paused", "injured"]
JOB_LOCK = threading.Lock()


def occupancy_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "video_occupancy"


def pending_dir() -> Path:
    return occupancy_root() / "pendientes"


def processed_dir(job_id: str) -> Path:
    return occupancy_root() / "procesados" / job_id


def error_dir(job_id: str) -> Path:
    return occupancy_root() / "errores" / job_id


def jobs_dir() -> Path:
    return occupancy_root() / "jobs"


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
        return json.loads(path.read_text(encoding="utf-8"))
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


def pending_videos() -> list[dict]:
    ensure_dirs()
    videos = []
    for path in sorted(pending_dir().rglob("*"), key=lambda item: item.stat().st_mtime):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        videos.append(
            {
                "filename": path.name,
                "path": str(path),
                "size": path.stat().st_size,
                "modified_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.get_current_timezone()).isoformat(),
                "metadata": read_json(sidecar_path(path), {}),
            }
        )
    return videos


def safe_filename(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", text).strip("_") or "item"


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


def save_face_evidence(entry: dict, job: dict, category: str, name: str) -> str:
    import cv2

    crop = crop_face_from_frame(entry.get("best_frame"), entry.get("best_bbox"))
    if crop is None:
        return ""
    evidence_dir = processed_dir(job["id"]) / "evidence" / category
    evidence_dir.mkdir(parents=True, exist_ok=True)
    crop_resized = cv2.resize(crop, (220, 220))
    filename = f"{safe_filename(name)}_hits_{entry.get('count', 1)}_frame_{entry.get('best_frame_index', 0)}.jpg"
    output_path = evidence_dir / filename
    cv2.imwrite(str(output_path), crop_resized)
    return str(output_path)


def evidence_url(request, job_id: str, evidence_path: str) -> str:
    if not evidence_path:
        return ""
    try:
        relative_path = Path(evidence_path).resolve().relative_to(processed_dir(job_id).resolve()).as_posix()
    except Exception:
        return ""
    path = f"/api/video-occupancy/evidence/{job_id}/{quote(relative_path, safe='/')}"
    return request.build_absolute_uri(path) if request else path


def hydrate_job_evidence_urls(job: dict, request) -> dict:
    hydrated = json.loads(json.dumps(job)) if job else job
    if not hydrated:
        return hydrated
    job_id = hydrated.get("id", "")
    for result in hydrated.get("results", []) or []:
        for key in ["identified", "unknown"]:
            for item in result.get(key, []) or []:
                item["evidence_url"] = evidence_url(request, job_id, item.get("evidence_path", ""))
    return hydrated


def occupancy_roster(site_id: int | None = None) -> list[object]:
    students = Student.objects.filter(status__in=ACTIVE_STUDENT_STATUSES)
    if site_id:
        students = students.filter(site_id=site_id)
    people: list[object] = list(students)
    players = Player.objects.filter(is_active=True)
    if site_id:
        players = players.filter(team__tournament__site_id=site_id)
    people.extend(players)
    return people


def person_label(person: object) -> str:
    if isinstance(person, Player):
        team_name = person.team.name if getattr(person, "team_id", None) else "Equipo adulto"
        return f"{person.full_name} ({team_name})"
    return getattr(person, "full_name", str(person))


def process_video_for_occupancy(video_path: Path, metadata: dict, job: dict) -> dict:
    import cv2
    import numpy as np

    providers = os.getenv("FACE_PROVIDERS", "auto")
    threshold = float(metadata.get("threshold") or os.getenv("VIDEO_OCCUPANCY_THRESHOLD", os.getenv("FACE_MATCH_THRESHOLD", "0.35")))
    min_margin = float(metadata.get("min_margin") or os.getenv("VIDEO_OCCUPANCY_MIN_MARGIN", "0.03"))
    min_hits = int(metadata.get("min_hits") or os.getenv("VIDEO_OCCUPANCY_MIN_HITS", "2"))
    sample_every = max(1, int(metadata.get("sample_every") or os.getenv("VIDEO_OCCUPANCY_SAMPLE_EVERY", "15")))
    duration_minutes = max(1, int(metadata.get("duration_minutes") or os.getenv("VIDEO_OCCUPANCY_DURATION_MINUTES", "120")))
    start_minute = max(0, int(metadata.get("start_minute") or 0))
    alert_threshold = max(1, int(metadata.get("alert_threshold") or os.getenv("VIDEO_OCCUPANCY_ALERT_THRESHOLD", "10")))
    unknown_duplicate_similarity = float(os.getenv("VIDEO_OCCUPANCY_UNKNOWN_DUPLICATE_GUARD", "0.38"))
    max_unknown_items = int(os.getenv("VIDEO_OCCUPANCY_MAX_UNKNOWN_ITEMS", "40"))
    site_id = int(metadata.get("site_id") or 0) or None

    roster = occupancy_roster(site_id)
    enrolled_people, reference_matrix, skipped = build_student_database(roster, providers_key=providers)
    if reference_matrix.size == 0:
        return {
            "video": video_path.name,
            "failed": True,
            "detail": "No hay fotos validas en la base de datos para comparar.",
            "identified": [],
            "unknown": [],
            "skipped": skipped[:20],
            "unique_people": 0,
            "alert": False,
            "alert_threshold": alert_threshold,
        }

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return {"video": video_path.name, "failed": True, "detail": "No se pudo abrir el video.", "identified": [], "unknown": []}

    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    total_duration = total_frames / fps if total_frames and fps else 0
    start_frame = int(start_minute * 60 * fps) if fps else 0
    end_frame = int((start_minute + duration_minutes) * 60 * fps) if fps else total_frames
    if total_frames:
        end_frame = min(end_frame, total_frames)
    if start_frame > 0:
        capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    frame_index = start_frame
    sampled_frames = 0
    matched_observations = []
    unknown_observations = []

    def ranked_candidates(embedding) -> tuple[list[dict], float, float]:
        query = embedding.astype(np.float32)
        query = query / max(np.linalg.norm(query), 1e-12)
        similarities = reference_matrix @ query
        order = np.argsort(-similarities)[:3]
        best = float(similarities[order[0]]) if len(order) else 0.0
        second = float(similarities[order[1]]) if len(order) > 1 else -1.0
        candidates = [
            {
                "person": enrolled_people[int(index)],
                "similarity": float(similarities[int(index)]),
            }
            for index in order
        ]
        return candidates, best, best - second

    try:
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

            for face in detect_embeddings(frame, providers_key=providers):
                candidates, best_similarity, margin = ranked_candidates(face.embedding)
                if candidates and best_similarity >= threshold and margin >= min_margin:
                    person = candidates[0]["person"]
                    matched_observations.append(
                        {
                            "person": person,
                            "count": 1,
                            "best_similarity": best_similarity,
                            "margin": margin,
                            "best_frame": frame.copy(),
                            "best_bbox": face.bbox,
                            "best_frame_index": frame_index,
                            "candidates": [
                                {"id": item["person"].id, "name": person_label(item["person"]), "similarity": round(item["similarity"], 4)}
                                for item in candidates
                            ],
                        }
                    )
                else:
                    unknown_observations.append(
                        {
                            "count": 1,
                            "best_similarity": best_similarity,
                            "best_frame": frame.copy(),
                            "best_bbox": face.bbox,
                            "best_frame_index": frame_index,
                            "embedding": face.embedding,
                        }
                    )
            if sampled_frames % 5 == 0 and total_frames:
                window_total = max(end_frame - start_frame, 1)
                window_done = max(frame_index - start_frame, 0)
                update_job(job, frame=frame_index, percent=min(99, round((window_done / window_total) * 100, 1)))
    finally:
        capture.release()

    identified_by_key: dict[str, dict] = {}
    for observation in sorted(matched_observations, key=lambda item: item["best_similarity"], reverse=True):
        person = observation["person"]
        key = f"{person.__class__.__name__}:{person.id}"
        current = identified_by_key.get(key)
        if current is None:
            identified_by_key[key] = observation
            continue
        current["count"] += 1
        if observation["best_similarity"] > current["best_similarity"]:
            observation["count"] = current["count"]
            identified_by_key[key] = observation

    identified_payload = []
    for entry in sorted(identified_by_key.values(), key=lambda item: item["count"], reverse=True):
        if entry["count"] < min_hits:
            continue
        person = entry["person"]
        evidence_path = save_face_evidence(entry, job, "identified", person_label(person))
        identified_payload.append(
            {
                "id": person.id,
                "type": "player" if isinstance(person, Player) else "student",
                "name": person_label(person),
                "hits": entry["count"],
                "similarity": round(entry["best_similarity"], 4),
                "margin": round(entry["margin"], 4),
                "frame": entry.get("best_frame_index", 0),
                "evidence_path": evidence_path,
                "candidates": entry.get("candidates", []),
            }
        )

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

    unknown_payload = []
    for index, entry in enumerate(sorted(unknown_groups, key=lambda item: item["count"], reverse=True)[:max_unknown_items], start=1):
        if entry["count"] < min_hits:
            continue
        evidence_path = save_face_evidence(entry, job, "unknown", f"unknown_{index}")
        unknown_payload.append(
            {
                "unknown_id": index,
                "hits": entry.get("count", 1),
                "similarity": round(entry.get("best_similarity", 0.0), 4),
                "frame": entry.get("best_frame_index", 0),
                "evidence_path": evidence_path,
            }
        )

    unique_people = len(identified_payload) + len(unknown_payload)
    return {
        "video": video_path.name,
        "site_id": site_id,
        "duration_seconds": round(total_duration, 2) if total_duration else None,
        "window": f"{start_minute}-{start_minute + duration_minutes} min",
        "sampled_frames": sampled_frames,
        "total_frames": total_frames,
        "identified": identified_payload,
        "unknown": unknown_payload,
        "unique_people": unique_people,
        "alert": unique_people > alert_threshold,
        "alert_threshold": alert_threshold,
        "thresholds": {
            "similarity": threshold,
            "margin": min_margin,
            "min_hits": min_hits,
            "sample_every": sample_every,
        },
        "skipped": skipped[:20],
    }


def move_finished_video(video_path: Path, job_id: str, failed: bool) -> None:
    target_dir = error_dir(job_id) if failed else processed_dir(job_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / video_path.name
    shutil.move(str(video_path), str(target))
    metadata_path = sidecar_path(video_path)
    if metadata_path.exists():
        shutil.move(str(metadata_path), str(sidecar_path(target)))


def process_pending_worker(job_id: str) -> None:
    close_old_connections()
    job = read_job(job_id)
    if not job:
        return
    try:
        videos = [Path(item["path"]) for item in pending_videos()]
        update_job(job, status="processing", total=len(videos), processed=0, percent=0, results=[])
        results = []
        for index, video_path in enumerate(videos, start=1):
            if not video_path.exists():
                continue
            metadata = read_json(sidecar_path(video_path), {})
            update_job(job, current_video=video_path.name, processed=index - 1, percent=0)
            failed = False
            try:
                result = process_video_for_occupancy(video_path, metadata, job)
                failed = bool(result.get("failed"))
            except Exception as exc:
                failed = True
                result = {"video": video_path.name, "failed": True, "detail": str(exc), "identified": [], "unknown": [], "unique_people": 0}
            results.append(result)
            move_finished_video(video_path, job_id, failed)
            update_job(job, processed=index, percent=round((index / max(len(videos), 1)) * 100, 1), results=results)
        status_value = "error" if results and all(result.get("failed") for result in results) else "done"
        detail = "Todos los videos de aforo fallaron." if status_value == "error" else ""
        update_job(job, status=status_value, current_video=None, percent=100, detail=detail, completed_at=timezone.now().isoformat(), results=results)
    except Exception as exc:
        update_job(job, status="error", detail=str(exc), completed_at=timezone.now().isoformat())
    finally:
        close_old_connections()


class VideoOccupancyStatusView(APIView):
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
                "root": str(occupancy_root()),
                "pending_dir": str(pending_dir()),
                "pending": pending_videos(),
                "active_job": hydrate_job_evidence_urls(current_job, request) if current_job else None,
                "jobs": latest_jobs,
            }
        )


class VideoOccupancyUploadView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request):
        if not is_local_enabled():
            return Response({"detail": "El procesamiento local no esta habilitado en este entorno."}, status=status.HTTP_403_FORBIDDEN)
        upload = request.FILES.get("video")
        if not upload:
            return Response({"detail": "Sube un archivo de video."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_upload(
                upload,
                allowed_extensions=SECURE_VIDEO_EXTENSIONS,
                allowed_mime_types=VIDEO_MIME_TYPES,
                max_bytes=settings.FILE_UPLOAD_MAX_VIDEO_BYTES,
            )
        except FileSecurityError as exc:
            return Response({"detail": exc.detail}, status=exc.status_code)

        metadata = {
            "source": "upload",
            "original_filename": upload.name,
            "uploaded_by": request.user.id,
            "uploaded_at": timezone.now().isoformat(),
            "site_id": request.data.get("site") or None,
            "recorded_date": request.data.get("recorded_date") or None,
            "start_minute": request.data.get("start_minute") or 0,
            "duration_minutes": request.data.get("duration_minutes") or 120,
            "alert_threshold": request.data.get("alert_threshold") or 10,
        }

        ensure_dirs()
        filename = f"{timezone.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}-{get_valid_filename(upload.name)}"
        site_folder = str(request.data.get("site") or "sin-sede")
        relative_path = Path("video_occupancy") / "pendientes" / site_folder / filename
        saved_path = Path(default_storage.save(str(relative_path), upload))
        full_path = Path(settings.MEDIA_ROOT) / saved_path
        write_json(sidecar_path(full_path), metadata)
        return Response({"pending": pending_videos(), "uploaded": {"filename": full_path.name, "metadata": metadata}}, status=status.HTTP_201_CREATED)


class VideoOccupancyProcessView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request):
        if not is_local_enabled():
            return Response({"detail": "El procesamiento local no esta habilitado en este entorno."}, status=status.HTTP_403_FORBIDDEN)
        ensure_dirs()
        if not pending_videos():
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
                "total": len(pending_videos()),
                "processed": 0,
                "percent": 0,
                "results": [],
            }
            write_json(job_path(job["id"]), job)
            thread = threading.Thread(target=process_pending_worker, args=(job["id"],), daemon=True)
            thread.start()
        return Response(job, status=status.HTTP_202_ACCEPTED)


class VideoOccupancyJobView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, job_id: str):
        job = read_job(job_id)
        if not job:
            return Response({"detail": "El trabajo no existe."}, status=status.HTTP_404_NOT_FOUND)
        return Response(hydrate_job_evidence_urls(job, request))


class VideoOccupancyEvidenceView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, job_id: str, evidence_path: str):
        try:
            validate_job_id(job_id)
            target = resolve_child_path(processed_dir(job_id), evidence_path)
            return secure_file_response(
                target,
                allowed_extensions=IMAGE_EXTENSIONS,
                max_bytes=settings.FILE_EVIDENCE_MAX_IMAGE_BYTES,
                content_type="image/jpeg",
                retention_days=settings.FILE_EVIDENCE_RETENTION_DAYS,
            )
        except FileSecurityError:
            return Response({"detail": "La evidencia no existe."}, status=status.HTTP_404_NOT_FOUND)
