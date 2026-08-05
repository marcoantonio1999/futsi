from __future__ import annotations

import os
import re
import time
from collections import deque
from dataclasses import dataclass, field
from queue import Empty, Full, Queue
from threading import Event, Lock, RLock, Thread

os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2
import numpy as np

from .mjpeg_stream import MjpegHttpReader, MjpegStreamError


@dataclass(slots=True)
class CapturedFrame:
    """A detector-sized frame with a lossless route back to its source JPEG."""

    sequence: int
    captured_at: float
    detection_frame: np.ndarray
    decode_reduction: int = 1
    encoded_original: bytes | None = None
    original_frame: np.ndarray | None = None
    _decode_lock: Lock = field(default_factory=Lock, init=False, repr=False)
    _decode_attempted: bool = field(default=False, init=False, repr=False)
    _decode_error: str = field(default="", init=False, repr=False)

    def decode_original(self) -> np.ndarray:
        """Decode the original JPEG at most once, caching the full image."""

        with self._decode_lock:
            if self.original_frame is not None:
                return self.original_frame
            if self._decode_attempted:
                raise ValueError(self._decode_error or "No se pudo decodificar el JPEG original.")
            self._decode_attempted = True
            if not self.encoded_original:
                self._decode_error = "El frame no conserva una imagen original."
                raise ValueError(self._decode_error)
            encoded = np.frombuffer(self.encoded_original, dtype=np.uint8)
            try:
                original = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
            except Exception as exc:
                self._decode_error = "No se pudo decodificar el JPEG original."
                raise ValueError(self._decode_error) from exc
            if original is None or original.size == 0:
                self._decode_error = "No se pudo decodificar el JPEG original."
                raise ValueError(self._decode_error)
            self.original_frame = original
            return original


class _PrimaryRetryRequested(RuntimeError):
    """Internal signal used to probe the preferred source from the fallback."""


