from __future__ import annotations

import os
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from threading import RLock

import cv2
import numpy as np


_DLL_DIRECTORY_HANDLES = []


def _preload_gpu_dependencies(ort) -> None:
    """Make pip-installed NVIDIA DLLs discoverable on Windows before CUDA starts."""
    if os.name == "nt":
        nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
        bin_directories = [path for path in nvidia_root.glob("*/bin") if path.is_dir()]
        if bin_directories:
            os.environ["PATH"] = os.pathsep.join([*(str(path) for path in bin_directories), os.environ.get("PATH", "")])
            if hasattr(os, "add_dll_directory"):
                for path in bin_directories:
                    _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(path)))
    if hasattr(ort, "preload_dlls"):
        ort.preload_dlls(directory="")


@dataclass
class DetectedFace:
    bbox: tuple[int, int, int, int]
    embedding: np.ndarray | None
    score: float
    quality: float
    landmarks: np.ndarray | None = None


@dataclass
class MatchResult:
    person: dict | None
    similarity: float
    margin: float
    candidates: list[dict] = field(default_factory=list)

    @property
    def matched(self) -> bool:
        return self.person is not None


@dataclass(frozen=True, slots=True)
class LandmarkGeometry:
    """Measurements used to decide whether SCRFD's five points are usable."""

    image_width: int
    image_height: int
    interocular: float
    mouth_width: float
    vertical_span: float
    eye_dx: float
    eye_dy: float
    mouth_dx: float
    mouth_dy: float
    nose_x_offset: float
    nose_y_position: float
    mouth_x_offset: float
    eye_mouth_ratio: float

    def as_dict(self) -> dict[str, float | int]:
        return asdict(self)


class LandmarkValidationError(ValueError):
    """Five keypoints exist, but their geometry is unsafe for ArcFace alignment."""

    def __init__(
        self,
        reasons: list[str] | tuple[str, ...],
        *,
        metrics: dict[str, float | int] | None = None,
    ):
        self.reasons = tuple(reasons)
        self.reason = self.reasons[0] if self.reasons else "invalid_landmarks"
        self.metrics = dict(metrics or {})
        reason_text = ", ".join(self.reasons)
        super().__init__(
            f"Los cinco landmarks faciales tienen geometria invalida: {reason_text}."
        )


