from __future__ import annotations

from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.api.automatic_attendance_clips import pending_videos
from core.api.automatic_attendance_jobs import active_job
from core.api.automatic_attendance_neighbors import expand_requested_path_with_neighbors, pending_video_matches_any_request
from core.api.automatic_attendance_state import PROCESS_ID, ensure_dirs, job_path, write_json
from core.api.automatic_attendance_worker import process_pending_worker


class Command(BaseCommand):
    help = "Procesa videos pendientes de pase automatico fuera del proceso runserver."

    def add_arguments(self, parser):
        parser.add_argument("--path", default="", help="Ruta pendiente o video_clip:<id> para procesar solo un video.")
        parser.add_argument("--user-id", type=int, default=0, help="Usuario que quedara asociado al job.")
        parser.add_argument("--job-id", default="", help="ID fijo para el job; por defecto se genera uno.")

    def handle(self, *args, **options):
        ensure_dirs()
        requested_path = (options.get("path") or "").strip() or None
        running = active_job()
        if running:
            raise CommandError(f"Ya hay un job activo: {running.get('id')}")

        requested_paths = expand_requested_path_with_neighbors(requested_path) if requested_path else []
        pending = pending_videos()
        if requested_path:
            pending = [item for item in pending if pending_video_matches_any_request(item, requested_paths)]
        if not pending:
            raise CommandError("No hay videos pendientes por procesar.")

        user = self._resolve_user(options.get("user_id") or 0)
        job_id = (options.get("job_id") or "").strip() or uuid4().hex
        job = {
            "id": job_id,
            "status": "queued",
            "created_at": timezone.now().isoformat(),
            "updated_at": timezone.now().isoformat(),
            "heartbeat_at": timezone.now().isoformat(),
            "worker_pid": PROCESS_ID,
            "created_by": user.id,
            "target_path": requested_path,
            "target_paths": requested_paths,
            "neighbor_expanded": bool(requested_paths and len(requested_paths) > 1),
            "total": len(pending),
            "processed": 0,
            "percent": 0,
            "results": [],
            "phase": "queued",
            "phase_label": "Procesar pendientes con worker externo",
        }
        write_json(job_path(job_id), job)
        self.stdout.write(f"JOB_ID={job_id} TOTAL={len(pending)}")
        process_pending_worker(job_id, user.id, requested_path, requested_paths)
        self.stdout.write(f"DONE JOB_ID={job_id}")

    def _resolve_user(self, user_id: int):
        User = get_user_model()
        if user_id:
            user = User.objects.filter(id=user_id).first()
            if not user:
                raise CommandError(f"No existe el usuario {user_id}.")
            return user
        user = User.objects.filter(is_superuser=True).first() or User.objects.first()
        if not user:
            raise CommandError("No hay usuarios para asociar al job.")
        return user
