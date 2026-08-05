from __future__ import annotations

import json
import logging
import time
from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, as_completed, wait
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event, Lock, RLock, Thread
from uuid import NAMESPACE_URL, uuid4, uuid5

import cv2
import numpy as np

from .camera import CameraWorker
from .config import ConfigManager
from .futsi_client import FutsiClient
from .face_quality import FaceQualityEvaluator, FaceQualityThresholds
from .preview import AMBER, BLUE, GREEN, MUTED, copy_crop_file, draw_detection_roi, draw_face, encode_preview, face_crop, face_crop_with_bounds, placeholder_frame, resize_for_processing, save_crop_image
from .recognition import (
    DetectedFace,
    FaceDetector,
    FaceEngine,
    LandmarkValidationError,
    match_matrix,
    validate_insightface_landmarks,
)
from .semantic_reference import SEMANTIC_REFERENCE_VERSION, SemanticReferenceGate
from .store import LocalStore, UNKNOWN_INACTIVE_STATUSES
from .synchronizer import StationSynchronizer
from .time_utils import BUSINESS_TIME_ZONE, business_time
from .unknown_gallery import (
    PreparedUnknownGallery,
    match_prepared_unknown_gallery,
    prepare_unknown_gallery,
)
from .unknown_links import (
    create_collaborator_from_unknown,
    create_student_from_unknown,
    link_unknown_subject,
)
from .unknown_reconcile import plan_unknown_reconciliation


LOGGER = logging.getLogger("futsi.face_station")
UNKNOWN_TRACK_TTL_SECONDS = 1.25
UNKNOWN_TRACK_MIN_IOU = 0.12
UNKNOWN_TRACK_MAX_CENTER_DISTANCE = 0.45
QUALITY_PROBE_INTERVAL_SECONDS = 0.5
PERSISTENCE_QUEUE_MAX = 512
UNKNOWN_CACHE_REFRESH_SECONDS = 0.25
BATCH_CANDIDATE_REFRESH_OBSERVED_SECONDS = 300.0
BATCH_PERSISTENT_REFRESH_CROPS = 128
BATCH_RECENT_REFRESH_SECONDS = 300.0
LIVE_RECENT_REFRESH_SECONDS = 1.0
AUTOMATIC_BATCH_COMPLETED_STATE_KEY = "automatic_batch_completed_date"
NIGHT_BATCH_WRITE_STATE_KEY = "night_batch_write_state"
UNKNOWN_RECONCILIATION_STATE_KEY = "unknown_reconciliation_last"
EVIDENCE_MAINTENANCE_STATE_KEY = "evidence_maintenance_last"
class AtomicNightCommitError(RuntimeError):
    """The prepared result did not reach a confirmed atomic SQLite commit."""


@dataclass(slots=True)
class PersistenceTask:
    kind: str
    subject_key: str
    observed_at: datetime
    crop: np.ndarray
    similarity: float
    detected_quality: float
    camera_key: str
    match_margin: float = 0.0
    embedding: np.ndarray | None = None
    person: dict | None = None
    subject: dict | None = None
    source_subject_id: str = ""
    existing_crop_path: str = ""
    bbox: tuple[int, int, int, int] | None = None
    landmarks: np.ndarray | None = None
    should_persist: bool = True
    reference_validated: bool = True
    quality_pass: bool | None = None
    quality_score: float | None = None
    quality_payload: dict | None = None
    analysis_version: str = ""
    enqueued_at: float = field(default_factory=time.monotonic)


