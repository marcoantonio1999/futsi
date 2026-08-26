from __future__ import annotations

import json
import logging
import math
import subprocess
import tempfile
import time
from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, as_completed, wait
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event, Lock, RLock, Thread, current_thread
from uuid import NAMESPACE_URL, uuid4, uuid5

import cv2
import numpy as np

from .camera import CameraWorker
from .config import ConfigManager
from .futsi_client import FutsiClient
from .face_quality import FaceQualityEvaluator, FaceQualityThresholds
from .mjpeg_stream import MjpegStreamError, OctetStreamJpegParser
from .match_video import (
    MATCH_EVIDENCE_RETENTION_DAYS,
    MatchEvidenceWriter,
    segment_needs_evidence_candidate,
)
from .mjpeg_index import (
    IndexedMjpegReader,
    MjpegPacket,
    build_mjpeg_index,
    load_mjpeg_index,
    mjpeg_index_path,
    mjpeg_packets_in_windows,
    select_mjpeg_scout_packets,
)
from .nvjpeg_cuda import NvJpegCudaDecoder, NvJpegCudaError
from .preview import AMBER, BLUE, GREEN, MUTED, copy_crop_file, draw_detection_roi, draw_face, encode_preview, face_crop, face_crop_with_bounds, placeholder_frame, resize_for_processing, save_crop_image
from .recognition import (
    DetectedFace,
    FaceDetector,
    FaceEngine,
    LandmarkValidationError,
    match_matrix,
    validate_insightface_landmarks,
)
from .recorded_pipeline import (
    CREATE_NO_WINDOW,
    RecordedCameraWorker,
    TieredRecordingStorage,
    find_media_binary,
    list_segment_jobs,
    list_segment_jobs_in_roots,
    recover_segment_jobs,
    segment_job_summary_in_roots,
    update_segment_job,
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
RAW_FRAME_QUEUE_MAX = 512
RAW_FRAME_WORKER_COUNT = 2
RAW_PERSISTENCE_BATCH_MAX = 64
RAW_PERSISTENCE_BATCH_WINDOW_SECONDS = 0.020
RAW_PERSISTENCE_BACKPRESSURE_SECONDS = 2.0
RAW_PERSISTENCE_BACKPRESSURE_SLICE_SECONDS = 0.1
STOP_CONTROL_JOIN_SECONDS = 8.0
STOP_RAW_DRAIN_SECONDS = 20.0
STOP_PERSISTENCE_DRAIN_SECONDS = 20.0
UNKNOWN_CACHE_REFRESH_SECONDS = 0.25
BATCH_CANDIDATE_REFRESH_OBSERVED_SECONDS = 300.0
BATCH_PERSISTENT_REFRESH_CROPS = 128
BATCH_RECENT_REFRESH_SECONDS = 300.0
LIVE_RECENT_REFRESH_SECONDS = 1.0
AUTOMATIC_BATCH_COMPLETED_STATE_KEY = "automatic_batch_completed_date"
NIGHT_BATCH_WRITE_STATE_KEY = "night_batch_write_state"
UNKNOWN_RECONCILIATION_STATE_KEY = "unknown_reconciliation_last"
EVIDENCE_MAINTENANCE_STATE_KEY = "evidence_maintenance_last"
RECORDED_ACTIVITY_PADDING_SECONDS = 1.0
RECORDED_MJPEG_BATCH_SIZE = 10
RECORDED_MJPEG_SINGLE_PASS_ENABLED = True


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


@dataclass(slots=True)
class RawFrameTask:
    """One compressed source frame awaiting a single full-resolution decode."""

    sequence: int
    observed_at: datetime
    camera_key: str
    detection_shape: tuple[int, int]
    detections: tuple[DetectedFace, ...]
    encoded_original: bytes
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
        self._capture_producer_done = Event()
        self._capture_producer_done.set()
        self._benchmark_requested = Event()
        self._manual_batch_requested = Event()
        self._manual_batch_cancel_requested = Event()
        self._automatic_batch_requested = Event()
        self._manual_detection_ready = Event()
        self._processing_thread: Thread | None = None
        self._sync_thread: Thread | None = None
        self._persistence_thread: Thread | None = None
        self._raw_frame_threads: list[Thread] = []
        self._batch_thread: Thread | None = None
        self._persistence_queue: Queue[PersistenceTask] = Queue(maxsize=PERSISTENCE_QUEUE_MAX)
        self._raw_frame_queue: Queue[RawFrameTask] = Queue(
            maxsize=RAW_FRAME_QUEUE_MAX
        )
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
        self._batch_quality_evaluated = 0
        self._batch_quality_skipped_ineligible = 0
        self._batch_reference_probes = 0
        self._batch_quality_latency_ms = 0.0
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
        self._persistence_raw_batches = 0
        self._persistence_raw_batch_items = 0
        self._persistence_raw_batch_max = 0
        self._persistence_backpressure_retries = 0
        self._persistence_inline_completed = 0
        self._raw_frame_enqueued = 0
        self._raw_frame_completed = 0
        self._raw_frame_dropped = 0
        self._raw_frame_dropped_faces = 0
        self._raw_frame_failed = 0
        self._raw_frame_decoded = 0
        self._raw_frame_crops_enqueued = 0
        self._raw_frame_queue_high_water = 0
        self._raw_frame_active = 0
        self._raw_frame_last_sequence = 0
        self._raw_frame_last_error = ""
        self._raw_frame_last_latency_ms = 0.0
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
        self._recorded_storage_root: Path | None = None
        self._recorded_storage_roots: tuple[Path, ...] = ()
        self._recorded_storage_router: TieredRecordingStorage | None = None
        self._recorded_ffmpeg: Path | None = None
        self._recorded_ffprobe: Path | None = None
        self._recorded_nvjpeg: NvJpegCudaDecoder | None = None
        self._recorded_last_queue_refresh = 0.0
        self._recorded_last_cleanup = 0.0
        self._recorded_pipeline_status: dict = {
            "enabled": False,
            "state": "disabled",
            "current": {},
            "queue": {
                "pending": 0,
                "processing": 0,
                "done": 0,
                "error": 0,
                "total": 0,
                "pending_bytes": 0,
                "recent": [],
            },
            "last_error": "",
        }

    @property
    def running(self) -> bool:
        return bool(self._processing_thread and self._processing_thread.is_alive())

    def _worker_threads(self) -> list[tuple[str, Thread]]:
        """Return every runtime-owned worker without hiding duplicate references."""
        workers: list[tuple[str, Thread | None]] = [
            ("processing", self._processing_thread),
            ("sync", self._sync_thread),
            ("persistence", self._persistence_thread),
            ("batch", self._batch_thread),
        ]
        workers.extend(
            (f"raw-{index + 1}", thread)
            for index, thread in enumerate(self._raw_frame_threads)
        )
        unique: list[tuple[str, Thread]] = []
        seen: set[int] = set()
        for label, thread in workers:
            if thread is None or id(thread) in seen:
                continue
            seen.add(id(thread))
            unique.append((label, thread))
        return unique

    def _live_worker_names(self) -> list[str]:
        return [
            f"{label} ({thread.name})"
            for label, thread in self._worker_threads()
            if thread.is_alive()
        ]

    def _live_camera_worker_names(self) -> list[str]:
        live: list[str] = []
        for camera_key, camera in self._cameras.items():
            try:
                metrics = dict(getattr(camera, "status_metrics", {}) or {})
            except Exception as exc:
                LOGGER.exception(
                    "No se pudo inspeccionar el pipeline de camara %s",
                    camera_key,
                )
                live.append(f"{camera_key} (estado desconocido: {exc})")
                continue
            if metrics.get("receiver_alive"):
                live.append(f"{camera_key} (receptor)")
            if metrics.get("decoder_alive"):
                live.append(f"{camera_key} (decoder)")
        return live

    @staticmethod
    def _join_threads_until(threads: list[Thread], deadline: float) -> None:
        caller = current_thread()
        for thread in threads:
            if thread is caller or not thread.is_alive():
                continue
            thread.join(timeout=max(0.0, deadline - time.monotonic()))

    def start(self) -> None:
        with self._lifecycle_lock:
            live_workers = self._live_worker_names()
            live_camera_workers = self._live_camera_worker_names()
            if live_workers or live_camera_workers:
                active = [*live_workers, *live_camera_workers]
                raise RuntimeError(
                    "No se puede iniciar otro motor mientras siguen activos "
                    f"workers anteriores: {', '.join(active)}."
                )
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
            self._raw_frame_queue = Queue(maxsize=RAW_FRAME_QUEUE_MAX)
            self._persistence_enqueued = 0
            self._persistence_completed = 0
            self._persistence_dropped = 0
            self._persistence_failed = 0
            self._persistence_last_error = ""
            self._persistence_last_latency_ms = 0.0
            self._persistence_raw_batches = 0
            self._persistence_raw_batch_items = 0
            self._persistence_raw_batch_max = 0
            self._persistence_backpressure_retries = 0
            self._persistence_inline_completed = 0
            self._raw_frame_enqueued = 0
            self._raw_frame_completed = 0
            self._raw_frame_dropped = 0
            self._raw_frame_dropped_faces = 0
            self._raw_frame_failed = 0
            self._raw_frame_decoded = 0
            self._raw_frame_crops_enqueued = 0
            self._raw_frame_queue_high_water = 0
            self._raw_frame_active = 0
            self._raw_frame_last_sequence = 0
            self._raw_frame_last_error = ""
            self._raw_frame_last_latency_ms = 0.0
            self.store.recover_processing_crops()
            config = self.config_manager.config
            definitions = self._camera_definitions(config)
            if config.recorded_detection_enabled:
                storage_value = str(config.recorded_video_dir).strip()
                if not storage_value:
                    storage_value = str(
                        self.config_manager.data_dir / "video-segments"
                    )
                storage_root = Path(storage_value).expanduser().resolve()
                storage_root.mkdir(parents=True, exist_ok=True)
                self._recorded_storage_root = storage_root
                hot_value = str(config.recorded_hot_video_dir).strip()
                hot_root = (
                    Path(hot_value).expanduser().resolve()
                    if hot_value
                    else None
                )
                storage_router = TieredRecordingStorage(
                    storage_root,
                    hot_root=hot_root,
                    min_free_gb=float(config.recorded_hot_min_free_gb),
                    resume_free_gb=float(config.recorded_hot_resume_free_gb),
                )
                self._recorded_storage_router = storage_router
                self._recorded_storage_roots = storage_router.roots
                self._recorded_ffmpeg = find_media_binary(
                    "ffmpeg",
                    config.recorded_ffmpeg_path,
                )
                self._recorded_ffprobe = find_media_binary(
                    "ffprobe",
                    config.recorded_ffprobe_path,
                )
                recovered = sum(
                    recover_segment_jobs(root)
                    for root in self._recorded_storage_roots
                )
                evidence_index = self._rebuild_match_evidence_index()
                LOGGER.info(
                    "Indice de evidencia reconstruido: %s videos, %s relaciones",
                    evidence_index["videos"],
                    evidence_index["links"],
                )
                self._cameras = {
                    key: RecordedCameraWorker(
                        details["source"],
                        name=key,
                        label=details["label"],
                        storage_root=storage_root,
                        storage_router=storage_router,
                        ffmpeg=self._recorded_ffmpeg,
                        ffprobe=self._recorded_ffprobe,
                        segment_seconds=int(config.recorded_segment_minutes) * 60,
                        preview_callback=(
                            lambda payload, camera_key=key: self._publish_recorded_live_preview(
                                camera_key,
                                payload,
                            )
                        ),
                        preview_fps=float(config.preview_fps),
                    )
                    for key, details in definitions.items()
                }
                with self._state_lock:
                    self._recorded_pipeline_status = {
                        "enabled": True,
                        "state": "starting",
                        "storage_dir": str(storage_root),
                        "storage_tier": storage_router.status(),
                        "segment_minutes": int(config.recorded_segment_minutes),
                        "sample_fps": float(config.recorded_sample_fps),
                        "processing_width": int(config.recorded_processing_width),
                        "original_retention_hours": int(
                            config.recorded_original_retention_hours
                        ),
                        "recovered_jobs": recovered,
                        "current": {},
                        "queue": segment_job_summary_in_roots(
                            self._recorded_storage_roots
                        ),
                        "last_error": "",
                    }
            else:
                self._recorded_storage_root = None
                self._recorded_storage_roots = ()
                self._recorded_storage_router = None
                self._recorded_ffmpeg = None
                self._recorded_ffprobe = None
                self._cameras = {
                    key: CameraWorker(
                        details["source"],
                        name=key,
                        fallback_source=details.get("fallback_source", ""),
                        async_mjpeg=bool(details.get("async_mjpeg", False)),
                        mjpeg_decode_reduction=int(
                            details.get("mjpeg_decode_reduction", 1)
                        ),
                    )
                    for key, details in definitions.items()
                }
                with self._state_lock:
                    self._recorded_pipeline_status = {
                        "enabled": False,
                        "state": "disabled",
                        "current": {},
                        "queue": {},
                        "last_error": "",
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
            # Cleared only after all camera starts succeeded. The raw workers
            # use this barrier to stay alive until the detector and every
            # in-flight executor task have lost the ability to enqueue.
            self._capture_producer_done.clear()
            processing_target = (
                self._recorded_processing_loop
                if config.recorded_detection_enabled
                else self._processing_loop
            )
            self._processing_thread = Thread(target=processing_target, name="futsi-recognition", daemon=True)
            self._sync_thread = Thread(target=StationSynchronizer(self).run, name="futsi-sync", daemon=True)
            self._persistence_thread = Thread(target=self._persistence_loop, name="futsi-persistence", daemon=True)
            self._raw_frame_threads = (
                []
                if config.recorded_detection_enabled
                else [
                    Thread(
                        target=self._raw_frame_loop,
                        name=f"futsi-original-frame-{index + 1}",
                        daemon=True,
                    )
                    for index in range(RAW_FRAME_WORKER_COUNT)
                ]
            )
            self._batch_thread = Thread(target=self._batch_loop, name="futsi-night-batch", daemon=True)
            self._persistence_thread.start()
            for thread in self._raw_frame_threads:
                thread.start()
            self._processing_thread.start()
            self._sync_thread.start()
            self._batch_thread.start()

    def stop(self) -> None:
        with self._lifecycle_lock:
            self._stop.set()
            camera_stop_errors: list[str] = []
            for camera_key, camera in self._cameras.items():
                try:
                    camera.stop()
                except Exception as exc:
                    LOGGER.exception(
                        "No se pudo detener la camara %s",
                        camera_key,
                    )
                    camera_stop_errors.append(f"{camera_key}: {exc}")
            control_threads = [
                thread
                for thread in (
                    self._processing_thread,
                    self._sync_thread,
                    self._batch_thread,
                )
                if thread is not None
            ]
            self._join_threads_until(
                control_threads,
                time.monotonic() + STOP_CONTROL_JOIN_SECONDS,
            )
            if (
                self._processing_thread is None
                or not self._processing_thread.is_alive()
            ):
                self._capture_producer_done.set()
            self._join_threads_until(
                list(self._raw_frame_threads),
                time.monotonic() + STOP_RAW_DRAIN_SECONDS,
            )
            if self._persistence_thread is not None:
                self._join_threads_until(
                    [self._persistence_thread],
                    time.monotonic() + STOP_PERSISTENCE_DRAIN_SECONDS,
                )

            live_workers = self._live_worker_names()
            live_camera_workers = self._live_camera_worker_names()
            if live_workers or live_camera_workers or camera_stop_errors:
                details = []
                if live_workers:
                    details.append(
                        "workers activos: " + ", ".join(live_workers)
                    )
                if live_camera_workers:
                    details.append(
                        "pipelines de camara activos: "
                        + ", ".join(live_camera_workers)
                    )
                if camera_stop_errors:
                    details.append(
                        "errores al detener camaras: "
                        + "; ".join(camera_stop_errors)
                    )
                message = (
                    "La estacion no pudo detener todos sus workers; se conservaron "
                    "las colas y referencias para evitar perdida de evidencia y un "
                    "reinicio duplicado. "
                    + " | ".join(details)
                    + "."
                )
                LOGGER.error(message)
                self._set_state("error", message)
                raise RuntimeError(message)

            self._processing_thread = None
            self._sync_thread = None
            self._persistence_thread = None
            self._raw_frame_threads = []
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
            payload = self._preview_jpegs.get(camera_key)
            label = self._camera_labels.get(camera_key, camera_key)
        return bytes(
            payload
            or placeholder_frame(
                f"Esperando video de {label}"
                if camera_key in self._camera_labels
                else "Camara no configurada"
            )
        )

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

    def _recorded_file_path(self, value: str) -> Path | None:
        if not value or not self._recorded_storage_roots:
            return None
        try:
            candidate = Path(value).resolve()
        except OSError:
            return None
        for root in self._recorded_storage_roots:
            try:
                candidate.relative_to(root.resolve())
            except (OSError, ValueError):
                continue
            return candidate if candidate.is_file() else None
        return None

    def _index_match_evidence_job(self, job_path: Path, payload: dict) -> None:
        try:
            self.store.upsert_match_evidence_video(job_path, payload)
        except Exception:
            # The job JSON remains the durable source of truth. Startup rebuilds
            # the complete index if SQLite was temporarily unavailable here.
            LOGGER.exception(
                "No se pudo actualizar el indice de evidencia para %s",
                job_path,
            )

    def _rebuild_match_evidence_index(self) -> dict:
        roots = self._recorded_storage_roots
        jobs = (
            list_segment_jobs_in_roots(roots, statuses={"done"})
            if roots
            else []
        )
        return self.store.rebuild_match_evidence_index(jobs)

    def match_window_videos(self, window_id: int) -> list[dict] | None:
        context = self.store.match_window_context(window_id)
        if context is None:
            return None
        if (
            not self._recorded_storage_roots
            or str(context.get("window_type")) != "unscheduled"
        ):
            return []
        items = []
        for payload in self.store.match_evidence_videos_for_window(window_id):
            path = self._recorded_file_path(
                str(payload.get("evidence_video_path") or "")
            )
            if path is None:
                continue
            items.append({
                "video_id": str(payload.get("video_id") or ""),
                "camera_key": str(payload.get("camera_key") or ""),
                "camera_label": str(payload.get("camera_label") or ""),
                "started_at": str(payload.get("started_at") or ""),
                "finished_at": str(payload.get("finished_at") or ""),
                "duration_seconds": float(payload.get("duration_seconds") or 0.0),
                "file_bytes": int(path.stat().st_size),
                "retained_until": str(
                    payload.get("evidence_delete_after") or ""
                ),
                "fallback_original": bool(payload.get("fallback_original")),
            })
        return items

    def match_window_video_path(self, window_id: int, video_id: str) -> Path | None:
        context = self.store.match_window_context(window_id)
        if context is None or str(context.get("window_type")) != "unscheduled":
            return None
        payload = self.store.match_evidence_video_for_window(window_id, video_id)
        if payload is None:
            return None
        return self._recorded_file_path(
            str(payload.get("evidence_video_path") or "")
        )

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
                "recorded_pipeline": {
                    **dict(self._recorded_pipeline_status),
                    "current": dict(
                        self._recorded_pipeline_status.get("current") or {}
                    ),
                    "queue": dict(
                        self._recorded_pipeline_status.get("queue") or {}
                    ),
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
                    "comparison_first": {
                        "enabled": True,
                        "quality_evaluated": self._batch_quality_evaluated,
                        "reference_probes": self._batch_reference_probes,
                        "skipped_below_reference_threshold": (
                            self._batch_quality_skipped_ineligible
                        ),
                        "quality_latency_ms": round(
                            self._batch_quality_latency_ms,
                            1,
                        ),
                    },
                },
                "persistence": {
                    "queue_depth": self._persistence_queue.qsize(),
                    "queue_capacity": PERSISTENCE_QUEUE_MAX,
                    "worker_active": bool(self._persistence_thread and self._persistence_thread.is_alive()),
                    "enqueued": self._persistence_enqueued,
                    "completed": self._persistence_completed,
                    "dropped": self._persistence_dropped,
                    "failed": self._persistence_failed,
                    "backpressure_retries": self._persistence_backpressure_retries,
                    "inline_completed": self._persistence_inline_completed,
                    "last_error": self._persistence_last_error,
                    "last_latency_ms": round(self._persistence_last_latency_ms, 1),
                    "raw_batch": {
                        "max_items": RAW_PERSISTENCE_BATCH_MAX,
                        "window_ms": int(
                            RAW_PERSISTENCE_BATCH_WINDOW_SECONDS * 1000
                        ),
                        "batches": self._persistence_raw_batches,
                        "items": self._persistence_raw_batch_items,
                        "largest": self._persistence_raw_batch_max,
                    },
                    "original_frames": {
                        "queue_depth": self._raw_frame_queue.qsize(),
                        "queue_capacity": RAW_FRAME_QUEUE_MAX,
                        "queue_high_water": self._raw_frame_queue_high_water,
                        "active": self._raw_frame_active,
                        "worker_count": len(self._raw_frame_threads),
                        "workers_active": sum(
                            1
                            for thread in self._raw_frame_threads
                            if thread.is_alive()
                        ),
                        "worker_active": any(
                            thread.is_alive()
                            for thread in self._raw_frame_threads
                        ),
                        "enqueued": self._raw_frame_enqueued,
                        "completed": self._raw_frame_completed,
                        "decoded": self._raw_frame_decoded,
                        "crops_enqueued": self._raw_frame_crops_enqueued,
                        "dropped": self._raw_frame_dropped,
                        "dropped_faces": self._raw_frame_dropped_faces,
                        "failed": self._raw_frame_failed,
                        "last_sequence": self._raw_frame_last_sequence,
                        "last_error": self._raw_frame_last_error,
                        "last_latency_ms": round(
                            self._raw_frame_last_latency_ms,
                            1,
                        ),
                    },
                },
            }
        cameras = {}
        for key, details in definitions.items():
            camera = self._cameras.get(key)
            capture_pipeline = (
                dict(camera.status_metrics)
                if camera is not None
                else {}
            )
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
                # CameraWorker owns this whitelist and never exposes source
                # URLs or credentials. Keep protocol diagnostics nested so
                # existing status consumers remain compatible.
                "capture_pipeline": capture_pipeline,
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
        # A manual merge is already atomic in SQLite. Keep a compact logical
        # audit of only the affected rows instead of copying the full multi-GB
        # database and running a global integrity scan while cameras wait.
        result = self.store.merge_unknowns(
            target_subject_id,
            source_subject_ids,
            create_backup=False,
            verify_integrity=False,
        )
        # A pending frame may still reference one of the archived IDs. The
        # store redirects those writes to the canonical target, while clearing
        # the visual tracks prevents new frames from keeping the stale group.
        self._unknown_tracks.clear()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    def rename_unknown(self, subject_id: str, temporary_name: str) -> dict:
        result = self.store.rename_unknown(subject_id, temporary_name)
        self._unknown_tracks.clear()
        self._reload_unknown_database()
        self._refresh_recent()
        return result

    def rename_registered_person(self, person_key: str, name: str) -> dict:
        result = self.store.rename_registered_person(
            person_key,
            name,
            queue_sync=True,
        )
        config = self.config_manager.config
        if config.station_token:
            try:
                client = FutsiClient(
                    config.api_url,
                    config.station_token,
                    config.reference_proxy_url,
                )
                response = client.rename_person(
                    str(result["person_type"]),
                    int(result["remote_id"]),
                    str(result["name"]),
                )
                remote_person = response.get("person") or response
                result = self.store.confirm_registered_person_name(
                    person_key,
                    str(remote_person.get("name") or result["name"]),
                )
            except Exception as exc:
                LOGGER.warning(
                    "La correccion de nombre %s quedo pendiente de sincronizacion: %s",
                    person_key,
                    exc,
                )
        self._reload_known_database()
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
                for proposal in plan.merge_proposals:
                    result = self.store.merge_unknowns(
                        proposal.target_subject_id,
                        list(proposal.source_subject_ids),
                        create_backup=False,
                    )
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
        result = self.store.quarantine_unknown(
            subject_id,
            reason,
            create_backup=False,
            verify_integrity=False,
        )
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
            capture_workers_suspended = False

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
                        # Keep the network sessions alive while the nightly
                        # matcher owns the GPU, but do not decode or retain an
                        # overnight backlog. Detection resumes from a fresh
                        # frame when the batch is complete.
                        if not capture_workers_suspended:
                            self._suspend_capture_workers()
                            capture_workers_suspended = True
                    with self._state_lock:
                        self._detection_paused = True
                    self._manual_detection_ready.set()
                    self._stop.wait(0.05)
                    continue
                if capture_workers_suspended:
                    self._resume_capture_workers()
                    capture_workers_suspended = False
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
                        packet = self._cameras[camera_key].next_packet()
                        if packet is None:
                            continue
                        future = executor.submit(
                            self._capture_packet,
                            packet,
                            camera_key,
                        )
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
                        packet = self._cameras[camera_key].next_packet()
                        if packet is None:
                            continue
                        self._capture_packet(packet, camera_key)
                        record_completion(camera_key)
                        processed_any = True
                    if not processed_any:
                        for camera in self._cameras.values():
                            if camera.wait_for_frame(0.005):
                                break
        except Exception as exc:
            LOGGER.exception("El motor de reconocimiento se detuvo")
            # A failed detector must terminate every auxiliary worker before a
            # restart can be attempted; otherwise two independent runtimes can
            # consume the same cameras and queues.
            self._stop.set()
            self._set_state("error", str(exc))
            for key in self._cameras or {"primary": None}:
                self._set_preview(placeholder_frame("Error del motor", str(exc)), key)
        finally:
            try:
                if executor:
                    executor.shutdown(wait=True, cancel_futures=True)
            finally:
                # This is the producer fence for original-frame workers. It
                # must be raised only after every capture task has returned.
                self._capture_producer_done.set()
                for camera in self._cameras.values():
                    camera.stop()

    def _recorded_processing_loop(self) -> None:
        """Analyze closed lossless segments instead of competing with live capture."""
        capture_workers_suspended = False
        try:
            config = self.config_manager.config
            self._set_state("loading_model", "")
            detector = FaceDetector(config)
            detector.load()
            self._detector = detector
            self._detectors = {key: detector for key in self._cameras}
            self._recorded_nvjpeg = NvJpegCudaDecoder()
            with self._state_lock:
                self._recorded_pipeline_status["jpeg_decoder"] = (
                    "nvJPEG CUDA GPU_HYBRID"
                )
            self._provider = detector.provider_label
            self._target_fps = float(config.recorded_sample_fps)
            self._reload_known_database()
            self._reload_unknown_database()
            self._update_reference_summary()
            self._set_state("running", "")
            self._set_recorded_pipeline_state("recording")

            while not self._stop.is_set():
                pause_requested = self._batch_detection_pause_requested()
                if pause_requested and not capture_workers_suspended:
                    self._set_recorded_pipeline_state("closing_segments")
                    self._suspend_capture_workers()
                    for camera in self._cameras.values():
                        wait_until_idle = getattr(camera, "wait_until_idle", None)
                        if callable(wait_until_idle):
                            wait_until_idle(12.0)
                    capture_workers_suspended = True

                job = self._next_recorded_segment_job()
                if job is not None:
                    job_path, payload = job
                    self._process_recorded_segment_job(job_path, payload)
                    continue

                self._refresh_recorded_pipeline_queue()
                if pause_requested:
                    with self._state_lock:
                        self._detection_paused = True
                        self._processing_fps = 0.0
                        for camera_key in self._camera_processing_fps:
                            self._camera_processing_fps[camera_key] = 0.0
                    self._set_recorded_pipeline_state("paused_for_night_batch")
                    self._manual_detection_ready.set()
                    self._stop.wait(0.05)
                    continue

                if capture_workers_suspended:
                    self._resume_capture_workers()
                    capture_workers_suspended = False
                if self._detection_paused:
                    with self._state_lock:
                        self._detection_paused = False
                    self._manual_detection_ready.clear()
                if self._benchmark_requested.is_set():
                    self._benchmark_requested.clear()
                    self._run_benchmark()
                self._cleanup_recorded_originals()
                self._set_recorded_pipeline_state("recording")
                self._stop.wait(0.25)
        except Exception as exc:
            LOGGER.exception("El pipeline de video grabado se detuvo")
            self._stop.set()
            self._set_recorded_pipeline_state("error", str(exc))
            self._set_state("error", str(exc))
            for key in self._cameras or {"primary": None}:
                self._set_preview(placeholder_frame("Error del pipeline", str(exc)), key)
        finally:
            if self._recorded_nvjpeg is not None:
                try:
                    self._recorded_nvjpeg.close()
                except Exception:
                    LOGGER.exception("No se pudo cerrar nvJPEG")
                self._recorded_nvjpeg = None
            self._capture_producer_done.set()
            for camera in self._cameras.values():
                try:
                    camera.stop()
                except Exception:
                    LOGGER.exception("No se pudo detener el grabador de cámara")

    def _set_recorded_pipeline_state(
        self,
        state: str,
        error: str = "",
        *,
        current: dict | None = None,
    ) -> None:
        with self._state_lock:
            self._recorded_pipeline_status["state"] = state
            self._recorded_pipeline_status["last_error"] = error[:500]
            if current is not None:
                self._recorded_pipeline_status["current"] = dict(current)

    def _refresh_recorded_pipeline_queue(self) -> None:
        roots = self._recorded_storage_roots
        if not roots:
            return
        now = time.monotonic()
        if now - self._recorded_last_queue_refresh < 1.0:
            return
        summary = segment_job_summary_in_roots(roots)
        with self._state_lock:
            self._recorded_pipeline_status["queue"] = summary
            if self._recorded_storage_router is not None:
                self._recorded_pipeline_status["storage_tier"] = (
                    self._recorded_storage_router.status()
                )
            self._recorded_last_queue_refresh = now

    def _next_recorded_segment_job(self) -> tuple[Path, dict] | None:
        roots = self._recorded_storage_roots
        if not roots:
            return None
        jobs: list[tuple[Path, dict]] = []
        # The SSD hot tier is first. Archive work continues whenever hot work
        # is drained, while old F: jobs remain fully compatible.
        for root in roots:
            jobs = list_segment_jobs(root, statuses={"pending"}, limit=1)
            if jobs:
                break
        if not jobs:
            return None
        job_path, payload = jobs[0]
        payload = update_segment_job(
            job_path,
            status="processing",
            stage="probing",
            attempts=int(payload.get("attempts") or 0) + 1,
            last_error="",
            processing_started_at=datetime.now(timezone.utc).isoformat(),
        )
        self._refresh_recorded_pipeline_queue()
        return job_path, payload

    def _process_recorded_segment_job(self, job_path: Path, job: dict) -> None:
        started = time.perf_counter()
        video_path = Path(str(job.get("path") or ""))
        camera_key = str(job.get("camera_key") or "")
        label = str(job.get("camera_label") or camera_key)
        evidence_writer: MatchEvidenceWriter | None = None
        evidence_result: dict = {}
        current = {
            "camera_key": camera_key,
            "camera_label": label,
            "filename": str(job.get("filename") or video_path.name),
            "stage": "probing",
            "progress": 0.0,
            "sampled_frames": 0,
            "face_frames": 0,
            "faces": 0,
            "crops_enqueued": 0,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        self._set_recorded_pipeline_state("processing", current=current)
        try:
            if not video_path.is_file():
                raise FileNotFoundError(f"No existe el segmento {video_path.name}.")
            info = self._probe_recorded_video(video_path)
            duration = float(info["duration_seconds"])
            current.update(
                {
                    "stage": "detecting",
                    "source_width": int(info["width"]),
                    "source_height": int(info["height"]),
                    "duration_seconds": round(duration, 2),
                    "decoder": info["decoder"],
                }
            )
            update_segment_job(
                job_path,
                stage="detecting",
                source_width=int(info["width"]),
                source_height=int(info["height"]),
                duration_seconds=round(duration, 3),
                codec=info["codec"],
                decoder=info["decoder"],
            )
            try:
                evidence_writer = self._open_match_evidence_writer(
                    video_path,
                    camera_key,
                    job,
                    info,
                )
            except Exception as exc:
                LOGGER.exception(
                    "No se pudo iniciar la copia de evidencia de %s",
                    video_path,
                )
                evidence_result = {
                    "ok": False,
                    "path": "",
                    "file_bytes": 0,
                    "frames": 0,
                    "error": str(exc),
                }
            single_pass_mjpeg = (
                RECORDED_MJPEG_SINGLE_PASS_ENABLED
                and str(info.get("codec") or "") == "mjpeg"
            )
            if single_pass_mjpeg:
                indexed_packets: list[MjpegPacket] = []
                try:
                    indexed_packets = load_mjpeg_index(video_path)
                    if not indexed_packets and video_path.suffix.lower() == ".avi":
                        if self._recorded_ffprobe is None:
                            raise RuntimeError("FFprobe no esta configurado.")
                        current.update({"stage": "indexing", "progress": 0.0})
                        self._set_recorded_pipeline_state(
                            "processing",
                            current=current,
                        )
                        update_segment_job(
                            job_path,
                            stage="indexing",
                            pipeline_mode="mjpeg_indexed_selective",
                        )
                        indexed_packets, index_seconds, index_cached = (
                            build_mjpeg_index(
                                self._recorded_ffprobe,
                                video_path,
                                stop_event=self._stop,
                            )
                        )
                        update_segment_job(
                            job_path,
                            stage="detecting",
                            mjpeg_index_path=str(mjpeg_index_path(video_path)),
                            mjpeg_index_packets=len(indexed_packets),
                            mjpeg_index_seconds=round(index_seconds, 3),
                            mjpeg_index_cached=bool(index_cached),
                            mjpeg_index_error="",
                        )
                    elif not indexed_packets:
                        # Legacy Matroska MJPEG segments have no per-frame
                        # offset table. Building one requires rereading every
                        # byte and can be slower than the proven decoder path
                        # on a busy archive disk. New ELP recordings use AVI.
                        update_segment_job(
                            job_path,
                            stage="detecting",
                            pipeline_mode="mjpeg_single_pass_legacy",
                            mjpeg_index_error=(
                                "Segmento MKV anterior sin indice; se usa la "
                                "ruta compatible de una pasada."
                            ),
                        )
                except Exception as exc:
                    LOGGER.exception(
                        "No se pudo preparar el indice de %s; se usa la ruta "
                        "anterior de una pasada.",
                        video_path,
                    )
                    update_segment_job(
                        job_path,
                        stage="detecting",
                        mjpeg_index_error=str(exc)[:1000],
                    )

                if indexed_packets:
                    (
                        anchors,
                        scan_stats,
                        activity_windows,
                        activity_stats,
                    ) = self._process_recorded_mjpeg_indexed(
                        video_path,
                        camera_key,
                        job,
                        info,
                        current,
                        indexed_packets,
                        evidence_writer=evidence_writer,
                    )
                else:
                    (
                        anchors,
                        scan_stats,
                        activity_windows,
                        activity_stats,
                    ) = self._process_recorded_mjpeg_single_pass(
                        video_path,
                        camera_key,
                        job,
                        info,
                        current,
                        evidence_writer=evidence_writer,
                    )
            else:
                anchors, scan_stats = self._scan_recorded_video(
                    video_path,
                    camera_key,
                    job,
                    info,
                    current,
                    evidence_writer=evidence_writer,
                )
                activity_windows = self._recorded_activity_windows(
                    anchors,
                    duration,
                    padding_seconds=max(
                        RECORDED_ACTIVITY_PADDING_SECONDS,
                        1.0
                        / max(
                            float(
                                self.config_manager.config.recorded_sample_fps
                            ),
                            0.001,
                        ),
                    ),
                )
            if evidence_writer is not None:
                evidence_result = evidence_writer.close()
                evidence_writer = None
            current.update(scan_stats)
            current.update(
                {
                    "stage": (
                        "analyzing_activity" if activity_windows else "finalizing"
                    ),
                    "progress": 0.92 if activity_windows else 1.0,
                    "scout_face_frames": int(scan_stats["face_frames"]),
                    "scout_faces": int(scan_stats["faces"]),
                    "activity_windows": len(activity_windows),
                    "activity_seconds": round(
                        sum(end - start for start, end in activity_windows),
                        3,
                    ),
                    "full_fps_frames": 0,
                    "face_frames": 0,
                    "faces": 0,
                    "crops_enqueued": 0,
                }
            )
            self._set_recorded_pipeline_state("processing", current=current)
            update_segment_job(
                job_path,
                stage=(
                    "analyzing_activity" if activity_windows else "finalizing"
                ),
                sampled_frames=int(scan_stats["sampled_frames"]),
                scout_face_frames=int(scan_stats["face_frames"]),
                scout_faces=int(scan_stats["faces"]),
                activity_windows=len(activity_windows),
                activity_seconds=current["activity_seconds"],
                face_frames=0,
                faces=0,
            )
            if not single_pass_mjpeg:
                activity_stats = self._persist_recorded_activity_windows(
                    video_path,
                    camera_key,
                    job,
                    info,
                    activity_windows,
                    current,
                )
                activity_stats = self._recover_empty_h264_activity(
                    video_path,
                    job_path,
                    camera_key,
                    job,
                    info,
                    duration,
                    scan_stats,
                    activity_stats,
                    current,
                )
            if self._scout_recovery_requires_retry(scan_stats, activity_stats):
                raise RuntimeError(
                    "El rastreo detecto rostros, pero la recuperacion a FPS completo "
                    "no reprodujo ninguno; se conserva el video original para reintentar."
                )
            current.update(activity_stats)
            with self._state_lock:
                full_fps_frames = int(activity_stats["full_fps_frames"])
                final_faces = int(activity_stats["faces"])
                scout_faces = int(scan_stats["faces"])
                self._processed_frames += full_fps_frames
                self._camera_processed_frames[camera_key] = (
                    self._camera_processed_frames.get(camera_key, 0)
                    + full_fps_frames
                )
                self._captured_frames_today += full_fps_frames
                face_adjustment = final_faces - scout_faces
                self._detected_faces = max(
                    0,
                    self._detected_faces + face_adjustment,
                )
                self._captured_faces_today = max(
                    0,
                    self._captured_faces_today + face_adjustment,
                )
            crops_enqueued = int(activity_stats["crops_enqueued"])
            persistence_timeout = max(120.0, min(900.0, crops_enqueued * 0.1))
            if crops_enqueued and not self._wait_recorded_persistence(
                persistence_timeout
            ):
                raise RuntimeError(
                    "Los recortes no terminaron de guardarse; se conservó el "
                    "video original para reintentar."
                )
            elapsed = time.perf_counter() - started
            original_deleted = False
            retention_hours = int(
                self.config_manager.config.recorded_original_retention_hours
            )
            delete_after = ""
            evidence_status = ""
            evidence_path = str(evidence_result.get("path") or "")
            if evidence_result and not evidence_result.get("ok"):
                # A browser proxy could not be written. Preserve the source as
                # a recoverable fallback instead of losing match evidence.
                evidence_status = "candidate_fallback"
                evidence_path = str(video_path)
                retention_hours = max(
                    retention_hours,
                    MATCH_EVIDENCE_RETENTION_DAYS * 24,
                )
            elif evidence_path:
                evidence_status = "candidate"
            if retention_hours <= 0:
                video_path.unlink(missing_ok=True)
                original_deleted = not video_path.exists()
                if original_deleted:
                    mjpeg_index_path(video_path).unlink(missing_ok=True)
            else:
                delete_after = (
                    datetime.now(timezone.utc)
                    + timedelta(hours=retention_hours)
                ).isoformat()
            current.update(
                {
                    "stage": "complete",
                    "progress": 1.0,
                    "crops_enqueued": crops_enqueued,
                    "elapsed_seconds": round(elapsed, 2),
                }
            )
            completed_payload = update_segment_job(
                job_path,
                status="done",
                stage="complete",
                processed_at=datetime.now(timezone.utc).isoformat(),
                elapsed_seconds=round(elapsed, 3),
                crops_enqueued=crops_enqueued,
                sampled_frames=int(scan_stats["sampled_frames"]),
                scout_face_frames=int(scan_stats["face_frames"]),
                scout_faces=int(scan_stats["faces"]),
                activity_windows=len(activity_windows),
                activity_seconds=current["activity_seconds"],
                full_fps_frames=int(activity_stats["full_fps_frames"]),
                face_frames=int(activity_stats["face_frames"]),
                faces=int(activity_stats["faces"]),
                original_deleted=original_deleted,
                delete_after=delete_after,
                evidence_status=evidence_status,
                evidence_video_path=evidence_path,
                evidence_file_bytes=int(evidence_result.get("file_bytes") or 0),
                evidence_frames=int(evidence_result.get("frames") or 0),
                evidence_fps=float(
                    self.config_manager.config.recorded_sample_fps
                ),
                evidence_size=420 if evidence_path else 0,
                evidence_error=str(evidence_result.get("error") or "")[:1000],
                evidence_window_ids=[],
                evidence_delete_after="",
                last_error="",
            )
            self._index_match_evidence_job(job_path, completed_payload)
            self._set_recorded_pipeline_state("recording", current=current)
        except Exception as exc:
            if evidence_writer is not None:
                try:
                    evidence_writer.close(commit=False)
                except Exception:
                    LOGGER.exception(
                        "No se pudo cerrar el video de evidencia incompleto"
                    )
            LOGGER.exception("No se pudo procesar el segmento %s", video_path)
            update_segment_job(
                job_path,
                status="error",
                stage="error",
                last_error=str(exc)[:1000],
                failed_at=datetime.now(timezone.utc).isoformat(),
            )
            current.update(
                {
                    "stage": "error",
                    "last_error": str(exc)[:500],
                    "elapsed_seconds": round(time.perf_counter() - started, 2),
                }
            )
            self._set_recorded_pipeline_state(
                "recording_with_errors",
                str(exc),
                current=current,
            )
        finally:
            self._refresh_recorded_pipeline_queue()

    def _recover_empty_h264_activity(
        self,
        video_path: Path,
        job_path: Path,
        camera_key: str,
        job: dict,
        info: dict,
        duration: float,
        scan_stats: dict,
        activity_stats: dict,
        current: dict,
    ) -> dict:
        """Recover H.264 detections when random frame seeking lands incorrectly.

        OpenCV frame seeking can report success while returning frames around a
        different keyframe than the requested interval.  The scout pass then
        sees a face, but the selective full-FPS pass sees none.  In that rare
        case, decode the segment sequentially from frame zero once.  Normal
        segments keep the fast selective path.
        """
        if (
            str(info.get("codec") or "").lower() != "h264"
            or int(scan_stats.get("faces") or 0) <= 0
            or int(activity_stats.get("faces") or 0) > 0
        ):
            return activity_stats

        recovery_mode = "h264_full_segment_sequential"
        current.update(
            {
                "stage": "recovering_activity",
                "progress": 0.92,
                "recovery_mode": recovery_mode,
                "recovery_trigger": "scout_faces_without_selective_faces",
            }
        )
        self._set_recorded_pipeline_state("processing", current=current)
        update_segment_job(
            job_path,
            stage="recovering_activity",
            recovery_mode=recovery_mode,
            recovery_trigger="scout_faces_without_selective_faces",
        )
        recovered = self._persist_recorded_activity_windows(
            video_path,
            camera_key,
            job,
            info,
            [(0.0, max(float(duration), 0.001))],
            current,
        )
        source_fps = max(float(info.get("source_fps") or 0.0), 0.001)
        expected_frames = max(1, int(math.ceil(float(duration) * source_fps)))
        # OpenCV/FFmpeg may omit a handful of tail frames when a segment ends
        # between GOPs.  Missing at most one second still means every useful
        # part of the segment was decoded sequentially.  If that exhaustive
        # pass cannot reproduce the scout's single detection, the scout was a
        # decoder artefact/false positive rather than unprocessed evidence.
        exhaustive_floor = max(1, expected_frames - max(2, int(math.ceil(source_fps))))
        recovery_exhaustive = (
            int(recovered.get("full_fps_frames") or 0) >= exhaustive_floor
        )
        recovery_faces = int(recovered.get("faces") or 0)
        recovered["recovery_exhaustive"] = recovery_exhaustive
        recovered["recovery_outcome"] = (
            "confirmed_faces"
            if recovery_faces > 0
            else (
                "scout_false_positive"
                if recovery_exhaustive
                else "incomplete_without_faces"
            )
        )
        update_segment_job(
            job_path,
            recovery_mode=recovery_mode,
            recovery_faces=recovery_faces,
            recovery_crops_enqueued=int(recovered.get("crops_enqueued") or 0),
            recovery_exhaustive=recovery_exhaustive,
            recovery_outcome=recovered["recovery_outcome"],
        )
        return recovered

    @staticmethod
    def _scout_recovery_requires_retry(
        scan_stats: dict,
        activity_stats: dict,
    ) -> bool:
        return (
            int(scan_stats.get("faces") or 0) > 0
            and int(activity_stats.get("faces") or 0) <= 0
            and not bool(activity_stats.get("recovery_exhaustive"))
        )

    def _probe_recorded_video(self, path: Path) -> dict:
        if self._recorded_ffprobe is None:
            raise RuntimeError("FFprobe no está configurado.")
        command = [
            str(self._recorded_ffprobe),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            (
                "stream=codec_name,width,height,pix_fmt,avg_frame_rate,duration:"
                "format=duration"
            ),
            "-of",
            "json",
            str(path),
        ]
        payload = json.loads(
            subprocess.check_output(
                command,
                text=True,
                timeout=20,
                creationflags=CREATE_NO_WINDOW,
            )
        )
        stream = payload.get("streams", [{}])[0]
        codec = str(stream.get("codec_name") or "")
        duration = float(
            stream.get("duration")
            or payload.get("format", {}).get("duration")
            or 0.0
        )
        cuvid = {
            "h264": "h264_cuvid",
            "hevc": "hevc_cuvid",
            "mjpeg": "mjpeg_cuvid",
            "mpeg2video": "mpeg2_cuvid",
            "mpeg4": "mpeg4_cuvid",
            "vp8": "vp8_cuvid",
            "vp9": "vp9_cuvid",
            "av1": "av1_cuvid",
        }.get(codec)
        return {
            "codec": codec,
            "width": int(stream.get("width") or 0),
            "height": int(stream.get("height") or 0),
            "pixel_format": str(stream.get("pix_fmt") or ""),
            "source_fps": self._parse_recorded_frame_rate(
                stream.get("avg_frame_rate")
            ),
            "duration_seconds": duration,
            "decoder": "nvjpeg_cuda" if codec == "mjpeg" else (cuvid or "cpu"),
        }

    @staticmethod
    def _parse_recorded_frame_rate(value) -> float:
        text = str(value or "").strip()
        try:
            if "/" in text:
                numerator, denominator = text.split("/", 1)
                rate = float(numerator) / float(denominator)
            else:
                rate = float(text)
        except (TypeError, ValueError, ZeroDivisionError):
            return 0.0
        return rate if math.isfinite(rate) and rate > 0 else 0.0

    @staticmethod
    def _recorded_activity_windows(
        anchors: list[
            tuple[float, tuple[int, int], tuple[DetectedFace, ...]]
        ],
        duration_seconds: float,
        *,
        padding_seconds: float = RECORDED_ACTIVITY_PADDING_SECONDS,
    ) -> list[tuple[float, float]]:
        """Merge scout hits into intervals that must be rescanned at full FPS."""
        duration = max(0.0, float(duration_seconds))
        padding = max(0.0, float(padding_seconds))
        intervals = sorted(
            (
                max(0.0, float(offset) - padding),
                min(duration, float(offset) + padding),
            )
            for offset, _shape, detections in anchors
            if detections and 0.0 <= float(offset) <= duration
        )
        merged: list[tuple[float, float]] = []
        for start, end in intervals:
            if end < start:
                continue
            if not merged or start > merged[-1][1] + 1e-6:
                merged.append((start, end))
                continue
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        return merged

    def _probe_recorded_packet_offsets(self, path: Path) -> list[float]:
        if self._recorded_ffprobe is None:
            raise RuntimeError("FFprobe no esta configurado.")
        output = subprocess.check_output(
            [
                str(self._recorded_ffprobe),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "packet=pts_time",
                "-of",
                "csv=p=0",
                str(path),
            ],
            text=True,
            timeout=30,
            creationflags=CREATE_NO_WINDOW,
            stderr=subprocess.DEVNULL,
        )
        timestamps: list[float] = []
        for line in output.splitlines():
            value = line.strip().split(",", 1)[0]
            try:
                timestamp = float(value)
            except (TypeError, ValueError):
                continue
            if math.isfinite(timestamp):
                timestamps.append(timestamp)
        if not timestamps:
            return []
        origin = timestamps[0]
        return [max(0.0, timestamp - origin) for timestamp in timestamps]

    @staticmethod
    def _read_recorded_frame(stream, frame_bytes: int) -> bytes:
        buffer = bytearray(frame_bytes)
        view = memoryview(buffer)
        received = 0
        while received < frame_bytes:
            count = stream.readinto(view[received:])
            if not count:
                return b"" if received == 0 else bytes(view[:received])
            received += count
        return bytes(buffer)

    def _open_match_evidence_writer(
        self,
        video_path: Path,
        camera_key: str,
        job: dict,
        info: dict,
    ) -> MatchEvidenceWriter | None:
        root = self._recorded_storage_root
        ffmpeg = self._recorded_ffmpeg
        if root is None or ffmpeg is None:
            return None
        started_at = datetime.fromisoformat(str(job["started_at"])).astimezone(
            BUSINESS_TIME_ZONE
        )
        ends_at = started_at + timedelta(
            seconds=max(0.0, float(info.get("duration_seconds") or 0.0))
        )
        if not segment_needs_evidence_candidate(started_at, ends_at):
            return None
        output_path = (
            root
            / "_match-evidence"
            / "candidates"
            / started_at.date().isoformat()
            / camera_key
            / f"{video_path.stem}.mp4"
        )
        return MatchEvidenceWriter(
            ffmpeg,
            output_path,
            fps=float(self.config_manager.config.recorded_sample_fps),
        )

    def _process_recorded_mjpeg_indexed(
        self,
        path: Path,
        camera_key: str,
        job: dict,
        info: dict,
        current: dict,
        packets: list[MjpegPacket],
        *,
        evidence_writer: MatchEvidenceWriter | None = None,
    ) -> tuple[list, dict, list[tuple[float, float]], dict]:
        """Detect from indexed scouts and read original packets only on hits."""
        decoder = self._recorded_nvjpeg
        detector = self._detector
        if decoder is None or detector is None:
            raise NvJpegCudaError("nvJPEG no esta preparado para procesar MJPEG.")
        if not packets:
            raise RuntimeError("El indice MJPEG no contiene paquetes.")

        config = self.config_manager.config
        width = int(config.recorded_processing_width)
        height = max(
            2,
            int(round(width * int(info["height"]) / max(int(info["width"]), 1))),
        )
        if height % 2:
            height += 1
        sample_fps = float(config.recorded_sample_fps)
        sample_interval = 1.0 / max(sample_fps, 0.001)
        duration = max(float(info.get("duration_seconds") or 0.0), 0.001)
        padding = max(RECORDED_ACTIVITY_PADDING_SECONDS, sample_interval)
        scout_packets = select_mjpeg_scout_packets(packets, sample_fps)
        expected_scout_frames = len(scout_packets)

        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(0, min(width - 1, int(round(width * roi_left))))
        roi_x2 = max(roi_x1 + 1, min(width, int(round(width * roi_right))))
        scaled_min_face_size = max(
            1,
            int(
                round(
                    float(config.min_face_size)
                    * width
                    / max(int(config.processing_width), 1)
                )
            ),
        )
        job_started = datetime.fromisoformat(str(job["started_at"]))
        pass_started = time.perf_counter()
        activity_windows: list[tuple[float, float]] = []
        anchors: list[
            tuple[float, tuple[int, int], tuple[DetectedFace, ...]]
        ] = []
        sampled_frames = 0
        scout_face_frames = 0
        scout_faces = 0
        full_fps_frames = 0
        full_face_frames = 0
        full_faces = 0
        crops_enqueued = 0
        batch_limit = 0
        last_job_update = 0.0
        full_packets: list[MjpegPacket] = []
        selective_bytes_read = 0
        selective_read_seconds = 0.0

        def merge_activity(start: float, end: float) -> None:
            start = max(0.0, start)
            end = min(duration, end)
            if not activity_windows or start > activity_windows[-1][1] + 1e-6:
                activity_windows.append((start, end))
                return
            previous_start, previous_end = activity_windows[-1]
            activity_windows[-1] = (previous_start, max(previous_end, end))

        def publish_scout_frame(
            frame: np.ndarray,
            offset: float,
            detections: tuple[DetectedFace, ...],
        ) -> None:
            captured_at = job_started.timestamp() + offset
            camera = self._cameras.get(camera_key)
            publish = getattr(camera, "publish_detection_frame", None)
            if callable(publish):
                publish(frame, captured_at)
            camera_metrics = camera.status_metrics if camera is not None else {}
            if camera_metrics.get("live_preview_enabled"):
                return
            preview_due = (
                time.monotonic() - self._last_preview_at.get(camera_key, 0.0)
                >= 1.0 / max(float(config.preview_fps), 1.0)
            )
            if not preview_due:
                return
            preview = frame.copy()
            draw_detection_roi(preview, (roi_x1, 0, roi_x2, height))
            for detected in detections:
                draw_face(
                    preview,
                    detected,
                    f"Detectado {detected.score * 100:.0f}%",
                    BLUE,
                )
            self._set_preview(
                encode_preview(preview, config.preview_width),
                camera_key,
            )
            self._last_preview_at[camera_key] = time.monotonic()

        def update_progress(*, force: bool = False) -> None:
            nonlocal last_job_update
            elapsed = time.perf_counter() - pass_started
            completed = sampled_frames + full_fps_frames
            expected = expected_scout_frames + len(full_packets)
            progress = 0.9 * completed / max(expected, 1)
            throughput = completed / max(elapsed, 0.001)
            source_bytes = max(int(info.get("file_bytes") or path.stat().st_size), 1)
            current.update(
                {
                    "stage": "detecting",
                    "pipeline_mode": "mjpeg_indexed_selective",
                    "decoder": "nvjpeg_cuda",
                    "pixel_format": str(info.get("pixel_format") or ""),
                    "decode_batch_size": batch_limit,
                    "progress": round(min(0.9, progress), 4),
                    "sampled_frames": sampled_frames,
                    "expected_frames": expected_scout_frames,
                    "source_packets": len(packets),
                    "packet_timestamps": len(packets),
                    "timestamp_fallbacks": 0,
                    "timestamp_source": "matroska_packet_index",
                    "face_frames": scout_face_frames,
                    "faces": scout_faces,
                    "full_fps_frames": full_fps_frames,
                    "full_fps_expected_frames": len(full_packets),
                    "full_fps_face_frames": full_face_frames,
                    "full_fps_faces": full_faces,
                    "crops_enqueued": crops_enqueued,
                    "activity_windows": len(activity_windows),
                    "selective_mib_read": round(selective_bytes_read / 1024**2, 2),
                    "source_fraction_read": round(
                        selective_bytes_read / source_bytes,
                        6,
                    ),
                    "throughput_fps": round(throughput, 2),
                    "elapsed_seconds": round(elapsed, 2),
                }
            )
            with self._state_lock:
                self._processing_fps = throughput
                self._camera_processing_fps[camera_key] = throughput
            self._set_recorded_pipeline_state("processing", current=current)
            now = time.monotonic()
            if not force and now - last_job_update < 5.0:
                return
            update_segment_job(
                path.with_suffix(path.suffix + ".job.json"),
                stage="detecting",
                pipeline_mode="mjpeg_indexed_selective",
                decoder="nvjpeg_cuda",
                pixel_format=str(info.get("pixel_format") or ""),
                decode_batch_size=batch_limit,
                sampled_frames=sampled_frames,
                expected_frames=expected_scout_frames,
                source_packets=len(packets),
                packet_timestamps=len(packets),
                timestamp_fallbacks=0,
                timestamp_source="matroska_packet_index",
                scout_face_frames=scout_face_frames,
                scout_faces=scout_faces,
                full_fps_frames=full_fps_frames,
                full_fps_expected_frames=len(full_packets),
                face_frames=full_face_frames,
                faces=full_faces,
                crops_enqueued=crops_enqueued,
                activity_windows=len(activity_windows),
                selective_mib_read=current["selective_mib_read"],
                source_fraction_read=current["source_fraction_read"],
                progress=current["progress"],
            )
            last_job_update = now

        with IndexedMjpegReader(path) as reader:
            def process_rows(rows: list[MjpegPacket], *, full: bool) -> None:
                nonlocal batch_limit, sampled_frames, scout_face_frames
                nonlocal scout_faces, full_fps_frames, full_face_frames
                nonlocal full_faces, crops_enqueued, selective_bytes_read
                nonlocal selective_read_seconds
                cursor = 0
                while cursor < len(rows):
                    if self._stop.is_set():
                        raise RuntimeError(
                            "El analisis se interrumpio al detener la estacion."
                        )
                    requested = batch_limit or RECORDED_MJPEG_BATCH_SIZE
                    batch_rows = rows[cursor : cursor + requested]
                    payloads = [reader.read(packet) for packet in batch_rows]
                    selective_bytes_read = reader.bytes_read
                    selective_read_seconds = reader.read_seconds
                    if batch_limit <= 0:
                        jpeg_info = decoder.image_info(payloads[0])
                        batch_limit = decoder.recommended_batch_size(
                            jpeg_info,
                            width,
                            height,
                            requested=RECORDED_MJPEG_BATCH_SIZE,
                        )
                        if len(payloads) > batch_limit:
                            payloads = payloads[:batch_limit]
                            batch_rows = batch_rows[:batch_limit]
                    with self._gpu_lock:
                        decoded = decoder.decode_resize_batch(
                            payloads,
                            width,
                            height,
                        )
                    try:
                        for batch_index, (frame, packet) in enumerate(
                            zip(
                                decoded.resized_frames,
                                batch_rows,
                                strict=True,
                            )
                        ):
                            if not full and evidence_writer is not None:
                                evidence_writer.write(frame)
                            with self._gpu_lock:
                                roi_detections = detector.detect(
                                    frame[:, roi_x1:roi_x2],
                                    min_face_size=scaled_min_face_size,
                                )
                            detections = tuple(
                                self._offset_detection(detected, roi_x1, 0)
                                for detected in roi_detections
                            )
                            if not full:
                                sampled_frames += 1
                                if detections:
                                    anchors.append(
                                        (packet.offset, frame.shape[:2], detections)
                                    )
                                    scout_face_frames += 1
                                    scout_faces += len(detections)
                                    merge_activity(
                                        packet.offset - padding,
                                        packet.offset + padding,
                                    )
                                    self._last_face_at = time.monotonic()
                                publish_scout_frame(
                                    frame,
                                    packet.offset,
                                    detections,
                                )
                                continue

                            if detections:
                                with self._gpu_lock:
                                    source_frame = decoded.copy_original(batch_index)
                                crops_enqueued += (
                                    self._enqueue_recorded_source_detections(
                                        source_frame,
                                        frame.shape[:2],
                                        detections,
                                        camera_key,
                                        job_started,
                                        packet.offset,
                                    )
                                )
                                full_face_frames += 1
                                full_faces += len(detections)
                                self._last_face_at = time.monotonic()
                            full_fps_frames += 1
                    finally:
                        decoded.close()
                    cursor += len(batch_rows)
                    update_progress()

            process_rows(scout_packets, full=False)
            full_packets = mjpeg_packets_in_windows(packets, activity_windows)
            process_rows(full_packets, full=True)
            selective_bytes_read = reader.bytes_read
            selective_read_seconds = reader.read_seconds

        elapsed = time.perf_counter() - pass_started
        observed_fps = len(packets) / duration
        source_bytes = max(path.stat().st_size, 1)
        with self._state_lock:
            self._processed_frames += sampled_frames
            self._detected_faces += scout_faces
            self._camera_processed_frames[camera_key] = (
                self._camera_processed_frames.get(camera_key, 0) + sampled_frames
            )
            observed_date = job_started.astimezone(
                BUSINESS_TIME_ZONE
            ).date().isoformat()
            if observed_date != self._capture_date:
                self._capture_date = observed_date
                self._captured_frames_today = 0
                self._captured_faces_today = 0
            self._captured_frames_today += sampled_frames
            self._captured_faces_today += scout_faces
        update_progress(force=True)
        common_stats = {
            "pipeline_mode": "mjpeg_indexed_selective",
            "source_packets": len(packets),
            "packet_timestamps": len(packets),
            "timestamp_fallbacks": 0,
            "timestamp_source": "matroska_packet_index",
            "decoder": "nvjpeg_cuda",
            "decode_batch_size": batch_limit,
            "selective_bytes_read": selective_bytes_read,
            "selective_mib_read": round(selective_bytes_read / 1024**2, 2),
            "source_fraction_read": round(
                selective_bytes_read / source_bytes,
                6,
            ),
            "selective_read_seconds": round(selective_read_seconds, 3),
            "indexed_processing_seconds": round(elapsed, 3),
        }
        scan_stats = {
            **common_stats,
            "sampled_frames": sampled_frames,
            "expected_frames": expected_scout_frames,
            "face_frames": scout_face_frames,
            "faces": scout_faces,
            "crops_enqueued": 0,
            "throughput_fps": round(sampled_frames / max(elapsed, 0.001), 2),
            "scan_seconds": round(elapsed, 3),
        }
        activity_stats = {
            **common_stats,
            "full_fps_frames": full_fps_frames,
            "full_fps_expected_frames": len(full_packets),
            "face_frames": full_face_frames,
            "faces": full_faces,
            "crops_enqueued": crops_enqueued,
            "full_fps": round(observed_fps, 3),
            "activity_throughput_fps": round(
                full_fps_frames / max(elapsed, 0.001),
                2,
            ),
            "activity_scan_seconds": round(elapsed, 3),
        }
        return anchors, scan_stats, activity_windows, activity_stats

    def _process_recorded_mjpeg_single_pass(
        self,
        path: Path,
        camera_key: str,
        job: dict,
        info: dict,
        current: dict,
        *,
        evidence_writer: MatchEvidenceWriter | None = None,
    ) -> tuple[list, dict, list[tuple[float, float]], dict]:
        """Scout and recover original MJPEG packets during one demux pass.

        A compressed ring retains only packets that may still fall inside the
        padding of a future scout hit. Final inactive packets are released and
        active packets are decoded at full FPS without reopening the segment.
        """
        decoder = self._recorded_nvjpeg
        detector = self._detector
        ffmpeg = self._recorded_ffmpeg
        if decoder is None or detector is None or ffmpeg is None:
            raise NvJpegCudaError("nvJPEG no esta preparado para procesar MJPEG.")

        config = self.config_manager.config
        width = int(config.recorded_processing_width)
        height = max(
            2,
            int(round(width * int(info["height"]) / max(int(info["width"]), 1))),
        )
        if height % 2:
            height += 1
        sample_fps = float(config.recorded_sample_fps)
        sample_interval = 1.0 / max(sample_fps, 0.001)
        duration = max(float(info.get("duration_seconds") or 0.0), 0.001)
        source_fps = float(info.get("source_fps") or 25.0)
        padding = max(RECORDED_ACTIVITY_PADDING_SECONDS, sample_interval)
        expected_scout_frames = max(1, int(math.ceil(duration * sample_fps)))

        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(0, min(width - 1, int(round(width * roi_left))))
        roi_x2 = max(roi_x1 + 1, min(width, int(round(width * roi_right))))
        scaled_min_face_size = max(
            1,
            int(
                round(
                    float(config.min_face_size)
                    * width
                    / max(int(config.processing_width), 1)
                )
            ),
        )
        job_started = datetime.fromisoformat(str(job["started_at"]))
        pass_started = time.perf_counter()

        packet_buffer: deque[tuple[float, bytes]] = deque()
        scout_payloads: list[bytes] = []
        scout_offsets: list[float] = []
        full_payloads: list[bytes] = []
        full_offsets: list[float] = []
        observed_offsets: list[float] = []
        activity_windows: list[tuple[float, float]] = []
        anchors: list[
            tuple[float, tuple[int, int], tuple[DetectedFace, ...]]
        ] = []
        source_packets = 0
        sampled_frames = 0
        scout_face_frames = 0
        scout_faces = 0
        full_fps_frames = 0
        full_face_frames = 0
        full_faces = 0
        crops_enqueued = 0
        next_sample_at = 0.0
        batch_limit = 0
        buffer_bytes = 0
        max_buffer_bytes = 0
        last_job_update = 0.0
        timestamped_packets = 0
        timestamp_fallbacks = 0
        parser = OctetStreamJpegParser()

        def merge_activity(start: float, end: float) -> None:
            start = max(0.0, start)
            end = min(duration, end)
            if not activity_windows or start > activity_windows[-1][1] + 1e-6:
                activity_windows.append((start, end))
                return
            previous_start, previous_end = activity_windows[-1]
            activity_windows[-1] = (previous_start, max(previous_end, end))

        def is_active(offset: float) -> bool:
            for start, end in activity_windows:
                if offset < start - 1e-6:
                    return False
                if offset <= end + 1e-6:
                    return True
            return False

        def publish_scout_frame(
            frame: np.ndarray,
            offset: float,
            detections: tuple[DetectedFace, ...],
        ) -> None:
            captured_at = job_started.timestamp() + offset
            camera = self._cameras.get(camera_key)
            publish = getattr(camera, "publish_detection_frame", None)
            if callable(publish):
                publish(frame, captured_at)
            camera_metrics = camera.status_metrics if camera is not None else {}
            if camera_metrics.get("live_preview_enabled"):
                return
            preview_due = (
                time.monotonic() - self._last_preview_at.get(camera_key, 0.0)
                >= 1.0 / max(float(config.preview_fps), 1.0)
            )
            if not preview_due:
                return
            preview = frame.copy()
            draw_detection_roi(preview, (roi_x1, 0, roi_x2, height))
            for detected in detections:
                draw_face(
                    preview,
                    detected,
                    f"Detectado {detected.score * 100:.0f}%",
                    BLUE,
                )
            self._set_preview(
                encode_preview(preview, config.preview_width),
                camera_key,
            )
            self._last_preview_at[camera_key] = time.monotonic()

        def update_progress(*, force: bool = False) -> None:
            nonlocal last_job_update
            elapsed = time.perf_counter() - pass_started
            throughput = sampled_frames / max(elapsed, 0.001)
            current.update(
                {
                    "stage": "detecting",
                    "pipeline_mode": "mjpeg_single_pass",
                    "decoder": "nvjpeg_cuda",
                    "pixel_format": str(info.get("pixel_format") or ""),
                    "decode_batch_size": batch_limit,
                    "progress": round(
                        min(
                            0.9,
                            0.9 * sampled_frames / expected_scout_frames,
                        ),
                        4,
                    ),
                    "sampled_frames": sampled_frames,
                    "expected_frames": expected_scout_frames,
                    "source_packets": source_packets,
                    "packet_timestamps": timestamped_packets,
                    "timestamp_fallbacks": timestamp_fallbacks,
                    "timestamp_source": "ffmpeg_live_demux",
                    "face_frames": scout_face_frames,
                    "faces": scout_faces,
                    "full_fps_frames": full_fps_frames,
                    "full_fps_face_frames": full_face_frames,
                    "full_fps_faces": full_faces,
                    "crops_enqueued": crops_enqueued,
                    "activity_windows": len(activity_windows),
                    "compressed_buffer_mib": round(buffer_bytes / 1024**2, 2),
                    "max_compressed_buffer_mib": round(
                        max_buffer_bytes / 1024**2,
                        2,
                    ),
                    "throughput_fps": round(throughput, 2),
                    "elapsed_seconds": round(elapsed, 2),
                }
            )
            with self._state_lock:
                self._processing_fps = throughput
                self._camera_processing_fps[camera_key] = throughput
            self._set_recorded_pipeline_state("processing", current=current)
            now = time.monotonic()
            if not force and now - last_job_update < 5.0:
                return
            update_segment_job(
                path.with_suffix(path.suffix + ".job.json"),
                stage="detecting",
                pipeline_mode="mjpeg_single_pass",
                decoder="nvjpeg_cuda",
                pixel_format=str(info.get("pixel_format") or ""),
                decode_batch_size=batch_limit,
                sampled_frames=sampled_frames,
                expected_frames=expected_scout_frames,
                source_packets=source_packets,
                packet_timestamps=timestamped_packets,
                timestamp_fallbacks=timestamp_fallbacks,
                timestamp_source="ffmpeg_live_demux",
                scout_face_frames=scout_face_frames,
                scout_faces=scout_faces,
                full_fps_frames=full_fps_frames,
                face_frames=full_face_frames,
                faces=full_faces,
                crops_enqueued=crops_enqueued,
                activity_windows=len(activity_windows),
                max_compressed_buffer_mib=round(max_buffer_bytes / 1024**2, 2),
                progress=current["progress"],
            )
            last_job_update = now

        def process_scout_batch() -> None:
            nonlocal sampled_frames, scout_face_frames, scout_faces
            if not scout_payloads:
                return
            with self._gpu_lock:
                decoded = decoder.decode_resize_batch(
                    scout_payloads,
                    width,
                    height,
                )
            try:
                for frame, offset in zip(
                    decoded.resized_frames,
                    scout_offsets,
                    strict=True,
                ):
                    if evidence_writer is not None:
                        evidence_writer.write(frame)
                    with self._gpu_lock:
                        roi_detections = detector.detect(
                            frame[:, roi_x1:roi_x2],
                            min_face_size=scaled_min_face_size,
                        )
                    detections = tuple(
                        self._offset_detection(detected, roi_x1, 0)
                        for detected in roi_detections
                    )
                    if detections:
                        anchors.append((offset, frame.shape[:2], detections))
                        scout_face_frames += 1
                        scout_faces += len(detections)
                        merge_activity(offset - padding, offset + padding)
                        self._last_face_at = time.monotonic()
                    publish_scout_frame(frame, offset, detections)
                    sampled_frames += 1
            finally:
                decoded.close()
                scout_payloads.clear()
                scout_offsets.clear()
            update_progress()

        def process_full_batch() -> None:
            nonlocal full_fps_frames, full_face_frames, full_faces
            nonlocal crops_enqueued
            if not full_payloads:
                return
            with self._gpu_lock:
                decoded = decoder.decode_resize_batch(
                    full_payloads,
                    width,
                    height,
                )
            try:
                for batch_index, (frame, offset) in enumerate(
                    zip(
                        decoded.resized_frames,
                        full_offsets,
                        strict=True,
                    )
                ):
                    with self._gpu_lock:
                        roi_detections = detector.detect(
                            frame[:, roi_x1:roi_x2],
                            min_face_size=scaled_min_face_size,
                        )
                    detections = tuple(
                        self._offset_detection(detected, roi_x1, 0)
                        for detected in roi_detections
                    )
                    if detections:
                        with self._gpu_lock:
                            source_frame = decoded.copy_original(batch_index)
                        crops_enqueued += self._enqueue_recorded_source_detections(
                            source_frame,
                            frame.shape[:2],
                            detections,
                            camera_key,
                            job_started,
                            offset,
                        )
                        full_face_frames += 1
                        full_faces += len(detections)
                        self._last_face_at = time.monotonic()
                    full_fps_frames += 1
            finally:
                decoded.close()
                full_payloads.clear()
                full_offsets.clear()
            update_progress()

        def finalize_safe(cutoff: float) -> None:
            nonlocal buffer_bytes
            while packet_buffer and packet_buffer[0][0] <= cutoff + 1e-6:
                offset, payload = packet_buffer.popleft()
                buffer_bytes -= len(payload)
                if not is_active(offset):
                    continue
                full_payloads.append(payload)
                full_offsets.append(offset)
                if len(full_payloads) >= batch_limit:
                    process_full_batch()

        command = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "debug",
            "-debug_ts",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-c:v",
            "copy",
            "-f",
            "image2pipe",
            "pipe:1",
        ]
        timestamp_queue: Queue[float] = Queue()
        timestamp_reader_stop = Event()
        timestamp_reader_done = Event()
        error_tail: deque[str] = deque(maxlen=120)
        with tempfile.TemporaryFile() as error_stream:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                creationflags=CREATE_NO_WINDOW,
            )
            assert process.stdout is not None
            assert process.stderr is not None

            def read_packet_timestamps() -> None:
                origin: float | None = None
                try:
                    while not timestamp_reader_stop.is_set():
                        raw_line = process.stderr.readline()
                        if not raw_line:
                            break
                        line = raw_line.decode("utf-8", errors="replace")
                        error_tail.append(line)
                        if "] demuxer -> " not in line or "pkt_pts_time:" not in line:
                            continue
                        token = line.split("pkt_pts_time:", 1)[1].split(None, 1)[0]
                        try:
                            pts = float(token)
                        except (TypeError, ValueError):
                            continue
                        if not math.isfinite(pts):
                            continue
                        if origin is None:
                            origin = pts
                        timestamp_queue.put(max(0.0, pts - origin))
                finally:
                    timestamp_reader_done.set()

            timestamp_reader = Thread(
                target=read_packet_timestamps,
                name="faceguard-mjpeg-timestamps",
                daemon=True,
            )
            timestamp_reader.start()
            try:
                while not self._stop.is_set():
                    chunk = process.stdout.read(2 * 1024 * 1024)
                    if not chunk:
                        break
                    for jpeg in parser.feed(chunk):
                        try:
                            offset = timestamp_queue.get(timeout=15.0)
                            timestamped_packets += 1
                        except Empty:
                            if not timestamp_reader_done.is_set():
                                raise TimeoutError(
                                    "FFmpeg no entrego el timestamp del paquete MJPEG."
                                )
                            offset = source_packets / max(source_fps, 0.001)
                            timestamp_fallbacks += 1
                        source_packets += 1
                        observed_offsets.append(offset)
                        packet_buffer.append((offset, jpeg))
                        buffer_bytes += len(jpeg)
                        max_buffer_bytes = max(max_buffer_bytes, buffer_bytes)
                        if batch_limit <= 0:
                            jpeg_info = decoder.image_info(jpeg)
                            batch_limit = decoder.recommended_batch_size(
                                jpeg_info,
                                width,
                                height,
                                requested=RECORDED_MJPEG_BATCH_SIZE,
                            )
                        if offset + 1e-6 < next_sample_at:
                            continue
                        scout_payloads.append(jpeg)
                        scout_offsets.append(offset)
                        while next_sample_at <= offset + 1e-6:
                            next_sample_at += sample_interval
                        if len(scout_payloads) >= batch_limit:
                            process_scout_batch()
                            finalize_safe(offset - padding)
                if self._stop.is_set():
                    raise RuntimeError(
                        "El analisis se interrumpio al detener la estacion."
                    )
                try:
                    parser.finish()
                except MjpegStreamError as exc:
                    if source_packets <= 0:
                        raise
                    LOGGER.warning(
                        "Se omitio el ultimo JPEG incompleto de %s: %s",
                        path,
                        exc,
                    )
                    current["trailing_frame_dropped"] = True
                process_scout_batch()
                finalize_safe(float("inf"))
                process_full_batch()
                return_code = process.wait(timeout=10)
                if return_code:
                    stderr = "".join(error_tail)
                    raise RuntimeError(
                        f"FFmpeg termino con codigo {return_code}: {stderr[-1200:]}"
                    )
                if sampled_frames <= 0:
                    raise RuntimeError("El segmento MJPEG no entrego frames completos.")
            finally:
                timestamp_reader_stop.set()
                if process.poll() is None:
                    process.kill()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                try:
                    process.stdout.close()
                except OSError:
                    pass
                try:
                    process.stderr.close()
                except OSError:
                    pass
                timestamp_reader.join(timeout=2)

        expected_full_frames = sum(
            1 for offset in observed_offsets if is_active(offset)
        )
        if full_fps_frames != expected_full_frames:
            raise RuntimeError(
                "La recuperacion MJPEG de una pasada esperaba "
                f"{expected_full_frames} frames y obtuvo {full_fps_frames}."
            )
        elapsed = time.perf_counter() - pass_started
        observed_fps = len(observed_offsets) / duration
        with self._state_lock:
            self._processed_frames += sampled_frames
            self._detected_faces += scout_faces
            self._camera_processed_frames[camera_key] = (
                self._camera_processed_frames.get(camera_key, 0) + sampled_frames
            )
            observed_date = job_started.astimezone(
                BUSINESS_TIME_ZONE
            ).date().isoformat()
            if observed_date != self._capture_date:
                self._capture_date = observed_date
                self._captured_frames_today = 0
                self._captured_faces_today = 0
            self._captured_frames_today += sampled_frames
            self._captured_faces_today += scout_faces
        update_progress(force=True)
        scan_stats = {
            "pipeline_mode": "mjpeg_single_pass",
            "sampled_frames": sampled_frames,
            "expected_frames": expected_scout_frames,
            "source_packets": source_packets,
            "packet_timestamps": timestamped_packets,
            "timestamp_fallbacks": timestamp_fallbacks,
            "timestamp_source": "ffmpeg_live_demux",
            "face_frames": scout_face_frames,
            "faces": scout_faces,
            "crops_enqueued": 0,
            "decoder": "nvjpeg_cuda",
            "decode_batch_size": batch_limit,
            "throughput_fps": round(sampled_frames / max(elapsed, 0.001), 2),
            "scan_seconds": round(elapsed, 3),
            "single_pass_seconds": round(elapsed, 3),
            "max_compressed_buffer_mib": round(max_buffer_bytes / 1024**2, 2),
        }
        activity_stats = {
            "pipeline_mode": "mjpeg_single_pass",
            "full_fps_frames": full_fps_frames,
            "full_fps_expected_frames": expected_full_frames,
            "face_frames": full_face_frames,
            "faces": full_faces,
            "crops_enqueued": crops_enqueued,
            "full_fps": round(observed_fps, 3),
            "activity_throughput_fps": round(
                full_fps_frames / max(elapsed, 0.001),
                2,
            ),
            "activity_scan_seconds": round(elapsed, 3),
            "single_pass_seconds": round(elapsed, 3),
            "max_compressed_buffer_mib": round(max_buffer_bytes / 1024**2, 2),
        }
        return anchors, scan_stats, activity_windows, activity_stats

    def _scan_recorded_video(
        self,
        path: Path,
        camera_key: str,
        job: dict,
        info: dict,
        current: dict,
        *,
        evidence_writer: MatchEvidenceWriter | None = None,
    ) -> tuple[list[tuple[float, tuple[int, int], tuple[DetectedFace, ...]]], dict]:
        if self._recorded_ffmpeg is None or self._detector is None:
            raise RuntimeError("El detector grabado no está preparado.")
        if str(info.get("codec") or "") == "mjpeg":
            return self._scan_recorded_mjpeg_cuda(
                path,
                camera_key,
                job,
                info,
                current,
                evidence_writer=evidence_writer,
            )
        config = self.config_manager.config
        width = int(config.recorded_processing_width)
        height = max(
            2,
            int(round(width * int(info["height"]) / max(int(info["width"]), 1))),
        )
        if height % 2:
            height += 1
        sample_fps = float(config.recorded_sample_fps)
        decoder = str(info.get("decoder") or "cpu")
        use_nvdec = decoder != "cpu"
        command = [str(self._recorded_ffmpeg), "-hide_banner", "-loglevel", "error"]
        if use_nvdec:
            command += [
                "-hwaccel",
                "cuda",
                "-hwaccel_output_format",
                "cuda",
                "-c:v",
                decoder,
            ]
        command += ["-i", str(path), "-an", "-sn"]
        filters = (
            [
                f"scale_cuda={width}:{height}",
                "hwdownload",
                "format=nv12",
                (
                    "setparams=colorspace=bt709:color_primaries=bt709:"
                    "color_trc=bt709:range=full"
                ),
            ]
            if use_nvdec
            else [f"scale={width}:{height}:flags=fast_bilinear"]
        )
        filters.append(f"fps=fps={sample_fps}")
        command += [
            "-vf",
            ",".join(filters),
            "-fps_mode",
            "passthrough",
            "-pix_fmt",
            "bgr24",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
        frame_bytes = width * height * 3
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=frame_bytes * 2,
            creationflags=CREATE_NO_WINDOW,
        )
        assert process.stdout is not None
        assert process.stderr is not None
        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(0, min(width - 1, int(round(width * roi_left))))
        roi_x2 = max(roi_x1 + 1, min(width, int(round(width * roi_right))))
        scaled_min_face_size = max(
            1,
            int(
                round(
                    float(config.min_face_size)
                    * width
                    / max(int(config.processing_width), 1)
                )
            ),
        )
        anchors = []
        frames = 0
        face_frames = 0
        faces = 0
        expected_frames = max(1, int(math.ceil(float(info["duration_seconds"]) * sample_fps)))
        scan_started = time.perf_counter()
        job_started = datetime.fromisoformat(str(job["started_at"]))
        last_job_update = 0.0
        try:
            while not self._stop.is_set():
                raw = self._read_recorded_frame(process.stdout, frame_bytes)
                if not raw:
                    break
                if len(raw) != frame_bytes:
                    raise RuntimeError(
                        f"FFmpeg entregó un frame incompleto: {len(raw)}/{frame_bytes}."
                    )
                frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
                if evidence_writer is not None:
                    evidence_writer.write(frame)
                offset = frames / max(sample_fps, 0.001)
                with self._gpu_lock:
                    roi_detections = self._detector.detect(
                        frame[:, roi_x1:roi_x2],
                        min_face_size=scaled_min_face_size,
                    )
                detections = tuple(
                    self._offset_detection(detected, roi_x1, 0)
                    for detected in roi_detections
                )
                if detections:
                    anchors.append((offset, (height, width), detections))
                    face_frames += 1
                    faces += len(detections)
                    self._last_face_at = time.monotonic()
                frames += 1
                captured_at = job_started.timestamp() + offset
                camera = self._cameras.get(camera_key)
                publish = getattr(camera, "publish_detection_frame", None)
                if callable(publish):
                    publish(frame, captured_at)
                camera_metrics = (
                    camera.status_metrics if camera is not None else {}
                )
                has_live_preview = bool(
                    camera_metrics.get("live_preview_enabled")
                )
                preview_due = (
                    time.monotonic() - self._last_preview_at.get(camera_key, 0.0)
                    >= 1.0 / max(float(config.preview_fps), 1.0)
                )
                if preview_due and not has_live_preview:
                    preview = frame.copy()
                    draw_detection_roi(
                        preview,
                        (roi_x1, 0, roi_x2, height),
                    )
                    for detected in detections:
                        draw_face(
                            preview,
                            detected,
                            f"Detectado {detected.score * 100:.0f}%",
                            BLUE,
                        )
                    self._set_preview(
                        encode_preview(preview, config.preview_width),
                        camera_key,
                    )
                    self._last_preview_at[camera_key] = time.monotonic()
                elapsed = time.perf_counter() - scan_started
                throughput = frames / max(elapsed, 0.001)
                current.update(
                    {
                        "stage": "detecting",
                        "progress": round(min(0.9, 0.9 * frames / expected_frames), 4),
                        "sampled_frames": frames,
                        "expected_frames": expected_frames,
                        "face_frames": face_frames,
                        "faces": faces,
                        "throughput_fps": round(throughput, 2),
                        "elapsed_seconds": round(elapsed, 2),
                    }
                )
                with self._state_lock:
                    self._processing_fps = throughput
                    self._camera_processing_fps[camera_key] = throughput
                self._set_recorded_pipeline_state("processing", current=current)
                now = time.monotonic()
                if now - last_job_update >= 5.0:
                    update_segment_job(
                        path.with_suffix(path.suffix + ".job.json"),
                        stage="detecting",
                        sampled_frames=frames,
                        expected_frames=expected_frames,
                        face_frames=face_frames,
                        faces=faces,
                        progress=current["progress"],
                    )
                    last_job_update = now
            if self._stop.is_set() and process.poll() is None:
                process.kill()
            stderr = process.stderr.read().decode("utf-8", errors="replace")
            return_code = process.wait()
            if self._stop.is_set():
                raise RuntimeError("El análisis se interrumpió al detener la estación.")
            if return_code:
                raise RuntimeError(
                    f"FFmpeg terminó con código {return_code}: {stderr[-1200:]}"
                )
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
        elapsed = time.perf_counter() - scan_started
        with self._state_lock:
            self._processed_frames += frames
            self._detected_faces += faces
            self._camera_processed_frames[camera_key] = (
                self._camera_processed_frames.get(camera_key, 0) + frames
            )
            observed_date = job_started.astimezone(BUSINESS_TIME_ZONE).date().isoformat()
            if observed_date != self._capture_date:
                self._capture_date = observed_date
                self._captured_frames_today = 0
                self._captured_faces_today = 0
            self._captured_frames_today += frames
            self._captured_faces_today += faces
        return anchors, {
            "sampled_frames": frames,
            "expected_frames": expected_frames,
            "face_frames": face_frames,
            "faces": faces,
            "throughput_fps": round(frames / max(elapsed, 0.001), 2),
            "scan_seconds": round(elapsed, 3),
        }

    def _scan_recorded_mjpeg_cuda(
        self,
        path: Path,
        camera_key: str,
        job: dict,
        info: dict,
        current: dict,
        *,
        evidence_writer: MatchEvidenceWriter | None = None,
    ) -> tuple[list, dict]:
        decoder = self._recorded_nvjpeg
        detector = self._detector
        ffmpeg = self._recorded_ffmpeg
        if decoder is None or detector is None or ffmpeg is None:
            raise NvJpegCudaError("nvJPEG no esta preparado para procesar MJPEG.")

        config = self.config_manager.config
        width = int(config.recorded_processing_width)
        height = max(
            2,
            int(round(width * int(info["height"]) / max(int(info["width"]), 1))),
        )
        if height % 2:
            height += 1
        sample_fps = float(config.recorded_sample_fps)
        source_fps = float(info.get("source_fps") or 25.0)
        sample_interval = 1.0 / max(sample_fps, 0.001)
        packet_offsets = self._probe_recorded_packet_offsets(path)
        expected_frames = max(
            1,
            int(math.ceil(float(info["duration_seconds"]) * sample_fps)),
        )
        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(0, min(width - 1, int(round(width * roi_left))))
        roi_x2 = max(roi_x1 + 1, min(width, int(round(width * roi_right))))
        scaled_min_face_size = max(
            1,
            int(
                round(
                    float(config.min_face_size)
                    * width
                    / max(int(config.processing_width), 1)
                )
            ),
        )
        job_started = datetime.fromisoformat(str(job["started_at"]))
        scan_started = time.perf_counter()
        frames = 0
        face_frames = 0
        faces = 0
        anchors: list[
            tuple[float, tuple[int, int], tuple[DetectedFace, ...]]
        ] = []
        source_packets = 0
        next_sample_at = 0.0
        selected_payloads: list[bytes] = []
        selected_offsets: list[float] = []
        batch_limit = 0
        last_job_update = 0.0
        parser = OctetStreamJpegParser()

        command = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-c:v",
            "copy",
            "-f",
            "image2pipe",
            "pipe:1",
        ]

        def process_selected_batch() -> None:
            nonlocal frames, face_frames, faces, last_job_update
            if not selected_payloads:
                return
            batch_started = time.perf_counter()
            with self._gpu_lock:
                decoded = decoder.decode_resize_batch(
                    selected_payloads,
                    width,
                    height,
                )
            try:
                for batch_index, (frame, offset) in enumerate(
                    zip(
                        decoded.resized_frames,
                        selected_offsets,
                        strict=True,
                    )
                ):
                    if evidence_writer is not None:
                        evidence_writer.write(frame)
                    with self._gpu_lock:
                        roi_detections = detector.detect(
                            frame[:, roi_x1:roi_x2],
                            min_face_size=scaled_min_face_size,
                        )
                    detections = tuple(
                        self._offset_detection(detected, roi_x1, 0)
                        for detected in roi_detections
                    )
                    if detections:
                        anchors.append((offset, frame.shape[:2], detections))
                        face_frames += 1
                        faces += len(detections)
                        self._last_face_at = time.monotonic()

                    captured_at = job_started.timestamp() + offset
                    camera = self._cameras.get(camera_key)
                    publish = getattr(camera, "publish_detection_frame", None)
                    if callable(publish):
                        publish(frame, captured_at)
                    camera_metrics = (
                        camera.status_metrics if camera is not None else {}
                    )
                    has_live_preview = bool(
                        camera_metrics.get("live_preview_enabled")
                    )
                    preview_due = (
                        time.monotonic()
                        - self._last_preview_at.get(camera_key, 0.0)
                        >= 1.0 / max(float(config.preview_fps), 1.0)
                    )
                    if preview_due and not has_live_preview:
                        preview = frame.copy()
                        draw_detection_roi(preview, (roi_x1, 0, roi_x2, height))
                        for detected in detections:
                            draw_face(
                                preview,
                                detected,
                                f"Detectado {detected.score * 100:.0f}%",
                                BLUE,
                            )
                        self._set_preview(
                            encode_preview(preview, config.preview_width),
                            camera_key,
                        )
                        self._last_preview_at[camera_key] = time.monotonic()
                    frames += 1
            finally:
                decoded.close()

            elapsed = time.perf_counter() - scan_started
            throughput = frames / max(elapsed, 0.001)
            current.update(
                {
                    "stage": "detecting",
                    "decoder": "nvjpeg_cuda",
                    "pixel_format": str(info.get("pixel_format") or ""),
                    "decode_batch_size": batch_limit,
                    "progress": round(
                        min(0.9, 0.9 * frames / expected_frames),
                        4,
                    ),
                    "sampled_frames": frames,
                    "expected_frames": expected_frames,
                    "source_packets": source_packets,
                    "packet_timestamps": len(packet_offsets),
                    "face_frames": face_frames,
                    "faces": faces,
                    "crops_enqueued": 0,
                    "throughput_fps": round(throughput, 2),
                    "elapsed_seconds": round(elapsed, 2),
                    "last_batch_seconds": round(
                        time.perf_counter() - batch_started,
                        3,
                    ),
                }
            )
            with self._state_lock:
                self._processing_fps = throughput
                self._camera_processing_fps[camera_key] = throughput
            self._set_recorded_pipeline_state("processing", current=current)
            now = time.monotonic()
            if now - last_job_update >= 5.0:
                update_segment_job(
                    path.with_suffix(path.suffix + ".job.json"),
                    stage="detecting",
                    decoder="nvjpeg_cuda",
                    pixel_format=str(info.get("pixel_format") or ""),
                    decode_batch_size=batch_limit,
                    sampled_frames=frames,
                    expected_frames=expected_frames,
                    source_packets=source_packets,
                    packet_timestamps=len(packet_offsets),
                    face_frames=face_frames,
                    faces=faces,
                    crops_enqueued=0,
                    progress=current["progress"],
                )
                last_job_update = now
            selected_payloads.clear()
            selected_offsets.clear()

        chunk_queue: Queue = Queue(maxsize=2)
        reader_stop = Event()
        reader_done = object()
        with tempfile.TemporaryFile() as error_stream:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=error_stream,
                bufsize=0,
                creationflags=CREATE_NO_WINDOW,
            )
            assert process.stdout is not None

            def read_stdout() -> None:
                try:
                    while not reader_stop.is_set():
                        chunk = process.stdout.read(2 * 1024 * 1024)
                        if not chunk:
                            break
                        while not reader_stop.is_set():
                            try:
                                chunk_queue.put(chunk, timeout=0.25)
                                break
                            except Full:
                                continue
                finally:
                    while not reader_stop.is_set():
                        try:
                            chunk_queue.put(reader_done, timeout=0.25)
                            break
                        except Full:
                            continue

            reader = Thread(
                target=read_stdout,
                name="faceguard-mjpeg-demux",
                daemon=True,
            )
            reader.start()
            last_chunk_at = time.monotonic()
            try:
                while not self._stop.is_set():
                    try:
                        chunk = chunk_queue.get(timeout=0.5)
                    except Empty:
                        if time.monotonic() - last_chunk_at >= 15.0:
                            raise TimeoutError(
                                "FFmpeg no entrego paquetes MJPEG durante 15 segundos."
                            )
                        continue
                    if chunk is reader_done:
                        break
                    last_chunk_at = time.monotonic()
                    for jpeg in parser.feed(chunk):
                        offset = (
                            packet_offsets[source_packets]
                            if source_packets < len(packet_offsets)
                            else source_packets / max(source_fps, 0.001)
                        )
                        source_packets += 1
                        if offset + 1e-6 < next_sample_at:
                            continue
                        selected_payloads.append(jpeg)
                        selected_offsets.append(offset)
                        while next_sample_at <= offset + 1e-6:
                            next_sample_at += sample_interval
                        if batch_limit <= 0:
                            jpeg_info = decoder.image_info(jpeg)
                            batch_limit = decoder.recommended_batch_size(
                                jpeg_info,
                                width,
                                height,
                                requested=RECORDED_MJPEG_BATCH_SIZE,
                            )
                            current.update(
                                {
                                    "decoder": "nvjpeg_cuda",
                                    "pixel_format": str(
                                        info.get("pixel_format") or ""
                                    ),
                                    "decode_batch_size": batch_limit,
                                }
                            )
                        if len(selected_payloads) >= batch_limit:
                            process_selected_batch()
                if self._stop.is_set():
                    raise RuntimeError(
                        "El analisis se interrumpio al detener la estacion."
                    )
                try:
                    parser.finish()
                except MjpegStreamError as exc:
                    if source_packets <= 0:
                        raise
                    LOGGER.warning(
                        "Se omitio el ultimo JPEG incompleto de %s: %s",
                        path,
                        exc,
                    )
                    current["trailing_frame_dropped"] = True
                process_selected_batch()
                return_code = process.wait(timeout=10)
                error_stream.seek(0)
                stderr = error_stream.read().decode("utf-8", errors="replace")
                if return_code:
                    raise RuntimeError(
                        f"FFmpeg termino con codigo {return_code}: {stderr[-1200:]}"
                    )
                if frames <= 0:
                    raise RuntimeError("El segmento MJPEG no entrego frames completos.")
            finally:
                reader_stop.set()
                if process.poll() is None:
                    process.kill()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                try:
                    process.stdout.close()
                except OSError:
                    pass
                reader.join(timeout=2)

        elapsed = time.perf_counter() - scan_started
        with self._state_lock:
            self._processed_frames += frames
            self._detected_faces += faces
            self._camera_processed_frames[camera_key] = (
                self._camera_processed_frames.get(camera_key, 0) + frames
            )
            observed_date = job_started.astimezone(
                BUSINESS_TIME_ZONE
            ).date().isoformat()
            if observed_date != self._capture_date:
                self._capture_date = observed_date
                self._captured_frames_today = 0
                self._captured_faces_today = 0
            self._captured_frames_today += frames
            self._captured_faces_today += faces
        return anchors, {
            "sampled_frames": frames,
            "expected_frames": expected_frames,
            "source_packets": source_packets,
            "packet_timestamps": len(packet_offsets),
            "face_frames": face_frames,
            "faces": faces,
            "crops_enqueued": 0,
            "decoder": "nvjpeg_cuda",
            "decode_batch_size": batch_limit,
            "throughput_fps": round(frames / max(elapsed, 0.001), 2),
            "scan_seconds": round(elapsed, 3),
        }

    def _enqueue_recorded_source_detections(
        self,
        source_frame: np.ndarray,
        detection_shape: tuple[int, int],
        detections: tuple[DetectedFace, ...],
        camera_key: str,
        started_at: datetime,
        offset: float,
    ) -> int:
        observed_at = business_time(
            datetime.fromtimestamp(
                started_at.timestamp() + offset,
                timezone.utc,
            )
        )
        enqueued = 0
        for detected in detections:
            source_detection = self._detection_for_source_shape(
                detected,
                detection_shape,
                source_frame.shape[:2],
            )
            crop, bounds = face_crop_with_bounds(source_frame, source_detection)
            if crop.size == 0:
                continue
            left, top, _, _ = bounds
            relative_landmarks = None
            if source_detection.landmarks is not None:
                relative_landmarks = source_detection.landmarks.copy()
                relative_landmarks[:, 0] -= left
                relative_landmarks[:, 1] -= top
            self._enqueue_raw_persistence(
                PersistenceTask(
                    kind="raw",
                    subject_key=uuid4().hex,
                    observed_at=observed_at,
                    crop=crop.copy(),
                    similarity=0.0,
                    detected_quality=source_detection.score,
                    camera_key=camera_key,
                    bbox=source_detection.bbox,
                    landmarks=relative_landmarks,
                )
            )
            enqueued += 1
        return enqueued

    def _persist_recorded_activity_windows(
        self,
        video_path: Path,
        camera_key: str,
        job: dict,
        info: dict,
        activity_windows: list[tuple[float, float]],
        current: dict,
    ) -> dict:
        """Rescan only active intervals at source FPS and persist every face."""
        empty = {
            "full_fps_frames": 0,
            "face_frames": 0,
            "faces": 0,
            "crops_enqueued": 0,
            "full_fps": round(float(info.get("source_fps") or 0.0), 3),
        }
        if not activity_windows:
            return empty
        if self._detector is None:
            raise RuntimeError("El detector grabado no esta preparado.")

        if (
            str(info.get("codec") or "").lower() == "mjpeg"
            and self._recorded_nvjpeg is not None
            and self._recorded_ffmpeg is not None
        ):
            return self._persist_recorded_mjpeg_activity_windows(
                video_path,
                camera_key,
                job,
                info,
                activity_windows,
                current,
            )

        config = self.config_manager.config
        processing_width = int(config.recorded_processing_width)
        processing_height = max(
            2,
            int(
                round(
                    processing_width
                    * int(info["height"])
                    / max(int(info["width"]), 1)
                )
            ),
        )
        if processing_height % 2:
            processing_height += 1
        source_fps = float(info.get("source_fps") or 0.0)
        capture = cv2.VideoCapture(str(video_path), cv2.CAP_FFMPEG)
        if not capture.isOpened():
            raise RuntimeError(
                "No se pudo abrir el video original para analizar la actividad."
            )
        if source_fps <= 0:
            source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        if source_fps <= 0:
            source_fps = 25.0

        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(
            0,
            min(
                processing_width - 1,
                int(round(processing_width * roi_left)),
            ),
        )
        roi_x2 = max(
            roi_x1 + 1,
            min(
                processing_width,
                int(round(processing_width * roi_right)),
            ),
        )
        scaled_min_face_size = max(
            1,
            int(
                round(
                    float(config.min_face_size)
                    * processing_width
                    / max(int(config.processing_width), 1)
                )
            ),
        )
        started_at = datetime.fromisoformat(str(job["started_at"]))
        expected_frames = max(
            1,
            sum(
                max(1, int(math.ceil((end - start) * source_fps)))
                for start, end in activity_windows
            ),
        )
        full_fps_frames = 0
        face_frames = 0
        faces = 0
        crops_enqueued = 0
        pass_started = time.perf_counter()
        last_update = 0.0
        try:
            for window_start, window_end in activity_windows:
                start_frame = max(0, int(math.floor(window_start * source_fps)))
                end_frame = max(start_frame, int(math.ceil(window_end * source_fps)))
                capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
                window_frames = 0
                for frame_index in range(start_frame, end_frame + 1):
                    if self._stop.is_set():
                        raise RuntimeError(
                            "El analisis adaptativo se interrumpio al detener "
                            "la estacion."
                        )
                    ok, source_frame = capture.read()
                    if not ok or source_frame is None or source_frame.size == 0:
                        break
                    detection_frame = cv2.resize(
                        source_frame,
                        (processing_width, processing_height),
                        interpolation=cv2.INTER_AREA,
                    )
                    with self._gpu_lock:
                        roi_detections = self._detector.detect(
                            detection_frame[:, roi_x1:roi_x2],
                            min_face_size=scaled_min_face_size,
                        )
                    detections = tuple(
                        self._offset_detection(detected, roi_x1, 0)
                        for detected in roi_detections
                    )
                    offset = frame_index / max(source_fps, 0.001)
                    if detections:
                        crops_enqueued += self._enqueue_recorded_source_detections(
                            source_frame,
                            detection_frame.shape[:2],
                            detections,
                            camera_key,
                            started_at,
                            offset,
                        )
                        face_frames += 1
                        faces += len(detections)
                        self._last_face_at = time.monotonic()
                    full_fps_frames += 1
                    window_frames += 1
                    now = time.monotonic()
                    if now - last_update >= 0.5:
                        current.update(
                            {
                                "stage": "analyzing_activity",
                                "progress": round(
                                    min(
                                        0.999,
                                        0.92
                                        + 0.079
                                        * full_fps_frames
                                        / expected_frames,
                                    ),
                                    4,
                                ),
                                "full_fps": round(source_fps, 3),
                                "full_fps_frames": full_fps_frames,
                                "full_fps_expected_frames": expected_frames,
                                "face_frames": face_frames,
                                "faces": faces,
                                "crops_enqueued": crops_enqueued,
                                "activity_throughput_fps": round(
                                    full_fps_frames
                                    / max(
                                        time.perf_counter() - pass_started,
                                        0.001,
                                    ),
                                    2,
                                ),
                            }
                        )
                        self._set_recorded_pipeline_state(
                            "processing",
                            current=current,
                        )
                        update_segment_job(
                            video_path.with_suffix(
                                video_path.suffix + ".job.json"
                            ),
                            stage="analyzing_activity",
                            full_fps=round(source_fps, 3),
                            full_fps_frames=full_fps_frames,
                            full_fps_expected_frames=expected_frames,
                            face_frames=face_frames,
                            faces=faces,
                            crops_enqueued=crops_enqueued,
                            progress=current["progress"],
                        )
                        last_update = now
                if window_frames <= 0:
                    raise RuntimeError(
                        "No se pudo recuperar ningun frame original entre "
                        f"{window_start:.3f}s y {window_end:.3f}s."
                    )
        finally:
            capture.release()
        elapsed = time.perf_counter() - pass_started
        return {
            "full_fps": round(source_fps, 3),
            "full_fps_frames": full_fps_frames,
            "full_fps_expected_frames": expected_frames,
            "face_frames": face_frames,
            "faces": faces,
            "crops_enqueued": crops_enqueued,
            "activity_throughput_fps": round(
                full_fps_frames / max(elapsed, 0.001),
                2,
            ),
            "activity_scan_seconds": round(elapsed, 3),
        }

    def _persist_recorded_mjpeg_activity_windows(
        self,
        video_path: Path,
        camera_key: str,
        job: dict,
        info: dict,
        activity_windows: list[tuple[float, float]],
        current: dict,
    ) -> dict:
        """Recover exact MJPEG packets in active windows and crop originals.

        Camera MJPEG containers commonly advertise 25 FPS even when network
        delivery is much lower. Packet timestamps are therefore authoritative;
        frame-number seeking would reopen the wrong part of the recording.
        """
        decoder = self._recorded_nvjpeg
        detector = self._detector
        ffmpeg = self._recorded_ffmpeg
        if decoder is None or detector is None or ffmpeg is None:
            raise RuntimeError("nvJPEG no esta preparado para recuperar actividad.")

        packet_offsets = self._probe_recorded_packet_offsets(video_path)
        if not packet_offsets:
            raise RuntimeError("El segmento MJPEG no contiene timestamps de paquetes.")
        windows = sorted(activity_windows)
        expected_frames = sum(
            1
            for offset in packet_offsets
            if any(start - 1e-6 <= offset <= end + 1e-6 for start, end in windows)
        )
        if expected_frames <= 0:
            raise RuntimeError(
                "Ningun frame original coincide con la actividad detectada."
            )

        config = self.config_manager.config
        width = int(config.recorded_processing_width)
        height = max(
            2,
            int(round(width * int(info["height"]) / max(int(info["width"]), 1))),
        )
        if height % 2:
            height += 1
        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(0, min(width - 1, int(round(width * roi_left))))
        roi_x2 = max(roi_x1 + 1, min(width, int(round(width * roi_right))))
        scaled_min_face_size = max(
            1,
            int(
                round(
                    float(config.min_face_size)
                    * width
                    / max(int(config.processing_width), 1)
                )
            ),
        )
        started_at = datetime.fromisoformat(str(job["started_at"]))
        duration = max(float(info.get("duration_seconds") or 0.0), 0.001)
        observed_fps = len(packet_offsets) / duration
        selected_payloads: list[bytes] = []
        selected_offsets: list[float] = []
        full_fps_frames = 0
        face_frames = 0
        faces = 0
        crops_enqueued = 0
        source_packets = 0
        window_index = 0
        batch_limit = 0
        pass_started = time.perf_counter()
        last_update = 0.0
        parser = OctetStreamJpegParser()

        def update_progress(*, force: bool = False) -> None:
            nonlocal last_update
            now = time.monotonic()
            if not force and now - last_update < 0.5:
                return
            throughput = full_fps_frames / max(
                time.perf_counter() - pass_started,
                0.001,
            )
            current.update(
                {
                    "stage": "analyzing_activity",
                    "progress": round(
                        min(
                            0.999,
                            0.92 + 0.079 * full_fps_frames / expected_frames,
                        ),
                        4,
                    ),
                    "full_fps": round(observed_fps, 3),
                    "full_fps_frames": full_fps_frames,
                    "full_fps_expected_frames": expected_frames,
                    "face_frames": face_frames,
                    "faces": faces,
                    "crops_enqueued": crops_enqueued,
                    "activity_throughput_fps": round(throughput, 2),
                }
            )
            self._set_recorded_pipeline_state("processing", current=current)
            update_segment_job(
                video_path.with_suffix(video_path.suffix + ".job.json"),
                stage="analyzing_activity",
                full_fps=round(observed_fps, 3),
                full_fps_frames=full_fps_frames,
                full_fps_expected_frames=expected_frames,
                face_frames=face_frames,
                faces=faces,
                crops_enqueued=crops_enqueued,
                activity_throughput_fps=round(throughput, 2),
                progress=current["progress"],
            )
            last_update = now

        def process_selected_batch() -> None:
            nonlocal full_fps_frames, face_frames, faces, crops_enqueued
            if not selected_payloads:
                return
            with self._gpu_lock:
                decoded = decoder.decode_resize_batch(
                    selected_payloads,
                    width,
                    height,
                )
            try:
                for batch_index, (frame, offset) in enumerate(
                    zip(
                        decoded.resized_frames,
                        selected_offsets,
                        strict=True,
                    )
                ):
                    with self._gpu_lock:
                        roi_detections = detector.detect(
                            frame[:, roi_x1:roi_x2],
                            min_face_size=scaled_min_face_size,
                        )
                    detections = tuple(
                        self._offset_detection(detected, roi_x1, 0)
                        for detected in roi_detections
                    )
                    if detections:
                        with self._gpu_lock:
                            source_frame = decoded.copy_original(batch_index)
                        crops_enqueued += self._enqueue_recorded_source_detections(
                            source_frame,
                            frame.shape[:2],
                            detections,
                            camera_key,
                            started_at,
                            offset,
                        )
                        face_frames += 1
                        faces += len(detections)
                        self._last_face_at = time.monotonic()
                    full_fps_frames += 1
                update_progress()
            finally:
                decoded.close()
                selected_payloads.clear()
                selected_offsets.clear()

        command = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-c:v",
            "copy",
            "-f",
            "image2pipe",
            "pipe:1",
        ]
        with tempfile.TemporaryFile() as error_stream:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=error_stream,
                bufsize=0,
                creationflags=CREATE_NO_WINDOW,
            )
            assert process.stdout is not None
            try:
                while not self._stop.is_set():
                    chunk = process.stdout.read(2 * 1024 * 1024)
                    if not chunk:
                        break
                    for jpeg in parser.feed(chunk):
                        if source_packets >= len(packet_offsets):
                            break
                        offset = packet_offsets[source_packets]
                        source_packets += 1
                        while (
                            window_index < len(windows)
                            and offset > windows[window_index][1] + 1e-6
                        ):
                            window_index += 1
                        if window_index >= len(windows):
                            continue
                        start, end = windows[window_index]
                        if offset < start - 1e-6 or offset > end + 1e-6:
                            continue
                        selected_payloads.append(jpeg)
                        selected_offsets.append(offset)
                        if batch_limit <= 0:
                            jpeg_info = decoder.image_info(jpeg)
                            batch_limit = decoder.recommended_batch_size(
                                jpeg_info,
                                width,
                                height,
                                requested=RECORDED_MJPEG_BATCH_SIZE,
                            )
                        if len(selected_payloads) >= batch_limit:
                            process_selected_batch()
                if self._stop.is_set():
                    raise RuntimeError(
                        "El analisis adaptativo se interrumpio al detener la estacion."
                    )
                try:
                    parser.finish()
                except MjpegStreamError as exc:
                    if source_packets <= 0:
                        raise
                    LOGGER.warning(
                        "Se omitio el ultimo JPEG incompleto durante la "
                        "recuperacion de %s: %s",
                        video_path,
                        exc,
                    )
                    current["trailing_frame_dropped"] = True
                process_selected_batch()
                return_code = process.wait(timeout=10)
                if return_code:
                    error_stream.seek(0)
                    stderr = error_stream.read().decode("utf-8", errors="replace")
                    raise RuntimeError(
                        f"FFmpeg termino con codigo {return_code}: {stderr[-1200:]}"
                    )
            finally:
                if process.poll() is None:
                    process.kill()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                try:
                    process.stdout.close()
                except OSError:
                    pass

        if full_fps_frames != expected_frames:
            raise RuntimeError(
                "La recuperacion adaptativa esperaba "
                f"{expected_frames} frames y obtuvo {full_fps_frames}."
            )
        elapsed = time.perf_counter() - pass_started
        update_progress(force=True)
        return {
            "full_fps_frames": full_fps_frames,
            "full_fps_expected_frames": expected_frames,
            "face_frames": face_frames,
            "faces": faces,
            "crops_enqueued": crops_enqueued,
            "full_fps": round(observed_fps, 3),
            "activity_throughput_fps": round(
                full_fps_frames / max(elapsed, 0.001),
                2,
            ),
            "activity_scan_seconds": round(elapsed, 3),
        }

    def _wait_recorded_persistence(self, timeout: float) -> bool:
        deadline = time.monotonic() + max(0.0, timeout)
        while time.monotonic() < deadline:
            if int(getattr(self._persistence_queue, "unfinished_tasks", 0)) <= 0:
                return True
            worker = self._persistence_thread
            if worker is None or not worker.is_alive():
                return False
            if self._stop.wait(0.05):
                return False
        return int(getattr(self._persistence_queue, "unfinished_tasks", 0)) <= 0

    def _cleanup_recorded_originals(self) -> None:
        roots = self._recorded_storage_roots
        if not roots:
            return
        monotonic_now = time.monotonic()
        if monotonic_now - self._recorded_last_cleanup < 60.0:
            return
        self._recorded_last_cleanup = monotonic_now
        now = datetime.now(timezone.utc)
        self._reconcile_match_video_evidence(now)
        for job_path, payload in list_segment_jobs_in_roots(
            roots,
            statuses={"done"},
        ):
            evidence_status = str(payload.get("evidence_status") or "")
            evidence_path = Path(str(payload.get("evidence_video_path") or ""))
            if evidence_status in {"candidate", "candidate_fallback", "retained"}:
                if evidence_path.is_file():
                    continue
            if payload.get("original_deleted"):
                updated_at = str(payload.get("updated_at") or "")
                try:
                    updated = datetime.fromisoformat(updated_at)
                except ValueError:
                    continue
                if now - updated >= timedelta(days=7):
                    job_path.unlink(missing_ok=True)
                continue
            delete_after = str(payload.get("delete_after") or "")
            if not delete_after:
                continue
            try:
                due = datetime.fromisoformat(delete_after)
            except ValueError:
                continue
            if due > now:
                continue
            video_path = Path(str(payload.get("path") or ""))
            video_path.unlink(missing_ok=True)
            if not video_path.exists():
                mjpeg_index_path(video_path).unlink(missing_ok=True)
            update_segment_job(
                job_path,
                original_deleted=not video_path.exists(),
                deleted_at=now.isoformat(),
            )

    def _reconcile_match_video_evidence(self, now: datetime) -> None:
        roots = self._recorded_storage_roots
        if not roots:
            return
        for job_path, payload in list_segment_jobs_in_roots(
            roots,
            statuses={"done"},
        ):
            status = str(payload.get("evidence_status") or "")
            if status not in {"candidate", "candidate_fallback", "retained"}:
                continue
            evidence_path = Path(str(payload.get("evidence_video_path") or ""))
            if status == "retained":
                due_text = str(payload.get("evidence_delete_after") or "")
                try:
                    due = datetime.fromisoformat(due_text)
                except ValueError:
                    continue
                if due > now:
                    continue
                evidence_path.unlink(missing_ok=True)
                same_as_original = evidence_path == Path(
                    str(payload.get("path") or "")
                )
                expired_payload = update_segment_job(
                    job_path,
                    evidence_status="expired",
                    evidence_deleted_at=now.isoformat(),
                    evidence_file_bytes=0,
                    original_deleted=(
                        not evidence_path.exists()
                        if same_as_original
                        else bool(payload.get("original_deleted"))
                    ),
                )
                self._index_match_evidence_job(job_path, expired_payload)
                continue

            try:
                started = datetime.fromisoformat(str(payload["started_at"])).astimezone(
                    BUSINESS_TIME_ZONE
                )
            except (KeyError, ValueError):
                continue
            duration = max(0.0, float(payload.get("duration_seconds") or 0.0))
            ends = started + timedelta(seconds=duration)
            decision = self.store.match_video_decision(
                started.date().isoformat(),
                started.isoformat(),
                ends.isoformat(),
            )
            if not decision.get("ready"):
                continue
            windows = list(decision.get("windows") or [])
            if not windows:
                evidence_path.unlink(missing_ok=True)
                same_as_original = evidence_path == Path(
                    str(payload.get("path") or "")
                )
                discarded_payload = update_segment_job(
                    job_path,
                    evidence_status="discarded",
                    evidence_deleted_at=now.isoformat(),
                    evidence_file_bytes=0,
                    original_deleted=(
                        not evidence_path.exists()
                        if same_as_original
                        else bool(payload.get("original_deleted"))
                    ),
                )
                self._index_match_evidence_job(job_path, discarded_payload)
                continue

            retain_until = max(
                datetime.fromisoformat(str(window["ends_at"]))
                for window in windows
            ) + timedelta(days=MATCH_EVIDENCE_RETENTION_DAYS)
            retained_path = evidence_path
            if status == "candidate" and evidence_path.is_file():
                # A hot-tier job can point at a proxy already archived on F:.
                # Keep the retained proxy on the tier that owns the evidence;
                # Path.replace cannot cross Windows volumes and the original
                # video job location is not authoritative for this file.
                evidence_root = job_path.parents[2]
                resolved_evidence = evidence_path.resolve()
                for storage_root in roots:
                    resolved_root = storage_root.resolve()
                    try:
                        resolved_evidence.relative_to(resolved_root)
                    except ValueError:
                        continue
                    evidence_root = resolved_root
                    break
                retained_path = (
                    evidence_root
                    / "_match-evidence"
                    / "retained"
                    / started.date().isoformat()
                    / str(payload.get("camera_key") or "camera")
                    / evidence_path.name
                )
                retained_path.parent.mkdir(parents=True, exist_ok=True)
                evidence_path.replace(retained_path)
            retained_payload = update_segment_job(
                job_path,
                evidence_status="retained",
                evidence_video_path=str(retained_path),
                evidence_window_ids=[int(window["id"]) for window in windows],
                evidence_delete_after=retain_until.isoformat(),
                evidence_retained_at=now.isoformat(),
                delete_after=(
                    retain_until.isoformat()
                    if status == "candidate_fallback"
                    else str(payload.get("delete_after") or "")
                ),
            )
            self._index_match_evidence_job(job_path, retained_payload)

    def _batch_detection_pause_requested(self) -> bool:
        return (
            self._manual_batch_requested.is_set()
            or self._automatic_batch_requested.is_set()
        )

    def _suspend_capture_workers(self) -> None:
        for camera in self._cameras.values():
            camera.set_processing_enabled(False)
            camera.clear_pending()

    def _resume_capture_workers(self) -> None:
        for camera in self._cameras.values():
            # Discard the final packets received before the pause took effect;
            # attendance must resume from a current frame, not from an
            # hours-old packet retained across the nightly batch.
            camera.clear_pending()
            camera.set_processing_enabled(True)

    def _enqueue_raw_frame(self, task: RawFrameTask) -> bool:
        """Hand off original JPEG work without ever stalling SCRFD."""
        try:
            self._raw_frame_queue.put_nowait(task)
        except Full:
            with self._state_lock:
                self._raw_frame_dropped += 1
                self._raw_frame_dropped_faces += len(task.detections)
                self._raw_frame_last_error = "Cola de frames originales llena"
            LOGGER.warning(
                "Se descarto el frame original %s de %s con %s rostros porque la cola esta llena",
                task.sequence,
                task.camera_key,
                len(task.detections),
            )
            return False
        with self._state_lock:
            self._raw_frame_enqueued += 1
            self._raw_frame_queue_high_water = max(
                self._raw_frame_queue_high_water,
                self._raw_frame_queue.qsize(),
            )
        return True

    def _raw_frame_loop(self) -> None:
        """Decode originals off the detector thread; captured_at remains authoritative."""
        while (
            not self._stop.is_set()
            or not self._capture_producer_done.is_set()
            or not self._raw_frame_queue.empty()
        ):
            try:
                task = self._raw_frame_queue.get(timeout=0.1)
            except Empty:
                continue
            with self._state_lock:
                self._raw_frame_active += 1
            try:
                crops_enqueued = self._process_raw_frame_task(task)
                with self._state_lock:
                    self._raw_frame_completed += 1
                    self._raw_frame_crops_enqueued += crops_enqueued
                    self._raw_frame_last_sequence = max(
                        self._raw_frame_last_sequence,
                        int(task.sequence),
                    )
                    self._raw_frame_last_error = ""
            except Exception as exc:
                LOGGER.exception(
                    "No se pudo convertir el frame original %s de %s en recortes",
                    task.sequence,
                    task.camera_key,
                )
                with self._state_lock:
                    self._raw_frame_failed += 1
                    self._raw_frame_last_sequence = max(
                        self._raw_frame_last_sequence,
                        int(task.sequence),
                    )
                    self._raw_frame_last_error = str(exc)[:500]
                self._stop.set()
                self._set_state(
                    "error",
                    "Se detuvo la captura porque un frame original no pudo "
                    f"conservarse: {exc}",
                )
            finally:
                with self._state_lock:
                    self._raw_frame_active = max(
                        0,
                        self._raw_frame_active - 1,
                    )
                    self._raw_frame_last_latency_ms = (
                        time.monotonic() - task.enqueued_at
                    ) * 1000
                self._raw_frame_queue.task_done()

    def _process_raw_frame_task(self, task: RawFrameTask) -> int:
        """Decode one JPEG exactly once and enqueue all of its face crops."""
        encoded = np.frombuffer(task.encoded_original, dtype=np.uint8)
        source_frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if source_frame is None or source_frame.size == 0:
            raise ValueError("No se pudo decodificar el JPEG original para persistencia.")
        with self._state_lock:
            self._raw_frame_decoded += 1

        enqueued = 0
        for detected in task.detections:
            source_detection = self._detection_for_source_shape(
                detected,
                task.detection_shape,
                source_frame.shape[:2],
            )
            crop, bounds = face_crop_with_bounds(source_frame, source_detection)
            if crop.size == 0:
                continue
            left, top, _, _ = bounds
            relative_landmarks = None
            if source_detection.landmarks is not None:
                relative_landmarks = source_detection.landmarks.copy()
                relative_landmarks[:, 0] -= left
                relative_landmarks[:, 1] -= top
            self._enqueue_raw_persistence(
                PersistenceTask(
                    kind="raw",
                    subject_key=uuid4().hex,
                    observed_at=task.observed_at,
                    crop=crop.copy(),
                    similarity=0.0,
                    detected_quality=source_detection.score,
                    camera_key=task.camera_key,
                    bbox=source_detection.bbox,
                    landmarks=relative_landmarks,
                )
            )
            enqueued += 1
        return enqueued

    def _record_persistence_enqueued(self, task: PersistenceTask) -> None:
        with self._state_lock:
            self._persistence_enqueued += 1
            if task.kind == "unknown":
                self._pending_quality_subjects.add(task.subject_key)
                self._last_quality_probe[
                    f"unknown:{task.subject_key}"
                ] = time.monotonic()

    def _enqueue_raw_persistence(self, task: PersistenceTask) -> None:
        """Apply bounded backpressure, then persist inline instead of losing a crop."""
        deadline = time.monotonic() + RAW_PERSISTENCE_BACKPRESSURE_SECONDS
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                self._persistence_queue.put(
                    task,
                    timeout=min(
                        RAW_PERSISTENCE_BACKPRESSURE_SLICE_SECONDS,
                        remaining,
                    ),
                )
            except Full:
                with self._state_lock:
                    self._persistence_backpressure_retries += 1
                continue
            self._record_persistence_enqueued(task)
            return

        LOGGER.warning(
            "La cola de persistencia siguio llena; el recorte %s se guardara "
            "directamente para conservar la evidencia",
            task.subject_key,
        )
        try:
            self._persist_raw_crop_batch([task])
        except Exception as exc:
            message = (
                "No se pudo conservar un recorte despues de agotar el "
                f"backpressure de persistencia: {exc}"
            )
            with self._state_lock:
                self._persistence_failed += 1
                self._persistence_last_error = message[:500]
            raise RuntimeError(message) from exc
        with self._state_lock:
            self._persistence_inline_completed += 1
            self._persistence_last_error = ""

    def _enqueue_persistence(self, task: PersistenceTask) -> bool:
        timeout = 0.2 if task.should_persist or task.kind == "known" else 0.0
        try:
            self._persistence_queue.put(task, timeout=timeout)
        except Full:
            message = (
                f"Cola de persistencia llena para una tarea {task.kind} "
                f"de {task.subject_key}"
            )
            with self._state_lock:
                self._persistence_dropped += 1
                self._persistence_last_error = message
            LOGGER.warning(
                "Se descarto una tarea %s para %s porque la cola esta llena",
                task.kind,
                task.subject_key,
            )
            if task.should_persist or task.kind == "known":
                self._stop.set()
                self._set_state("error", message)
            return False
        self._record_persistence_enqueued(task)
        return True

    def _persistence_loop(self) -> None:
        unknown_cache_dirty = False
        last_cache_refresh = time.monotonic()
        deferred_task: PersistenceTask | None = None
        while (
            not self._stop.is_set()
            or any(thread.is_alive() for thread in self._raw_frame_threads)
            or not self._persistence_queue.empty()
            or deferred_task is not None
        ):
            if deferred_task is not None:
                task = deferred_task
                deferred_task = None
            else:
                try:
                    task = self._persistence_queue.get(timeout=0.1)
                except Empty:
                    if unknown_cache_dirty:
                        self._reload_unknown_database()
                        unknown_cache_dirty = False
                        last_cache_refresh = time.monotonic()
                    continue

            tasks = [task]
            if task.kind == "raw":
                deadline = (
                    time.monotonic() + RAW_PERSISTENCE_BATCH_WINDOW_SECONDS
                )
                while len(tasks) < RAW_PERSISTENCE_BATCH_MAX:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    try:
                        candidate = self._persistence_queue.get(
                            timeout=remaining
                        )
                    except Empty:
                        break
                    if candidate.kind != "raw":
                        deferred_task = candidate
                        break
                    tasks.append(candidate)
            try:
                if task.kind == "raw":
                    with self._state_lock:
                        self._persistence_raw_batches += 1
                        self._persistence_raw_batch_items += len(tasks)
                        self._persistence_raw_batch_max = max(
                            self._persistence_raw_batch_max,
                            len(tasks),
                        )
                    self._persist_raw_crop_batch(tasks)
                else:
                    unknown_cache_dirty = (
                        self._persist_task(task) or unknown_cache_dirty
                    )
                with self._state_lock:
                    self._persistence_completed += len(tasks)
                    self._persistence_last_error = ""
            except Exception as exc:
                LOGGER.exception(
                    "No se pudo persistir %s tarea(s) de tipo %s",
                    len(tasks),
                    task.kind,
                )
                with self._state_lock:
                    self._persistence_failed += len(tasks)
                    self._persistence_last_error = str(exc)[:500]
                if any(
                    queued.kind == "raw"
                    or queued.kind == "known"
                    or queued.should_persist
                    for queued in tasks
                ):
                    self._stop.set()
                    self._set_state(
                        "error",
                        "Se detuvo la captura porque no se pudo guardar "
                        f"evidencia: {exc}",
                    )
            finally:
                for completed_task in tasks:
                    self._finish_pending_quality(completed_task)
                    self._persistence_queue.task_done()
                with self._state_lock:
                    self._persistence_last_latency_ms = max(
                        time.monotonic() - completed_task.enqueued_at
                        for completed_task in tasks
                    ) * 1000
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
        self._persist_raw_crop_batch([task])

    def _persist_raw_crop_batch(
        self,
        tasks: list[PersistenceTask],
    ) -> list[dict]:
        """Write JPEGs first, then commit their queue rows in one WAL txn."""
        if not tasks:
            return []
        created_paths: list[Path] = []
        items: list[dict] = []
        try:
            for task in tasks:
                crop_path = save_crop_image(
                    self.store.spool_dir,
                    task.crop,
                    task.camera_key,
                    task.subject_key,
                    task.observed_at,
                    jpeg_quality=self.config_manager.config.spool_jpeg_quality,
                )
                if not crop_path:
                    raise RuntimeError(
                        "No se pudo guardar un recorte de la cola nocturna."
                    )
                path = Path(crop_path)
                created_paths.append(path)
                height, width = task.crop.shape[:2]
                items.append(
                    {
                        "captured_at": task.observed_at,
                        "camera_key": task.camera_key,
                        "camera_label": self._camera_labels.get(
                            task.camera_key,
                            task.camera_key,
                        ),
                        "crop_path": crop_path,
                        "file_bytes": path.stat().st_size,
                        "crop_width": width,
                        "crop_height": height,
                        "det_score": task.detected_quality,
                        "bbox": task.bbox or (0, 0, width, height),
                        "landmarks": task.landmarks,
                    }
                )
            return self.store.enqueue_crops_for_processing(items)
        except Exception:
            # The SQLite insert is atomic. Mirror that property on disk so a
            # failed batch cannot leave unindexed JPEGs consuming storage.
            for path in created_paths:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    LOGGER.exception(
                        "No se pudo retirar el recorte compensatorio %s",
                        path,
                    )
            raise

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

    def _run_night_quality_analysis(
        self,
        crop: np.ndarray,
        detected_quality: float,
    ) -> tuple[bool, float, dict, str]:
        started = time.perf_counter()
        result = self._analyze_unknown_quality(crop, detected_quality)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        with self._state_lock:
            self._batch_quality_evaluated += 1
            self._batch_quality_latency_ms += elapsed_ms
        return result

    @staticmethod
    def _skipped_reference_quality(
        detected_quality: float,
        reason: str,
    ) -> tuple[bool, float, dict, str]:
        score = float(max(0.0, detected_quality))
        return (
            False,
            score,
            {
                "accepted": False,
                "score": score,
                "skipped": True,
                "reasons": [reason],
                "reference_probe": {
                    "eligible": reason != "debajo_umbral_referencia",
                    "reason": reason,
                },
            },
            "comparison-first-reference-probe-v1",
        )

    def _quality_for_existing_match(
        self,
        *,
        crop: np.ndarray,
        detected_quality: float,
        reference_eligible: bool,
    ) -> tuple[bool, float, dict, str]:
        if not reference_eligible:
            with self._state_lock:
                self._batch_quality_skipped_ineligible += 1
            return self._skipped_reference_quality(
                detected_quality,
                "debajo_umbral_referencia",
            )

        with self._state_lock:
            self._batch_reference_probes += 1
        return self._run_night_quality_analysis(crop, detected_quality)

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
        """Compatibility path for decoded OpenCV frames and existing callers."""
        self._capture_detection_frame(
            source_frame,
            captured_at,
            camera_key,
            decode_reduction=1,
            decode_original=lambda: source_frame,
            sequence=0,
            encoded_original=None,
        )

    def _capture_packet(self, packet, camera_key: str) -> None:
        """Detect on the reduced view and crop only from its exact source frame."""
        detection_frame = getattr(packet, "detection_frame", None)
        if (
            not isinstance(detection_frame, np.ndarray)
            or detection_frame.size == 0
        ):
            LOGGER.warning("La camara %s entrego un paquete sin imagen valida", camera_key)
            return
        self._capture_detection_frame(
            detection_frame,
            float(getattr(packet, "captured_at", 0.0) or time.time()),
            camera_key,
            decode_reduction=max(
                1,
                int(getattr(packet, "decode_reduction", 1) or 1),
            ),
            decode_original=packet.decode_original,
            sequence=int(getattr(packet, "sequence", 0) or 0),
            encoded_original=getattr(packet, "encoded_original", None),
        )

    def _capture_detection_frame(
        self,
        detection_source,
        captured_at: float,
        camera_key: str,
        *,
        decode_reduction: int,
        decode_original,
        sequence: int,
        encoded_original: bytes | None,
    ) -> None:
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
        detection_height, detection_width = detection_source.shape[:2]
        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(
            0,
            min(
                detection_width - 1,
                int(round(detection_width * roi_left)),
            ),
        )
        roi_x2 = max(
            roi_x1 + 1,
            min(detection_width, int(round(detection_width * roi_right))),
        )
        detection_frame = detection_source[:, roi_x1:roi_x2]
        detector = self._detectors.get(camera_key) or self._detector
        if detector and decode_reduction > 1:
            minimum_at_detector_scale = max(
                1,
                int(math.ceil(float(config.min_face_size) / decode_reduction)),
            )
            roi_detections = detector.detect(
                detection_frame,
                min_face_size=minimum_at_detector_scale,
            )
        else:
            roi_detections = detector.detect(detection_frame) if detector else []
        detections = [
            self._offset_detection(detected, roi_x1, 0)
            for detected in roi_detections
        ]
        preview_due = (
            time.monotonic() - self._last_preview_at.get(camera_key, 0.0)
            >= 1.0 / max(float(config.preview_fps), 1.0)
        )
        preview_frame = (
            resize_for_processing(detection_source, config.preview_width)
            if preview_due
            else None
        )
        preview_scale_x = (
            preview_frame.shape[1] / detection_width
            if preview_frame is not None
            else 1.0
        )
        preview_scale_y = (
            preview_frame.shape[0] / detection_height
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

        source_frame = None
        source_detections: list[DetectedFace] = []
        raw_frame_enqueued: bool | None = None
        if detections and encoded_original:
            raw_frame_enqueued = self._enqueue_raw_frame(
                RawFrameTask(
                    sequence=sequence,
                    observed_at=observed_at,
                    camera_key=camera_key,
                    detection_shape=(detection_height, detection_width),
                    detections=tuple(detections),
                    encoded_original=encoded_original,
                )
            )
        elif detections:
            raw_frame_enqueued = False
            try:
                source_frame = decode_original()
            except Exception as exc:
                LOGGER.warning(
                    "No se pudo decodificar el frame original de %s: %s",
                    camera_key,
                    exc,
                )
            if (
                isinstance(source_frame, np.ndarray)
                and source_frame.size > 0
            ):
                source_detections = [
                    self._detection_for_source(
                        detected,
                        detection_source,
                        source_frame,
                    )
                    for detected in detections
                ]
                raw_frame_enqueued = True

        for detected in source_detections:
            crop, bounds = face_crop_with_bounds(source_frame, detected)
            if crop.size == 0:
                continue
            left, top, _, _ = bounds
            relative_landmarks = None
            if detected.landmarks is not None:
                relative_landmarks = detected.landmarks.copy()
                relative_landmarks[:, 0] -= left
                relative_landmarks[:, 1] -= top
            self._enqueue_raw_persistence(
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
            for detected in detections:
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
                if raw_frame_enqueued is False:
                    preview_label = (
                        f"No guardado: cola llena {detected.score * 100:.0f}%"
                    )
                    preview_color = AMBER
                else:
                    preview_label = (
                        f"Recorte en cola {detected.score * 100:.0f}%"
                    )
                    preview_color = BLUE
                draw_face(
                    preview_frame,
                    preview_detection,
                    preview_label,
                    preview_color,
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
            self._reset_comparison_first_metrics()
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
            self._reset_comparison_first_metrics()
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

    def _reset_comparison_first_metrics(self) -> None:
        self._batch_quality_evaluated = 0
        self._batch_quality_skipped_ineligible = 0
        self._batch_reference_probes = 0
        self._batch_quality_latency_ms = 0.0

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
            # A failed/rejected write is not a completed fence item. Starting
            # the nightly matcher in that state would make missing evidence
            # indistinguishable from a successfully drained capture queue.
            if (
                self._raw_frame_failed > 0
                or self._persistence_failed > 0
                or self._persistence_dropped > 0
            ):
                return False
            if self._raw_frame_enqueued > self._raw_frame_completed:
                return False
            if self._batch_persistence_fence is None:
                self._batch_persistence_fence = self._persistence_enqueued
            return self._persistence_completed >= self._batch_persistence_fence

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
            match_margin = float(getattr(known_match, "margin", 0.0))
            config = self.config_manager.config
            (
                quality_pass,
                quality_score,
                quality_payload,
                analysis_version,
            ) = self._quality_for_existing_match(
                crop=image,
                detected_quality=detected.quality,
                reference_eligible=bool(
                    float(known_match.similarity)
                    >= float(config.adaptive_known_min_similarity)
                    and match_margin
                    >= float(config.adaptive_known_min_margin)
                ),
            )
            task = PersistenceTask(
                kind="known",
                subject_key=matched_person["person_key"],
                observed_at=observed_at,
                crop=image,
                similarity=known_match.similarity,
                detected_quality=detected.quality,
                camera_key=str(item["camera_key"]),
                match_margin=match_margin,
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
            (
                quality_pass,
                quality_score,
                quality_payload,
                analysis_version,
            ) = self._run_night_quality_analysis(image, detected.quality)
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
                (
                    quality_pass,
                    quality_score,
                    quality_payload,
                    analysis_version,
                ) = self._quality_for_existing_match(
                    crop=image,
                    detected_quality=detected.quality,
                    # A manually linked unknown is already a trusted identity;
                    # quality alone decides whether this view may improve it.
                    reference_eligible=True,
                )
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
        if is_new_identity or str(unknown.get("status") or "") == "candidate":
            (
                quality_pass,
                quality_score,
                quality_payload,
                analysis_version,
            ) = self._run_night_quality_analysis(image, detected.quality)
        else:
            (
                quality_pass,
                quality_score,
                quality_payload,
                analysis_version,
            ) = self._quality_for_existing_match(
                crop=image,
                detected_quality=detected.quality,
                reference_eligible=bool(
                    reference_validated
                    and float(similarity)
                    >= float(
                        self.config_manager.config.adaptive_unknown_min_similarity
                    )
                ),
            )
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

    def _publish_recorded_live_preview(
        self,
        camera_key: str,
        jpeg_payload: bytes,
    ) -> None:
        frame = cv2.imdecode(
            np.frombuffer(jpeg_payload, dtype=np.uint8),
            cv2.IMREAD_COLOR,
        )
        if frame is None or frame.size == 0:
            raise ValueError("FFmpeg entrego una vista previa JPEG invalida.")
        config = self.config_manager.config
        preview = resize_for_processing(frame, int(config.preview_width))
        roi_left, roi_right = self._camera_roi(config, camera_key)
        roi_x1 = max(0, min(preview.shape[1] - 1, int(round(preview.shape[1] * roi_left))))
        roi_x2 = max(roi_x1 + 1, min(preview.shape[1], int(round(preview.shape[1] * roi_right))))
        draw_detection_roi(
            preview,
            (roi_x1, 0, roi_x2, preview.shape[0]),
        )
        self._set_preview(
            encode_preview(preview, int(config.preview_width)),
            camera_key,
        )
        self._last_preview_at[camera_key] = time.monotonic()

    @staticmethod
    def _detection_for_source(detected: DetectedFace, detection_frame, source_frame) -> DetectedFace:
        """Map a detection back to the untouched camera frame for high-quality crops."""
        return StationRuntime._detection_for_source_shape(
            detected,
            detection_frame.shape[:2],
            source_frame.shape[:2],
        )

    @staticmethod
    def _detection_for_source_shape(
        detected: DetectedFace,
        detection_shape: tuple[int, int],
        source_shape: tuple[int, int],
    ) -> DetectedFace:
        detection_height, detection_width = detection_shape
        source_height, source_width = source_shape
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
        landmarks = None
        if detected.landmarks is not None:
            landmarks = np.asarray(detected.landmarks, dtype=np.float32).copy()
            landmarks[:, 0] *= scale_x
            landmarks[:, 1] *= scale_y
        return replace(detected, bbox=bbox, landmarks=landmarks)

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
        if camera_key == "tertiary":
            return (
                float(config.tertiary_camera_roi_left),
                float(config.tertiary_camera_roi_right),
            )
        return float(config.camera_roi_left), float(config.camera_roi_right)

    @staticmethod
    def _camera_definitions(config) -> dict[str, dict]:
        primary_source = str(config.camera_url).strip()
        primary_is_http = primary_source.lower().startswith(
            ("http://", "https://")
        )
        primary_async_mjpeg = bool(
            config.camera_async_mjpeg_enabled and primary_is_http
        )
        definitions = {
            "primary": {
                "source": primary_source,
                "fallback_source": config.camera_fallback_url,
                "camera_id": config.camera_id,
                "label": config.camera_label,
                "roi": [float(config.camera_roi_left), float(config.camera_roi_right)],
                # The compressed JPEG path is intentionally restricted to the
                # Raspberry's HTTP MJPEG source. RTSP cameras continue through
                # OpenCV/NVDEC until a timestamped main/sub-stream design is
                # introduced for them.
                "async_mjpeg": primary_async_mjpeg,
                "mjpeg_decode_reduction": int(
                    config.camera_mjpeg_decode_reduction
                    if primary_async_mjpeg
                    else 1
                ),
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
                "async_mjpeg": False,
                "mjpeg_decode_reduction": 1,
            }
        if config.tertiary_camera_enabled and config.tertiary_camera_url:
            tertiary_source = str(config.tertiary_camera_url).strip()
            tertiary_is_http = tertiary_source.lower().startswith(
                ("http://", "https://")
            )
            tertiary_async_mjpeg = bool(
                config.tertiary_camera_async_mjpeg_enabled
                and tertiary_is_http
            )
            definitions["tertiary"] = {
                "source": tertiary_source,
                "fallback_source": config.tertiary_camera_fallback_url,
                "camera_id": config.tertiary_camera_id,
                "label": config.tertiary_camera_label,
                "roi": [
                    float(config.tertiary_camera_roi_left),
                    float(config.tertiary_camera_roi_right),
                ],
                "async_mjpeg": tertiary_async_mjpeg,
                "mjpeg_decode_reduction": int(
                    config.tertiary_camera_mjpeg_decode_reduction
                    if tertiary_async_mjpeg
                    else 1
                ),
            }
        return definitions
