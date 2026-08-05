from __future__ import annotations

import os
import time
from collections import deque
from threading import Event, Lock, Thread

os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2
import numpy as np


class _PrimaryRetryRequested(RuntimeError):
    """Internal signal used to probe the preferred source from the fallback."""


class CameraWorker:
    """Continuously reads a source and keeps a small bounded RAM frame queue."""

    NETWORK_TIMEOUT_MSEC = 5_000

    def __init__(
        self,
        source: str,
        name: str = "camera",
        queue_size: int = 3,
        fallback_source: str = "",
        failover_after: int = 3,
        primary_retry_seconds: float = 60.0,
        primary_recovery_frames: int = 8,
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
        self._stop = Event()
        self._frame_available = Event()
        self._lock = Lock()
        self._thread: Thread | None = None
        self._frame = None
        self._frames = deque(maxlen=max(1, int(queue_size)))
        self._captured_at = 0.0
        self._capture = None
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

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = Thread(target=self._run, name=f"futsi-camera-{self.name}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            # Give a normal read a brief chance to finish, then release the
            # capture so a network read cannot keep the worker around forever.
            self._thread.join(timeout=0.5)
            if self._thread.is_alive():
                self._release_capture()
                self._thread.join(timeout=2.5)
        self._release_capture()
        self.connected = False

    def latest(self):
        with self._lock:
            return (self._frame.copy(), self._captured_at) if self._frame is not None else (None, 0.0)

    def next_frame(self):
        """Transfer ownership of the oldest buffered frame to the detector."""
        with self._lock:
            if not self._frames:
                self._frame_available.clear()
                return None, 0.0
            item = self._frames.popleft()
            if not self._frames:
                self._frame_available.clear()
            return item

    def wait_for_frame(self, timeout: float) -> bool:
        return self._frame_available.wait(max(0.0, float(timeout)))

    @property
    def queue_depth(self) -> int:
        with self._lock:
            return len(self._frames)

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
                capture = cv2.VideoCapture(
                    source,
                    cv2.CAP_FFMPEG,
                    accelerated_params,
                )
                if not capture.isOpened():
                    capture.release()
                    capture = cv2.VideoCapture(source, cv2.CAP_FFMPEG, base_params)
                self.hardware_acceleration = bool(
                    capture.isOpened()
                    and capture.get(cv2.CAP_PROP_HW_ACCELERATION)
                    != cv2.VIDEO_ACCELERATION_NONE
                )
            else:
                # Explicit FFmpeg parameters are important here: the generic
                # HTTP opener may otherwise wait indefinitely when the LAN URL
                # is unreachable and never give the fallback a chance.
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

    def _publish(self, frame) -> None:
        captured_at = time.time()
        with self._lock:
            self._frame = frame
            self._captured_at = captured_at
            if len(self._frames) == self._frames.maxlen:
                self.frames_dropped += 1
            self._frames.append((frame, captured_at))
            self._frame_available.set()
        self.frames_read += 1

    def _release_capture(self) -> None:
        capture = self._capture
        self._capture = None
        if capture:
            capture.release()

    def _run(self) -> None:
        if self.source.startswith("synthetic://"):
            self._run_synthetic()
            return
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

                # A source that merely opens is not necessarily healthy.  When
                # returning from the fallback, require several consecutive
                # frames before exposing the role change to status/consumers.
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
                        # Keep status on fallback until the preferred source has
                        # passed its recovery probation. Failed probes therefore
                        # cannot make the UI flap between sources.
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

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        message = str(exc).strip()
        if "://" in message and "@" in message:
            prefix, remainder = message.split("://", 1)
            message = f"{prefix}://***@{remainder.split('@', 1)[1]}"
        return message or "La fuente de video no esta disponible."

    def _run_synthetic(self) -> None:
        self.connected = True
        position = 0
        while not self._stop.wait(1 / 15):
            frame = np.full((540, 960, 3), (24, 28, 27), dtype=np.uint8)
            cv2.rectangle(frame, (0, 0), (960, 72), (7, 70, 38), -1)
            cv2.putText(frame, "FUTSI - FUENTE DE PRUEBA", (28, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            x = 80 + (position % 720)
            cv2.circle(frame, (x, 280), 58, (228, 232, 229), -1)
            cv2.putText(frame, time.strftime("%Y-%m-%d %H:%M:%S"), (28, 510), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (210, 220, 214), 2)
            self._publish(frame)
            position += 5
