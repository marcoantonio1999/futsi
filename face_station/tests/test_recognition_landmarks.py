from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from face_station.app.recognition import (
    FaceEngine,
    LandmarkValidationError,
    validate_insightface_landmarks,
)


VALID_LANDMARKS = np.asarray(
    [[35, 42], [84, 41], [60, 65], [41, 88], [79, 87]],
    dtype=np.float32,
)


class FakeRecognitionModel:
    input_size = (112, 112)

    def __init__(self, result: np.ndarray):
        self.result = result
        self.inputs: list[np.ndarray] = []

    def get_feat(self, image: np.ndarray) -> np.ndarray:
        self.inputs.append(image)
        return self.result


class FakeAnalysis:
    def __init__(self, recognition_model: FakeRecognitionModel):
        self.models = {"recognition": recognition_model}

    def get(self, _image: np.ndarray):
        raise AssertionError("La ruta directa no debe ejecutar FaceAnalysis.get/SCRFD.")


def make_engine(model: FakeRecognitionModel) -> FaceEngine:
    engine = FaceEngine(SimpleNamespace())
    engine.app = FakeAnalysis(model)
    return engine


def test_embedding_from_landmarks_aligns_and_normalizes_without_detection(monkeypatch):
    from insightface.utils import face_align

    aligned = np.full((112, 112, 3), 17, dtype=np.uint8)
    alignment_call = {}

    def fake_norm_crop(image, landmark, image_size):
        alignment_call.update(
            image=image,
            landmark=landmark.copy(),
            image_size=image_size,
        )
        return aligned

    monkeypatch.setattr(face_align, "norm_crop", fake_norm_crop)
    model = FakeRecognitionModel(np.array([[3.0, 4.0, 0.0]], dtype=np.float32))
    engine = make_engine(model)
    crop = np.full((180, 160, 3), 100, dtype=np.uint8)
    landmarks = np.array(
        [[45, 62], [110, 61], [78, 91], [52, 124], [104, 123]],
        dtype=np.float32,
    )

    embedding = engine.embedding_from_landmarks(crop, landmarks)

    assert alignment_call["image"] is crop
    assert np.array_equal(alignment_call["landmark"], landmarks)
    assert alignment_call["image_size"] == 112
    assert model.inputs == [aligned]
    assert embedding.dtype == np.float32
    assert np.allclose(embedding, [0.6, 0.8, 0.0])
    assert np.isclose(np.linalg.norm(embedding), 1.0)


@pytest.mark.parametrize(
    "landmarks",
    [
        np.zeros((4, 2), dtype=np.float32),
        np.full((5, 2), np.nan, dtype=np.float32),
    ],
)
def test_embedding_from_landmarks_rejects_invalid_points_before_inference(landmarks):
    model = FakeRecognitionModel(np.ones((1, 512), dtype=np.float32))
    engine = make_engine(model)

    with pytest.raises(ValueError, match="cinco landmarks"):
        engine.embedding_from_landmarks(
            np.zeros((120, 120, 3), dtype=np.uint8),
            landmarks,
        )

    assert model.inputs == []


def test_embedding_from_landmarks_rejects_invalid_model_output(monkeypatch):
    from insightface.utils import face_align

    monkeypatch.setattr(
        face_align,
        "norm_crop",
        lambda _image, landmark, image_size: np.zeros(
            (image_size, image_size, 3),
            dtype=np.uint8,
        ),
    )
    model = FakeRecognitionModel(np.zeros((1, 512), dtype=np.float32))
    engine = make_engine(model)

    with pytest.raises(ValueError, match="embedding valido"):
        engine.embedding_from_landmarks(
            np.zeros((120, 120, 3), dtype=np.uint8),
            VALID_LANDMARKS,
        )