def validate_insightface_landmarks(
    image: np.ndarray,
    landmarks: np.ndarray,
) -> LandmarkGeometry:
    """Validate InsightFace/SCRFD's ordered five-point face geometry.

    Point order is expected to be left eye, right eye, nose, left mouth and
    right mouth in image coordinates.  ArcFace will still return an embedding
    when those points are collapsed or swapped, but that embedding represents
    the alignment artefact rather than a reliable face.
    """
    points = np.asarray(landmarks, dtype=np.float32)
    if points.shape != (5, 2):
        raise LandmarkValidationError(["invalid_shape"])
    if not np.isfinite(points).all():
        raise LandmarkValidationError(["non_finite"])
    if (
        not isinstance(image, np.ndarray)
        or image.size == 0
        or image.ndim not in (2, 3)
    ):
        raise ValueError("La imagen del recorte no es valida.")

    image_height, image_width = (int(value) for value in image.shape[:2])
    scale = float(min(image_width, image_height))
    left_eye, right_eye, nose, left_mouth, right_mouth = points
    eye_vector = right_eye - left_eye
    mouth_vector = right_mouth - left_mouth
    eye_midpoint = (left_eye + right_eye) * 0.5
    mouth_midpoint = (left_mouth + right_mouth) * 0.5
    vertical_span = float(mouth_midpoint[1] - eye_midpoint[1])
    interocular = float(np.linalg.norm(eye_vector))
    mouth_width = float(np.linalg.norm(mouth_vector))
    eye_dx, eye_dy = (float(value) for value in eye_vector)
    mouth_dx, mouth_dy = (float(value) for value in mouth_vector)
    nose_x_offset = float(
        (nose[0] - eye_midpoint[0]) / max(interocular, 1e-6)
    )
    nose_y_position = float(
        (nose[1] - eye_midpoint[1]) / max(vertical_span, 1e-6)
    )
    mouth_x_offset = float(
        (mouth_midpoint[0] - eye_midpoint[0]) / max(interocular, 1e-6)
    )
    eye_mouth_ratio = float(vertical_span / max(interocular, 1e-6))
    geometry = LandmarkGeometry(
        image_width=image_width,
        image_height=image_height,
        interocular=round(interocular, 4),
        mouth_width=round(mouth_width, 4),
        vertical_span=round(vertical_span, 4),
        eye_dx=round(eye_dx, 4),
        eye_dy=round(eye_dy, 4),
        mouth_dx=round(mouth_dx, 4),
        mouth_dy=round(mouth_dy, 4),
        nose_x_offset=round(nose_x_offset, 4),
        nose_y_position=round(nose_y_position, 4),
        mouth_x_offset=round(mouth_x_offset, 4),
        eye_mouth_ratio=round(eye_mouth_ratio, 4),
    )
    metrics = geometry.as_dict()
    reasons: list[str] = []

    boundary_margin = max(2.0, max(image_width, image_height) * 0.02)
    if (
        np.any(points[:, 0] < -boundary_margin)
        or np.any(points[:, 0] > image_width - 1 + boundary_margin)
        or np.any(points[:, 1] < -boundary_margin)
        or np.any(points[:, 1] > image_height - 1 + boundary_margin)
    ):
        reasons.append("outside_image")

    # With InsightFace's documented order both pairs must run left-to-right.
    # Reversed pairs were the clearest failure in Desconocido 13768.
    if eye_dx <= 0.0:
        reasons.append("eye_order_inverted")
    if mouth_dx <= 0.0:
        reasons.append("mouth_order_inverted")

    # These limits are deliberately permissive for moderate yaw/roll. They
    # only reject points that have collapsed compared with the saved crop.
    if interocular < max(8.0, scale * 0.11):
        reasons.append("interocular_too_small")
    if mouth_width < max(3.0, scale * 0.035):
        reasons.append("mouth_width_too_small")
    if vertical_span < max(4.0, scale * 0.05):
        reasons.append("vertical_span_too_small")
    elif mouth_width / vertical_span < 0.08:
        reasons.append("landmark_widths_collapsed")
    if eye_mouth_ratio > 1.75:
        reasons.append("eye_mouth_ratio_too_large")

    # A larger slope is effectively a sideways/upside-down face and causes a
    # highly unstable similarity transform. The attendance quality filter is
    # stricter; this guard only catches geometrically impossible alignments.
    if abs(eye_dy) > max(2.0, abs(eye_dx)):
        reasons.append("eye_line_too_steep")
    if abs(mouth_dy) > max(2.0, abs(mouth_dx)):
        reasons.append("mouth_line_too_steep")

    if vertical_span > 0.0:
        if nose_y_position < -0.15 or nose_y_position > 1.20:
            reasons.append("nose_vertical_order_invalid")
        if abs(nose_x_offset) > 0.65:
            reasons.append("nose_horizontal_outlier")
        if abs(mouth_x_offset) > 1.0:
            reasons.append("mouth_horizontal_outlier")

    if reasons:
        raise LandmarkValidationError(reasons, metrics=metrics)
    return geometry