class StationRuntime:
    """Owns the camera, InsightFace engine, local store, and background sync."""

    def __init__(self, config_manager: ConfigManager):
        self.config_manager = config_manager
        self.store = LocalStore(config_manager.data_dir)
        self._state_lock = RLock()
        self._preview_lock = RLock()
        self._lifecycle_lock = RLock()
        self._stop = Event()
        self._benchmark_requested = Event()
        self._manual_batch_requested = Event()
        self._manual_batch_cancel_requested = Event()
        self._automatic_batch_requested = Event()
        self._manual_detection_ready = Event()
        self._processing_thread: Thread | None = None
        self._sync_thread: Thread | None = None
        self._persistence_thread: Thread | None = None
        self._batch_thread: Thread | None = None
        self._persistence_queue: Queue[PersistenceTask] = Queue(maxsize=PERSISTENCE_QUEUE_MAX)
        self._cameras: dict[str, CameraWorker] = {}
        self._camera_labels: dict[str, str] = {}
        self._camera_ids: dict[str, str] = {}
        self._last_preview_at: dict[str, float] = {}
        self._engine: FaceEngine | None = None
        self._detector: FaceDetector | None = None
        self._detectors: dict[str, FaceDetector] = {}
        self._gpu_lock = Lock()
        self._night_engine_lock = Lock()
        self._reconciliation_lock = Lock()
        self._preview_jpegs = {"primary": placeholder_frame("La estacion esta detenida")}
        self._recent_date = datetime.now(
            BUSINESS_TIME_ZONE
        ).date().isoformat()
        self._recent = deque(self.store.recent_detections(self._recent_date, limit=40), maxlen=40)
        recent_summary = self.store.detection_summary(self._recent_date)
        self._recent_total = recent_summary["detections"]
        self._recent_subjects = recent_summary["subjects"]
        self._last_recent_refresh_at = 0.0
        self._last_recent_refresh_date = ""
        self._last_persisted: dict[str, float] = {}
        self._last_quality_probe: dict[str, float] = {}
        self._pending_quality_subjects: set[str] = set()
        self._unknown_tracks: dict[str, list[dict]] = {}
        self._unknown_rows: list[dict] = []
        self._unknown_matrix = np.empty((0, 512), dtype=np.float32)
        self._unknown_reference_rows: list[dict] = []
        self._unknown_reference_matrix = np.empty((0, 512), dtype=np.float32)
        self._unknown_gallery_index: PreparedUnknownGallery = prepare_unknown_gallery(
            [],
            np.empty((0, 512), dtype=np.float32),
            [],
            np.empty((0, 512), dtype=np.float32),
        )
        self._candidate_rows: list[dict] = []
        self._candidate_matrix = np.empty((0, 512), dtype=np.float32)
        self._batch_candidates: dict[str, tuple[dict, np.ndarray]] = {}
        self._batch_recent_unknowns: dict[str, tuple[dict, np.ndarray]] = {}
        self._batch_candidate_loaded_epoch: float | None = None
        self._batch_unknowns_since_persistent_reload = 0
        self._quality_evaluator: FaceQualityEvaluator | None = None
        self._semantic_reference_gate: SemanticReferenceGate | None = None
        self._semantic_reference_status: dict = {}
        self._started_at = ""
        self._state = "stopped"
        self._last_error = ""
        self._last_bootstrap_at = ""
        self._site_name = "Sin sincronizar"
        self._device_name = "Estacion local"
        self._station_id = ""
        self._provider = "Sin cargar"
        self._target_fps = 1.0
        self._processing_fps = 0.0
        self._processed_frames = 0
        self._camera_processing_fps: dict[str, float] = {}
        self._camera_processed_frames: dict[str, int] = {}
        self._detected_faces = 0
        self._benchmark: dict = {}
        self._client_online = False
        self._client_error = ""
        self._reference_total = 0
        self._reference_configured = 0
        self._reference_ready = 0
        self._reference_pending = 0
        self._reference_missing = 0
        self._reference_failed = 0
        self._reference_current = ""
        self._persistence_enqueued = 0
        self._persistence_completed = 0
        self._persistence_dropped = 0
        self._persistence_failed = 0
        self._persistence_last_error = ""
        self._persistence_last_latency_ms = 0.0
        self._last_face_at = 0.0
        self._batch_state = "waiting_schedule"
        self._batch_processed = 0
        self._batch_discarded = 0
        self._batch_failed = 0
        self._batch_current_crop_id = 0
        self._batch_direct_embeddings = 0
        self._batch_detection_fallbacks = 0
        self._batch_embedding_batches = 0
        self._batch_embedding_batch_failures = 0
        self._batch_atomic_commit_active = False
        self._batch_atomic_commits = 0
        self._batch_atomic_failures = 0
        self._batch_legacy_writes = 0
        self._batch_atomic_last_error = ""
        self._automatic_batch_active = False
        self._automatic_batch_run_date = ""
        self._automatic_batch_completed_date = self.store.runtime_state(
            AUTOMATIC_BATCH_COMPLETED_STATE_KEY
        )
        self._automatic_batch_started_at = ""
        self._automatic_batch_finished_at = ""
        self._automatic_batch_initial_pending = 0
        self._automatic_batch_last_error = ""
        self._batch_persistence_fence: int | None = None
        self._manual_batch_active = False
        self._detection_paused = False
        self._manual_batch_status = "idle"
        self._manual_batch_started_at = ""
        self._manual_batch_finished_at = ""
        self._manual_batch_initial_pending = 0
        self._manual_batch_processed = 0
        self._manual_batch_discarded = 0
        self._manual_batch_failed = 0
        self._manual_batch_last_error = ""
        self._reconciliation_status: dict = {}
        stored_reconciliation = self.store.runtime_state(
            UNKNOWN_RECONCILIATION_STATE_KEY
        )
        if stored_reconciliation:
            try:
                self._reconciliation_status = json.loads(stored_reconciliation)
            except (TypeError, ValueError):
                self._reconciliation_status = {}
        self._evidence_maintenance_status: dict = {}
        stored_maintenance = self.store.runtime_state(
            EVIDENCE_MAINTENANCE_STATE_KEY
        )
        if stored_maintenance:
            try:
                self._evidence_maintenance_status = json.loads(
                    stored_maintenance
                )
            except (TypeError, ValueError):
                self._evidence_maintenance_status = {}
        self._capture_date = datetime.now(
            BUSINESS_TIME_ZONE
        ).date().isoformat()
        self._captured_frames_today = 0
        self._captured_faces_today = 0

    @property
    def running(self) -> bool:
        return bool(self._processing_thread and self._processing_thread.is_alive())

    def start(self) -> None:
        with self._lifecycle_lock:
            if self.running:
                return
            self._stop.clear()
            self._manual_batch_requested.clear()
            self._manual_batch_cancel_requested.clear()
            self._automatic_batch_requested.clear()
            self._manual_detection_ready.clear()
            self._automatic_batch_active = False
            self._automatic_batch_run_date = ""
            self._automatic_batch_completed_date = self.store.runtime_state(
                AUTOMATIC_BATCH_COMPLETED_STATE_KEY
            )
            self._automatic_batch_started_at = ""
            self._automatic_batch_finished_at = ""
            self._automatic_batch_initial_pending = 0
            self._automatic_batch_last_error = ""
            self._batch_persistence_fence = None
            self._manual_batch_active = False
            self._detection_paused = False
            self._manual_batch_status = "idle"
            self._manual_batch_started_at = ""
            self._manual_batch_finished_at = ""
            self._manual_batch_initial_pending = 0
            self._manual_batch_processed = 0
            self._manual_batch_discarded = 0
            self._manual_batch_failed = 0
            self._manual_batch_last_error = ""
            self._unknown_tracks.clear()
            self._last_quality_probe.clear()
            self._pending_quality_subjects.clear()
            self._last_preview_at.clear()
            self._last_recent_refresh_at = 0.0
            self._last_recent_refresh_date = ""
            self._invalidate_batch_candidate_cache()
            self._persistence_queue = Queue(maxsize=PERSISTENCE_QUEUE_MAX)
            self.store.recover_processing_crops()
            config = self.config_manager.config
            definitions = self._camera_definitions(config)
            self._cameras = {
                key: CameraWorker(
                    details["source"],
                    name=key,
                    fallback_source=details.get("fallback_source", ""),
                )
                for key, details in definitions.items()
            }
            self._camera_labels = {key: details["label"] for key, details in definitions.items()}
            self._camera_ids = {key: details["camera_id"] for key, details in definitions.items()}
            self._camera_processing_fps = {key: 0.0 for key in definitions}
            self._camera_processed_frames = {key: 0 for key in definitions}
            with self._preview_lock:
                self._preview_jpegs = {
                    key: placeholder_frame(f"Esperando video de {details['label']}")
                    for key, details in definitions.items()
                }
            for camera in self._cameras.values():
                camera.start()
            self._started_at = datetime.now(timezone.utc).isoformat()
            self._set_state("starting", "")
            self._processing_thread = Thread(target=self._processing_loop, name="futsi-recognition", daemon=True)
            self._sync_thread = Thread(target=StationSynchronizer(self).run, name="futsi-sync", daemon=True)
            self._persistence_thread = Thread(target=self._persistence_loop, name="futsi-persistence", daemon=True)
            self._batch_thread = Thread(target=self._batch_loop, name="futsi-night-batch", daemon=True)
            self._persistence_thread.start()
            self._processing_thread.start()
            self._sync_thread.start()
            self._batch_thread.start()

    def stop(self) -> None:
        with self._lifecycle_lock:
            self._stop.set()
            for camera in self._cameras.values():
                camera.stop()
            for thread in (self._processing_thread, self._sync_thread, self._batch_thread):
                if thread and thread.is_alive():
                    thread.join(timeout=8)
            if self._persistence_thread and self._persistence_thread.is_alive():
                self._persistence_thread.join(timeout=20)
            if self._persistence_thread and self._persistence_thread.is_alive():
                LOGGER.warning(
                    "La cola de persistencia no termino a tiempo; se descartaran %s tareas pendientes",
                    self._persistence_queue.qsize(),
                )
                while True:
                    try:
                        task = self._persistence_queue.get_nowait()
                    except Empty:
                        break
                    else:
                        self._finish_pending_quality(task)
                        self._persistence_queue.task_done()
                        self._persistence_dropped += 1
                self._persistence_thread.join(timeout=5)
            self._processing_thread = None
            self._sync_thread = None
            self._persistence_thread = None
            self._batch_thread = None
            self._engine = None
            self._detector = None
            self._detectors = {}
            self._invalidate_batch_candidate_cache()
            self._manual_batch_requested.clear()
            self._manual_batch_cancel_requested.clear()
            self._automatic_batch_requested.clear()
            self._manual_detection_ready.clear()
            self._automatic_batch_active = False
            self._automatic_batch_run_date = ""
            self._batch_persistence_fence = None
            self._manual_batch_active = False
            self._detection_paused = False
            if self._quality_evaluator:
                self._quality_evaluator.close()
                self._quality_evaluator = None
            self._release_semantic_reference_gate()
            self._set_state("stopped", "")
            for key in self._cameras or {"primary": None}:
                self._set_preview(placeholder_frame("La estacion esta detenida"), key)

    def restart(self) -> None:
        self.stop()
        self.start()

    def request_benchmark(self) -> None:
        if not self.running:
            raise RuntimeError("Inicia el motor antes de ejecutar la prueba.")
        if self._batch_detection_pause_requested():
            raise RuntimeError("Espera a que termine el procesamiento de la cola.")
        self._benchmark_requested.set()

    def request_manual_batch(self) -> dict:
        if not self.running:
            raise RuntimeError("Inicia el motor antes de procesar la cola.")
        summary = self.store.crop_queue_total_summary()
        pending = int(summary["pending"])
        with self._state_lock:
            if self._automatic_batch_requested.is_set() or self._automatic_batch_active:
                raise RuntimeError("El lote nocturno automatico ya esta procesando la cola.")
            if self._manual_batch_requested.is_set() or self._manual_batch_active:
                raise RuntimeError("El procesamiento manual ya está en curso.")
            if pending <= 0:
                raise RuntimeError("No hay recortes pendientes para procesar.")
            self._manual_batch_status = "queued"
            self._manual_batch_started_at = ""
            self._manual_batch_finished_at = ""
            self._manual_batch_initial_pending = pending
            self._manual_batch_processed = 0
            self._manual_batch_discarded = 0
            self._manual_batch_failed = 0
            self._manual_batch_last_error = ""
            self._detection_paused = True
            self._manual_batch_cancel_requested.clear()
            self._manual_detection_ready.clear()
            self._manual_batch_requested.set()
        return {"queued": True, "pending": pending}

    def cancel_manual_batch(self) -> dict:
        with self._state_lock:
            if not self._manual_batch_requested.is_set() and not self._manual_batch_active:
                raise RuntimeError("No hay un procesamiento manual en curso.")
            self._manual_batch_cancel_requested.set()
            self._manual_batch_status = "cancelling"
        return {"cancelling": True}

    def latest_preview(self, camera_key: str = "primary") -> bytes:
        with self._preview_lock:
            payload = self._preview_jpegs.get(camera_key) or self._preview_jpegs.get("primary")
            return bytes(payload or placeholder_frame("Camara no configurada"))

    def health_status(self) -> dict:
        """Return liveness data without touching SQLite or the worker pool.

        ``status()`` intentionally includes queue, attendance and sync summaries.
        Those queries can take seconds on a large local database and must not be
        part of the watchdog probe: otherwise a busy report can make a healthy
        Uvicorn process look dead and exhaust Starlette's sync worker threads.
        """
        cameras = tuple(self._cameras.values())
        return {
            "running": self.running,
            "state": self._state,
            "camera_connected": any(camera.connected for camera in cameras),
            "online": self._client_online,
        }

    def status(self) -> dict:
        config = self.config_manager.config
        definitions = self._camera_definitions(config)
        queue_summary = self.store.crop_queue_total_summary()
        today_queue_summary = self.store.crop_queue_summary()
        unassigned_summary = self.store.unassigned_summary()
        with self._state_lock:
            payload = {
                "running": self.running,
                "state": self._state,
                "last_error": self._last_error,
                "started_at": self._started_at,
                "device_name": self._device_name,
                "station_id": self._station_id,
                "site_name": self._site_name,
                "provider": self._provider,
                "target_fps": round(self._target_fps, 2),
                "processing_fps": round(self._processing_fps, 2),
                "processed_frames": self._processed_frames,
                "detected_faces": self._detected_faces,
                "last_bootstrap_at": self._last_bootstrap_at,
                "online": self._client_online,
                "sync_error": self._client_error,
                "benchmark": dict(self._benchmark),
                "recent": list(self._recent),
                "recent_total_today": self._recent_total,
                "recent_subjects_today": self._recent_subjects,
                "recent_visible": len(self._recent),
                "recent_date": self._recent_date,
                "capture": {
                    "date": self._capture_date,
                    "frames_today": self._captured_frames_today,
                    "faces_today": self._captured_faces_today,
                    "night_batch_start_time": config.night_batch_start_time,
                    "detection_paused": self._detection_paused,
                },
                "crop_queue": {
                    **queue_summary,
                    "today": today_queue_summary,
                    "unassigned": unassigned_summary,
                    "batch_state": self._batch_state,
                    "batch_processed": self._batch_processed,
                    "batch_discarded": self._batch_discarded,
                    "batch_failed": self._batch_failed,
                    "current_crop_id": self._batch_current_crop_id,
                    "direct_embeddings": self._batch_direct_embeddings,
                    "detection_fallbacks": self._batch_detection_fallbacks,
                    "embedding_batch_size": config.night_embedding_batch_size,
                    "embedding_batches": self._batch_embedding_batches,
                    "embedding_batch_failures": self._batch_embedding_batch_failures,
                    "sqlite_writes": {
                        "configured": bool(config.night_batch_atomic_commit_enabled),
                        "mode": "atomic" if self._batch_atomic_commit_active else "legacy",
                        "atomic_commits": self._batch_atomic_commits,
                        "atomic_failures": self._batch_atomic_failures,
                        "legacy_writes": self._batch_legacy_writes,
                        "last_error": self._batch_atomic_last_error,
                    },
                    "automatic": {
                        "requested": self._automatic_batch_requested.is_set(),
                        "active": self._automatic_batch_active,
                        "run_date": self._automatic_batch_run_date,
                        "completed_date": self._automatic_batch_completed_date,
                        "started_at": self._automatic_batch_started_at,
                        "finished_at": self._automatic_batch_finished_at,
                        "initial_pending": self._automatic_batch_initial_pending,
                        "last_error": self._automatic_batch_last_error,
                        "start_time": config.night_batch_start_time,
                        "exclusive": True,
                    },
                    "manual": {
                        "requested": self._manual_batch_requested.is_set(),
                        "active": self._manual_batch_active,
                        "detection_paused": self._detection_paused,
                        "status": self._manual_batch_status,
                        "started_at": self._manual_batch_started_at,
                        "finished_at": self._manual_batch_finished_at,
                        "initial_pending": self._manual_batch_initial_pending,
                        "processed": self._manual_batch_processed,
                        "discarded": self._manual_batch_discarded,
                        "failed": self._manual_batch_failed,
                        "last_error": self._manual_batch_last_error,
                    },
                    "reconciliation": dict(self._reconciliation_status),
                    "evidence_maintenance": {
                        **dict(self._evidence_maintenance_status),
                        "daily_limit": int(config.daily_evidence_limit),
                        "safety_days": int(config.evidence_safety_days),
                        "gallery_limit": 12,
                    },
                },
                "references": {
                    "total": self._reference_total,
                    "configured": self._reference_configured,
                    "ready": self._reference_ready,
                    "pending": self._reference_pending,
                    "missing": self._reference_missing,
                    "failed": self._reference_failed,
                    "current": self._reference_current,
                },
                "reference_admission": {
                    "strict_quality_enabled": bool(config.quality_filter_enabled),
                    "semantic_filter_enabled": bool(
                        config.semantic_reference_filter_enabled
                    ),
                    "semantic": self._semantic_reference_metadata(),
                    "attendance_depends_on_visual_quality": False,
                },
                "persistence": {
                    "queue_depth": self._persistence_queue.qsize(),
                    "queue_capacity": PERSISTENCE_QUEUE_MAX,
                    "worker_active": bool(self._persistence_thread and self._persistence_thread.is_alive()),
                    "enqueued": self._persistence_enqueued,
                    "completed": self._persistence_completed,
                    "dropped": self._persistence_dropped,
                    "failed": self._persistence_failed,
                    "last_error": self._persistence_last_error,
                    "last_latency_ms": round(self._persistence_last_latency_ms, 1),
                },
            }
        cameras = {}
        for key, details in definitions.items():
            camera = self._cameras.get(key)
            cameras[key] = {
                "label": details["label"],
                "camera_id": details["camera_id"],
                "roi": list(details["roi"]),
                "roi_active": list(details["roi"]) != [0.0, 1.0],
                "connected": bool(camera and camera.connected),
                "frames_read": int(camera.frames_read if camera else 0),
                "frames_dropped": int(camera.frames_dropped if camera else 0),
                "processed_frames": int(self._camera_processed_frames.get(key, 0)),
                "processing_fps": round(self._camera_processing_fps.get(key, 0.0), 2),
                "hardware_acceleration": bool(camera and camera.hardware_acceleration),
                "queue_depth": int(camera.queue_depth if camera else 0),
                "last_error": camera.last_error if camera else "",
                "source_role": camera.source_role if camera else "primary",
                "using_fallback": bool(camera and camera.using_fallback),
                "failover_count": int(camera.failover_count if camera else 0),
                "last_source_switch_at": float(camera.last_source_switch_at if camera else 0.0),
                "last_failover_reason": camera.last_failover_reason if camera else "",
            }
        connected_count = sum(1 for camera in cameras.values() if camera["connected"])
        payload["cameras"] = cameras
        payload["camera"] = {
            "connected": connected_count > 0,
            "connected_count": connected_count,
            "configured_count": len(cameras),
            "frames_read": sum(camera["frames_read"] for camera in cameras.values()),
            "last_error": next((camera["last_error"] for camera in cameras.values() if camera["last_error"]), ""),
        }
        payload["sync"] = self.store.sync_summary()
        return payload

    def dashboard(self, selected_date: str) -> dict:
        # Status is polled independently by the shell. Keeping it out of this
        # endpoint avoids repeating queue and sync summaries on every dashboard
        # refresh.
        return self.store.dashboard(selected_date)

    def link_unknown(self, subject_id: str, person_key: str) -> dict:
        result = link_unknown_subject(self, subject_id, person_key)
        # Avoid carrying a stale candidate track after it becomes linked.
        self._unknown_tracks.clear()
        return result

    def merge_unknowns(self, target_subject_id: str, source_subject_ids: list[str]) -> dict:
        result = self.store.merge_unknowns(target_subject_id, source_subject_ids)
        # A pending frame may still reference one of the archived IDs. The
        # store redirects those writes to the canonical target, while clearing
        # the visual tracks prevents new frames from keeping the stale group.
        self._unknown_tracks.clear()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    def reconcile_unknowns(self, *, apply: bool = False) -> dict:
        """Build a conservative global plan and optionally apply its safe groups.

        Planning is read-only. Automatic application is only allowed while the
        capture pipeline is paused, so ArcFace/SQLite cannot race a merge.
        """
        if apply and not self._detection_paused:
            raise RuntimeError(
                "Pausa la deteccion antes de aplicar la reconciliacion global."
            )
        with self._reconciliation_lock:
            identity_rows, centroid_matrix = self.store.unknown_database()
            reference_rows, reference_matrix = (
                self.store.unknown_reference_database()
            )
            plan = plan_unknown_reconciliation(
                identity_rows,
                centroid_matrix,
                reference_rows,
                reference_matrix,
            )
            applied = []
            if apply:
                batch_backup_path: Path | None = None
                for proposal in plan.merge_proposals:
                    create_batch_backup = not applied
                    result = self.store.merge_unknowns(
                        proposal.target_subject_id,
                        list(proposal.source_subject_ids),
                        create_backup=create_batch_backup,
                        existing_backup_path=batch_backup_path,
                    )
                    if create_batch_backup:
                        backup_value = str(result.get("backup_path") or "").strip()
                        if not backup_value:
                            raise RuntimeError(
                                "La reconciliacion no pudo confirmar su respaldo SQLite."
                            )
                        batch_backup_path = Path(backup_value)
                    applied.append(result)
                if applied:
                    self._unknown_tracks.clear()
                    self._reload_unknown_database()
                    self._refresh_recent()

            compact = {
                "mode": "applied" if apply else "dry_run",
                "ran_at": datetime.now(timezone.utc).isoformat(),
                "identity_count": int(plan.identity_count),
                "eligible_identity_count": int(plan.eligible_identity_count),
                "candidate_pairs": int(plan.vectorized_candidate_count),
                "supported_pairs": int(plan.supported_pair_count),
                "proposal_count": len(plan.merge_proposals),
                "review_count": len(plan.review_items),
                "applied_count": len(applied),
                "proposals": [
                    {
                        "target_subject_id": proposal.target_subject_id,
                        "target_name": proposal.target_name,
                        "member_subject_ids": list(
                            proposal.member_subject_ids
                        ),
                        "member_names": list(proposal.member_names),
                        "robust_anchor_count": int(
                            proposal.robust_anchor_count
                        ),
                        "adaptive_anchor_count": int(
                            proposal.adaptive_anchor_count
                        ),
                        "seed_anchor_count": int(
                            proposal.seed_anchor_count
                        ),
                        "hard_reference_edge_count": int(
                            proposal.hard_reference_edge_count
                        ),
                        "pair_count": int(proposal.pair_count),
                        "expected_pair_count": int(
                            proposal.expected_pair_count
                        ),
                        "weakest_pair_confidence": round(
                            float(proposal.weakest_pair_confidence),
                            6,
                        ),
                    }
                    for proposal in plan.merge_proposals
                ],
            }
            with self._state_lock:
                self._reconciliation_status = compact
            self.store.set_runtime_state(
                UNKNOWN_RECONCILIATION_STATE_KEY,
                json.dumps(compact, ensure_ascii=True),
            )
            return {
                "plan": plan.to_dict(),
                "summary": compact,
                "applied": applied,
            }

    def set_unknowns_ignored(self, subject_ids: list[str], ignored: bool) -> dict:
        result = self.store.set_unknowns_ignored(subject_ids, ignored)
        self._unknown_tracks.clear()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    def quarantine_unknown(self, subject_id: str, reason: str) -> dict:
        result = self.store.quarantine_unknown(subject_id, reason)
        self._unknown_tracks.clear()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    def reject_unknown_crop(self, crop_id: int, reason: str = "") -> dict:
        result = self.store.reject_unknown_crop(crop_id, reason)
        self._unknown_tracks.clear()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    def create_student_from_unknown(
        self,
        subject_id: str,
        full_name: str,
        crop_id: int,
    ) -> dict:
        result = create_student_from_unknown(
            self,
            subject_id,
            full_name,
            crop_id,
        )
        self._unknown_tracks.clear()
        self._reload_known_database()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    def create_collaborator_from_unknown(
        self,
        subject_id: str,
        full_name: str,
        crop_id: int,
    ) -> dict:
        result = create_collaborator_from_unknown(
            self,
            subject_id,
            full_name,
            crop_id,
        )
        self._unknown_tracks.clear()
        self._reload_known_database()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    @property
    def station_id(self) -> str:
        return self._station_id

    def reload_unknown_database(self) -> None:
        self._reload_unknown_database()

    def _processing_loop(self) -> None:
        executor: ThreadPoolExecutor | None = None
        try:
            config = self.config_manager.config
            self._set_state("loading_model", "")
            camera_keys = list(self._cameras)
            primary_key = camera_keys[0]
            primary_detector = FaceDetector(config)
            primary_detector.load()
            detectors = {primary_key: primary_detector}
            if primary_detector.providers[0] == "CUDAExecutionProvider":
                for camera_key in camera_keys[1:]:
                    detector = FaceDetector(config)
                    detector.load()
                    detectors[camera_key] = detector
            else:
                for camera_key in camera_keys[1:]:
                    detectors[camera_key] = primary_detector
            self._detector = primary_detector
            self._detectors = detectors
            self._provider = primary_detector.provider_label
            self._reload_known_database()
            self._reload_unknown_database()
            self._update_reference_summary()
            self._wait_for_first_frame()
            if config.target_fps <= 0:
                self._run_benchmark()
            else:
                self._target_fps = config.target_fps
            self._set_state("running", "")
            completion_samples: deque[float] = deque(maxlen=max(60, len(camera_keys) * 90))
            camera_samples = {key: deque(maxlen=90) for key in camera_keys}
            worker_count = len({id(detector) for detector in detectors.values()})
            if worker_count > 1:
                executor = ThreadPoolExecutor(
                    max_workers=worker_count,
                    thread_name_prefix="futsi-detection",
                )
            in_flight = {}

            def record_completion(camera_key: str) -> None:
                completed = time.perf_counter()
                completion_samples.append(completed)
                camera_samples[camera_key].append(completed)
                total_window = max(completion_samples[-1] - completion_samples[0], 0.001)
                own_samples = camera_samples[camera_key]
                own_window = max(own_samples[-1] - own_samples[0], 0.001)
                with self._state_lock:
                    if len(completion_samples) > 1:
                        self._processing_fps = (len(completion_samples) - 1) / total_window
                    if len(own_samples) > 1:
                        self._camera_processing_fps[camera_key] = (len(own_samples) - 1) / own_window
                    self._processed_frames += 1
                    self._camera_processed_frames[camera_key] = (
                        self._camera_processed_frames.get(camera_key, 0) + 1
                    )

            while not self._stop.is_set():
                if self._batch_detection_pause_requested():
                    if in_flight:
                        done, _ = wait(tuple(in_flight), timeout=0.01, return_when=FIRST_COMPLETED)
                        for future in done:
                            camera_key = in_flight.pop(future)
                            future.result()
                            record_completion(camera_key)
                        continue
                    if not self._manual_detection_ready.is_set():
                        completion_samples.clear()
                        for own_samples in camera_samples.values():
                            own_samples.clear()
                        with self._state_lock:
                            self._processing_fps = 0.0
                            for camera_key in camera_keys:
                                self._camera_processing_fps[camera_key] = 0.0
                    with self._state_lock:
                        self._detection_paused = True
                    self._manual_detection_ready.set()
                    self._stop.wait(0.05)
                    continue
                if self._detection_paused:
                    with self._state_lock:
                        self._detection_paused = False
                    self._manual_detection_ready.clear()
                if self._benchmark_requested.is_set():
                    if in_flight:
                        done, _ = wait(tuple(in_flight), timeout=0.01, return_when=FIRST_COMPLETED)
                        for future in done:
                            camera_key = in_flight.pop(future)
                            future.result()
                            record_completion(camera_key)
                        continue
                    self._benchmark_requested.clear()
                    self._run_benchmark()

                if executor:
                    busy_cameras = set(in_flight.values())
                    for camera_key in camera_keys:
                        if camera_key in busy_cameras:
                            continue
                        frame, captured_at = self._cameras[camera_key].next_frame()
                        if frame is None:
                            continue
                        future = executor.submit(self._capture_frame, frame, captured_at, camera_key)
                        in_flight[future] = camera_key
                    if not in_flight:
                        for camera in self._cameras.values():
                            if camera.wait_for_frame(0.005):
                                break
                        continue
                    done, _ = wait(tuple(in_flight), timeout=0.01, return_when=FIRST_COMPLETED)
                    for future in done:
                        camera_key = in_flight.pop(future)
                        future.result()
                        record_completion(camera_key)
                else:
                    processed_any = False
                    for camera_key in camera_keys:
                        frame, captured_at = self._cameras[camera_key].next_frame()
                        if frame is None:
                            continue
                        self._capture_frame(frame, captured_at, camera_key)
                        record_completion(camera_key)
                        processed_any = True
                    if not processed_any:
                        for camera in self._cameras.values():
                            if camera.wait_for_frame(0.005):
                                break
        except Exception as exc:
            LOGGER.exception("El motor de reconocimiento se detuvo")
            self._set_state("error", str(exc))
            for key in self._cameras or {"primary": None}:
                self._set_preview(placeholder_frame("Error del motor", str(exc)), key)
        finally:
            if executor:
                executor.shutdown(wait=True, cancel_futures=True)
            for camera in self._cameras.values():
                camera.stop()

    def _batch_detection_pause_requested(self) -> bool:
        return (
            self._manual_batch_requested.is_set()
            or self._automatic_batch_requested.is_set()
        )

    def _enqueue_persistence(self, task: PersistenceTask) -> bool:
        timeout = 0.2 if task.should_persist or task.kind == "known" else 0.0
        try:
            self._persistence_queue.put(task, timeout=timeout)
        except Full:
            with self._state_lock:
                self._persistence_dropped += 1
                self._persistence_last_error = "Cola de persistencia llena"
            LOGGER.warning("Se descarto una tarea %s para %s porque la cola esta llena", task.kind, task.subject_key)
            return False
        with self._state_lock:
            self._persistence_enqueued += 1
            if task.kind == "unknown":
                self._pending_quality_subjects.add(task.subject_key)
                self._last_quality_probe[f"unknown:{task.subject_key}"] = time.monotonic()
        return True

    def _persistence_loop(self) -> None:
        unknown_cache_dirty = False
        last_cache_refresh = time.monotonic()
        while not self._stop.is_set() or not self._persistence_queue.empty():
            try:
                task = self._persistence_queue.get(timeout=0.1)
            except Empty:
                if unknown_cache_dirty:
                    self._reload_unknown_database()
                    unknown_cache_dirty = False
                    last_cache_refresh = time.monotonic()
                continue
            try:
                unknown_cache_dirty = self._persist_task(task) or unknown_cache_dirty
                with self._state_lock:
                    self._persistence_completed += 1
                    self._persistence_last_error = ""
            except Exception as exc:
                LOGGER.exception("No se pudo persistir una deteccion %s", task.subject_key)
                with self._state_lock:
                    self._persistence_failed += 1
                    self._persistence_last_error = str(exc)[:500]
            finally:
                self._finish_pending_quality(task)
                with self._state_lock:
                    self._persistence_last_latency_ms = (time.monotonic() - task.enqueued_at) * 1000
                self._persistence_queue.task_done()
            if unknown_cache_dirty and (
                self._persistence_queue.empty()
                or time.monotonic() - last_cache_refresh >= UNKNOWN_CACHE_REFRESH_SECONDS
            ):
                self._reload_unknown_database()
                unknown_cache_dirty = False
                last_cache_refresh = time.monotonic()
        if unknown_cache_dirty:
            self._reload_unknown_database()

    def _finish_pending_quality(self, task: PersistenceTask) -> None:
        if task.kind != "unknown":
            return
        with self._state_lock:
            self._pending_quality_subjects.discard(task.subject_key)

    def _persist_task(self, task: PersistenceTask) -> bool:
        if task.kind == "raw":
            self._persist_raw_crop_task(task)
            return False
        if task.kind == "known":
            self._persist_known_task(task)
            return False
        if task.kind == "unknown":
            return self._persist_unknown_task(task)
        raise ValueError(f"Tipo de persistencia desconocido: {task.kind}")

    def _persist_raw_crop_task(self, task: PersistenceTask) -> None:
        crop_path = save_crop_image(
            self.store.spool_dir,
            task.crop,
            task.camera_key,
            task.subject_key,
            task.observed_at,
            jpeg_quality=self.config_manager.config.spool_jpeg_quality,
        )
        if not crop_path:
            raise RuntimeError("No se pudo guardar el recorte de la cola nocturna.")
        path = Path(crop_path)
        height, width = task.crop.shape[:2]
        self.store.enqueue_crop_for_processing(
            captured_at=task.observed_at,
            camera_key=task.camera_key,
            camera_label=self._camera_labels.get(task.camera_key, task.camera_key),
            crop_path=crop_path,
            file_bytes=path.stat().st_size,
            crop_width=width,
            crop_height=height,
            det_score=task.detected_quality,
            bbox=task.bbox or (0, 0, width, height),
            landmarks=task.landmarks,
        )

    def _persist_known_task(self, task: PersistenceTask) -> None:
        person = task.person or {}
        person_key = task.subject_key
        (
            quality_pass,
            quality_score,
            quality_payload,
            analysis_version,
        ) = self._quality_for_task(task)
        reference_quality_pass = self._known_reference_is_safe(
            task,
            quality_pass=quality_pass,
        )
        crop_path = (
            copy_crop_file(
                self.store.faces_dir,
                task.existing_crop_path,
                "known",
                person_key,
                task.observed_at,
            )
            if task.existing_crop_path
            else save_crop_image(
                self.store.faces_dir,
                task.crop,
                "known",
                person_key,
                task.observed_at,
                jpeg_quality=self.config_manager.config.spool_jpeg_quality,
            )
        )
        if not crop_path:
            raise RuntimeError("No se pudo codificar el recorte conocido.")
        presence = self.store.upsert_presence(person_key, "known", task.observed_at, task.similarity, crop_path)
        camera_label = self._camera_labels.get(task.camera_key, task.camera_key)
        self.store.record_crop(
            person_key,
            "known",
            task.observed_at,
            crop_path,
            task.similarity,
            quality_score,
            camera_label,
            embedding=task.embedding,
            analysis_version=analysis_version,
            quality_pass=quality_pass,
            quality_payload=quality_payload,
        )
        if reference_quality_pass and task.embedding is not None:
            try:
                self.store.save_known_observation_reference(
                    person_key,
                    crop_path,
                    task.embedding,
                    quality_score,
                    task.observed_at,
                    quality_payload,
                )
                # Publish the newly curated multi-reference gallery
                # immediately so live matching does not stay stale.
                self._reload_known_database()
            except Exception:
                # Attendance and audit evidence were already committed. A
                # failed gallery improvement must not erase or double-count
                # either of them.
                LOGGER.exception(
                    "No se pudo admitir el recorte conocido %s como referencia adaptativa",
                    person_key,
                )
        event_id = str(
            uuid5(
                NAMESPACE_URL,
                f"futsi:{self._station_id or 'local'}:{person_key}:{presence['presence_date']}:{presence['session_id']}",
            )
        )
        payload = {
            "event_id": event_id,
            "person_type": person["person_type"],
            "person_id": person["remote_id"],
            "person_key": person_key,
            "presence_date": presence["presence_date"],
            "occurred_at": presence["first_seen_at"],
            "session_id": presence["session_id"] if presence["session_id"] != -1 else None,
            "detection_count": presence["detection_count"],
            "similarity": task.similarity,
            "source_subject_id": task.source_subject_id,
            "metadata": {"camera_id": self._camera_ids.get(task.camera_key, self.config_manager.config.camera_id)},
        }
        self.store.queue_event(event_id, "known_event", payload)
        self._record_recent(
            "known",
            person["name"],
            task.similarity,
            crop_path,
            task.observed_at,
            person_key,
            task.camera_key,
            presence["detection_count"],
        )

    def _persist_unknown_task(self, task: PersistenceTask) -> bool:
        try:
            current = self.store.get_unknown(task.subject_key)
        except LookupError:
            current = None
        if current and current.get("status") in UNKNOWN_INACTIVE_STATUSES:
            return False
        (
            quality_pass,
            quality_score,
            quality_payload,
            analysis_version,
        ) = self._quality_for_task(task)
        if not task.should_persist and not quality_pass:
            return False
        reference_quality_pass = bool(
            self._unknown_reference_is_safe(
                task,
                current=current,
                quality_pass=quality_pass,
            )
        )
        crop_path = (
            copy_crop_file(
                self.store.faces_dir,
                task.existing_crop_path,
                "unknown",
                task.subject_key,
                task.observed_at,
            )
            if task.existing_crop_path
            else save_crop_image(
                self.store.faces_dir,
                task.crop,
                "unknown",
                task.subject_key,
                task.observed_at,
                jpeg_quality=self.config_manager.config.spool_jpeg_quality,
            )
        )
        if not crop_path:
            raise RuntimeError("No se pudo codificar el recorte desconocido.")
        if current:
            result = self.store.update_unknown(
                task.subject_key,
                task.embedding,
                task.observed_at,
                crop_path,
                quality_score,
                quality_pass=reference_quality_pass,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
            if result.get("status") in UNKNOWN_INACTIVE_STATUSES:
                Path(crop_path).unlink(missing_ok=True)
                return False
        else:
            subject = task.subject or {}
            result = self.store.create_unknown(
                task.embedding,
                task.observed_at,
                crop_path,
                quality_score,
                subject_id=task.subject_key,
                temporary_name=subject.get("temporary_name", task.subject_key),
                quality_pass=reference_quality_pass,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
        crop_recorded = self.store.record_crop(
            result["subject_id"],
            "unknown",
            task.observed_at,
            crop_path,
            task.similarity,
            quality_score,
            self._camera_labels.get(task.camera_key, task.camera_key),
            embedding=task.embedding,
            analysis_version=analysis_version,
            quality_pass=quality_pass,
            quality_payload=quality_payload,
        )
        if not crop_recorded:
            Path(crop_path).unlink(missing_ok=True)
            return False
        if task.subject is not None:
            task.subject.update(result)
        if not task.should_persist and quality_pass:
            with self._state_lock:
                self._last_persisted[f"unknown:{task.subject_key}"] = time.monotonic()
        self._record_recent(
            "unknown",
            result["temporary_name"],
            task.similarity,
            result.get("best_crop_path") or crop_path,
            task.observed_at,
            result["subject_id"],
            task.camera_key,
            result.get("daily_detection_count") or result["detection_count"],
        )
        return True

    def _analyze_unknown_quality(
        self,
        crop: np.ndarray,
        detected_quality: float,
    ) -> tuple[bool, float, dict, str]:
        if self._quality_evaluator:
            quality_result = self._quality_evaluator.analyze(crop)
            quality_pass = bool(quality_result.accepted)
            quality_score = float(quality_result.score)
            quality_payload = quality_result.as_dict()
            analysis_version = "mediapipe-face-landmarker-v2"
        else:
            quality_pass = float(detected_quality) >= 0.7
            quality_score = float(detected_quality)
            quality_payload = {
                "accepted": quality_pass,
                "score": quality_score,
                "reasons": ["filtro_mediapipe_desactivado"],
            }
            analysis_version = "legacy-quality-v1"

        config = self.config_manager.config
        if not config.semantic_reference_filter_enabled:
            return (
                quality_pass,
                quality_score,
                quality_payload,
                analysis_version,
            )

        analysis_version = f"{analysis_version}+{SEMANTIC_REFERENCE_VERSION}"
        if not quality_pass:
            quality_payload["semantic_reference"] = {
                "accepted": False,
                "skipped": True,
                "reasons": ["calidad_base_insuficiente"],
                "version": SEMANTIC_REFERENCE_VERSION,
            }
            return False, quality_score, quality_payload, analysis_version

        gate = self._semantic_reference_gate
        if gate is None:
            semantic_payload = {
                "accepted": False,
                "reasons": ["modelo_semantico_no_disponible"],
                "version": SEMANTIC_REFERENCE_VERSION,
            }
        else:
            with self._gpu_lock:
                semantic_result = gate.evaluate(
                    crop,
                    mesh_detected=bool(quality_payload.get("mesh_detected")),
                    minimum_ear=float(quality_payload.get("minimum_ear") or 0.0),
                )
            semantic_payload = semantic_result.as_dict()
            self._semantic_reference_status = dict(gate.metadata)

        semantic_pass = bool(semantic_payload.get("accepted"))
        semantic_reasons = [
            str(reason)
            for reason in semantic_payload.get("reasons", [])
            if str(reason)
        ]
        quality_payload["semantic_reference"] = semantic_payload
        quality_payload["accepted"] = bool(quality_pass and semantic_pass)
        quality_payload["reasons"] = list(
            dict.fromkeys(
                [
                    *(
                        str(reason)
                        for reason in quality_payload.get("reasons", [])
                        if str(reason)
                    ),
                    *semantic_reasons,
                ]
            )
        )
        return (
            bool(quality_pass and semantic_pass),
            quality_score,
            quality_payload,
            analysis_version,
        )

    def _quality_for_task(
        self,
        task: PersistenceTask,
    ) -> tuple[bool, float, dict, str]:
        if task.quality_pass is None:
            return self._analyze_unknown_quality(
                task.crop,
                task.detected_quality,
            )
        quality_pass = bool(task.quality_pass)
        quality_score = float(
            task.quality_score
            if task.quality_score is not None
            else task.detected_quality
        )
        quality_payload = dict(task.quality_payload or {})
        quality_payload.setdefault("accepted", quality_pass)
        quality_payload.setdefault("score", quality_score)
        analysis_version = str(task.analysis_version or "legacy-quality-v1")
        return (
            quality_pass,
            quality_score,
            quality_payload,
            analysis_version,
        )

    def _known_reference_is_safe(
        self,
        task: PersistenceTask,
        *,
        quality_pass: bool,
    ) -> bool:
        if not quality_pass or task.embedding is None:
            return False
        if task.source_subject_id:
            return True
        config = self.config_manager.config
        return bool(
            float(task.similarity)
            >= float(config.adaptive_known_min_similarity)
            and float(task.match_margin)
            >= float(config.adaptive_known_min_margin)
        )

    def _unknown_reference_is_safe(
        self,
        task: PersistenceTask,
        *,
        current: dict | None,
        quality_pass: bool,
    ) -> bool:
        if not quality_pass or task.embedding is None:
            return False
        # The first valid observation bootstraps a new identity. Subsequent
        # observations may improve its gallery only after a facial match (not
        # spatial tracking alone) and the stricter adaptive threshold.
        if current is None:
            return True
        return bool(
            task.reference_validated
            and float(task.similarity)
            >= float(self.config_manager.config.adaptive_unknown_min_similarity)
        )

    def _persist_known_night_task_atomic(
        self,
        crop_id: int,
        task: PersistenceTask,
    ) -> dict:
        person = task.person or {}
        person_key = task.subject_key
        (
            quality_pass,
            quality_score,
            quality_payload,
            analysis_version,
        ) = self._quality_for_task(task)
        reference_quality_pass = self._known_reference_is_safe(
            task,
            quality_pass=quality_pass,
        )
        crop_path = (
            copy_crop_file(
                self.store.faces_dir,
                task.existing_crop_path,
                "known",
                person_key,
                task.observed_at,
            )
            if task.existing_crop_path
            else save_crop_image(
                self.store.faces_dir,
                task.crop,
                "known",
                person_key,
                task.observed_at,
                jpeg_quality=self.config_manager.config.spool_jpeg_quality,
            )
        )
        if not crop_path:
            raise RuntimeError("No se pudo codificar el recorte conocido.")
        outcome = self._commit_atomic_night_plan(
            crop_id,
            {
                "status": "processed",
                "result_kind": "known",
                "result_key": person_key,
                "result_name": str(person.get("name") or person_key),
                "person_key": person_key,
                "person_type": str(person.get("person_type") or ""),
                "person_id": int(person.get("remote_id") or 0),
                "seen_at": task.observed_at,
                "crop_path": crop_path,
                "similarity": task.similarity,
                "quality": quality_score,
                "camera": self._camera_labels.get(task.camera_key, task.camera_key),
                "embedding": task.embedding,
                "quality_pass": quality_pass,
                "reference_quality_pass": reference_quality_pass,
                "quality_payload": quality_payload,
                "analysis_version": analysis_version,
                "camera_id": self._camera_ids.get(
                    task.camera_key,
                    self.config_manager.config.camera_id,
                ),
                "source_subject_id": task.source_subject_id,
                "station_id": self._station_id or "local",
            },
            crop_path,
        )
        if outcome.get("result_kind") != "known" or outcome.get("status") != "processed":
            return outcome
        presence = outcome.get("presence") or {}
        self._record_recent_after_atomic_commit(
            "known",
            str(person.get("name") or person_key),
            task.similarity,
            crop_path,
            task.observed_at,
            person_key,
            task.camera_key,
            int(presence.get("detection_count") or 1),
        )
        return outcome

    def _persist_unknown_night_task_atomic(
        self,
        crop_id: int,
        task: PersistenceTask,
    ) -> dict:
        try:
            current = self.store.get_unknown(task.subject_key)
        except LookupError:
            current = None
        if current and current.get("status") in UNKNOWN_INACTIVE_STATUSES:
            return {
                "status": "discarded",
                "result_kind": str(current["status"]),
                "result_key": str(current["subject_id"]),
                "result_name": str(current["temporary_name"]),
                "similarity": task.similarity,
                "queue_committed": False,
            }
        (
            quality_pass,
            quality_score,
            quality_payload,
            analysis_version,
        ) = self._quality_for_task(task)
        if not task.should_persist and not quality_pass:
            return {
                "status": "discarded",
                "result_kind": "unknown",
                "result_key": task.subject_key,
                "result_name": str((task.subject or {}).get("temporary_name") or ""),
                "similarity": task.similarity,
                "queue_committed": False,
            }
        reference_quality_pass = bool(
            self._unknown_reference_is_safe(
                task,
                current=current,
                quality_pass=quality_pass,
            )
        )
        crop_path = (
            copy_crop_file(
                self.store.faces_dir,
                task.existing_crop_path,
                "unknown",
                task.subject_key,
                task.observed_at,
            )
            if task.existing_crop_path
            else save_crop_image(
                self.store.faces_dir,
                task.crop,
                "unknown",
                task.subject_key,
                task.observed_at,
                jpeg_quality=self.config_manager.config.spool_jpeg_quality,
            )
        )
        if not crop_path:
            raise RuntimeError("No se pudo codificar el recorte desconocido.")
        subject = task.subject or {}
        outcome = self._commit_atomic_night_plan(
            crop_id,
            {
                "status": "processed",
                "result_kind": "unknown",
                "subject_id": task.subject_key,
                "temporary_name": str(subject.get("temporary_name") or ""),
                "embedding": task.embedding,
                "seen_at": task.observed_at,
                "crop_path": crop_path,
                "similarity": task.similarity,
                "quality": quality_score,
                "camera": self._camera_labels.get(task.camera_key, task.camera_key),
                "quality_pass": quality_pass,
                "reference_quality_pass": reference_quality_pass,
                "quality_payload": quality_payload,
                "analysis_version": analysis_version,
            },
            crop_path,
        )
        if outcome.get("status") == "discarded" or outcome.get("result_kind") != "unknown":
            Path(crop_path).unlink(missing_ok=True)
            return outcome
        result = outcome.get("subject") or {}
        if not result and outcome.get("result_kind") == "unknown":
            try:
                result = self.store.get_unknown(str(outcome.get("result_key") or task.subject_key))
            except LookupError:
                result = {}
        if task.subject is not None:
            task.subject.update(result)
        if not task.should_persist and quality_pass:
            with self._state_lock:
                self._last_persisted[f"unknown:{task.subject_key}"] = time.monotonic()
        self._record_recent_after_atomic_commit(
            "unknown",
            str(result.get("temporary_name") or task.subject_key),
            task.similarity,
            str(result.get("best_crop_path") or crop_path),
            task.observed_at,
            str(result.get("subject_id") or task.subject_key),
            task.camera_key,
            int(result.get("daily_detection_count") or result.get("detection_count") or 1),
        )
        return outcome

    def _persist_unassigned_night_crop(
        self,
        crop_id: int,
        item: dict,
        detected: DetectedFace,
        observed_at: datetime,
        *,
        reason: str,
        similarity: float,
        match_metadata: dict,
        quality_pass: bool,
        quality_score: float,
        quality_payload: dict,
        analysis_version: str,
    ) -> dict:
        quality_metadata = dict(quality_payload or {})
        quality_metadata.setdefault("accepted", bool(quality_pass))
        quality_metadata.setdefault("score", float(quality_score))
        return self._commit_atomic_night_plan(
            crop_id,
            {
                "status": "processed",
                "result_kind": "unassigned",
                "seen_at": observed_at,
                "crop_path": str(Path(item["crop_path"]).resolve()),
                "embedding": detected.embedding,
                "quality": float(quality_score),
                "det_score": float(item.get("det_score") or detected.score),
                "reason": reason,
                "similarity": float(similarity),
                "match_metadata": dict(match_metadata or {}),
                "quality_payload": quality_metadata,
                "analysis_version": analysis_version,
                "camera": self._camera_labels.get(
                    str(item["camera_key"]),
                    str(item.get("camera_label") or item["camera_key"]),
                ),
            },
        )

    def _commit_atomic_night_plan(
        self,
        crop_id: int,
        plan: dict,
        created_crop_path: str = "",
    ) -> dict:
        try:
            outcome = self.store.commit_night_crop(crop_id, plan)
            outcome["queue_committed"] = True
            if outcome.get("already_committed") and created_crop_path:
                try:
                    if not self.store.face_crop_path_recorded(created_crop_path):
                        Path(created_crop_path).unlink(missing_ok=True)
                except Exception:
                    LOGGER.exception(
                        "No se pudo limpiar el replay del archivo %s",
                        created_crop_path,
                    )
            return outcome
        except Exception as exc:
            committed = None
            try:
                committed = self.store.crop_processing_result(crop_id)
            except Exception:
                LOGGER.exception(
                    "No se pudo confirmar el estado del recorte atomico %s",
                    crop_id,
                )
            if committed and committed.get("status") in {"processed", "discarded"}:
                if created_crop_path:
                    try:
                        if not self.store.face_crop_path_recorded(created_crop_path):
                            Path(created_crop_path).unlink(missing_ok=True)
                    except Exception:
                        LOGGER.exception(
                            "No se pudo limpiar el archivo recuperado %s",
                            created_crop_path,
                        )
                recovered = dict(committed)
                recovered["queue_committed"] = True
                recovered["already_committed"] = True
                recovered["crop_path"] = created_crop_path
                return recovered
            if created_crop_path:
                try:
                    if not self.store.face_crop_path_recorded(created_crop_path):
                        Path(created_crop_path).unlink(missing_ok=True)
                except Exception:
                    LOGGER.exception(
                        "No se pudo limpiar el archivo compensatorio %s",
                        created_crop_path,
                    )
            raise AtomicNightCommitError(
                f"Fallo el commit SQLite atomico del recorte {crop_id}: {exc}"
            ) from exc

    def _record_recent_after_atomic_commit(
        self,
        kind: str,
        name: str,
        similarity: float,
        crop_path: str,
        observed_at: datetime,
        subject_key: str,
        camera_key: str,
        detection_count: int,
    ) -> None:
        try:
            self._record_recent(
                kind,
                name,
                similarity,
                crop_path,
                observed_at,
                subject_key,
                camera_key,
                detection_count,
            )
        except Exception:
            LOGGER.exception(
                "El commit atomico termino, pero no se pudo refrescar recientes para %s",
                subject_key,
            )

    def _capture_frame(self, source_frame, captured_at: float, camera_key: str) -> None:
        config = self.config_manager.config
        observed_at = business_time(
            datetime.fromtimestamp(
                captured_at or time.time(),
                timezone.utc,
            )
        )
        observed_date = observed_at.date().isoformat()
        if observed_date != self._capture_date:
            with self._state_lock:
                self._capture_date = observed_date
                self._captured_frames_today = 0
                self._captured_faces_today = 0
        source_height, source_width = source_frame.shape[:2]
        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(0, min(source_width - 1, int(round(source_width * roi_left))))
        roi_x2 = max(roi_x1 + 1, min(source_width, int(round(source_width * roi_right))))
        detection_frame = source_frame[:, roi_x1:roi_x2]
        detector = self._detectors.get(camera_key) or self._detector
        roi_detections = detector.detect(detection_frame) if detector else []
        detections = [
            self._offset_detection(detected, roi_x1, 0)
            for detected in roi_detections
        ]
        preview_due = (
            time.monotonic() - self._last_preview_at.get(camera_key, 0.0)
            >= 1.0 / max(float(config.preview_fps), 1.0)
        )
        preview_frame = resize_for_processing(source_frame, config.preview_width) if preview_due else None
        preview_scale_x = (
            preview_frame.shape[1] / source_frame.shape[1]
            if preview_frame is not None
            else 1.0
        )
        preview_scale_y = (
            preview_frame.shape[0] / source_frame.shape[0]
            if preview_frame is not None
            else 1.0
        )
        if preview_frame is not None:
            draw_detection_roi(
                preview_frame,
                (
                    int(round(roi_x1 * preview_scale_x)),
                    0,
                    int(round(roi_x2 * preview_scale_x)),
                    preview_frame.shape[0],
                ),
            )
        for detected in detections:
            crop, bounds = face_crop_with_bounds(source_frame, detected)
            if crop.size == 0:
                continue
            left, top, _, _ = bounds
            relative_landmarks = None
            if detected.landmarks is not None:
                relative_landmarks = detected.landmarks.copy()
                relative_landmarks[:, 0] -= left
                relative_landmarks[:, 1] -= top
            self._enqueue_persistence(
                PersistenceTask(
                    kind="raw",
                    subject_key=uuid4().hex,
                    observed_at=observed_at,
                    crop=crop.copy(),
                    similarity=0.0,
                    detected_quality=detected.score,
                    camera_key=camera_key,
                    bbox=detected.bbox,
                    landmarks=relative_landmarks,
                )
            )
            if preview_frame is not None:
                x1, y1, x2, y2 = detected.bbox
                preview_detection = DetectedFace(
                    bbox=(
                        int(round(x1 * preview_scale_x)),
                        int(round(y1 * preview_scale_y)),
                        int(round(x2 * preview_scale_x)),
                        int(round(y2 * preview_scale_y)),
                    ),
                    embedding=None,
                    score=detected.score,
                    quality=detected.quality,
                )
                draw_face(
                    preview_frame,
                    preview_detection,
                    f"Recorte en cola {detected.score * 100:.0f}%",
                    BLUE,
                )
        if detections:
            self._last_face_at = time.monotonic()
        with self._state_lock:
            self._detected_faces += len(detections)
            self._captured_frames_today += 1
            self._captured_faces_today += len(detections)
        if preview_frame is not None:
            self._set_preview(encode_preview(preview_frame, config.preview_width), camera_key)
            self._last_preview_at[camera_key] = time.monotonic()

    def _process_frame(self, source_frame, captured_at: float, camera_key: str) -> None:
        config = self.config_manager.config
        preview_due = (
            time.monotonic() - self._last_preview_at.get(camera_key, 0.0)
            >= 1.0 / max(float(config.preview_fps), 1.0)
        )
        frame = resize_for_processing(source_frame, config.processing_width)
        observed_at = business_time(
            datetime.fromtimestamp(
                captured_at or time.time(),
                timezone.utc,
            )
        )
        detections = self._engine.detect(frame) if self._engine else []
        track_matches, lingering_tracks = self._assign_unknown_tracks(camera_key, detections)
        next_tracks: list[dict] = []
        with self._state_lock:
            self._detected_faces += len(detections)
        for detection_index, detected in enumerate(detections):
            track = track_matches[detection_index]
            crop_detection = self._detection_for_source(detected, frame, source_frame)
            known_match = self._engine.match_known(detected.embedding) if self._engine else None
            if known_match and known_match.matched:
                matched_person = next(
                    (
                        person
                        for person in known_match.candidates
                        if self.store.find_session(person["person_key"], observed_at) is not None
                    ),
                    known_match.person,
                )
                label = self._handle_known(
                    crop_detection,
                    matched_person,
                    known_match.similarity,
                    observed_at,
                    source_frame,
                    match_margin=float(getattr(known_match, "margin", 0.0)),
                    camera_key=camera_key,
                )
                if preview_due:
                    draw_face(frame, detected, label, GREEN)
                continue

            unknown, unknown_similarity, unknown_match = self._match_persistent_unknown(
                detected.embedding
            )
            unknown_match = dict(unknown_match or {})
            reference_validated = unknown is not None
            match_margin = float(unknown_match.get("margin") or 0.0)
            if unknown is None:
                with self._state_lock:
                    candidate_rows = self._candidate_rows
                    candidate_matrix = self._candidate_matrix
                unknown, unknown_similarity = match_matrix(
                    detected.embedding,
                    candidate_rows,
                    candidate_matrix,
                    config.unknown_threshold,
                )
                reference_validated = unknown is not None
                match_margin = 0.0
            # Recognition embeddings can change drastically while a person
            # lowers their head. Spatial continuity across adjacent frames is
            # safer than lowering the global facial threshold and accidentally
            # merging two different people.
            if unknown is None and track:
                tracked = track.get("subject")
                if tracked and tracked.get("status") in {
                    "candidate",
                    "consolidated",
                    "linked",
                    "ignored",
                    "quarantined",
                }:
                    unknown = tracked
                    unknown_similarity = float(track["embedding"] @ detected.embedding)
                    reference_validated = False
                    match_margin = 0.0
            if unknown and unknown.get("status") in UNKNOWN_INACTIVE_STATUSES:
                next_tracks.append(
                    {
                        "subject_id": unknown["subject_id"],
                        "subject": unknown,
                        "embedding": detected.embedding.copy(),
                        "bbox": detected.bbox,
                        "updated_at": time.monotonic(),
                    }
                )
                if preview_due:
                    status_label = (
                        "Cuarentena"
                        if unknown.get("status") == "quarantined"
                        else "Descartado"
                    )
                    draw_face(
                        frame,
                        detected,
                        f"{status_label} {max(0, unknown_similarity) * 100:.0f}%",
                        MUTED,
                    )
                continue
            if unknown and unknown.get("linked_person_key"):
                linked_person = self.store.get_person(unknown["linked_person_key"])
                if linked_person:
                    label = self._handle_known(
                        crop_detection,
                        linked_person,
                        unknown_similarity,
                        observed_at,
                        source_frame,
                        source_subject_id=unknown["subject_id"],
                        match_margin=match_margin,
                        camera_key=camera_key,
                    )
                    if preview_due:
                        draw_face(frame, detected, label, GREEN)
                    continue
            unknown = self._handle_unknown(
                crop_detection,
                unknown,
                unknown_similarity,
                observed_at,
                source_frame,
                camera_key,
                reference_validated=reference_validated,
                match_margin=match_margin,
            )
            next_tracks.append(
                {
                    "subject_id": unknown["subject_id"],
                    "subject": unknown,
                    "embedding": detected.embedding.copy(),
                    "bbox": detected.bbox,
                    "updated_at": time.monotonic(),
                }
            )
            color = AMBER if unknown["status"] == "consolidated" else BLUE
            if preview_due:
                draw_face(frame, detected, unknown["temporary_name"], color)

        active_subjects = {track["subject_id"] for track in next_tracks}
        self._unknown_tracks[camera_key] = [
            *next_tracks,
            *(track for track in lingering_tracks if track["subject_id"] not in active_subjects),
        ]

        if preview_due:
            self._set_preview(encode_preview(frame, config.preview_width), camera_key)
            self._last_preview_at[camera_key] = time.monotonic()

    def _handle_known(
        self,
        detected: DetectedFace,
        person: dict,
        similarity: float,
        observed_at: datetime,
        frame,
        source_subject_id: str = "",
        match_margin: float = 0.0,
        camera_key: str = "primary",
    ) -> str:
        person_key = person["person_key"]
        should_persist = self._should_persist(f"known:{person_key}")
        if should_persist:
            self._enqueue_persistence(
                PersistenceTask(
                    kind="known",
                    subject_key=person_key,
                    observed_at=observed_at,
                    crop=face_crop(frame, detected).copy(),
                    similarity=similarity,
                    detected_quality=detected.quality,
                    camera_key=camera_key,
                    match_margin=match_margin,
                    embedding=(
                        detected.embedding.copy()
                        if detected.embedding is not None
                        else None
                    ),
                    person=dict(person),
                    source_subject_id=source_subject_id,
                )
            )
        return f"{person['name']} {max(0, similarity) * 100:.0f}%"

    def _handle_unknown(
        self,
        detected: DetectedFace,
        unknown: dict | None,
        similarity: float,
        observed_at: datetime,
        frame,
        camera_key: str,
        *,
        reference_validated: bool = True,
        match_margin: float = 0.0,
    ) -> dict:
        new_identity = None if unknown else self.store.next_unknown_name()
        key = unknown["subject_id"] if unknown else new_identity[0]
        persist_key = f"unknown:{key}"
        should_persist = unknown is None or self._should_persist(persist_key)
        should_probe_quality = bool(
            unknown
            and unknown.get("status") == "candidate"
            and key not in self._pending_quality_subjects
            and self._should_probe_quality(persist_key)
        )
        if unknown and not should_persist and not should_probe_quality:
            return unknown
        subject = unknown or {
            "subject_id": new_identity[0],
            "temporary_name": new_identity[1],
            "status": "candidate",
            "best_crop_path": "",
            "best_quality": 0.0,
            "detection_count": 1,
            "daily_detection_count": 0,
            "linked_person_key": None,
        }
        self._enqueue_persistence(
            PersistenceTask(
                kind="unknown",
                subject_key=key,
                observed_at=observed_at,
                crop=face_crop(frame, detected).copy(),
                similarity=similarity,
                detected_quality=detected.quality,
                camera_key=camera_key,
                match_margin=match_margin,
                embedding=detected.embedding.copy(),
                subject=subject,
                should_persist=should_persist,
                reference_validated=(unknown is None or reference_validated),
            )
        )
        return subject

    def _automatic_batch_due_date(self, observed_at: datetime | None = None) -> str:
        local_now = business_time(
            observed_at or datetime.now(BUSINESS_TIME_ZONE)
        )
        hour_text, minute_text = self.config_manager.config.night_batch_start_time.split(":")
        scheduled_minute = int(hour_text) * 60 + int(minute_text)
        current_minute = local_now.hour * 60 + local_now.minute
        if current_minute < scheduled_minute:
            return ""
        run_date = local_now.date().isoformat()
        if self._automatic_batch_completed_date == run_date:
            return ""
        return run_date

    def _ensure_night_pipeline(self) -> None:
        with self._night_engine_lock:
            config = self.config_manager.config
            if not self._engine:
                engine = FaceEngine(config)
                engine.load()
                self._engine = engine
            if config.quality_filter_enabled and not self._quality_evaluator:
                model_path = (
                    config.quality_model_path
                    or str(self.config_manager.data_dir / "models" / "face_landmarker.task")
                )
                thresholds = FaceQualityThresholds(
                    max_yaw=config.quality_max_yaw,
                    max_pitch=config.quality_max_pitch,
                    max_roll=config.quality_max_roll,
                    min_face_width=config.quality_min_face_width,
                    min_face_height=config.quality_min_face_height,
                    min_interocular=config.quality_min_interocular,
                    min_sharpness=config.quality_min_sharpness,
                )
                self._quality_evaluator = FaceQualityEvaluator(model_path, thresholds)
            if (
                config.semantic_reference_filter_enabled
                and self._semantic_reference_gate is None
            ):
                semantic_model_path = (
                    config.semantic_reference_model_path
                    or str(
                        self.config_manager.data_dir
                        / "models"
                        / "face_parser_resnet18.onnx"
                    )
                )
                semantic_gate = SemanticReferenceGate(
                    semantic_model_path,
                    processing_device=config.processing_device,
                )
                semantic_gate.load()
                self._semantic_reference_gate = semantic_gate
                self._semantic_reference_status = dict(semantic_gate.metadata)
            self._reload_known_database()
            self._reload_unknown_database()

    def _semantic_reference_metadata(self) -> dict:
        gate = self._semantic_reference_gate
        if gate is not None:
            return dict(gate.metadata)
        return dict(self._semantic_reference_status)

    def _release_semantic_reference_gate(self) -> None:
        gate = self._semantic_reference_gate
        if gate is None:
            return
        metadata = dict(gate.metadata)
        gate.close()
        metadata["loaded"] = False
        metadata["released"] = True
        self._semantic_reference_status = metadata
        self._semantic_reference_gate = None

    def _begin_manual_batch(self) -> None:
        write_mode = False
        with self._state_lock:
            if self._manual_batch_active:
                return
            write_mode = bool(
                self.config_manager.config.night_batch_atomic_commit_enabled
            )
            self._manual_batch_active = True
            self._batch_persistence_fence = None
            self._detection_paused = True
            self._manual_batch_status = "pausing"
            self._manual_batch_started_at = datetime.now(timezone.utc).isoformat()
            self._manual_batch_finished_at = ""
            self._batch_atomic_commit_active = write_mode
            self._batch_atomic_commits = 0
            self._batch_atomic_failures = 0
            self._batch_legacy_writes = 0
            self._batch_atomic_last_error = ""
            self._batch_embedding_batches = 0
            self._batch_embedding_batch_failures = 0
        self._persist_batch_write_state("atomic" if write_mode else "legacy")

    def _finish_manual_batch(self, status: str, error: str = "") -> None:
        self._release_semantic_reference_gate()
        automatic_completed_date = ""
        if status in {"completed", "completed_with_errors"}:
            automatic_completed_date = self._automatic_batch_due_date()
            if automatic_completed_date:
                self.store.set_runtime_state(
                    AUTOMATIC_BATCH_COMPLETED_STATE_KEY,
                    automatic_completed_date,
                )
        with self._state_lock:
            if automatic_completed_date:
                self._automatic_batch_completed_date = automatic_completed_date
            self._manual_batch_active = False
            self._detection_paused = False
            self._manual_batch_status = status
            self._manual_batch_finished_at = datetime.now(timezone.utc).isoformat()
            self._manual_batch_last_error = error
            self._batch_current_crop_id = 0
            self._manual_batch_requested.clear()
            self._manual_batch_cancel_requested.clear()
            self._manual_detection_ready.clear()
            self._batch_persistence_fence = None
        if status in {"completed", "completed_with_errors"}:
            self.store.start_match_analysis(force=False)

    def _begin_automatic_batch(self, run_date: str) -> None:
        summary = self.store.crop_queue_total_summary()
        write_mode = bool(
            self.config_manager.config.night_batch_atomic_commit_enabled
        )
        with self._state_lock:
            if self._automatic_batch_active:
                return
            self._automatic_batch_active = True
            self._automatic_batch_run_date = run_date
            self._automatic_batch_started_at = datetime.now(timezone.utc).isoformat()
            self._automatic_batch_finished_at = ""
            self._automatic_batch_initial_pending = int(summary["pending"])
            self._automatic_batch_last_error = ""
            self._batch_processed = 0
            self._batch_discarded = 0
            self._batch_failed = 0
            self._batch_direct_embeddings = 0
            self._batch_detection_fallbacks = 0
            self._batch_embedding_batches = 0
            self._batch_embedding_batch_failures = 0
            self._batch_atomic_commit_active = write_mode
            self._batch_atomic_commits = 0
            self._batch_atomic_failures = 0
            self._batch_legacy_writes = 0
            self._batch_atomic_last_error = ""
            self._batch_persistence_fence = None
            self._detection_paused = True
            self._batch_state = "automatic_pausing"
            self._manual_detection_ready.clear()
            self._automatic_batch_requested.set()
        self._persist_batch_write_state("atomic" if write_mode else "legacy")

    def _persist_batch_write_state(self, mode: str, error: str = "") -> None:
        try:
            self.store.set_runtime_state(
                NIGHT_BATCH_WRITE_STATE_KEY,
                json.dumps(
                    {
                        "mode": str(mode),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "error": str(error)[:1000],
                    },
                    ensure_ascii=True,
                ),
            )
        except Exception:
            LOGGER.exception("No se pudo guardar el modo de escritura del lote nocturno")

    def _finish_automatic_batch(
        self,
        run_date: str,
        *,
        status: str = "caught_up",
        error: str = "",
    ) -> None:
        self._release_semantic_reference_gate()
        self.store.set_runtime_state(AUTOMATIC_BATCH_COMPLETED_STATE_KEY, run_date)
        with self._state_lock:
            self._automatic_batch_completed_date = run_date
            self._automatic_batch_active = False
            self._automatic_batch_run_date = ""
            self._automatic_batch_finished_at = datetime.now(timezone.utc).isoformat()
            self._automatic_batch_last_error = error
            self._batch_current_crop_id = 0
            self._batch_persistence_fence = None
            self._batch_state = status
            self._detection_paused = False
            self._automatic_batch_requested.clear()
            self._manual_detection_ready.clear()
        self.store.start_match_analysis(force=False)

    def _capture_persistence_drained(self) -> bool:
        with self._state_lock:
            if self._batch_persistence_fence is None:
                self._batch_persistence_fence = self._persistence_enqueued
            completed = self._persistence_completed + self._persistence_failed
            return completed >= self._batch_persistence_fence

    def _batch_loop(self) -> None:
        while not self._stop.is_set():
            manual_run = self._manual_batch_requested.is_set()
            automatic_run_date = ""
            if manual_run:
                self._begin_manual_batch()
                if self._manual_batch_cancel_requested.is_set():
                    self._finish_manual_batch("cancelled")
                    continue
                if not self._manual_detection_ready.is_set():
                    self._batch_state = "manual_pausing"
                    with self._state_lock:
                        self._manual_batch_status = "pausing"
                    self._stop.wait(0.05)
                    continue
            else:
                automatic_run_date = self._automatic_batch_due_date()
                if not automatic_run_date:
                    self._batch_state = "waiting_schedule"
                    self._batch_current_crop_id = 0
                    self._stop.wait(0.5)
                    continue
                self._begin_automatic_batch(automatic_run_date)
                if not self._manual_detection_ready.is_set():
                    self._batch_state = "automatic_pausing"
                    self._stop.wait(0.05)
                    continue
            if not self._capture_persistence_drained():
                self._batch_state = "manual_draining" if manual_run else "automatic_draining"
                if manual_run:
                    with self._state_lock:
                        self._manual_batch_status = "draining"
                self._stop.wait(0.05)
                continue
            if manual_run:
                with self._state_lock:
                    self._manual_batch_status = "loading"
            config = self.config_manager.config
            if (
                not self._engine
                or (
                    config.semantic_reference_filter_enabled
                    and self._semantic_reference_gate is None
                )
            ):
                self._batch_state = "manual_loading" if manual_run else "loading"
                try:
                    self._ensure_night_pipeline()
                except Exception as exc:
                    LOGGER.exception("No se pudo cargar el motor nocturno")
                    with self._state_lock:
                        self._batch_failed += 1
                        if manual_run:
                            self._manual_batch_failed += 1
                    if manual_run:
                        self._finish_manual_batch("error", str(exc))
                    else:
                        self._finish_automatic_batch(
                            automatic_run_date,
                            status="error",
                            error=str(exc),
                        )
                    continue
            if manual_run and self._manual_batch_cancel_requested.is_set():
                self._finish_manual_batch("cancelled")
                continue
            embedding_batch_size = int(
                self.config_manager.config.night_embedding_batch_size
            )
            if embedding_batch_size <= 1:
                item = self.store.claim_pending_crop()
                prepared_items = (
                    [(item, None, None, False)]
                    if item
                    else []
                )
            else:
                queued_items = self.store.pending_crop_batch(embedding_batch_size)
                prepared_items = self._prepare_queued_crop_batch(queued_items)
            if not prepared_items:
                self._finish_empty_batch(manual_run, automatic_run_date)
                continue
            self._batch_state = "manual_processing" if manual_run else "processing"
            if manual_run:
                with self._state_lock:
                    self._manual_batch_status = "processing"
            for queued_item, image, detected, embedding_prepared in prepared_items:
                if self._stop.is_set():
                    break
                if manual_run and self._manual_batch_cancel_requested.is_set():
                    break
                item = (
                    queued_item
                    if not embedding_prepared
                    else self.store.claim_pending_crop(int(queued_item["id"]))
                )
                if not item:
                    continue
                landmark_rejection = queued_item.get("_landmark_rejection")
                if landmark_rejection:
                    item["_landmark_rejection"] = landmark_rejection
                self._process_claimed_queued_crop(
                    item,
                    manual_run=manual_run,
                    image=image,
                    detected=detected,
                    embedding_prepared=embedding_prepared,
                )

    def _finish_empty_batch(
        self,
        manual_run: bool,
        automatic_run_date: str,
    ) -> None:
        if self._batch_state not in {"caught_up", "manual_complete"}:
            self._batch_state = (
                "manual_reconciling" if manual_run else "reconciling"
            )
            try:
                self.reconcile_unknowns(apply=True)
            except Exception as exc:
                LOGGER.exception(
                    "No se pudo reconciliar la base de desconocidos"
                )
                with self._state_lock:
                    self._batch_failed += 1
                    if manual_run:
                        self._manual_batch_failed += 1
                        self._manual_batch_last_error = str(exc)
                    else:
                        self._automatic_batch_last_error = str(exc)
            try:
                self._run_evidence_maintenance()
            except Exception as exc:
                LOGGER.exception(
                    "No se pudo completar la curacion/retencion de evidencia"
                )
                with self._state_lock:
                    self._batch_failed += 1
                    if manual_run:
                        self._manual_batch_failed += 1
                        self._manual_batch_last_error = str(exc)
                    else:
                        self._automatic_batch_last_error = str(exc)
            # Refresh once after the complete batch so detection resumes with
            # the final curated multi-reference galleries.
            self._reload_known_database()
            self._reload_unknown_database()
            # The parser is only needed for strict reference admission during
            # the batch. Free its CUDA session before live capture resumes.
            self._release_semantic_reference_gate()
        if manual_run:
            self._batch_state = "manual_complete"
            final_status = (
                "completed_with_errors"
                if self._manual_batch_failed
                else "completed"
            )
            self._finish_manual_batch(final_status)
        else:
            self._finish_automatic_batch(automatic_run_date)

    def _run_evidence_maintenance(self) -> dict:
        config = self.config_manager.config
        started_at = datetime.now(timezone.utc).isoformat()
        with self._state_lock:
            self._evidence_maintenance_status = {
                "status": "running",
                "started_at": started_at,
                "finished_at": "",
                "last_error": "",
            }
        try:
            curation = self.store.curate_pending_daily_evidence(
                limit=int(config.daily_evidence_limit),
            )
            retention = self.store.prune_redundant_evidence(
                safety_days=int(config.evidence_safety_days),
            )
            purge = self.store.purge_retention_quarantine()
            result = {
                "status": "completed",
                "started_at": started_at,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "last_error": "",
                "curation": curation,
                "retention": retention,
                "purge": purge,
            }
        except Exception as exc:
            result = {
                "status": "failed",
                "started_at": started_at,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "last_error": str(exc),
            }
            with self._state_lock:
                self._evidence_maintenance_status = result
            self.store.set_runtime_state(
                EVIDENCE_MAINTENANCE_STATE_KEY,
                json.dumps(result, ensure_ascii=True),
            )
            raise
        with self._state_lock:
            self._evidence_maintenance_status = result
        self.store.set_runtime_state(
            EVIDENCE_MAINTENANCE_STATE_KEY,
            json.dumps(result, ensure_ascii=True),
        )
        return result

    def _prepare_queued_crop_batch(
        self,
        queued_items: list[dict],
    ) -> list[tuple[dict, np.ndarray | None, DetectedFace | None, bool]]:
        if not queued_items:
            return []
        prepared: list[dict] = []
        direct_indexes: list[int] = []
        direct_images: list[np.ndarray] = []
        direct_landmarks: list[np.ndarray] = []
        for item in queued_items:
            image = cv2.imread(str(item["crop_path"]))
            prepared.append({"item": item, "image": image, "detected": None})
            if image is None:
                continue
            landmarks = np.asarray(item.get("landmarks") or [], dtype=np.float32)
            if landmarks.shape == (5, 2) and np.isfinite(landmarks).all():
                try:
                    validate_insightface_landmarks(image, landmarks)
                except LandmarkValidationError as exc:
                    item["_landmark_rejection"] = ",".join(exc.reasons)
                    prepared[-1]["detected"] = self._embedding_from_queued_crop(
                        item,
                        image,
                    )
                    continue
                direct_indexes.append(len(prepared) - 1)
                direct_images.append(image)
                direct_landmarks.append(landmarks)
            else:
                prepared[-1]["detected"] = self._embedding_from_queued_crop(
                    item,
                    image,
                )

        engine = self._engine
        if engine is not None and len(direct_indexes) > 1:
            try:
                with self._gpu_lock:
                    embeddings = engine.embeddings_from_landmarks_batch(
                        direct_images,
                        direct_landmarks,
                    )
                if len(embeddings) != len(direct_indexes):
                    raise ValueError("ArcFace devolvio un numero inesperado de embeddings.")
                for prepared_index, embedding in zip(direct_indexes, embeddings):
                    entry = prepared[prepared_index]
                    entry["detected"] = self._queued_face_from_embedding(
                        entry["item"],
                        entry["image"],
                        embedding,
                    )
                with self._state_lock:
                    self._batch_direct_embeddings += len(direct_indexes)
                    self._batch_embedding_batches += 1
            except (RuntimeError, ValueError) as exc:
                LOGGER.warning(
                    "ArcFace no pudo procesar el lote de %s recortes; "
                    "se usara la ruta individual: %s",
                    len(direct_indexes),
                    exc,
                )
                with self._state_lock:
                    self._batch_embedding_batch_failures += 1
                for prepared_index in direct_indexes:
                    entry = prepared[prepared_index]
                    entry["detected"] = self._embedding_from_queued_crop(
                        entry["item"],
                        entry["image"],
                    )
        else:
            for prepared_index in direct_indexes:
                entry = prepared[prepared_index]
                entry["detected"] = self._embedding_from_queued_crop(
                    entry["item"],
                    entry["image"],
                )

        return [
            (entry["item"], entry["image"], entry["detected"], True)
            for entry in prepared
        ]

    def _process_claimed_queued_crop(
        self,
        item: dict,
        *,
        manual_run: bool,
        image: np.ndarray | None = None,
        detected: DetectedFace | None = None,
        embedding_prepared: bool = False,
    ) -> None:
        self._batch_current_crop_id = int(item["id"])
        source_path = Path(item["crop_path"])
        try:
            result = (
                self._process_queued_crop(
                    item,
                    image=image,
                    detected=detected,
                    embedding_prepared=True,
                )
                if embedding_prepared
                else self._process_queued_crop(item)
            )
            if result.get("queue_committed"):
                with self._state_lock:
                    self._batch_atomic_commits += 1
            else:
                finalized = self.store.finish_crop_processing(
                    int(item["id"]),
                    status=result["status"],
                    result_kind=result.get("result_kind", ""),
                    result_key=result.get("result_key", ""),
                    result_name=result.get("result_name", ""),
                    similarity=float(result.get("similarity") or 0.0),
                    expected_status="processing",
                )
                if not finalized:
                    durable = self.store.crop_processing_result(int(item["id"]))
                    if not durable or durable.get("status") not in {
                        "processed",
                        "discarded",
                    }:
                        raise RuntimeError(
                            f"No se pudo confirmar el cierre del recorte {item['id']}."
                        )
                with self._state_lock:
                    self._batch_legacy_writes += 1
            if result.get("result_kind") != "unassigned":
                source_path.unlink(missing_ok=True)
            with self._state_lock:
                if result["status"] == "discarded":
                    self._batch_discarded += 1
                    if manual_run:
                        self._manual_batch_discarded += 1
                else:
                    self._batch_processed += 1
                    if manual_run:
                        self._manual_batch_processed += 1
        except Exception as exc:
            LOGGER.exception("No se pudo procesar el recorte nocturno %s", item["id"])
            if isinstance(exc, AtomicNightCommitError):
                with self._state_lock:
                    self._batch_atomic_failures += 1
                    self._batch_atomic_commit_active = False
                    self._batch_atomic_last_error = str(exc)
                self._persist_batch_write_state("legacy_fallback", str(exc))
                LOGGER.error(
                    "Se desactivo el commit atomico para el resto del lote; "
                    "el recorte %s queda recuperable como error",
                    item["id"],
                )
            self.store.finish_crop_processing(
                int(item["id"]),
                status="error",
                error=str(exc),
                expected_status="processing",
            )
            with self._state_lock:
                self._batch_failed += 1
                if manual_run:
                    self._manual_batch_failed += 1
                    self._manual_batch_last_error = str(exc)
        finally:
            self._batch_current_crop_id = 0

    def _process_queued_crop(
        self,
        item: dict,
        *,
        image: np.ndarray | None = None,
        detected: DetectedFace | None = None,
        embedding_prepared: bool = False,
    ) -> dict:
        atomic_commit = self._batch_atomic_commit_active
        source_path = Path(item["crop_path"])
        if not embedding_prepared:
            image = cv2.imread(str(source_path))
        if image is None:
            return {"status": "discarded", "result_name": "Imagen ilegible"}
        if not embedding_prepared:
            detected = self._embedding_from_queued_crop(item, image)
        if detected is None:
            landmark_rejection = str(item.get("_landmark_rejection") or "")
            if landmark_rejection:
                return {
                    "status": "discarded",
                    "result_kind": "invalid_landmarks",
                    "result_name": f"Landmarks invalidos: {landmark_rejection}",
                }
            return {"status": "discarded", "result_name": "Sin rostro util"}
        if detected.embedding is None:
            return {"status": "discarded", "result_name": "Sin embedding"}
        observed_at = datetime.fromisoformat(str(item["captured_at"]))
        (
            quality_pass,
            quality_score,
            quality_payload,
            analysis_version,
        ) = self._analyze_unknown_quality(image, detected.quality)
        known_match = self._engine.match_known(detected.embedding) if self._engine else None
        if known_match and known_match.matched:
            matched_person = next(
                (
                    person
                    for person in known_match.candidates
                    if self.store.find_session(person["person_key"], observed_at) is not None
                ),
                known_match.person,
            )
            task = PersistenceTask(
                kind="known",
                subject_key=matched_person["person_key"],
                observed_at=observed_at,
                crop=image,
                similarity=known_match.similarity,
                detected_quality=detected.quality,
                camera_key=str(item["camera_key"]),
                match_margin=float(getattr(known_match, "margin", 0.0)),
                embedding=detected.embedding,
                person=dict(matched_person),
                existing_crop_path=str(source_path),
                quality_pass=quality_pass,
                quality_score=quality_score,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
            if atomic_commit:
                return self._persist_known_night_task_atomic(int(item["id"]), task)
            self._persist_known_task(task)
            return {
                "status": "processed",
                "result_kind": "known",
                "result_key": matched_person["person_key"],
                "result_name": matched_person["name"],
                "similarity": known_match.similarity,
            }

        unknown, similarity, unknown_match = self._match_persistent_unknown(
            detected.embedding
        )
        unknown_match = dict(unknown_match or {})
        reference_validated = unknown is not None
        match_margin = float(unknown_match.get("margin") or 0.0)
        if (
            unknown is None
            and str(unknown_match.get("reason") or "") == "ambiguous_margin"
        ):
            return self._persist_unassigned_night_crop(
                int(item["id"]),
                item,
                detected,
                observed_at,
                reason="margen_ambiguo",
                similarity=similarity,
                match_metadata=unknown_match,
                quality_pass=quality_pass,
                quality_score=quality_score,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
        if unknown is None:
            unknown, similarity = self._match_batch_candidate(
                detected.embedding,
                observed_at,
            )
            reference_validated = unknown is not None
            match_margin = 0.0
        if unknown and unknown.get("status") in UNKNOWN_INACTIVE_STATUSES:
            return {
                "status": "discarded",
                "result_kind": str(unknown["status"]),
                "result_key": unknown["subject_id"],
                "result_name": unknown["temporary_name"],
                "similarity": similarity,
            }
        if unknown and unknown.get("linked_person_key"):
            linked_person = self.store.get_person(unknown["linked_person_key"])
            if linked_person:
                task = PersistenceTask(
                    kind="known",
                    subject_key=linked_person["person_key"],
                    observed_at=observed_at,
                    crop=image,
                    similarity=similarity,
                    detected_quality=detected.quality,
                    camera_key=str(item["camera_key"]),
                    match_margin=match_margin,
                    embedding=detected.embedding,
                    person=dict(linked_person),
                    source_subject_id=unknown["subject_id"],
                    existing_crop_path=str(source_path),
                    quality_pass=quality_pass,
                    quality_score=quality_score,
                    quality_payload=quality_payload,
                    analysis_version=analysis_version,
                )
                if atomic_commit:
                    return self._persist_known_night_task_atomic(int(item["id"]), task)
                self._persist_known_task(task)
                return {
                    "status": "processed",
                    "result_kind": "known",
                    "result_key": linked_person["person_key"],
                    "result_name": linked_person["name"],
                    "similarity": similarity,
                }

        is_new_identity = unknown is None
        if unknown:
            subject = dict(unknown)
            subject_id = unknown["subject_id"]
        else:
            if not quality_pass:
                return self._persist_unassigned_night_crop(
                    int(item["id"]),
                    item,
                    detected,
                    observed_at,
                    reason="calidad_insuficiente",
                    similarity=similarity,
                    match_metadata=unknown_match,
                    quality_pass=quality_pass,
                    quality_score=quality_score,
                    quality_payload=quality_payload,
                    analysis_version=analysis_version,
                )
            if atomic_commit:
                subject_id, temporary_name = str(uuid4()), ""
            else:
                subject_id, temporary_name = self.store.next_unknown_name()
            subject = {
                "subject_id": subject_id,
                "temporary_name": temporary_name,
                "status": "candidate",
                "best_crop_path": "",
                "best_quality": 0.0,
                "detection_count": 1,
                "daily_detection_count": 0,
                "linked_person_key": None,
            }
        task = PersistenceTask(
            kind="unknown",
            subject_key=subject_id,
            observed_at=observed_at,
            crop=image,
            similarity=similarity,
            detected_quality=detected.quality,
            camera_key=str(item["camera_key"]),
            match_margin=match_margin,
            embedding=detected.embedding,
            subject=subject,
            existing_crop_path=str(source_path),
            reference_validated=(is_new_identity or reference_validated),
            quality_pass=quality_pass,
            quality_score=quality_score,
            quality_payload=quality_payload,
            analysis_version=analysis_version,
        )
        anchor_reference_validated = self._unknown_reference_is_safe(
            task,
            current=None if is_new_identity else subject,
            quality_pass=quality_pass,
        )
        anchor_landmarks_valid = self._batch_anchor_landmarks_valid(
            image,
            detected.landmarks,
        )
        atomic_outcome = (
            self._persist_unknown_night_task_atomic(int(item["id"]), task)
            if atomic_commit
            else None
        )
        persisted = (
            atomic_outcome.get("status") == "processed"
            and atomic_outcome.get("result_kind") == "unknown"
            if atomic_outcome is not None
            else self._persist_unknown_task(task)
        )
        subject_id = str(subject.get("subject_id") or subject_id)
        if atomic_outcome is not None and not persisted:
            return atomic_outcome
        self._apply_batch_unknown_result(
            subject,
            detected.embedding,
            observed_at,
            quality_pass=quality_pass,
            landmarks_valid=anchor_landmarks_valid,
            reference_validated=anchor_reference_validated,
        )
        if not persisted:
            return {
                "status": "discarded",
                "result_kind": "unknown",
                "result_key": subject_id,
                "result_name": subject.get("temporary_name", ""),
                "similarity": similarity,
            }
        return {
            "status": "processed",
            "result_kind": "unknown",
            "result_key": subject_id,
            "result_name": subject.get("temporary_name", subject_id),
            "similarity": similarity,
            "queue_committed": bool(atomic_outcome),
        }

    def _embedding_from_queued_crop(
        self,
        item: dict,
        image: np.ndarray,
    ) -> DetectedFace | None:
        """Reuse SCRFD's stored keypoints and run only ArcFace when possible."""
        engine = self._engine
        if engine is None:
            return None
        landmarks = np.asarray(item.get("landmarks") or [], dtype=np.float32)
        if landmarks.shape == (5, 2) and np.isfinite(landmarks).all():
            try:
                validate_insightface_landmarks(image, landmarks)
            except LandmarkValidationError as exc:
                item["_landmark_rejection"] = ",".join(exc.reasons)
            else:
                try:
                    with self._gpu_lock:
                        embedding = engine.embedding_from_landmarks(image, landmarks)
                    with self._state_lock:
                        self._batch_direct_embeddings += 1
                    item.pop("_landmark_rejection", None)
                    return self._queued_face_from_embedding(
                        item,
                        image,
                        embedding,
                    )
                except (RuntimeError, ValueError) as exc:
                    LOGGER.debug(
                        "No se pudo reutilizar landmarks del recorte %s; se usara SCRFD: %s",
                        item.get("id"),
                        exc,
                    )

        with self._state_lock:
            self._batch_detection_fallbacks += 1
        with self._gpu_lock:
            detections = engine.detect(image)
        if not detections:
            return None
        item.pop("_landmark_rejection", None)
        return max(
            detections,
            key=lambda face: face.score
            * max(1, face.bbox[2] - face.bbox[0])
            * max(1, face.bbox[3] - face.bbox[1]),
        )

    @staticmethod
    def _queued_face_from_embedding(
        item: dict,
        image: np.ndarray,
        embedding: np.ndarray,
    ) -> DetectedFace:
        height, width = image.shape[:2]
        score = float(item.get("det_score") or 0.0)
        area_factor = min(1.0, min(width, height) / 180.0)
        landmarks = np.asarray(item.get("landmarks") or [], dtype=np.float32)
        return DetectedFace(
            bbox=(0, 0, width, height),
            embedding=np.asarray(embedding, dtype=np.float32),
            score=score,
            quality=score * area_factor,
            landmarks=landmarks if landmarks.shape == (5, 2) else None,
        )

    def _refresh_reference_embeddings(self) -> None:
        engine = self._engine
        if not engine:
            return
        config = self.config_manager.config
        if not config.station_token:
            self._reload_known_database()
            return
        pending = [person for person in self.store.people_needing_embeddings() if person.get("photo_url")]
        self._update_reference_summary(pending=len(pending))
        with self._state_lock:
            self._reference_failed = 0
            self._reference_current = ""
        if not pending:
            self._reload_known_database()
            return

        def download(person: dict):
            client = FutsiClient(config.api_url, config.station_token, config.reference_proxy_url)
            return client.download_reference(person, self.store.references_dir)

        executor = ThreadPoolExecutor(max_workers=6, thread_name_prefix="futsi-reference")
        futures = {executor.submit(download, person): person for person in pending}
        completed_since_reload = 0
        try:
            for future in as_completed(futures):
                if self._stop.is_set():
                    break
                person = futures[future]
                with self._state_lock:
                    self._reference_current = person.get("name", person["person_key"])
                try:
                    path = future.result()
                    embedding = engine.embedding_from_reference(path)
                    self.store.save_person_embedding(person["person_key"], path, embedding)
                    completed_since_reload += 1
                    with self._state_lock:
                        self._reference_ready += 1
                except Exception as exc:
                    with self._state_lock:
                        self._reference_failed += 1
                    LOGGER.warning("No se preparo la referencia %s: %s", person["person_key"], exc)
                finally:
                    with self._state_lock:
                        self._reference_pending = max(0, self._reference_pending - 1)
                if completed_since_reload >= 25:
                    self._reload_known_database()
                    completed_since_reload = 0
        finally:
            executor.shutdown(wait=not self._stop.is_set(), cancel_futures=True)
            with self._state_lock:
                self._reference_current = ""
        self._reload_known_database()

    def _update_reference_summary(self, pending: int | None = None) -> None:
        summary = self.store.reference_summary()
        with self._state_lock:
            self._reference_total = summary["total"]
            self._reference_configured = summary["configured"]
            self._reference_ready = summary["ready"]
            self._reference_missing = summary["missing"]
            if pending is not None:
                self._reference_pending = max(0, int(pending))

    def _reload_known_database(self) -> None:
        # Matching consumes the complete curated gallery (up to twelve
        # references per identity), not only the centroid persisted in people.
        # The store filters inactive or invalidated registrations here.
        people, matrix = self.store.known_reference_database()
        if not people:
            # Defensive compatibility for a database that has not completed
            # the reference backfill yet.
            people, matrix = self.store.known_database()
        if self._engine and hasattr(self._engine, "set_known_database"):
            self._engine.set_known_database(people, matrix)

    def _match_persistent_unknown(self, embedding: np.ndarray) -> tuple[dict | None, float, dict]:
        with self._state_lock:
            gallery_index = self._unknown_gallery_index
        config = self.config_manager.config
        return match_prepared_unknown_gallery(
            embedding,
            gallery_index,
            threshold=config.unknown_threshold,
            confirmation_threshold=config.unknown_confirmation_threshold,
            min_margin=config.min_margin,
        )

    def _reload_persistent_unknown_database(self) -> None:
        unknown_rows, unknown_matrix = self.store.unknown_database()
        reference_rows, reference_matrix = self.store.unknown_reference_database()
        gallery_index = prepare_unknown_gallery(
            unknown_rows,
            unknown_matrix,
            reference_rows,
            reference_matrix,
        )
        with self._state_lock:
            self._unknown_rows = unknown_rows
            self._unknown_matrix = unknown_matrix
            self._unknown_reference_rows = reference_rows
            self._unknown_reference_matrix = reference_matrix
            self._unknown_gallery_index = gallery_index
            self._batch_unknowns_since_persistent_reload = 0

    def _reload_unknown_database(self) -> None:
        self._reload_persistent_unknown_database()
        cutoff = datetime.now(BUSINESS_TIME_ZONE) - timedelta(
            minutes=self.config_manager.config.candidate_ttl_minutes
        )
        candidate_rows, candidate_matrix = self.store.candidate_database(cutoff)
        with self._state_lock:
            self._candidate_rows = candidate_rows
            self._candidate_matrix = candidate_matrix
        self._invalidate_batch_candidate_cache()

    def _invalidate_batch_candidate_cache(self) -> None:
        with self._state_lock:
            self._batch_candidates = {}
            self._batch_recent_unknowns = {}
            self._batch_candidate_loaded_epoch = None

    @staticmethod
    def _batch_candidate_entry(
        row: dict,
        embedding: np.ndarray,
    ) -> tuple[dict, np.ndarray]:
        cached_row = dict(row)
        cached_row["_first_seen_epoch"] = datetime.fromisoformat(
            str(cached_row["first_seen_at"])
        ).timestamp()
        cached_row["_last_seen_epoch"] = datetime.fromisoformat(
            str(cached_row["last_seen_at"])
        ).timestamp()
        normalized = np.asarray(embedding, dtype=np.float32)
        normalized /= max(float(np.linalg.norm(normalized)), 1e-12)
        return cached_row, normalized

    def _load_batch_candidate_database(self, observed_at: datetime) -> None:
        cutoff = observed_at - timedelta(
            minutes=self.config_manager.config.candidate_ttl_minutes
        )
        rows, matrix = self.store.candidate_database(
            cutoff,
            active_before=observed_at,
        )
        candidates = {
            str(row["subject_id"]): self._batch_candidate_entry(row, embedding)
            for row, embedding in zip(rows, matrix)
        }
        with self._state_lock:
            self._batch_candidates = candidates
            self._batch_candidate_loaded_epoch = observed_at.timestamp()

    def _ensure_batch_candidate_database(self, observed_at: datetime) -> None:
        observed_epoch = observed_at.timestamp()
        with self._state_lock:
            loaded_epoch = self._batch_candidate_loaded_epoch
        if (
            loaded_epoch is None
            or observed_epoch < loaded_epoch
            or observed_epoch - loaded_epoch
            >= BATCH_CANDIDATE_REFRESH_OBSERVED_SECONDS
        ):
            self._load_batch_candidate_database(observed_at)

    def _match_batch_candidate(
        self,
        embedding: np.ndarray,
        observed_at: datetime,
    ) -> tuple[dict | None, float]:
        self._ensure_batch_candidate_database(observed_at)
        observed_epoch = observed_at.timestamp()
        cutoff_epoch = observed_epoch - (
            self.config_manager.config.candidate_ttl_minutes * 60
        )
        with self._state_lock:
            expired_recent = [
                subject_id
                for subject_id, (row, _embedding) in self._batch_recent_unknowns.items()
                if str(row.get("status") or "") != "consolidated"
                and float(row["_last_seen_epoch"]) < cutoff_epoch
            ]
            for subject_id in expired_recent:
                self._batch_recent_unknowns.pop(subject_id, None)
            candidates = dict(self._batch_candidates)
            # A good first crop is consolidated immediately. Keep identities
            # observed during this chronological batch in a separate overlay
            # so a gallery refresh cannot erase them before the next frame.
            candidates.update(self._batch_recent_unknowns)
            entries = [
                (row, candidate_embedding)
                for row, candidate_embedding in candidates.values()
                if float(row["_first_seen_epoch"]) <= observed_epoch
                and (
                    str(row.get("status") or "") == "consolidated"
                    or float(row["_last_seen_epoch"]) >= cutoff_epoch
                )
            ]
        if not entries:
            return None, 0.0
        rows = [entry[0] for entry in entries]
        matrix = np.vstack([entry[1] for entry in entries]).astype(np.float32)
        return match_matrix(
            embedding,
            rows,
            matrix,
            self.config_manager.config.unknown_threshold,
        )

    @staticmethod
    def _batch_anchor_landmarks_valid(
        image: np.ndarray,
        landmarks: np.ndarray | None,
    ) -> bool:
        """Only geometrically validated five-point alignments may seed a batch."""
        try:
            validate_insightface_landmarks(image, landmarks)
        except (TypeError, ValueError):
            return False
        return True

    def _apply_batch_unknown_result(
        self,
        subject: dict,
        embedding: np.ndarray,
        observed_at: datetime,
        *,
        quality_pass: bool,
        landmarks_valid: bool,
        reference_validated: bool,
    ) -> None:
        subject_id = str(subject.get("subject_id") or "")
        if not subject_id:
            return
        status = str(subject.get("status") or "")
        anchor_eligible = bool(
            quality_pass
            and landmarks_valid
            and reference_validated
        )
        should_reload_persistent = False
        with self._state_lock:
            if status in {"candidate", "consolidated"} and anchor_eligible:
                previous = (
                    self._batch_recent_unknowns.get(subject_id)
                    or self._batch_candidates.get(subject_id)
                )
                first_quality_consolidation = bool(
                    status == "consolidated"
                    and subject.get("promoted")
                )
                candidate_embedding = (
                    embedding
                    if first_quality_consolidation or previous is None
                    else previous[1]
                )
                entry = self._batch_candidate_entry(
                    subject,
                    candidate_embedding,
                )
                self._batch_recent_unknowns[subject_id] = entry
                if status == "candidate":
                    self._batch_candidates[subject_id] = entry
                else:
                    self._batch_candidates.pop(subject_id, None)
            elif status not in {"candidate", "consolidated"}:
                self._batch_candidates.pop(subject_id, None)
                self._batch_recent_unknowns.pop(subject_id, None)
            self._batch_unknowns_since_persistent_reload += 1
            should_reload_persistent = (
                self._batch_unknowns_since_persistent_reload
                >= BATCH_PERSISTENT_REFRESH_CROPS
            )
        if should_reload_persistent:
            self._reload_persistent_unknown_database()

    def _run_benchmark(self) -> None:
        frame = None
        for camera in self._cameras.values():
            candidate, _ = camera.latest()
            if candidate is not None:
                frame = candidate
                break
        if frame is None or not self._detector:
            return
        config = self.config_manager.config
        previous_state = self._state
        self._set_state("benchmarking", "")
        with self._gpu_lock:
            result = self._detector.benchmark(frame, config.benchmark_seconds)
        with self._state_lock:
            self._benchmark = result
            self._target_fps = config.target_fps or result["recommended_fps"]
        self._set_state("running" if previous_state != "starting" else previous_state, "")

    def _wait_for_first_frame(self) -> None:
        deadline = time.monotonic() + 30
        while not self._stop.is_set() and time.monotonic() < deadline:
            for camera in self._cameras.values():
                frame, _ = camera.latest()
                if frame is not None:
                    return
            self._stop.wait(0.2)
        if not self._stop.is_set():
            error = next((camera.last_error for camera in self._cameras.values() if camera.last_error), "")
            raise RuntimeError(error or "Ninguna camara entrego video en 30 segundos.")

    def _should_persist(self, key: str) -> bool:
        now = time.monotonic()
        previous = self._last_persisted.get(key, 0)
        if now - previous < self.config_manager.config.detection_debounce_seconds:
            return False
        self._last_persisted[key] = now
        return True

    def _should_probe_quality(self, key: str) -> bool:
        now = time.monotonic()
        previous = self._last_quality_probe.get(key, 0)
        return now - previous >= QUALITY_PROBE_INTERVAL_SECONDS

    def _assign_unknown_tracks(self, camera_key: str, detections: list[DetectedFace]) -> tuple[list[dict | None], list[dict]]:
        now = time.monotonic()
        tracks = [
            track
            for track in self._unknown_tracks.get(camera_key, [])
            if now - float(track["updated_at"]) <= UNKNOWN_TRACK_TTL_SECONDS
        ]
        candidates: list[tuple[float, int, int]] = []
        for detection_index, detected in enumerate(detections):
            for track_index, track in enumerate(tracks):
                iou = self._bbox_iou(detected.bbox, track["bbox"])
                center_distance = self._normalized_center_distance(detected.bbox, track["bbox"])
                if iou < UNKNOWN_TRACK_MIN_IOU and center_distance > UNKNOWN_TRACK_MAX_CENTER_DISTANCE:
                    continue
                score = iou * 2.0 + max(0.0, 1.0 - center_distance)
                candidates.append((score, detection_index, track_index))
        matches: list[dict | None] = [None] * len(detections)
        used_detections: set[int] = set()
        used_tracks: set[int] = set()
        for _score, detection_index, track_index in sorted(candidates, reverse=True):
            if detection_index in used_detections or track_index in used_tracks:
                continue
            matches[detection_index] = tracks[track_index]
            used_detections.add(detection_index)
            used_tracks.add(track_index)
        lingering = [track for index, track in enumerate(tracks) if index not in used_tracks]
        return matches, lingering

    @staticmethod
    def _bbox_iou(first: tuple[int, int, int, int], second: tuple[int, int, int, int]) -> float:
        left = max(first[0], second[0])
        top = max(first[1], second[1])
        right = min(first[2], second[2])
        bottom = min(first[3], second[3])
        intersection = max(0, right - left) * max(0, bottom - top)
        first_area = max(0, first[2] - first[0]) * max(0, first[3] - first[1])
        second_area = max(0, second[2] - second[0]) * max(0, second[3] - second[1])
        union = first_area + second_area - intersection
        return intersection / max(union, 1)

    @staticmethod
    def _normalized_center_distance(
        first: tuple[int, int, int, int],
        second: tuple[int, int, int, int],
    ) -> float:
        first_center = ((first[0] + first[2]) / 2.0, (first[1] + first[3]) / 2.0)
        second_center = ((second[0] + second[2]) / 2.0, (second[1] + second[3]) / 2.0)
        distance = float(np.hypot(first_center[0] - second_center[0], first_center[1] - second_center[1]))
        first_diagonal = float(np.hypot(first[2] - first[0], first[3] - first[1]))
        second_diagonal = float(np.hypot(second[2] - second[0], second[3] - second[1]))
        return distance / max(first_diagonal, second_diagonal, 1.0)

    def _record_recent(
        self,
        kind: str,
        name: str,
        similarity: float,
        crop_path: str,
        observed_at: datetime,
        subject_key: str,
        camera_key: str,
        detection_count: int,
    ) -> None:
        observed_date = business_time(observed_at).date().isoformat()
        now = time.monotonic()
        refresh_interval = (
            BATCH_RECENT_REFRESH_SECONDS
            if self._batch_state in {"processing", "manual_processing"}
            else LIVE_RECENT_REFRESH_SECONDS
        )
        with self._state_lock:
            if (
                observed_date == self._last_recent_refresh_date
                and now - self._last_recent_refresh_at < refresh_interval
            ):
                return
            self._last_recent_refresh_date = observed_date
            self._last_recent_refresh_at = now
        # The database is authoritative and includes candidates that have a
        # crop but are intentionally absent from daily_presence. Refresh this
        # aggregate periodically; recomputing it for every crop makes a
        # historical batch quadratic as the date accumulates evidence.
        try:
            self._refresh_recent(observed_date)
        except Exception as exc:
            with self._state_lock:
                if self._last_recent_refresh_date == observed_date:
                    self._last_recent_refresh_at = 0.0
            LOGGER.warning("No se pudo actualizar el resumen reciente: %s", exc)

    def _refresh_recent(self, selected_date: str | None = None) -> None:
        selected_date = selected_date or datetime.now(
            BUSINESS_TIME_ZONE
        ).date().isoformat()
        current_summary = self.store.detection_summary(selected_date)
        recent = self.store.recent_detections(selected_date, limit=40)
        with self._state_lock:
            if selected_date != self._recent_date:
                self._recent_date = selected_date
            self._recent_total = int(current_summary["detections"] or 0)
            self._recent_subjects = int(current_summary["subjects"] or 0)
            self._recent = deque(recent, maxlen=40)

    def _set_state(self, state: str, error: str) -> None:
        with self._state_lock:
            self._state = state
            self._last_error = error

    def _set_preview(self, payload: bytes, camera_key: str = "primary") -> None:
        with self._preview_lock:
            self._preview_jpegs[camera_key] = payload

    @staticmethod
    def _detection_for_source(detected: DetectedFace, detection_frame, source_frame) -> DetectedFace:
        """Map a detection back to the untouched camera frame for high-quality crops."""
        detection_height, detection_width = detection_frame.shape[:2]
        source_height, source_width = source_frame.shape[:2]
        if (detection_width, detection_height) == (source_width, source_height):
            return detected
        scale_x = source_width / max(detection_width, 1)
        scale_y = source_height / max(detection_height, 1)
        x1, y1, x2, y2 = detected.bbox
        bbox = (
            max(0, min(source_width - 1, round(x1 * scale_x))),
            max(0, min(source_height - 1, round(y1 * scale_y))),
            max(1, min(source_width, round(x2 * scale_x))),
            max(1, min(source_height, round(y2 * scale_y))),
        )
        return replace(detected, bbox=bbox)

    @staticmethod
    def _offset_detection(detected: DetectedFace, offset_x: int, offset_y: int) -> DetectedFace:
        if not offset_x and not offset_y:
            return detected
        x1, y1, x2, y2 = detected.bbox
        landmarks = None
        if detected.landmarks is not None:
            landmarks = detected.landmarks.copy()
            landmarks[:, 0] += offset_x
            landmarks[:, 1] += offset_y
        return replace(
            detected,
            bbox=(x1 + offset_x, y1 + offset_y, x2 + offset_x, y2 + offset_y),
            landmarks=landmarks,
        )

    @staticmethod
    def _camera_roi(config, camera_key: str) -> tuple[float, float]:
        if camera_key == "secondary":
            return (
                float(config.secondary_camera_roi_left),
                float(config.secondary_camera_roi_right),
            )
        return float(config.camera_roi_left), float(config.camera_roi_right)

    @staticmethod
    def _camera_definitions(config) -> dict[str, dict]:
        definitions = {
            "primary": {
                "source": config.camera_url,
                "fallback_source": config.camera_fallback_url,
                "camera_id": config.camera_id,
                "label": config.camera_label,
                "roi": [float(config.camera_roi_left), float(config.camera_roi_right)],
            }
        }
        if config.secondary_camera_enabled and config.secondary_camera_url:
            definitions["secondary"] = {
                "source": config.secondary_camera_source(),
                "camera_id": config.secondary_camera_id,
                "label": config.secondary_camera_label,
                "roi": [
                    float(config.secondary_camera_roi_left),
                    float(config.secondary_camera_roi_right),
                ],
            }
        return definitions
