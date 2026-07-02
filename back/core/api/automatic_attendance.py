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
from .automatic_attendance_processor import *
from .automatic_attendance_worker import *
from .automatic_attendance_cache_worker import cache_pending_videos_worker
from .automatic_attendance_local_cache import local_cache_summary
from .automatic_attendance_neighbors import expand_requested_path_with_neighbors, pending_video_matches_any_request


class AutomaticAttendanceStatusView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request):
        ensure_dirs()
        expire_stale_jobs()
        view_mode = request.query_params.get("mode") or request.query_params.get("view") or ""
        session_filter = request.query_params.get("session_id")

        def job_matches_session(job: dict) -> bool:
            if not session_filter:
                return True
            for result in job.get("results", []) or []:
                for session_result in result.get("sessions", []) or []:
                    if str(session_result.get("session", {}).get("id")) == str(session_filter):
                        return True
            return False

        latest_jobs = []
        for path in sorted(jobs_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[:30]:
            raw_job = read_json(path, {})
            if job_matches_session(raw_job):
                latest_jobs.append(hydrate_job_evidence_urls(raw_job, request))
        current_job = active_job()
        active_payload = hydrate_job_evidence_urls(current_job, request) if current_job and job_matches_session(current_job) else None
        if view_mode == "report":
            return Response(
                {
                    "enabled": is_local_enabled(),
                    "root": str(automatic_root()),
                    "pending_dir": str(pending_dir()),
                    "pending": [],
                    "video_clips": [],
                    "reprocessable": [],
                    "local_cache": local_cache_summary(),
                    "active_job": active_payload,
                    "jobs": latest_jobs,
                }
            )
        return Response(
            {
                "enabled": is_local_enabled(),
                "root": str(automatic_root()),
                "pending_dir": str(pending_dir()),
                "pending": pending_videos(),
                "video_clips": video_clip_monitor_items(),
                "reprocessable": recent_reprocessable_videos(),
                "local_cache": local_cache_summary(),
                "active_job": active_payload,
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
        requested_paths = expand_requested_path_with_neighbors(requested_path) if requested_path else []
        pending = pending_videos()
        if requested_path:
            pending = [item for item in pending if pending_video_matches_any_request(item, requested_paths)]
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
                "heartbeat_at": timezone.now().isoformat(),
                "worker_pid": PROCESS_ID,
                "created_by": request.user.id,
                "target_path": requested_path,
                "target_paths": requested_paths,
                "neighbor_expanded": bool(requested_paths and len(requested_paths) > 1),
                "total": len(pending),
                "processed": 0,
                "percent": 0,
                "results": [],
            }
            write_json(job_path(job["id"]), job)
            thread = threading.Thread(target=process_pending_worker, args=(job["id"], request.user.id, requested_path, requested_paths), daemon=True)
            thread.start()
        return Response(job, status=status.HTTP_202_ACCEPTED)


class AutomaticAttendanceDownloadPendingView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def post(self, request):
        if not is_local_enabled():
            return Response({"detail": "El procesamiento local no esta habilitado en este entorno."}, status=status.HTTP_403_FORBIDDEN)
        ensure_dirs()
        requested_path = request.data.get("path") or None
        pending = [item for item in pending_videos() if item.get("source") == "drive"]
        if requested_path:
            pending = [item for item in pending if pending_video_matches_request(item, requested_path)]
            if not pending:
                return Response({"detail": "El video pendiente seleccionado ya no existe o ya esta local."}, status=status.HTTP_404_NOT_FOUND)
        if not pending:
            return Response({"detail": "No hay videos remotos pendientes para descargar a local."}, status=status.HTTP_400_BAD_REQUEST)
        with JOB_LOCK:
            running = active_job()
            if running:
                return Response(running, status=status.HTTP_202_ACCEPTED)
            job = {
                "id": uuid4().hex,
                "status": "queued",
                "phase": "local_cache",
                "phase_label": "Descargando pendientes a cache local",
                "created_at": timezone.now().isoformat(),
                "updated_at": timezone.now().isoformat(),
                "heartbeat_at": timezone.now().isoformat(),
                "worker_pid": PROCESS_ID,
                "created_by": request.user.id,
                "target_path": requested_path,
                "cache_only": True,
                "total": len(pending),
                "processed": 0,
                "percent": 0,
                "results": [],
            }
            write_json(job_path(job["id"]), job)
            thread = threading.Thread(target=cache_pending_videos_worker, args=(job["id"], requested_path), daemon=True)
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
            requested_paths = expand_requested_path_with_neighbors(requested_path)
            pending = [item for item in pending_videos() if pending_video_matches_any_request(item, requested_paths)]
            if not pending:
                return Response({"detail": "No se pudo preparar el video para reprocesar."}, status=status.HTTP_400_BAD_REQUEST)
            job = {
                "id": uuid4().hex,
                "status": "queued",
                "created_at": timezone.now().isoformat(),
                "updated_at": timezone.now().isoformat(),
                "heartbeat_at": timezone.now().isoformat(),
                "worker_pid": PROCESS_ID,
                "created_by": request.user.id,
                "target_path": requested_path,
                "target_paths": requested_paths,
                "neighbor_expanded": bool(len(requested_paths) > 1),
                "reprocess": True,
                "total": len(pending),
                "processed": 0,
                "percent": 0,
                "results": [],
            }
            write_json(job_path(job["id"]), job)
            thread = threading.Thread(target=process_pending_worker, args=(job["id"], request.user.id, requested_path, requested_paths), daemon=True)
            thread.start()
        return Response(job, status=status.HTTP_202_ACCEPTED)


class AutomaticAttendanceJobView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, job_id: str):
        expire_stale_jobs()
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


class AutomaticAttendanceStorageEvidenceView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request, bucket: str, object_path: str):
        try:
            local_path = download_private_file(bucket, object_path, suffix=Path(object_path).suffix or ".jpg")
        except Exception as exc:
            return Response({"detail": f"No se pudo leer la evidencia privada: {exc}"}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(open(local_path, "rb"), content_type="image/jpeg")