class CameraWorker:
    """Continuously reads a source into a bounded detector-facing queue.

    HTTP MJPEG can opt into a two-stage path: one thread receives the exact
    JPEG bytes while a second decodes a reduced image for detection. RTSP,
    local devices and synthetic inputs retain the established OpenCV path.
    """

    NETWORK_TIMEOUT_MSEC = 5_000
    MJPEG_QUEUE_SIZE = 256
    MJPEG_PACKET_QUEUE_SIZE = 64
    METRIC_WINDOW_SECONDS = 10.0
    SHUTDOWN_TIMEOUT_SECONDS = 7.0

    def __init__(
        self,
        source: str,
        name: str = "camera",
        queue_size: int = 3,
        fallback_source: str = "",
        failover_after: int = 3,
        primary_retry_seconds: float = 60.0,
        primary_recovery_frames: int = 8,
        async_mjpeg: bool = False,
        mjpeg_decode_reduction: int = 4,
    ):
        self.source = str(source).strip()
        candidate_fallback = str(fallback_source).strip()
        self.fallback_source = (
            candidate_fallback if candidate_fallback and candidate_fallback != self.source else ""
        )
        self.name = name
        self._failover_after = max(1, int(failover_after))
        self._primary_retry_seconds = max(0.01, float(primary_retry_seconds))
        self._primary_retry_ceiling = max(self._primary_retry_seconds, 300.0)
        self._primary_recovery_frames = max(1, int(primary_recovery_frames))
        reduction = int(mjpeg_decode_reduction)
        if reduction not in (1, 2, 4, 8):
            raise ValueError("mjpeg_decode_reduction debe ser 1, 2, 4 u 8.")
        all_http = self._is_http(self.source) and (
            not self.fallback_source or self._is_http(self.fallback_source)
        )
        self.async_mjpeg = bool(async_mjpeg and all_http)
        self.mjpeg_decode_reduction = reduction
        self._stop = Event()
        self._processing_enabled = Event()
        self._processing_enabled.set()
        self._frame_available = Event()
        self._lock = Lock()
        self._metrics_lock = Lock()
        self._lifecycle_lock = RLock()
        self._thread: Thread | None = None
        self._decoder_thread: Thread | None = None
        self._frame = None
        packet_queue_size = (
            max(int(queue_size), self.MJPEG_PACKET_QUEUE_SIZE)
            if self.async_mjpeg
            else max(1, int(queue_size))
        )
        self._frames: deque[CapturedFrame] = deque(maxlen=packet_queue_size)
        self._compressed_frames: Queue[tuple[int, float, bytes]] = Queue(
            maxsize=self.MJPEG_QUEUE_SIZE
        )
        self._captured_at = 0.0
        self._capture = None
        self._mjpeg_reader: MjpegHttpReader | None = None
        self._sequence = 0
        self._ingress_samples: deque[tuple[float, int]] = deque(maxlen=2400)
        self._ingress_frames = 0
        self._ingress_bytes = 0
        self._decoded_frames = 0
        self._decode_errors = 0
        self._jpeg_errors = 0
        self._compressed_frames_dropped = 0
        self._packet_frames_dropped = 0
        self._frames_drained_while_paused = 0
        self._compressed_queue_high_water = 0
        self._packet_queue_high_water = 0
        self._detection_resolution: tuple[int, int] | None = None
        self.connected = False
        self.last_error = ""
        self.frames_read = 0
        self.frames_dropped = 0
        self.hardware_acceleration = False
        self.source_role = "primary"
        self.using_fallback = False
        self.failover_count = 0
        self.last_source_switch_at = 0.0
        self.last_failover_reason = ""

    @staticmethod
    def _is_http(source: str) -> bool:
        return str(source).lower().startswith(("http://", "https://"))

    def start(self) -> None:
        with self._lifecycle_lock:
            receiver_alive = bool(self._thread and self._thread.is_alive())
            decoder_alive = bool(
                self._decoder_thread and self._decoder_thread.is_alive()
            )
            if receiver_alive or decoder_alive:
                if self._stop.is_set() or not receiver_alive:
                    raise RuntimeError(
                        "La captura anterior aun se esta deteniendo; no se puede iniciar otra conexion."
                    )
                return
            self.clear_pending()
            self._processing_enabled.set()
            self._stop.clear()
            if self.async_mjpeg:
                self._decoder_thread = Thread(
                    target=self._decode_mjpeg_frames,
                    name=f"futsi-camera-decode-{self.name}",
                    daemon=True,
                )
                self._decoder_thread.start()
            self._thread = Thread(
                target=self._run,
                name=f"futsi-camera-{self.name}",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        with self._lifecycle_lock:
            self._stop.set()
            # Closing the active response normally interrupts a socket read.
            # During DNS/connect there is no Response yet, so wait through the
            # configured requests timeout and fail closed rather than allowing
            # a restart to overlap the one-client FFmpeg endpoint.
            reader = self._mjpeg_reader
            if reader is not None:
                reader.close()
            self._release_capture()
            deadline = time.monotonic() + max(0.1, self.SHUTDOWN_TIMEOUT_SECONDS)
            if self._thread and self._thread.is_alive():
                self._thread.join(timeout=max(0.0, deadline - time.monotonic()))
            self.clear_pending()
            if self._decoder_thread and self._decoder_thread.is_alive():
                self._decoder_thread.join(
                    timeout=max(0.0, deadline - time.monotonic())
                )
            self._release_capture()
            self.connected = False
            alive = [
                label
                for label, thread in (
                    ("receptor", self._thread),
                    ("decoder", self._decoder_thread),
                )
                if thread is not None and thread.is_alive()
            ]
            if alive:
                self.last_error = (
                    "No se pudo detener el pipeline de camara: "
                    + ", ".join(alive)
                    + "."
                )
                raise RuntimeError(self.last_error)
            self._thread = None
            self._decoder_thread = None
            self._mjpeg_reader = None

    def latest(self):
        with self._lock:
            return (self._frame.copy(), self._captured_at) if self._frame is not None else (None, 0.0)

    def next_packet(self) -> CapturedFrame | None:
        """Transfer ownership of the oldest detector packet to its consumer."""

        if not self._processing_enabled.is_set():
            return None
        with self._lock:
            if not self._frames:
                self._frame_available.clear()
                return None
            packet = self._frames.popleft()
            if not self._frames:
                self._frame_available.clear()
            return packet

    def next_frame(self):
        """Backward-compatible frame API used by the existing processor/tests."""

        packet = self.next_packet()
        if packet is None:
            return None, 0.0
        return packet.detection_frame, packet.captured_at

    def wait_for_frame(self, timeout: float) -> bool:
        return self._frame_available.wait(max(0.0, float(timeout)))

    @property
    def queue_depth(self) -> int:
        with self._lock:
            return len(self._frames)

    def set_processing_enabled(self, enabled: bool) -> None:
        """Keep receiving while paused, but do not decode or accumulate frames."""

        if enabled:
            self.clear_pending()
            self._processing_enabled.set()
        else:
            self._processing_enabled.clear()
            self.clear_pending()

    def clear_pending(self) -> None:
        drained = 0
        with self._lock:
            drained += len(self._frames)
            self._frames.clear()
            self._frame_available.clear()
        while True:
            try:
                self._compressed_frames.get_nowait()
                self._compressed_frames.task_done()
                drained += 1
            except Empty:
                break
        if drained and not self._processing_enabled.is_set():
            with self._metrics_lock:
                self._frames_drained_while_paused += drained

    @property
    def status_metrics(self) -> dict:
        now = time.monotonic()
        packet_queue_depth = self.queue_depth
        with self._metrics_lock:
            while self._ingress_samples and now - self._ingress_samples[0][0] > self.METRIC_WINDOW_SECONDS:
                self._ingress_samples.popleft()
            samples = tuple(self._ingress_samples)
            if len(samples) >= 2:
                elapsed = max(0.001, samples[-1][0] - samples[0][0])
                ingress_fps = (len(samples) - 1) / elapsed
                ingress_mbps = sum(size for _, size in samples[1:]) * 8 / elapsed / 1_000_000
            else:
                ingress_fps = 0.0
                ingress_mbps = 0.0
            metrics = {
                "pipeline_mode": "async_mjpeg" if self.async_mjpeg else "opencv",
                "decode_reduction": self.mjpeg_decode_reduction if self.async_mjpeg else 1,
                "ingress_frames": self._ingress_frames,
                "ingress_fps": round(ingress_fps, 2),
                "ingress_mbps": round(ingress_mbps, 2),
                "decoded_frames": self._decoded_frames,
                "decode_errors": self._decode_errors,
                "jpeg_errors": self._jpeg_errors,
                "compressed_queue_depth": self._compressed_frames.qsize(),
                "compressed_queue_high_water": self._compressed_queue_high_water,
                "packet_queue_depth": packet_queue_depth,
                "packet_queue_high_water": self._packet_queue_high_water,
                "compressed_frames_dropped": self._compressed_frames_dropped,
                "packet_frames_dropped": self._packet_frames_dropped,
                "frames_drained_while_paused": self._frames_drained_while_paused,
                "processing_enabled": self._processing_enabled.is_set(),
                "receiver_alive": bool(self._thread and self._thread.is_alive()),
                "decoder_alive": bool(
                    self._decoder_thread and self._decoder_thread.is_alive()
                ),
                "detection_resolution": (
                    {"width": self._detection_resolution[0], "height": self._detection_resolution[1]}
                    if self._detection_resolution
                    else None
                ),
            }
        return metrics

    def _source_value(self, source: str | None = None):
        value = str(self.source if source is None else source).strip()
        return int(value) if value.isdigit() else value

    def _open(self, source: str | None = None):
        source = self._source_value(source)
        network_source = isinstance(source, str) and source.lower().startswith(
            ("http://", "https://", "rtsp://")
        )
        if network_source:
            base_params = [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
                self.NETWORK_TIMEOUT_MSEC,
                cv2.CAP_PROP_READ_TIMEOUT_MSEC,
                self.NETWORK_TIMEOUT_MSEC,
            ]
            if source.lower().startswith("rtsp://"):
                accelerated_params = [
                    *base_params,
                    cv2.CAP_PROP_HW_ACCELERATION,
                    cv2.VIDEO_ACCELERATION_ANY,
                ]
                capture = cv2.VideoCapture(source, cv2.CAP_FFMPEG, accelerated_params)
                if not capture.isOpened():
                    capture.release()
                    capture = cv2.VideoCapture(source, cv2.CAP_FFMPEG, base_params)
                self.hardware_acceleration = bool(
                    capture.isOpened()
                    and capture.get(cv2.CAP_PROP_HW_ACCELERATION)
                    != cv2.VIDEO_ACCELERATION_NONE
                )
            else:
                capture = cv2.VideoCapture(source, cv2.CAP_FFMPEG, base_params)
                self.hardware_acceleration = False
        else:
            capture = cv2.VideoCapture(source)
            self.hardware_acceleration = False
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return capture

    def _set_source_role(self, role: str) -> None:
        role = "fallback" if role == "fallback" else "primary"
        if role == self.source_role:
            return
        self.source_role = role
        self.using_fallback = role == "fallback"
        self.last_source_switch_at = time.time()
        if self.using_fallback:
            self.failover_count += 1

    def _next_sequence(self) -> int:
        with self._metrics_lock:
            self._sequence += 1
            return self._sequence

    def _publish(self, frame) -> None:
        captured_at = time.time()
        packet = CapturedFrame(
            sequence=self._next_sequence(),
            captured_at=captured_at,
            detection_frame=frame,
            decode_reduction=1,
            original_frame=frame,
        )
        self._publish_packet(packet, count_read=True)

    def _publish_packet(self, packet: CapturedFrame, *, count_read: bool = False) -> None:
        if not self._processing_enabled.is_set():
            with self._metrics_lock:
                self._frames_drained_while_paused += 1
            return
        with self._lock:
            self._frame = packet.detection_frame
            self._captured_at = packet.captured_at
            if len(self._frames) == self._frames.maxlen:
                self.frames_dropped += 1
                with self._metrics_lock:
                    self._packet_frames_dropped += 1
            self._frames.append(packet)
            depth = len(self._frames)
            self._frame_available.set()
        with self._metrics_lock:
            self._packet_queue_high_water = max(self._packet_queue_high_water, depth)
            self._detection_resolution = (
                int(packet.detection_frame.shape[1]),
                int(packet.detection_frame.shape[0]),
            )
        if count_read:
            self.frames_read += 1

    def _record_ingress(self, encoded: bytes) -> tuple[int, float, bytes]:
        now = time.monotonic()
        captured_at = time.time()
        with self._metrics_lock:
            self._sequence += 1
            sequence = self._sequence
            self._ingress_frames += 1
            self._ingress_bytes += len(encoded)
            self._ingress_samples.append((now, len(encoded)))
        self.frames_read += 1
        return sequence, captured_at, encoded

    def _enqueue_encoded(self, item: tuple[int, float, bytes]) -> None:
        if not self._processing_enabled.is_set():
            with self._metrics_lock:
                self._frames_drained_while_paused += 1
            return
        try:
            self._compressed_frames.put_nowait(item)
        except Full:
            # Preserve recency under an unexpected overload, but surface every
            # loss in metrics instead of silently hiding it.
            try:
                self._compressed_frames.get_nowait()
                self._compressed_frames.task_done()
            except Empty:  # pragma: no cover - another consumer won the race
                pass
            with self._metrics_lock:
                self._compressed_frames_dropped += 1
            self.frames_dropped += 1
            self._compressed_frames.put_nowait(item)
        with self._metrics_lock:
            self._compressed_queue_high_water = max(
                self._compressed_queue_high_water,
                self._compressed_frames.qsize(),
            )

    def _decode_mjpeg_frames(self) -> None:
        flags = {
            1: cv2.IMREAD_COLOR,
            2: cv2.IMREAD_REDUCED_COLOR_2,
            4: cv2.IMREAD_REDUCED_COLOR_4,
            8: cv2.IMREAD_REDUCED_COLOR_8,
        }
        flag = flags[self.mjpeg_decode_reduction]
        while not self._stop.is_set():
            try:
                sequence, captured_at, encoded = self._compressed_frames.get(timeout=0.1)
            except Empty:
                continue
            try:
                if not self._processing_enabled.is_set():
                    with self._metrics_lock:
                        self._frames_drained_while_paused += 1
                    continue
                try:
                    decoded = cv2.imdecode(
                        np.frombuffer(encoded, dtype=np.uint8),
                        flag,
                    )
                    if decoded is None or decoded.size == 0:
                        raise ValueError("El JPEG reducido no se pudo decodificar.")
                    packet = CapturedFrame(
                        sequence=sequence,
                        captured_at=captured_at,
                        detection_frame=decoded,
                        decode_reduction=self.mjpeg_decode_reduction,
                        encoded_original=encoded,
                    )
                    self._publish_packet(packet)
                    with self._metrics_lock:
                        self._decoded_frames += 1
                except Exception:
                    # Parser validation intentionally remains cheap (SOI/EOI).
                    # libjpeg/OpenCV can still reject a corrupt payload; one
                    # bad camera frame must not kill the decoder permanently.
                    with self._metrics_lock:
                        self._decode_errors += 1
            finally:
                self._compressed_frames.task_done()

    def _release_capture(self) -> None:
        capture = self._capture
        self._capture = None
        if capture:
            capture.release()

    def _run(self) -> None:
        if self.source.startswith("synthetic://"):
            self._run_synthetic()
            return
        if self.async_mjpeg:
            self._run_async_mjpeg()
            return
        self._run_opencv()

    def _run_opencv(self) -> None:
        role = "primary"
        probing_primary = False
        primary_failures = 0
        next_primary_retry = 0.0
        current_primary_retry = self._primary_retry_seconds
        retry = 1.0
        while not self._stop.is_set():
            try:
                active_source = self.fallback_source if role == "fallback" else self.source
                self._capture = self._open(active_source)
                if not self._capture.isOpened():
                    raise RuntimeError("No se pudo abrir la fuente de video.")
                warmed_frames = []
                if probing_primary:
                    for _ in range(self._primary_recovery_frames):
                        ok, frame = self._capture.read()
                        if not ok or frame is None:
                            raise RuntimeError(
                                "La fuente principal no supero la prueba de recuperacion."
                            )
                        warmed_frames.append(frame)
                    self._set_source_role("primary")
                    probing_primary = False
                    primary_failures = 0
                    current_primary_retry = self._primary_retry_seconds
                    for frame in warmed_frames:
                        self._publish(frame)
                elif role == "fallback":
                    self._set_source_role("fallback")

                self.connected = True
                self.last_error = ""
                retry = 1.0
                session_frames = len(warmed_frames)
                while not self._stop.is_set():
                    if role == "fallback" and time.monotonic() >= next_primary_retry:
                        raise _PrimaryRetryRequested()
                    ok, frame = self._capture.read()
                    if not ok or frame is None:
                        raise RuntimeError("La camara dejo de entregar video.")
                    self._publish(frame)
                    session_frames += 1
                    if role == "primary" and session_frames >= self._primary_recovery_frames:
                        primary_failures = 0
            except _PrimaryRetryRequested:
                self._release_capture()
                self.connected = False
                role = "primary"
                probing_primary = True
                retry = 1.0
                continue
            except Exception as exc:
                self.connected = False
                error = self._safe_error(exc)
                self.last_error = error
                self._release_capture()
                if role == "primary" and self.fallback_source:
                    if probing_primary:
                        role = "fallback"
                        probing_primary = False
                        current_primary_retry = min(
                            current_primary_retry * 2.0,
                            self._primary_retry_ceiling,
                        )
                        next_primary_retry = time.monotonic() + current_primary_retry
                        self._stop.wait(min(self._primary_retry_seconds, 1.0))
                        continue
                    primary_failures += 1
                    if primary_failures >= self._failover_after:
                        self.last_failover_reason = error
                        role = "fallback"
                        self._set_source_role("fallback")
                        current_primary_retry = self._primary_retry_seconds
                        next_primary_retry = time.monotonic() + current_primary_retry
                        retry = 1.0
                        continue
                self._stop.wait(retry)
                retry = min(retry * 1.8, 15.0)
        self._release_capture()
        self.connected = False

    def _run_async_mjpeg(self) -> None:
        role = "primary"
        probing_primary = False
        primary_failures = 0
        next_primary_retry = 0.0
        current_primary_retry = self._primary_retry_seconds
        retry = 1.0
        while not self._stop.is_set():
            reader = None
            try:
                active_source = self.fallback_source if role == "fallback" else self.source
                reader = MjpegHttpReader(active_source, self._stop)
                self._mjpeg_reader = reader
                iterator = iter(reader.iter_frames())
                warmed_frames: list[tuple[int, float, bytes]] = []
                if probing_primary:
                    for _ in range(self._primary_recovery_frames):
                        warmed_frames.append(self._record_ingress(next(iterator)))
                    self._set_source_role("primary")
                    probing_primary = False
                    primary_failures = 0
                    current_primary_retry = self._primary_retry_seconds
                    for item in warmed_frames:
                        self._enqueue_encoded(item)
                    self.connected = True
                    self.last_error = ""
                    retry = 1.0
                elif role == "fallback":
                    self._set_source_role("fallback")

                session_frames = len(warmed_frames)
                for encoded in iterator:
                    if self._stop.is_set():
                        break
                    if role == "fallback" and time.monotonic() >= next_primary_retry:
                        raise _PrimaryRetryRequested()
                    if not self.connected:
                        self.connected = True
                        self.last_error = ""
                        retry = 1.0
                    self._enqueue_encoded(self._record_ingress(encoded))
                    session_frames += 1
                    if role == "primary" and session_frames >= self._primary_recovery_frames:
                        primary_failures = 0
                if self._stop.is_set():
                    break
                raise RuntimeError("La camara dejo de entregar video.")
            except _PrimaryRetryRequested:
                self.connected = False
                role = "primary"
                probing_primary = True
                retry = 1.0
                continue
            except Exception as exc:
                if self._stop.is_set():
                    break
                self.connected = False
                if isinstance(exc, MjpegStreamError):
                    with self._metrics_lock:
                        self._jpeg_errors += 1
                error = self._safe_error(exc)
                self.last_error = error
                if role == "primary" and self.fallback_source:
                    if probing_primary:
                        role = "fallback"
                        probing_primary = False
                        current_primary_retry = min(
                            current_primary_retry * 2.0,
                            self._primary_retry_ceiling,
                        )
                        next_primary_retry = time.monotonic() + current_primary_retry
                        self._stop.wait(min(self._primary_retry_seconds, 1.0))
                        continue
                    primary_failures += 1
                    if primary_failures >= self._failover_after:
                        self.last_failover_reason = error
                        role = "fallback"
                        self._set_source_role("fallback")
                        current_primary_retry = self._primary_retry_seconds
                        next_primary_retry = time.monotonic() + current_primary_retry
                        retry = 1.0
                        continue
                self._stop.wait(retry)
                retry = min(retry * 1.8, 15.0)
            finally:
                if reader is not None:
                    reader.close()
                if self._mjpeg_reader is reader:
                    self._mjpeg_reader = None
        self.connected = False

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        message = str(exc).strip()
        message = re.sub(r"(?i)\b(?:https?|rtsp)://[^\s]+", "<fuente>", message)
        return message or "La fuente de video no esta disponible."

    def _run_synthetic(self) -> None:
        self.connected = True
        position = 0
        while not self._stop.wait(1 / 15):
            frame = np.full((540, 960, 3), (24, 28, 27), dtype=np.uint8)
            cv2.rectangle(frame, (0, 0), (960, 72), (7, 70, 38), -1)
            cv2.putText(
                frame,
                "FUTSI - FUENTE DE PRUEBA",
                (28, 46),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (255, 255, 255),
                2,
            )
            x = 80 + (position % 720)
            cv2.circle(frame, (x, 280), 58, (228, 232, 229), -1)
            cv2.putText(
                frame,
                time.strftime("%Y-%m-%d %H:%M:%S"),
                (28, 510),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (210, 220, 214),
                2,
            )
            self._publish(frame)
            position += 5
