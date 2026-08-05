from __future__ import annotations

import numpy as np
import pytest

from face_station.app.face_quality import (
    FACE_OVAL,
    LEFT_EYE_EAR_LANDMARKS,
    RIGHT_EYE_EAR_LANDMARKS,
    FaceQualityEvaluator,
    FaceQualityResult,
    FaceQualityThresholds,
)


def _set_eye(
    points: np.ndarray,
    indices: tuple[int, ...],
    *,
    origin_x: float,
    horizontal: float,
    outer_height: float,
    inner_height: float,
) -> None:
    outer, upper_outer, upper_inner, inner, lower_inner, lower_outer = indices
    points[outer] = (origin_x, 10.0)
    points[inner] = (origin_x + horizontal, 10.0)
    points[upper_outer] = (origin_x + horizontal * 0.25, 10.0 - outer_height / 2.0)
    points[lower_outer] = (origin_x + horizontal * 0.25, 10.0 + outer_height / 2.0)
    points[upper_inner] = (origin_x + horizontal * 0.75, 10.0 - inner_height / 2.0)
    points[lower_inner] = (origin_x + horizontal * 0.75, 10.0 + inner_height / 2.0)


def test_eye_aspect_ratio_uses_both_vertical_eye_openings() -> None:
    points = np.zeros((478, 2), dtype=np.float32)
    _set_eye(
        points,
        LEFT_EYE_EAR_LANDMARKS,
        origin_x=10.0,
        horizontal=20.0,
        outer_height=8.0,
        inner_height=4.0,
    )

    ear = FaceQualityEvaluator._eye_aspect_ratio(points, LEFT_EYE_EAR_LANDMARKS)

    assert ear == pytest.approx(0.3)


def test_eye_aspect_ratio_is_zero_when_eye_width_is_degenerate() -> None:
    points = np.zeros((478, 2), dtype=np.float32)
    _set_eye(
        points,
        RIGHT_EYE_EAR_LANDMARKS,
        origin_x=10.0,
        horizontal=0.0,
        outer_height=8.0,
        inner_height=8.0,
    )

    ear = FaceQualityEvaluator._eye_aspect_ratio(points, RIGHT_EYE_EAR_LANDMARKS)

    assert ear == 0.0


def test_face_quality_result_keeps_ear_defaults_backward_compatible() -> None:
    result = FaceQualityResult(True, 0.9, ())

    assert result.left_ear == 0.0
    assert result.right_ear == 0.0
    assert result.minimum_ear == 0.0
    assert result.as_dict()["minimum_ear"] == 0.0


def test_measure_exposes_each_eye_and_minimum_ear() -> None:
    evaluator = object.__new__(FaceQualityEvaluator)
    evaluator.thresholds = FaceQualityThresholds()
    points = np.full((478, 2), (100.0, 100.0), dtype=np.float32)
    points[list(FACE_OVAL)] = (100.0, 100.0)
    points[10] = (100.0, 60.0)
    points[152] = (100.0, 140.0)
    points[234] = (60.0, 100.0)
    points[454] = (140.0, 100.0)
    _set_eye(
        points,
        LEFT_EYE_EAR_LANDMARKS,
        origin_x=65.0,
        horizontal=20.0,
        outer_height=8.0,
        inner_height=4.0,
    )
    _set_eye(
        points,
        RIGHT_EYE_EAR_LANDMARKS,
        origin_x=115.0,
        horizontal=20.0,
        outer_height=4.0,
        inner_height=4.0,
    )
    image = np.random.default_rng(7).integers(20, 236, size=(200, 200, 3), dtype=np.uint8)

    result = evaluator._measure(image, points, yaw=0.0, pitch=0.0, roll=0.0)

    assert result.left_ear == pytest.approx(0.3)
    assert result.right_ear == pytest.approx(0.2)
    assert result.minimum_ear == pytest.approx(0.2)
    assert result.as_dict()["minimum_ear"] == pytest.approx(0.2)
