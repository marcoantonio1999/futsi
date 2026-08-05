from __future__ import annotations

import sys
from types import SimpleNamespace

import numpy as np
import pytest

from face_station.app.config import StationConfig
from face_station.app.config import ConfigManager
from face_station.app.face_quality import FaceQualityResult
from face_station.app.processor import StationRuntime
from face_station.app.semantic_reference import (
    SEMANTIC_REFERENCE_VERSION,
    SemanticReferenceGate,
    SemanticReferenceMetrics,
    decide_semantic_reference,
    extract_semantic_reference_metrics,
    preprocess_semantic_reference,
)


def test_semantic_reference_config_is_opt_in_and_requires_base_quality():
    assert StationConfig().semantic_reference_filter_enabled is False
    enabled = StationConfig.from_dict(
        {
            "semantic_reference_filter_enabled": True,
            "semantic_reference_model_path": "parser.onnx",
        }
    )
    assert enabled.semantic_reference_filter_enabled is True
    assert enabled.semantic_reference_model_path == "parser.onnx"
    with pytest.raises(ValueError, match="requiere quality_filter_enabled"):
        StationConfig.from_dict(
            {
                "quality_filter_enabled": False,
                "semantic_reference_filter_enabled": True,
            }
        )


def test_runtime_combines_mediapipe_and_semantic_gate_for_reference_only(
    tmp_path,
):
    manager = ConfigManager(tmp_path)
    manager.update({"semantic_reference_filter_enabled": True})
    runtime = StationRuntime(manager)

    class AcceptedBaseQuality:
        @staticmethod
        def analyze(_image):
            return FaceQualityResult(
                True,
                0.91,
                (),
                mesh_detected=True,
                minimum_ear=0.24,
            )

    class RejectedSemanticGate:
        metadata = {"loaded": True, "provider": "test"}

        @staticmethod
        def evaluate(_image, *, mesh_detected, minimum_ear):
            assert mesh_detected is True
            assert minimum_ear == pytest.approx(0.24)
            return SimpleNamespace(
                accepted=False,
                as_dict=lambda: {
                    "accepted": False,
                    "reasons": ["region_oral_no_visible"],
                    "version": SEMANTIC_REFERENCE_VERSION,
                },
            )

    runtime._quality_evaluator = AcceptedBaseQuality()
    runtime._semantic_reference_gate = RejectedSemanticGate()

    accepted, score, payload, version = runtime._analyze_unknown_quality(
        np.full((120, 100, 3), 127, dtype=np.uint8),
        0.95,
    )

    assert accepted is False
    assert score == pytest.approx(0.91)
    assert payload["accepted"] is False
    assert "region_oral_no_visible" in payload["reasons"]
    assert payload["semantic_reference"]["accepted"] is False
    assert version.endswith(SEMANTIC_REFERENCE_VERSION)


def make_metrics(**overrides) -> SemanticReferenceMetrics:
    values = {
        "mesh_detected": True,
        "minimum_ear": 0.24,
        "left_eye_top_probability": 0.55,
        "right_eye_top_probability": 0.52,
        "glasses_area_ratio": 0.0,
        "hat_area_ratio": 0.0,
        "oral_area_ratio": 0.01,
    }
    values.update(overrides)
    return SemanticReferenceMetrics(**values)


def make_logits(size: int = 64) -> np.ndarray:
    logits = np.full((1, 19, size, size), -4.0, dtype=np.float32)
    logits[:, 0, :, :] = 4.0
    logits[:, 4, 2:22, 2:22] = 10.0
    logits[:, 5, 2:22, 30:50] = 10.0
    logits[:, 11, 40:48, 20:44] = 10.0
    return logits


def test_preprocess_converts_bgr_to_rgb_and_normalizes_imagenet():
    image = np.asarray([[[0, 127, 255]]], dtype=np.uint8)

    tensor = preprocess_semantic_reference(image)

    assert tensor.shape == (1, 3, 512, 512)
    assert tensor.dtype == np.float32
    assert tensor[0, 0, 0, 0] == pytest.approx((1.0 - 0.485) / 0.229)
    assert tensor[0, 1, 0, 0] == pytest.approx((127 / 255.0 - 0.456) / 0.224)
    assert tensor[0, 2, 0, 0] == pytest.approx((0.0 - 0.406) / 0.225)


def test_extracts_required_classes_and_top_eye_probability():
    metrics = extract_semantic_reference_metrics(
        make_logits(),
        mesh_detected=True,
        minimum_ear=0.23,
    )

    assert metrics.left_eye_top_probability > 0.9
    assert metrics.right_eye_top_probability > 0.9
    assert metrics.glasses_area_ratio == 0.0
    assert metrics.hat_area_ratio == 0.0
    assert metrics.oral_area_ratio == pytest.approx(192 / 4096)