def test_embeddings_from_landmarks_batch_aligns_once_and_normalizes_each_row(monkeypatch):
    from insightface.utils import face_align

    aligned_images = []

    def fake_norm_crop(image, landmark, image_size):
        aligned = np.full((image_size, image_size, 3), image[0, 0, 0], dtype=np.uint8)
        aligned_images.append((aligned, landmark.copy()))
        return aligned

    monkeypatch.setattr(face_align, "norm_crop", fake_norm_crop)
    raw_embeddings = np.zeros((2, 512), dtype=np.float32)
    raw_embeddings[0, :3] = [3.0, 4.0, 0.0]
    raw_embeddings[1, :3] = [0.0, 5.0, 12.0]
    model = FakeRecognitionModel(raw_embeddings)
    engine = make_engine(model)
    images = [
        np.full((180, 160, 3), 17, dtype=np.uint8),
        np.full((190, 170, 3), 29, dtype=np.uint8),
    ]
    landmarks = [
        np.asarray([[45, 62], [110, 61], [78, 91], [52, 124], [104, 123]], dtype=np.float32),
        np.asarray([[48, 65], [114, 64], [81, 94], [55, 128], [108, 127]], dtype=np.float32),
    ]

    embeddings = engine.embeddings_from_landmarks_batch(images, landmarks)

    assert len(aligned_images) == 2
    assert len(model.inputs) == 1
    assert isinstance(model.inputs[0], list)
    assert all(
        np.array_equal(actual, expected[0])
        for actual, expected in zip(model.inputs[0], aligned_images)
    )
    assert len(embeddings) == 2
    assert np.allclose(embeddings[0][:3], [0.6, 0.8, 0.0])
    assert np.allclose(embeddings[1][:3], [0.0, 5.0 / 13.0, 12.0 / 13.0])
    assert np.count_nonzero(embeddings[0][3:]) == 0
    assert np.count_nonzero(embeddings[1][3:]) == 0
    assert all(embedding.dtype == np.float32 for embedding in embeddings)


def test_embeddings_from_landmarks_batch_rejects_wrong_result_count(monkeypatch):
    from insightface.utils import face_align

    monkeypatch.setattr(
        face_align,
        "norm_crop",
        lambda image, landmark, image_size: np.zeros(
            (image_size, image_size, 3),
            dtype=np.uint8,
        ),
    )
    model = FakeRecognitionModel(np.ones((1, 512), dtype=np.float32))
    engine = make_engine(model)

    with pytest.raises(ValueError, match="lote valido"):
        engine.embeddings_from_landmarks_batch(
            [
                np.zeros((120, 120, 3), dtype=np.uint8),
                np.zeros((120, 120, 3), dtype=np.uint8),
            ],
            [
                VALID_LANDMARKS,
                VALID_LANDMARKS,
            ],
        )


def test_landmark_geometry_accepts_a_valid_rolled_frontal_face():
    image = np.zeros((180, 160, 3), dtype=np.uint8)
    landmarks = np.asarray(
        [[42, 57], [108, 68], [72, 91], [46, 117], [97, 125]],
        dtype=np.float32,
    )

    geometry = validate_insightface_landmarks(image, landmarks)

    assert geometry.interocular > 60
    assert geometry.eye_dx > 0
    assert geometry.mouth_dx > 0
    assert 0 < geometry.nose_y_position < 1


def test_landmark_geometry_rejects_reversed_d13768_points_with_diagnostics():
    image = np.zeros((340, 146, 3), dtype=np.uint8)
    # Stored SCRFD output for crop 167445 of Desconocido 13768.
    landmarks = np.asarray(
        [
            [93.99797, 134.47992],
            [87.29430, 132.98050],
            [121.97247, 165.85396],
            [107.25693, 215.30096],
            [103.07753, 215.03053],
        ],
        dtype=np.float32,
    )

    with pytest.raises(LandmarkValidationError) as captured:
        validate_insightface_landmarks(image, landmarks)

    error = captured.value
    assert "eye_order_inverted" in error.reasons
    assert "mouth_order_inverted" in error.reasons
    assert "interocular_too_small" in error.reasons
    assert "landmark_widths_collapsed" in error.reasons
    assert error.metrics["interocular"] == pytest.approx(6.8693, abs=1e-3)


def test_landmark_geometry_rejects_d13768_group_a_despite_five_ordered_points():
    image = np.zeros((250, 217, 3), dtype=np.uint8)
    # Crop 126802: the five points exist and are ordered, but SCRFD placed the
    # nose far outside a face geometry compressed by the on-screen scoreboard.
    landmarks = np.asarray(
        [
            [115.78369, 89.78691],
            [147.86841, 89.48404],
            [160.48596, 105.92670],
            [136.95886, 146.46979],
            [162.50452, 146.53186],
        ],
        dtype=np.float32,
    )

    with pytest.raises(LandmarkValidationError) as captured:
        validate_insightface_landmarks(image, landmarks)

    error = captured.value
    assert "eye_mouth_ratio_too_large" in error.reasons
    assert "nose_horizontal_outlier" in error.reasons
    assert error.metrics["eye_mouth_ratio"] == pytest.approx(1.7722, abs=1e-3)
    assert error.metrics["nose_x_offset"] == pytest.approx(0.8932, abs=1e-3)


