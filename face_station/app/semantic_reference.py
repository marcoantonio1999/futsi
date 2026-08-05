"""Conservative semantic gate for admitting face-reference crops.

This module is deliberately independent from attendance matching.  Its only
answer is whether a crop is clean enough to become (or replace) a reference.
If the optional ONNX model is unavailable, its output is malformed, or an
inference fails, the gate rejects the reference instead of weakening the
admission policy.
"""

from __future__ import annotations

import hashlib
import math
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock
from typing import Any

import cv2
import numpy as np


SEMANTIC_REFERENCE_VERSION = "semantic-reference-v1"
MODEL_INPUT_SIZE = 512
LEFT_EYE_CLASS = 4
RIGHT_EYE_CLASS = 5
GLASSES_CLASS = 6
ORAL_CLASSES = (11, 12, 13)
HAT_CLASS = 18
EXPECTED_CLASS_COUNT = 19

_IMAGENET_MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
_DLL_DIRECTORY_HANDLES: list[object] = []


@dataclass(frozen=True, slots=True)
class SemanticReferenceThresholds:
    """Thresholds calibrated by the isolated face-parsing experiment."""

    glasses_area_boundary: float = 0.02
    bare_eye_confidence_min: float = 0.30
    bare_minimum_ear: float = 0.18
    glasses_eye_confidence_min: float = 0.10
    glasses_minimum_ear: float = 0.20
    hat_area_max: float = 0.15
    oral_area_min: float = 0.002
    top_probability_pixels: int = 256


@dataclass(frozen=True, slots=True)
class SemanticReferenceMetrics:
    mesh_detected: bool
    minimum_ear: float
    left_eye_top_probability: float
    right_eye_top_probability: float
    glasses_area_ratio: float
    hat_area_ratio: float
    oral_area_ratio: float

    @property
    def both_eye_confidence(self) -> float:
        return min(
            float(self.left_eye_top_probability),
            float(self.right_eye_top_probability),
        )

    def as_dict(self) -> dict[str, bool | float]:
        return {
            **asdict(self),
            "both_eye_confidence": self.both_eye_confidence,
        }


@dataclass(frozen=True, slots=True)
class SemanticReferenceDecision:
    accepted: bool
    reasons: tuple[str, ...]
    eye_evidence_mode: str

    def as_dict(self) -> dict[str, object]:
        return {
            "accepted": self.accepted,
            "reasons": list(self.reasons),
            "eye_evidence_mode": self.eye_evidence_mode,
        }


@dataclass(frozen=True, slots=True)
class SemanticReferenceResult:
    accepted: bool
    reasons: tuple[str, ...]
    eye_evidence_mode: str
    metrics: SemanticReferenceMetrics | None
    provider: str
    model_sha256: str
    inference_latency_ms: float
    version: str = SEMANTIC_REFERENCE_VERSION

    def as_dict(self) -> dict[str, object]:
        return {
            "accepted": self.accepted,
            "reasons": list(self.reasons),
            "eye_evidence_mode": self.eye_evidence_mode,
            "metrics": self.metrics.as_dict() if self.metrics is not None else None,
            "provider": self.provider,
            "model_sha256": self.model_sha256,
            "inference_latency_ms": self.inference_latency_ms,
            "version": self.version,
        }


