from __future__ import annotations

import time
from threading import Event, Lock, Thread

import cv2
import numpy as np


class CameraWorker:
    """Continuously reads a source and keeps only its newest frame."""

    def __init__(self, source: str):
        self.source = source
        self._stop = Event()
        self._lock = Lock()
        self._thread: Thread | None = None
        self._frame = None
        self._captured_at = 0.0
        self._capture = None
        self.connected = False
        self.last_error = ""
        self.frames_read = 0

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = Thread(target=self._run, name="futsi-camera", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        if self._capture:
            self._capture.release()
        self.connected = False

    def latest(self):
        with self._lock:
            return (self._frame.copy(), self._captured_at) if self._frame is not None else (None, 0.0)

    def _source_value(self):
        value = self.source.strip()
        return int(value) if value.isdigit() else value

    def _open(self):
        capture = cv2.VideoCapture(self._source_value())
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return capture

    def _run(self) -> None:
        if self.source.startswith("synthetic://"):
            self._run_synthetic()
            return
        retry = 1.0
        while not self._stop.is_set():
            try:
                self._capture = self._open()
                if not self._capture.isOpened():
                    raise RuntimeError(f"No se pudo abrir {self.source}")
                self.connected = True
                self.last_error = ""
                retry = 1.0
                while not self._stop.is_set():
                    ok, frame = self._capture.read()
                    if not ok or frame is None:
                        raise RuntimeError("La camara dejo de entregar video.")
                    with self._lock:
                        self._frame = frame
                        self._captured_at = time.time()
                    self.frames_read += 1
            except Exception as exc:
                self.connected = False
                self.last_error = str(exc)
                if self._capture:
                    self._capture.release()
                self._stop.wait(retry)
                retry = min(retry * 1.8, 15.0)

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
            with self._lock:
                self._frame = frame
                self._captured_at = time.time()
            self.frames_read += 1
            position += 5