def test_landmark_geometry_rejects_d13768_group_b_tiny_profile_points():
    image = np.zeros((167, 128, 3), dtype=np.uint8)
    # Crop 161099: SCRFD returned all five points, concentrated in a small
    # sliver of a hood/profile rather than across a usable frontal face.
    landmarks = np.asarray(
        [
            [84.28235, 75.01965],
            [96.19080, 72.68808],
            [97.98810, 91.91321],
            [72.69971, 109.78802],
            [82.45544, 108.46814],
        ],
        dtype=np.float32,
    )

    with pytest.raises(LandmarkValidationError) as captured:
        validate_insightface_landmarks(image, landmarks)

    error = captured.value
    assert "interocular_too_small" in error.reasons
    assert "eye_mouth_ratio_too_large" in error.reasons
    assert "mouth_horizontal_outlier" in error.reasons
    assert error.metrics["interocular"] == pytest.approx(12.1345, abs=1e-3)


def test_embedding_does_not_align_or_infer_with_invalid_d13768_geometry(monkeypatch):
    from insightface.utils import face_align

    alignment_calls = []
    monkeypatch.setattr(
        face_align,
        "norm_crop",
        lambda *args, **kwargs: alignment_calls.append((args, kwargs)),
    )
    model = FakeRecognitionModel(np.ones((1, 512), dtype=np.float32))
    engine = make_engine(model)
    invalid = np.asarray(
        [
            [97.05946, 136.04567],
            [92.87262, 134.18207],
            [128.53169, 170.09302],
            [116.36443, 218.97867],
            [114.65416, 218.11111],
        ],
        dtype=np.float32,
    )

    with pytest.raises(LandmarkValidationError) as captured:
        engine.embedding_from_landmarks(
            np.zeros((346, 157, 3), dtype=np.uint8),
            invalid,
        )

    assert "eye_order_inverted" in captured.value.reasons
    assert alignment_calls == []
    assert model.inputs == []


def test_batch_validates_every_geometry_before_aligning_any_image(monkeypatch):
    from insightface.utils import face_align

    alignment_calls = []
    monkeypatch.setattr(
        face_align,
        "norm_crop",
        lambda *args, **kwargs: alignment_calls.append((args, kwargs)),
    )
    model = FakeRecognitionModel(np.ones((2, 512), dtype=np.float32))
    engine = make_engine(model)
    inverted = VALID_LANDMARKS.copy()
    inverted[[0, 1]] = inverted[[1, 0]]
    inverted[[3, 4]] = inverted[[4, 3]]

    with pytest.raises(LandmarkValidationError):
        engine.embeddings_from_landmarks_batch(
            [
                np.zeros((120, 120, 3), dtype=np.uint8),
                np.zeros((120, 120, 3), dtype=np.uint8),
            ],
            [VALID_LANDMARKS, inverted],
        )

    assert alignment_calls == []
    assert model.inputs == []


def test_detect_preserves_valid_five_points_and_drops_invalid_embedding():
    class Detection:
        bbox = np.asarray([20, 20, 140, 160], dtype=np.float32)
        det_score = 0.95
        normed_embedding = np.ones(512, dtype=np.float32) / np.sqrt(512)

        def __init__(self, kps):
            self.kps = kps

    valid = VALID_LANDMARKS + np.asarray([20, 20], dtype=np.float32)
    invalid = valid.copy()
    invalid[[0, 1]] = invalid[[1, 0]]
    invalid[[3, 4]] = invalid[[4, 3]]

    class DetectionAnalysis:
        def get(self, _frame):
            return [Detection(valid), Detection(invalid)]

    engine = FaceEngine(SimpleNamespace(min_det_score=0.65, min_face_size=70))
    engine.app = DetectionAnalysis()

    detections = engine.detect(np.zeros((200, 180, 3), dtype=np.uint8))

    assert len(detections) == 1
    assert np.array_equal(detections[0].landmarks, valid)
