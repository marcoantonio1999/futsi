from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from threading import RLock

import cv2
import numpy as np


@dataclass
class DetectedFace:
    bbox: tuple[int, int, int, int]
    embedding: np.ndarray
    score: float
    quality: float


@dataclass
class MatchResult:
    person: dict | None
    similarity: float
    margin: float

    @property
    def matched(self) -> bool:
        return self.person is not None


class FaceEngine:
    def __init__(self, config):
        self.config = config
        self.app = None
        self.providers: list[str] = []
        self.provider_label = "Sin cargar"
        self.last_error = ""
        self._known_people: list[dict] = []
        self._known_matrix = np.empty((0, 512), dtype=np.float32)
        self._lock = RLock()
        self._inference_lock = RLock()

    def load(self) -> None:
        import onnxruntime as ort
        from insightface.app import FaceAnalysis

        if hasattr(ort, "preload_dlls"):
            try:
                ort.preload_dlls(directory="")
            except Exception:
                pass
        available = ort.get_available_providers()
        requested = self.config.processing_device
        if requested == "gpu" and "CUDAExecutionProvider" in available:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        elif requested == "auto" and "CUDAExecutionProvider" in available:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        else:
            providers = ["CPUExecutionProvider"]
        try:
            self.app = self._prepare_app(FaceAnalysis, providers)
        except Exception as exc:
            if providers[0] != "CUDAExecutionProvider":
                raise
            self.last_error = f"CUDA no pudo iniciar; se uso CPU: {exc}"
            providers = ["CPUExecutionProvider"]
            self.app = self._prepare_app(FaceAnalysis, providers)
        self.providers = providers
        self.provider_label = "GPU NVIDIA (CUDA)" if providers[0] == "CUDAExecutionProvider" else "CPU"
        if requested == "gpu" and providers[0] != "CUDAExecutionProvider":
            self.provider_label = "CPU (GPU no disponible)"
        if not self.last_error:
            self.last_error = ""

    def _prepare_app(self, analysis_class, providers: list[str]):
        model_root = os.getenv("FUTSI_FACE_MODEL_DIR", str(Path.home() / ".insightface"))
        app = analysis_class(name=self.config.model_name, root=model_root, providers=providers)
        app.prepare(ctx_id=0, det_size=(self.config.detector_size, self.config.detector_size))
        return app

    def detect(self, frame) -> list[DetectedFace]:
        if self.app is None:
            raise RuntimeError("InsightFace no esta cargado.")
        detections = []
        with self._inference_lock:
            faces = self.app.get(frame)
        for face in faces:
            x1, y1, x2, y2 = [int(round(value)) for value in face.bbox]
            width, height = max(0, x2 - x1), max(0, y2 - y1)
            score = float(getattr(face, "det_score", 0))
            if score < self.config.min_det_score or min(width, height) < self.config.min_face_size:
                continue
            embedding = getattr(face, "normed_embedding", None)
            if embedding is None:
                raw = np.asarray(face.embedding, dtype=np.float32)
                embedding = raw / max(float(np.linalg.norm(raw)), 1e-12)
            area_factor = min(1.0, min(width, height) / 180.0)
            detections.append(
                DetectedFace(
                    bbox=(x1, y1, x2, y2),
                    embedding=np.asarray(embedding, dtype=np.float32),
                    score=score,
                    quality=score * area_factor,
                )
            )
        return detections

    def set_known_database(self, people: list[dict], matrix: np.ndarray) -> None:
        with self._lock:
            self._known_people = people
            self._known_matrix = matrix

    def match_known(self, embedding: np.ndarray) -> MatchResult:
        with self._lock:
            if self._known_matrix.size == 0:
                return MatchResult(None, 0, 0)
            similarities = self._known_matrix @ embedding
            best_index = int(np.argmax(similarities))
            best = float(similarities[best_index])
            second = float(np.partition(similarities, -2)[-2]) if len(similarities) > 1 else -1.0
            margin = best - second
            person = self._known_people[best_index] if best >= self.config.known_threshold and margin >= self.config.min_margin else None
            return MatchResult(person, best, margin)

    def embedding_from_reference(self, path: Path) -> np.ndarray:
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError("No se pudo leer la foto de referencia.")
        faces = self.detect(image)
        if not faces:
            raise ValueError("No se encontro un rostro util en la foto.")
        return max(faces, key=lambda item: item.quality).embedding

    def benchmark(self, frame, seconds: int = 8) -> dict:
        if self.app is None:
            raise RuntimeError("InsightFace no esta cargado.")
        for _ in range(2):
            with self._inference_lock:
                self.app.get(frame)
        durations = []
        started = time.perf_counter()
        while time.perf_counter() - started < max(2, seconds):
            sample_start = time.perf_counter()
            with self._inference_lock:
                self.app.get(frame)
            durations.append(time.perf_counter() - sample_start)
        average = sum(durations) / max(len(durations), 1)
        capacity = 1 / max(average, 0.001)
        recommended = max(1.0, min(12.0, capacity * 0.72))
        return {
            "samples": len(durations),
            "average_ms": round(average * 1000, 1),
            "capacity_fps": round(capacity, 2),
            "recommended_fps": round(recommended, 2),
            "provider": self.provider_label,
        }


def match_matrix(embedding: np.ndarray, rows: list[dict], matrix: np.ndarray, threshold: float):
    if matrix.size == 0:
        return None, 0.0
    similarities = matrix @ embedding
    index = int(np.argmax(similarities))
    similarity = float(similarities[index])
    return (rows[index] if similarity >= threshold else None), similarity