class FaceEngine:
    def __init__(self, config):
        self.config = config
        self.app = None
        self.providers: list[str] = []
        self.provider_label = "Sin cargar"
        self.last_error = ""
        self._known_people: list[dict] = []
        self._known_matrix = np.empty((0, 512), dtype=np.float32)
        self._known_reference_identity_indexes = np.empty((0,), dtype=np.int64)
        self._lock = RLock()
        self._inference_lock = RLock()

    def load(self) -> None:
        import onnxruntime as ort
        from insightface.app import FaceAnalysis

        _preload_gpu_dependencies(ort)
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
            if providers[0] == "CUDAExecutionProvider":
                self._validate_cuda_runtime()
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

    def _validate_cuda_runtime(self) -> None:
        sessions = [getattr(model, "session", None) for model in getattr(self.app, "models", {}).values()]
        active_providers = [session.get_providers() for session in sessions if session is not None]
        if not active_providers or not all("CUDAExecutionProvider" in providers for providers in active_providers):
            raise RuntimeError("Una o mas sesiones ONNX no activaron CUDA.")
        probe = np.zeros((self.config.detector_size, self.config.detector_size, 3), dtype=np.uint8)
        self.app.get(probe)

    def _prepare_app(self, analysis_class, providers: list[str]):
        model_root = os.getenv("FUTSI_FACE_MODEL_DIR", str(Path.home() / ".insightface"))
        # The station only consumes detector boxes/keypoints and recognition
        # embeddings. Loading landmark, gender and age modules makes
        # FaceAnalysis execute models whose outputs are never used.
        app = analysis_class(
            name=self.config.model_name,
            root=model_root,
            providers=providers,
            allowed_modules=("detection", "recognition"),
        )
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
            points = np.asarray(
                getattr(face, "kps", []),
                dtype=np.float32,
            )
            if points.shape != (5, 2):
                continue
            try:
                validate_insightface_landmarks(frame, points)
            except LandmarkValidationError:
                # FaceAnalysis already attempted recognition internally. Do
                # not let an embedding produced from impossible geometry enter
                # either the known matcher or the unknown gallery.
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
                    landmarks=points,
                )
            )
        return detections

    def embedding_from_landmarks(
        self,
        image: np.ndarray,
        landmarks: np.ndarray,
    ) -> np.ndarray:
        """Create an ArcFace embedding without running face detection again.

        ``landmarks`` must contain the five InsightFace keypoints expressed in
        coordinates relative to ``image``. Invalid inputs raise an exception so
        the caller can decide whether re-detection is an acceptable fallback.
        """
        if self.app is None:
            raise RuntimeError("InsightFace no esta cargado.")
        recognition_model = getattr(self.app, "models", {}).get("recognition")
        if recognition_model is None:
            raise RuntimeError("El modelo de reconocimiento de InsightFace no esta cargado.")

        if not isinstance(image, np.ndarray) or image.size == 0 or image.ndim not in (2, 3):
            raise ValueError("La imagen del recorte no es valida.")
        points = np.asarray(landmarks, dtype=np.float32)
        validate_insightface_landmarks(image, points)

        input_size = tuple(getattr(recognition_model, "input_size", ()))
        if (
            len(input_size) != 2
            or int(input_size[0]) <= 0
            or int(input_size[0]) != int(input_size[1])
        ):
            raise RuntimeError("El modelo de reconocimiento tiene un tamano de entrada no compatible.")

        from insightface.utils import face_align

        aligned = face_align.norm_crop(
            image,
            landmark=points,
            image_size=int(input_size[0]),
        )
        with self._inference_lock:
            raw_embedding = recognition_model.get_feat(aligned)
        embedding = np.asarray(raw_embedding, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(embedding))
        if embedding.size == 0 or not np.isfinite(embedding).all() or norm <= 1e-12:
            raise ValueError("El modelo de reconocimiento no genero un embedding valido.")
        return np.asarray(embedding / norm, dtype=np.float32)

    def embeddings_from_landmarks_batch(
        self,
        images: list[np.ndarray],
        landmarks_batch: list[np.ndarray],
    ) -> list[np.ndarray]:
        """Create ArcFace embeddings for several already-detected crops at once."""
        if self.app is None:
            raise RuntimeError("InsightFace no esta cargado.")
        if not images or len(images) != len(landmarks_batch):
            raise ValueError("El lote debe contener una imagen y cinco landmarks por rostro.")
        recognition_model = getattr(self.app, "models", {}).get("recognition")
        if recognition_model is None:
            raise RuntimeError("El modelo de reconocimiento de InsightFace no esta cargado.")
        input_size = tuple(getattr(recognition_model, "input_size", ()))
        if (
            len(input_size) != 2
            or int(input_size[0]) <= 0
            or int(input_size[0]) != int(input_size[1])
        ):
            raise RuntimeError("El modelo de reconocimiento tiene un tamano de entrada no compatible.")

        from insightface.utils import face_align

        validated: list[tuple[np.ndarray, np.ndarray]] = []
        for image, landmarks in zip(images, landmarks_batch):
            if (
                not isinstance(image, np.ndarray)
                or image.dtype != np.uint8
                or image.ndim != 3
                or image.shape[2] != 3
                or image.size == 0
            ):
                raise ValueError("Una imagen del lote no es valida.")
            points = np.asarray(landmarks, dtype=np.float32)
            validate_insightface_landmarks(image, points)
            validated.append((image, points))

        # Validate the whole lot before aligning any image. One corrupt set of
        # points therefore cannot partially feed ArcFace before the failure is
        # reported and the caller falls back to individual handling.
        aligned_images: list[np.ndarray] = []
        for image, points in validated:
            aligned_images.append(
                face_align.norm_crop(
                    image,
                    landmark=points,
                    image_size=int(input_size[0]),
                )
            )

        try:
            with self._inference_lock:
                raw_embeddings = recognition_model.get_feat(aligned_images)
        except Exception as exc:
            raise RuntimeError(
                "ArcFace no pudo procesar el lote de embeddings."
            ) from exc
        embeddings = np.asarray(raw_embeddings, dtype=np.float32)
        if (
            embeddings.ndim != 2
            or embeddings.shape[0] != len(aligned_images)
            or embeddings.shape[1] != 512
            or not np.isfinite(embeddings).all()
        ):
            raise ValueError("El modelo de reconocimiento no genero un lote valido.")
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        if np.any(norms <= 1e-12):
            raise ValueError("El modelo de reconocimiento genero un embedding vacio.")
        normalized = embeddings / norms
        return [
            np.asarray(embedding, dtype=np.float32)
            for embedding in normalized
        ]

    def set_known_database(self, people: list[dict], matrix: np.ndarray) -> None:
        paired_rows = list(zip(people, matrix))
        parents: dict[tuple[str, str], tuple[str, str]] = {}

        def find(token: tuple[str, str]) -> tuple[str, str]:
            parent = parents.setdefault(token, token)
            while parent != parents[parent]:
                parents[parent] = parents[parents[parent]]
                parent = parents[parent]
            while token != parent:
                next_token = parents[token]
                parents[token] = parent
                token = next_token
            return parent

        def union(left: tuple[str, str], right: tuple[str, str]) -> None:
            left_root = find(left)
            right_root = find(right)
            if left_root != right_root:
                parents[right_root] = left_root

        row_tokens: list[tuple[str, str]] = []
        for row_index, (person, _embedding) in enumerate(paired_rows):
            person_key = str(person.get("person_key") or "").strip()
            person_token = (
                ("person", person_key)
                if person_key
                else ("row", str(row_index))
            )
            identity_key = self._identity_key(person)
            identity_token = (
                ("identity", identity_key)
                if identity_key
                else person_token
            )
            union(person_token, identity_token)
            row_tokens.append(person_token)

        grouped_people: list[dict] = []
        grouped_embeddings: list[np.ndarray] = []
        grouped_candidate_keys: list[set[str]] = []
        reference_identity_indexes: list[int] = []
        group_indexes: dict[tuple[str, str], int] = {}
        for (person, embedding), row_token in zip(paired_rows, row_tokens):
            identity_root = find(row_token)
            group_index = group_indexes.get(identity_root)
            if group_index is None:
                group_index = len(grouped_people)
                group_indexes[identity_root] = group_index
                representative = dict(person)
                representative["_identity_candidates"] = [dict(person)]
                grouped_people.append(representative)
                grouped_candidate_keys.append(
                    {str(person.get("person_key") or "").strip()}
                )
            else:
                person_key = str(person.get("person_key") or "").strip()
                if person_key not in grouped_candidate_keys[group_index]:
                    grouped_people[group_index]["_identity_candidates"].append(
                        dict(person)
                    )
                    grouped_candidate_keys[group_index].add(person_key)
            grouped_embeddings.append(np.asarray(embedding, dtype=np.float32))
            reference_identity_indexes.append(group_index)
        with self._lock:
            self._known_people = grouped_people
            self._known_matrix = (
                np.vstack(grouped_embeddings).astype(np.float32)
                if grouped_embeddings
                else np.empty((0, 512), dtype=np.float32)
            )
            self._known_reference_identity_indexes = np.asarray(
                reference_identity_indexes,
                dtype=np.int64,
            )

    @staticmethod
    def _identity_key(person: dict) -> str:
        reference_version = str(person.get("reference_version") or "")
        marker = ":supabase://"
        if marker in reference_version:
            return f"supabase://{reference_version.split(marker, 1)[1]}"
        return str(person.get("person_key") or "")

    def match_known(self, embedding: np.ndarray) -> MatchResult:
        with self._lock:
            if self._known_matrix.size == 0:
                return MatchResult(None, 0, 0)
            reference_similarities = self._known_matrix @ embedding
            identity_similarities = np.full(
                len(self._known_people),
                -np.inf,
                dtype=np.float32,
            )
            np.maximum.at(
                identity_similarities,
                self._known_reference_identity_indexes,
                reference_similarities,
            )
            best_index = int(np.argmax(identity_similarities))
            best = float(identity_similarities[best_index])
            second = (
                float(np.partition(identity_similarities, -2)[-2])
                if len(identity_similarities) > 1
                else -1.0
            )
            margin = best - second
            person = self._known_people[best_index] if best >= self.config.known_threshold and margin >= self.config.min_margin else None
            candidates = list(person.get("_identity_candidates", [person])) if person else []
            return MatchResult(person, best, margin, candidates)

    def embedding_from_reference(self, path: Path) -> np.ndarray:
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError("No se pudo leer la foto de referencia.")
        if self.app is None:
            raise RuntimeError("InsightFace no esta cargado.")

        # Registration portraits are often cropped tightly around the head. The
        # live-camera detector expects surrounding context and can reject those
        # images even when the face is sharp. Try the original first, then place
        # it on a neutral canvas so the detector sees the missing context. Keep
        # this separate from detect(): live frames still use the stricter size
        # and confidence filters configured for attendance.
        candidates = [image]
        height, width = image.shape[:2]
        padding = max(height, width)
        candidates.append(
            cv2.copyMakeBorder(
                image,
                padding,
                padding,
                padding,
                padding,
                cv2.BORDER_CONSTANT,
                value=(114, 114, 114),
            )
        )
        faces = []
        for candidate in candidates:
            with self._inference_lock:
                faces = self.app.get(candidate)
            if faces:
                break
        if not faces:
            raise ValueError("No se encontro un rostro util en la foto.")

        def reference_quality(face) -> float:
            x1, y1, x2, y2 = [float(value) for value in face.bbox]
            area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
            return float(getattr(face, "det_score", 0.0)) * area

        selected = max(faces, key=reference_quality)
        embedding = getattr(selected, "normed_embedding", None)
        if embedding is None:
            raw = np.asarray(selected.embedding, dtype=np.float32)
            embedding = raw / max(float(np.linalg.norm(raw)), 1e-12)
        return np.asarray(embedding, dtype=np.float32)

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


