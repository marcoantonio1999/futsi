from __future__ import annotations

import logging
import time
from collections import deque
from datetime import datetime, timezone
from threading import Event, RLock, Thread
from uuid import NAMESPACE_URL, uuid5

import numpy as np

from .camera import CameraWorker
from .config import ConfigManager
from .futsi_client import FutsiClient
from .preview import AMBER, BLUE, GREEN, draw_face, draw_overlay, encode_preview, placeholder_frame, resize_for_processing, save_crop
from .recognition import DetectedFace, FaceEngine, match_matrix
from .store import LocalStore
from .synchronizer import StationSynchronizer
from .unknown_links import link_unknown_subject


LOGGER = logging.getLogger("futsi.face_station")


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
        self._processing_thread: Thread | None = None
        self._sync_thread: Thread | None = None
        self._camera: CameraWorker | None = None
        self._engine: FaceEngine | None = None
        self._preview_jpeg = placeholder_frame("La estacion esta detenida")
        self._recent = deque(maxlen=40)
        self._last_persisted: dict[str, float] = {}
        self._unknown_rows: list[dict] = []
        self._unknown_matrix = np.empty((0, 512), dtype=np.float32)
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
        self._detected_faces = 0
        self._benchmark: dict = {}
        self._client_online = False
        self._client_error = ""

    @property
    def running(self) -> bool:
        return bool(self._processing_thread and self._processing_thread.is_alive())

    def start(self) -> None:
        with self._lifecycle_lock:
            if self.running:
                return
            self._stop.clear()
            config = self.config_manager.config
            self._camera = CameraWorker(config.camera_url)
            self._camera.start()
            self._started_at = datetime.now(timezone.utc).isoformat()
            self._set_state("starting", "")
            self._processing_thread = Thread(target=self._processing_loop, name="futsi-recognition", daemon=True)
            self._sync_thread = Thread(target=StationSynchronizer(self).run, name="futsi-sync", daemon=True)
            self._processing_thread.start()
            self._sync_thread.start()

    def stop(self) -> None:
        with self._lifecycle_lock:
            self._stop.set()
            if self._camera:
                self._camera.stop()
            for thread in (self._processing_thread, self._sync_thread):
                if thread and thread.is_alive():
                    thread.join(timeout=8)
            self._processing_thread = None
            self._sync_thread = None
            self._engine = None
            self._set_state("stopped", "")
            self._set_preview(placeholder_frame("La estacion esta detenida"))

    def restart(self) -> None:
        self.stop()
        self.start()

    def request_benchmark(self) -> None:
        if not self.running:
            raise RuntimeError("Inicia el motor antes de ejecutar la prueba.")
        self._benchmark_requested.set()

    def latest_preview(self) -> bytes:
        with self._preview_lock:
            return bytes(self._preview_jpeg)

    def status(self) -> dict:
        camera = self._camera
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
            }
        payload["camera"] = {
            "connected": bool(camera and camera.connected),
            "frames_read": int(camera.frames_read if camera else 0),
            "last_error": camera.last_error if camera else "",
        }
        payload["sync"] = self.store.sync_summary()
        return payload

    def dashboard(self, selected_date: str) -> dict:
        return {**self.store.dashboard(selected_date), "status": self.status()}

    def link_unknown(self, subject_id: str, person_key: str) -> dict:
        return link_unknown_subject(self, subject_id, person_key)

    @property
    def station_id(self) -> str:
        return self._station_id

    def reload_unknown_database(self) -> None:
        self._reload_unknown_database()

    def _processing_loop(self) -> None:
        try:
            config = self.config_manager.config
            self._set_state("loading_model", "")
            engine = FaceEngine(config)
            engine.load()
            self._engine = engine
            self._provider = engine.provider_label
            self._reload_known_database()
            self._reload_unknown_database()
            self._refresh_reference_embeddings()
            self._wait_for_first_frame()
            if config.target_fps <= 0:
                self._run_benchmark()
            else:
                self._target_fps = config.target_fps
            self._set_state("running", "")
            samples: deque[float] = deque(maxlen=30)
            last_processed = 0.0

            while not self._stop.is_set():
                if self._benchmark_requested.is_set():
                    self._benchmark_requested.clear()
                    self._run_benchmark()
                frame, captured_at = self._camera.latest() if self._camera else (None, 0)
                if frame is None:
                    self._set_preview(placeholder_frame("Esperando video de la camara"))
                    self._stop.wait(0.15)
                    continue
                interval = 1.0 / max(self._target_fps, 0.5)
                now = time.monotonic()
                if now - last_processed < interval:
                    self._stop.wait(min(0.03, interval - (now - last_processed)))
                    continue
                last_processed = now
                started = time.perf_counter()
                self._process_frame(frame, captured_at)
                duration = max(time.perf_counter() - started, 0.0001)
                samples.append(duration)
                with self._state_lock:
                    self._processing_fps = len(samples) / max(sum(samples), 0.001)
                    self._processed_frames += 1
        except Exception as exc:
            LOGGER.exception("El motor de reconocimiento se detuvo")
            self._set_state("error", str(exc))
            self._set_preview(placeholder_frame("Error del motor", str(exc)))
        finally:
            if self._camera:
                self._camera.stop()

    def _process_frame(self, source_frame, captured_at: float) -> None:
        config = self.config_manager.config
        frame = resize_for_processing(source_frame, config.processing_width)
        observed_at = datetime.fromtimestamp(captured_at or time.time(), timezone.utc).astimezone()
        detections = self._engine.detect(frame) if self._engine else []
        with self._state_lock:
            self._detected_faces += len(detections)
        for detected in detections:
            known_match = self._engine.match_known(detected.embedding) if self._engine else None
            if known_match and known_match.matched:
                label = self._handle_known(detected, known_match.person, known_match.similarity, observed_at, frame)
                draw_face(frame, detected, label, GREEN)
                continue

            unknown, unknown_similarity = match_matrix(
                detected.embedding,
                self._unknown_rows,
                self._unknown_matrix,
                config.unknown_threshold,
            )
            if unknown and unknown.get("linked_person_key"):
                linked_person = self.store.get_person(unknown["linked_person_key"])
                if linked_person:
                    label = self._handle_known(
                        detected,
                        linked_person,
                        unknown_similarity,
                        observed_at,
                        frame,
                        source_subject_id=unknown["subject_id"],
                    )
                    draw_face(frame, detected, label, GREEN)
                    continue
            unknown = self._handle_unknown(detected, unknown, unknown_similarity, observed_at, frame)
            color = AMBER if unknown["status"] == "consolidated" else BLUE
            draw_face(frame, detected, unknown["temporary_name"], color)

        draw_overlay(
            frame,
            len(detections),
            observed_at,
            self._provider,
            self._processing_fps,
            self._client_online,
        )
        self._set_preview(encode_preview(frame, config.preview_width))

    def _handle_known(
        self,
        detected: DetectedFace,
        person: dict,
        similarity: float,
        observed_at: datetime,
        frame,
        source_subject_id: str = "",
    ) -> str:
        person_key = person["person_key"]
        should_persist = self._should_persist(f"known:{person_key}")
        if should_persist:
            crop_path = save_crop(self.store.faces_dir, frame, detected, "known", person_key, observed_at)
            presence = self.store.upsert_presence(person_key, "known", observed_at, similarity, crop_path)
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
                "similarity": similarity,
                "source_subject_id": source_subject_id,
                "metadata": {"camera_id": self.config_manager.config.camera_id},
            }
            self.store.queue_event(event_id, "known_event", payload)
            self._record_recent("known", person["name"], similarity, crop_path, observed_at, person_key)
        return f"{person['name']} {max(0, similarity) * 100:.0f}%"

    def _handle_unknown(
        self,
        detected: DetectedFace,
        unknown: dict | None,
        similarity: float,
        observed_at: datetime,
        frame,
    ) -> dict:
        key = unknown["subject_id"] if unknown else f"new:{round(observed_at.timestamp(), 1)}"
        if unknown and not self._should_persist(f"unknown:{key}"):
            return unknown
        crop_path = save_crop(self.store.faces_dir, frame, detected, "unknown", key, observed_at)
        if unknown:
            result = self.store.update_unknown(
                unknown["subject_id"],
                detected.embedding,
                observed_at,
                crop_path,
                detected.quality,
                self.config_manager.config.unknown_min_hits,
            )
        else:
            result = self.store.create_unknown(detected.embedding, observed_at, crop_path, detected.quality)
        self._reload_unknown_database()
        self._record_recent("unknown", result["temporary_name"], similarity, crop_path, observed_at, result["subject_id"])
        return result

    def _refresh_reference_embeddings(self) -> None:
        engine = self._engine
        if not engine:
            return
        config = self.config_manager.config
        if not config.station_token:
            self._reload_known_database()
            return
        client = FutsiClient(config.api_url, config.station_token)
        for person in self.store.people_needing_embeddings():
            if self._stop.is_set() or not person.get("photo_url"):
                continue
            try:
                path = client.download_reference(person, self.store.references_dir)
                embedding = engine.embedding_from_reference(path)
                self.store.save_person_embedding(person["person_key"], path, embedding)
            except Exception as exc:
                LOGGER.warning("No se preparo la referencia de %s: %s", person.get("name"), exc)
        self._reload_known_database()

    def _reload_known_database(self) -> None:
        people, matrix = self.store.known_database()
        if self._engine:
            self._engine.set_known_database(people, matrix)

    def _reload_unknown_database(self) -> None:
        self._unknown_rows, self._unknown_matrix = self.store.unknown_database()

    def _run_benchmark(self) -> None:
        frame, _ = self._camera.latest() if self._camera else (None, 0)
        if frame is None or not self._engine:
            return
        config = self.config_manager.config
        frame = resize_for_processing(frame, config.processing_width)
        previous_state = self._state
        self._set_state("benchmarking", "")
        result = self._engine.benchmark(frame, config.benchmark_seconds)
        with self._state_lock:
            self._benchmark = result
            self._target_fps = config.target_fps or result["recommended_fps"]
        self._set_state("running" if previous_state != "starting" else previous_state, "")

    def _wait_for_first_frame(self) -> None:
        deadline = time.monotonic() + 30
        while not self._stop.is_set() and time.monotonic() < deadline:
            frame, _ = self._camera.latest() if self._camera else (None, 0)
            if frame is not None:
                return
            self._stop.wait(0.2)
        if not self._stop.is_set():
            raise RuntimeError(self._camera.last_error or "La camara no entrego video en 30 segundos.")

    def _should_persist(self, key: str) -> bool:
        now = time.monotonic()
        previous = self._last_persisted.get(key, 0)
        if now - previous < self.config_manager.config.detection_debounce_seconds:
            return False
        self._last_persisted[key] = now
        return True

    def _record_recent(
        self,
        kind: str,
        name: str,
        similarity: float,
        crop_path: str,
        observed_at: datetime,
        subject_key: str,
    ) -> None:
        with self._state_lock:
            self._recent.appendleft(
                {
                    "kind": kind,
                    "name": name,
                    "similarity": round(similarity, 4),
                    "seen_at": observed_at.isoformat(),
                    "crop_path": crop_path,
                    "subject_key": subject_key,
                }
            )

    def _set_state(self, state: str, error: str) -> None:
        with self._state_lock:
            self._state = state
            self._last_error = error

    def _set_preview(self, payload: bytes) -> None:
        with self._preview_lock:
            self._preview_jpeg = payload