def preprocess_semantic_reference(image: np.ndarray) -> np.ndarray:
    """Convert a BGR crop to the parser's RGB ImageNet-normalized tensor."""

    if (
        not isinstance(image, np.ndarray)
        or image.size == 0
        or image.ndim != 3
        or image.shape[2] != 3
        or not np.issubdtype(image.dtype, np.number)
    ):
        raise ValueError("El recorte semantico debe ser una imagen BGR valida.")
    if not np.isfinite(image).all():
        raise ValueError("El recorte semantico contiene valores no finitos.")

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(
        rgb,
        (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
        interpolation=cv2.INTER_LINEAR,
    )
    tensor = resized.astype(np.float32) / 255.0
    tensor = (tensor - _IMAGENET_MEAN) / _IMAGENET_STD
    return np.ascontiguousarray(
        np.transpose(tensor, (2, 0, 1))[None],
        dtype=np.float32,
    )


def _target_class_probabilities(
    logits: np.ndarray,
    class_indexes: tuple[int, ...],
) -> tuple[np.ndarray, dict[int, np.ndarray]]:
    """Compute only the probability planes consumed by the decision rule.

    Materializing a complete 19x512x512 softmax adds substantial CPU time and
    memory traffic after CUDA inference.  A streaming denominator preserves the
    exact softmax values while retaining only the two eye planes.
    """

    maximum = logits.max(axis=0)
    denominator = np.zeros_like(maximum, dtype=np.float32)
    scratch = np.empty_like(maximum, dtype=np.float32)
    targets: dict[int, np.ndarray] = {}
    selected = set(class_indexes)
    for class_index in range(logits.shape[0]):
        np.subtract(logits[class_index], maximum, out=scratch)
        np.exp(scratch, out=scratch)
        denominator += scratch
        if class_index in selected:
            targets[class_index] = scratch.copy()
    if not np.isfinite(denominator).all() or np.any(denominator <= 0.0):
        raise ValueError("El modelo semantico genero probabilidades invalidas.")
    for class_index in tuple(targets):
        targets[class_index] /= denominator
    return maximum, targets


def _top_mean(values: np.ndarray, count: int) -> float:
    flattened = np.asarray(values, dtype=np.float32).reshape(-1)
    count = min(max(int(count), 1), int(flattened.size))
    return float(np.partition(flattened, flattened.size - count)[-count:].mean())


def extract_semantic_reference_metrics(
    logits: np.ndarray,
    *,
    mesh_detected: bool,
    minimum_ear: float,
    top_probability_pixels: int = 256,
) -> SemanticReferenceMetrics:
    """Extract the small, auditable metric set used by the pure decision rule."""

    values = np.asarray(logits, dtype=np.float32)
    if values.ndim == 4 and values.shape[0] == 1:
        values = values[0]
    if (
        values.ndim != 3
        or values.shape[0] < EXPECTED_CLASS_COUNT
        or values.shape[1] <= 0
        or values.shape[2] <= 0
        or not np.isfinite(values).all()
    ):
        raise ValueError(
            "El modelo semantico debe producir logits [1, 19, alto, ancho] validos."
        )
    if not math.isfinite(float(minimum_ear)):
        raise ValueError("La apertura ocular no es valida.")

    maximum, probabilities = _target_class_probabilities(
        values,
        (LEFT_EYE_CLASS, RIGHT_EYE_CLASS),
    )
    pixel_count = float(maximum.size)
    area = lambda class_index: float(
        np.count_nonzero(values[class_index] == maximum)
    ) / pixel_count
    return SemanticReferenceMetrics(
        mesh_detected=bool(mesh_detected),
        minimum_ear=float(minimum_ear),
        left_eye_top_probability=_top_mean(
            probabilities[LEFT_EYE_CLASS], top_probability_pixels
        ),
        right_eye_top_probability=_top_mean(
            probabilities[RIGHT_EYE_CLASS], top_probability_pixels
        ),
        glasses_area_ratio=area(GLASSES_CLASS),
        hat_area_ratio=area(HAT_CLASS),
        oral_area_ratio=sum(area(class_index) for class_index in ORAL_CLASSES),
    )


def decide_semantic_reference(
    metrics: SemanticReferenceMetrics,
    thresholds: SemanticReferenceThresholds = SemanticReferenceThresholds(),
) -> SemanticReferenceDecision:
    """Pure fail-closed rule for reference admission."""

    numeric_values = (
        metrics.minimum_ear,
        metrics.left_eye_top_probability,
        metrics.right_eye_top_probability,
        metrics.glasses_area_ratio,
        metrics.hat_area_ratio,
        metrics.oral_area_ratio,
    )
    if not all(math.isfinite(float(value)) for value in numeric_values):
        return SemanticReferenceDecision(
            accepted=False,
            reasons=("metricas_semanticas_invalidas",),
            eye_evidence_mode="invalid",
        )

    uses_glasses_rule = (
        metrics.glasses_area_ratio >= thresholds.glasses_area_boundary
    )
    eye_evidence_mode = "glasses" if uses_glasses_rule else "bare"
    eye_confidence_min = (
        thresholds.glasses_eye_confidence_min
        if uses_glasses_rule
        else thresholds.bare_eye_confidence_min
    )
    minimum_ear = (
        thresholds.glasses_minimum_ear
        if uses_glasses_rule
        else thresholds.bare_minimum_ear
    )

    reasons: list[str] = []
    if not metrics.mesh_detected:
        reasons.append("malla_facial_no_detectada")
    if metrics.hat_area_ratio >= thresholds.hat_area_max:
        reasons.append("gorra_cubre_demasiado")
    if metrics.both_eye_confidence < eye_confidence_min:
        reasons.append("ojos_no_visibles_semanticamente")
    if metrics.minimum_ear < minimum_ear:
        reasons.append("apertura_ocular_insuficiente")
    if metrics.oral_area_ratio < thresholds.oral_area_min:
        reasons.append("region_oral_no_visible")
    return SemanticReferenceDecision(
        accepted=not reasons,
        reasons=tuple(reasons),
        eye_evidence_mode=eye_evidence_mode,
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def _preload_cuda_dependencies(ort: Any) -> None:
    if os.name == "nt":
        nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
        bin_directories = [path for path in nvidia_root.glob("*/bin") if path.is_dir()]
        if bin_directories:
            os.environ["PATH"] = os.pathsep.join(
                [*(str(path) for path in bin_directories), os.environ.get("PATH", "")]
            )
            if hasattr(os, "add_dll_directory"):
                for path in bin_directories:
                    _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(path)))
    if hasattr(ort, "preload_dlls"):
        ort.preload_dlls(directory="")