class FaceDetector:
    """Persistent SCRFD-only session for the high-priority capture pipeline."""

    def __init__(self, config):
        self.config = config
        self.model = None
        self.providers: list[str] = []
        self.provider_label = "Sin cargar"
        self.last_error = ""
        self._inference_lock = RLock()

    def load(self) -> None:
        import onnxruntime as ort
        from insightface.model_zoo import get_model

        _preload_gpu_dependencies(ort)
        available = ort.get_available_providers()
        requested = self.config.processing_device
        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if requested in {"auto", "gpu"} and "CUDAExecutionProvider" in available
            else ["CPUExecutionProvider"]
        )
        model_path = self._model_path("det_10g.onnx")
        try:
            self.model = get_model(str(model_path), providers=providers)
            self.model.prepare(
                ctx_id=0,
                input_size=(self.config.detector_size, self.config.detector_size),
                det_thresh=self.config.min_det_score,
            )
            if providers[0] == "CUDAExecutionProvider":
                active = list(getattr(self.model, "session").get_providers())
                if "CUDAExecutionProvider" not in active:
                    raise RuntimeError("SCRFD no activo CUDA.")
                self.detect(np.zeros((self.config.detector_size, self.config.detector_size, 3), dtype=np.uint8))
        except Exception as exc:
            if providers[0] != "CUDAExecutionProvider":
                raise
            self.last_error = f"CUDA no pudo iniciar SCRFD; se uso CPU: {exc}"
            providers = ["CPUExecutionProvider"]
            self.model = get_model(str(model_path), providers=providers)
            self.model.prepare(
                ctx_id=-1,
                input_size=(self.config.detector_size, self.config.detector_size),
                det_thresh=self.config.min_det_score,
            )
        self.providers = providers
        self.provider_label = (
            "SCRFD directo · GPU NVIDIA (CUDA)"
            if providers[0] == "CUDAExecutionProvider"
            else "SCRFD directo · CPU"
        )
        if requested == "gpu" and providers[0] != "CUDAExecutionProvider":
            self.provider_label = "SCRFD directo · CPU (GPU no disponible)"

    def _model_path(self, filename: str) -> Path:
        root = Path(os.getenv("FUTSI_FACE_MODEL_DIR", str(Path.home() / ".insightface")))
        candidates = (
            root / "models" / self.config.model_name / filename,
            root / self.config.model_name / filename,
        )
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        raise FileNotFoundError(f"No se encontro el modelo {filename} de {self.config.model_name}.")

    def detect(self, frame) -> list[DetectedFace]:
        if self.model is None:
            raise RuntimeError("SCRFD no esta cargado.")
        with self._inference_lock:
            boxes, landmarks = self.model.detect(frame, max_num=0, metric="default")
        detections: list[DetectedFace] = []
        if boxes is None:
            return detections
        for index, values in enumerate(boxes):
            x1, y1, x2, y2 = [int(round(float(value))) for value in values[:4]]
            width, height = max(0, x2 - x1), max(0, y2 - y1)
            score = float(values[4]) if len(values) > 4 else 0.0
            if score < self.config.min_det_score or min(width, height) < self.config.min_face_size:
                continue
            area_factor = min(1.0, min(width, height) / 180.0)
            points = None
            if landmarks is not None and index < len(landmarks):
                points = np.asarray(landmarks[index], dtype=np.float32)
            detections.append(
                DetectedFace(
                    bbox=(x1, y1, x2, y2),
                    embedding=None,
                    score=score,
                    quality=score * area_factor,
                    landmarks=points,
                )
            )
        return detections

    def benchmark(self, frame, seconds: int = 8) -> dict:
        if self.model is None:
            raise RuntimeError("SCRFD no esta cargado.")
        for _ in range(2):
            self.detect(frame)
        durations = []
        started = time.perf_counter()
        while time.perf_counter() - started < max(2, seconds):
            sample_start = time.perf_counter()
            self.detect(frame)
            durations.append(time.perf_counter() - sample_start)
        average = sum(durations) / max(len(durations), 1)
        capacity = 1 / max(average, 0.001)
        return {
            "samples": len(durations),
            "average_ms": round(average * 1000, 1),
            "capacity_fps": round(capacity, 2),
            "recommended_fps": round(max(1.0, min(30.0, capacity * 0.85)), 2),
            "provider": self.provider_label,
        }


def match_matrix(embedding: np.ndarray, rows: list[dict], matrix: np.ndarray, threshold: float):
    if matrix.size == 0:
        return None, 0.0
    similarities = matrix @ embedding
    index = int(np.argmax(similarities))
    similarity = float(similarities[index])
    return (rows[index] if similarity >= threshold else None), similarity