def test_pure_rule_accepts_bare_face_and_clear_glasses_modes():
    bare = decide_semantic_reference(make_metrics())
    glasses = decide_semantic_reference(
        make_metrics(
            glasses_area_ratio=0.03,
            left_eye_top_probability=0.12,
            right_eye_top_probability=0.11,
            minimum_ear=0.21,
        )
    )

    assert bare.accepted is True
    assert bare.eye_evidence_mode == "bare"
    assert glasses.accepted is True
    assert glasses.eye_evidence_mode == "glasses"


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"mesh_detected": False}, "malla_facial_no_detectada"),
        ({"minimum_ear": 0.17}, "apertura_ocular_insuficiente"),
        (
            {"right_eye_top_probability": 0.29},
            "ojos_no_visibles_semanticamente",
        ),
        ({"hat_area_ratio": 0.15}, "gorra_cubre_demasiado"),
        ({"oral_area_ratio": 0.001}, "region_oral_no_visible"),
    ],
)
def test_pure_rule_rejects_each_strict_condition(overrides, reason):
    decision = decide_semantic_reference(make_metrics(**overrides))

    assert decision.accepted is False
    assert reason in decision.reasons


def test_gate_keeps_one_session_and_reports_metadata(monkeypatch, tmp_path):
    model = tmp_path / "parser.onnx"
    model.write_bytes(b"semantic-model-test")

    class FakeSession:
        def __init__(self):
            self.run_count = 0

        def get_providers(self):
            return ["CPUExecutionProvider"]

        def get_inputs(self):
            return [SimpleNamespace(name="input")]

        def get_outputs(self):
            return [SimpleNamespace(name="output")]

        def run(self, output_names, inputs):
            assert output_names == ["output"]
            assert inputs["input"].shape == (1, 3, 512, 512)
            self.run_count += 1
            return [make_logits()]

    session = FakeSession()
    creation_count = 0

    def create_session(*_args, **_kwargs):
        nonlocal creation_count
        creation_count += 1
        return session

    fake_ort = SimpleNamespace(
        get_available_providers=lambda: ["CPUExecutionProvider"],
        SessionOptions=lambda: SimpleNamespace(graph_optimization_level=None),
        GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL="all"),
        InferenceSession=create_session,
    )
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)
    gate = SemanticReferenceGate(model, processing_device="cpu")

    assert gate.load() is True
    assert gate.load() is True
    first = gate.evaluate(
        np.full((80, 60, 3), 127, dtype=np.uint8),
        mesh_detected=True,
        minimum_ear=0.23,
    )
    second = gate.evaluate(
        np.full((80, 60, 3), 127, dtype=np.uint8),
        mesh_detected=True,
        minimum_ear=0.23,
    )

    assert creation_count == 1
    assert session.run_count == 2
    assert first.accepted is True
    assert second.accepted is True
    assert first.provider == "CPUExecutionProvider"
    assert len(first.model_sha256) == 64
    assert first.inference_latency_ms >= 0
    assert gate.metadata["version"] == SEMANTIC_REFERENCE_VERSION
    assert gate.metadata["evaluation_count"] == 2


def test_gate_fails_closed_when_model_or_inference_is_unavailable(
    monkeypatch,
    tmp_path,
):
    missing = SemanticReferenceGate(tmp_path / "missing.onnx")
    assert missing.load() is False
    unavailable = missing.evaluate(
        np.zeros((16, 16, 3), dtype=np.uint8),
        mesh_detected=True,
        minimum_ear=0.3,
    )
    assert unavailable.accepted is False
    assert unavailable.reasons == ("modelo_semantico_no_disponible",)

    model = tmp_path / "broken.onnx"
    model.write_bytes(b"broken-model")

    class BrokenSession:
        def get_providers(self):
            return ["CPUExecutionProvider"]

        def get_inputs(self):
            return [SimpleNamespace(name="input")]

        def get_outputs(self):
            return [SimpleNamespace(name="output")]

        def run(self, *_args, **_kwargs):
            raise RuntimeError("inference exploded")

    fake_ort = SimpleNamespace(
        get_available_providers=lambda: ["CPUExecutionProvider"],
        SessionOptions=lambda: SimpleNamespace(graph_optimization_level=None),
        GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL="all"),
        InferenceSession=lambda *_args, **_kwargs: BrokenSession(),
    )
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)
    gate = SemanticReferenceGate(model, processing_device="cpu")
    assert gate.load() is True

    result = gate.evaluate(
        np.zeros((16, 16, 3), dtype=np.uint8),
        mesh_detected=True,
        minimum_ear=0.3,
    )

    assert result.accepted is False
    assert result.reasons == ("inferencia_semantica_fallida",)
    assert gate.metadata["error_count"] == 1
    assert "inference exploded" in str(gate.metadata["last_error"])