class SemanticReferenceGate:
    """Persistent ONNX face-parser session used only for reference admission."""

    def __init__(
        self,
        model_path: str | Path,
        *,
        processing_device: str = "auto",
        thresholds: SemanticReferenceThresholds | None = None,
    ) -> None:
        self.model_path = Path(model_path)
        self.processing_device = str(processing_device).strip().lower()
        self.thresholds = thresholds or SemanticReferenceThresholds()
        self.provider = "not_loaded"
        self.model_sha256 = ""
        self.last_error = ""
        self.load_latency_ms = 0.0
        self.evaluation_count = 0
        self.rejection_count = 0
        self.error_count = 0
        self._session: Any | None = None
        self._input_name = ""
        self._output_name = ""
        self._lock = RLock()

    @property
    def loaded(self) -> bool:
        return self._session is not None

    @property
    def metadata(self) -> dict[str, object]:
        return {
            "version": SEMANTIC_REFERENCE_VERSION,
            "loaded": self.loaded,
            "requested_device": self.processing_device,
            "provider": self.provider,
            "model_path": str(self.model_path),
            "model_sha256": self.model_sha256,
            "load_latency_ms": self.load_latency_ms,
            "evaluation_count": self.evaluation_count,
            "rejection_count": self.rejection_count,
            "error_count": self.error_count,
            "last_error": self.last_error,
        }

    def load(self) -> bool:
        """Load once and keep the session; return False instead of opening the gate."""

        with self._lock:
            if self._session is not None:
                return True
            started = time.perf_counter()
            try:
                if not self.model_path.is_file():
                    raise FileNotFoundError(self.model_path)
                if self.processing_device not in {"auto", "cpu", "gpu", "cuda"}:
                    raise ValueError(
                        "processing_device debe ser auto, cpu, gpu o cuda."
                    )
                import onnxruntime as ort

                available = set(ort.get_available_providers())
                wants_cuda = self.processing_device in {"auto", "gpu", "cuda"}
                cuda_available = "CUDAExecutionProvider" in available
                providers = (
                    ["CUDAExecutionProvider", "CPUExecutionProvider"]
                    if wants_cuda and cuda_available
                    else ["CPUExecutionProvider"]
                )
                if providers[0] == "CUDAExecutionProvider":
                    _preload_cuda_dependencies(ort)

                options = ort.SessionOptions()
                options.graph_optimization_level = (
                    ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                )
                try:
                    session = ort.InferenceSession(
                        str(self.model_path),
                        sess_options=options,
                        providers=providers,
                    )
                except Exception:
                    if providers[0] != "CUDAExecutionProvider":
                        raise
                    session = ort.InferenceSession(
                        str(self.model_path),
                        sess_options=options,
                        providers=["CPUExecutionProvider"],
                    )

                actual_providers = list(session.get_providers())
                if not actual_providers:
                    raise RuntimeError("ONNX Runtime no reporto un proveedor activo.")
                inputs = list(session.get_inputs())
                outputs = list(session.get_outputs())
                if not inputs or not outputs:
                    raise RuntimeError("El modelo semantico no expone entradas y salidas.")

                self.model_sha256 = _sha256_file(self.model_path)
                self.provider = str(actual_providers[0])
                self._input_name = str(inputs[0].name)
                self._output_name = str(outputs[0].name)
                self._session = session
                self.last_error = ""
                return True
            except Exception as exc:
                self._session = None
                self._input_name = ""
                self._output_name = ""
                self.provider = "unavailable"
                self.last_error = f"{type(exc).__name__}: {exc}"
                self.error_count += 1
                return False
            finally:
                self.load_latency_ms = round(
                    (time.perf_counter() - started) * 1000.0,
                    3,
                )

    def evaluate(
        self,
        image: np.ndarray,
        *,
        mesh_detected: bool,
        minimum_ear: float,
    ) -> SemanticReferenceResult:
        """Evaluate one crop; any runtime problem produces a rejected result."""

        with self._lock:
            self.evaluation_count += 1
            if self._session is None:
                self.rejection_count += 1
                return self._failed_result("modelo_semantico_no_disponible")

            started = time.perf_counter()
            try:
                tensor = preprocess_semantic_reference(image)
                outputs = self._session.run(
                    [self._output_name],
                    {self._input_name: tensor},
                )
                if not outputs:
                    raise ValueError("El modelo semantico no devolvio resultados.")
                metrics = extract_semantic_reference_metrics(
                    outputs[0],
                    mesh_detected=mesh_detected,
                    minimum_ear=minimum_ear,
                    top_probability_pixels=self.thresholds.top_probability_pixels,
                )
                decision = decide_semantic_reference(metrics, self.thresholds)
                latency_ms = round(
                    (time.perf_counter() - started) * 1000.0,
                    3,
                )
                if not decision.accepted:
                    self.rejection_count += 1
                self.last_error = ""
                return SemanticReferenceResult(
                    accepted=decision.accepted,
                    reasons=decision.reasons,
                    eye_evidence_mode=decision.eye_evidence_mode,
                    metrics=metrics,
                    provider=self.provider,
                    model_sha256=self.model_sha256,
                    inference_latency_ms=latency_ms,
                )
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                self.error_count += 1
                self.rejection_count += 1
                return self._failed_result(
                    "inferencia_semantica_fallida",
                    latency_ms=round(
                        (time.perf_counter() - started) * 1000.0,
                        3,
                    ),
                )

    def _failed_result(
        self,
        reason: str,
        *,
        latency_ms: float = 0.0,
    ) -> SemanticReferenceResult:
        return SemanticReferenceResult(
            accepted=False,
            reasons=(reason,),
            eye_evidence_mode="unavailable",
            metrics=None,
            provider=self.provider,
            model_sha256=self.model_sha256,
            inference_latency_ms=latency_ms,
        )

    def close(self) -> None:
        with self._lock:
            self._session = None
            self._input_name = ""
            self._output_name = ""
            self.provider = "not_loaded"
