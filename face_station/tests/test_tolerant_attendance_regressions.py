from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from face_station.app.config import ConfigManager
from face_station.app.face_quality import FaceQualityResult
from face_station.app.processor import StationRuntime
from face_station.app.recognition import DetectedFace


def _normalized(seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    embedding = generator.normal(size=512).astype(np.float32)
    return embedding / np.linalg.norm(embedding)


def test_known_match_below_eighty_with_rejected_visual_quality_keeps_attendance_and_evidence(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._camera_labels = {"primary": "Raspberry"}
    runtime._camera_ids = {"primary": "cancha_1"}
    seen_at = datetime(2026, 7, 30, 18, 15, tzinfo=timezone.utc).astimezone()
    person = {
        "person_key": "student:tolerant-probe",
        "person_type": "student",
        "remote_id": 901,
        "name": "Alumno Reconocido",
    }
    runtime.store.replace_bootstrap(
        [
            {
                "key": person["person_key"],
                "type": person["person_type"],
                "id": person["remote_id"],
                "name": person["name"],
                "reference_available": True,
                "reference_version": "regression-v1",
            }
        ],
        [],
    )
    registered_path = tmp_path / "registered-reference.jpg"
    assert cv2.imwrite(
        str(registered_path),
        np.full((180, 180, 3), 180, dtype=np.uint8),
    )
    anchor = _normalized(801)
    runtime.store.save_person_embedding(
        person["person_key"],
        registered_path,
        anchor,
    )
    references_before, _ = runtime.store.known_reference_database(
        person["person_key"]
    )

    match = SimpleNamespace(
        matched=True,
        person=person,
        candidates=[person],
        similarity=0.74,
        margin=0.14,
    )
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: match)
    monkeypatch.setattr(
        runtime,
        "_embedding_from_queued_crop",
        lambda _item, _image: DetectedFace(
            bbox=(0, 0, 180, 180),
            embedding=anchor,
            score=0.96,
            quality=0.91,
        ),
    )

    class RejectedVisualQuality:
        @staticmethod
        def analyze(_image):
            return FaceQualityResult(
                False,
                0.22,
                ("rostro_de_lado",),
                mesh_detected=True,
                yaw=42.0,
            )

    runtime._quality_evaluator = RejectedVisualQuality()
    source_path = tmp_path / "profile-probe.jpg"
    assert cv2.imwrite(
        str(source_path),
        np.full((180, 180, 3), 155, dtype=np.uint8),
    )

    result = runtime._process_queued_crop(
        {
            "id": 1,
            "crop_path": str(source_path),
            "captured_at": seen_at.isoformat(),
            "camera_key": "primary",
        }
    )

    references_after, _ = runtime.store.known_reference_database(
        person["person_key"]
    )
    with runtime.store.connection() as database:
        presence = dict(
            database.execute(
                "select * from daily_presence where subject_key=?",
                (person["person_key"],),
            ).fetchone()
        )
        evidence = dict(
            database.execute(
                "select * from face_crops where subject_key=?",
                (person["person_key"],),
            ).fetchone()
        )

    assert result["status"] == "processed"
    assert result["result_kind"] == "known"
    assert result["result_key"] == person["person_key"]
    assert result["similarity"] == pytest.approx(0.74)
    assert presence["subject_kind"] == "known"
    assert presence["detection_count"] == 1
    assert presence["best_similarity"] == pytest.approx(0.74)
    assert evidence["subject_kind"] == "known"
    assert evidence["similarity"] == pytest.approx(0.74)
    assert evidence["quality_pass"] == 0
    assert "rostro_de_lado" in json.loads(evidence["quality_json"])["reasons"]
    assert len(references_before) == 1
    assert len(references_after) == len(references_before)
    assert [row["source"] for row in references_after] == ["registered"]


@pytest.mark.parametrize("redetection_succeeds", [True, False])
def test_invalid_stored_landmarks_use_scrfd_and_discard_only_when_redetection_fails(
    tmp_path,
    monkeypatch,
    redetection_succeeds,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    image = np.full((250, 217, 3), 120, dtype=np.uint8)
    source_path = tmp_path / f"invalid-landmarks-{redetection_succeeds}.jpg"
    assert cv2.imwrite(str(source_path), image)
    recovered_face = DetectedFace(
        bbox=(38, 24, 181, 226),
        embedding=_normalized(802),
        score=0.93,
        quality=0.88,
        landmarks=np.asarray(
            [[75, 80], [145, 79], [110, 121], [82, 166], [138, 165]],
            dtype=np.float32,
        ),
    )
    person = {
        "person_key": "student:scrfd-recovery",
        "person_type": "student",
        "remote_id": 902,
        "name": "Rostro Recuperado",
    }
    detection_calls: list[tuple[int, ...]] = []

    class RedetectingEngine:
        @staticmethod
        def embedding_from_landmarks(_image, _landmarks):
            raise AssertionError(
                "ArcFace no debe consumir los landmarks almacenados invalidos."
            )

        @staticmethod
        def detect(candidate_image):
            detection_calls.append(candidate_image.shape)
            return [recovered_face] if redetection_succeeds else []

        @staticmethod
        def match_known(_embedding):
            if not redetection_succeeds:
                raise AssertionError("No debe comparar si SCRFD no recupero un rostro.")
            return SimpleNamespace(
                matched=True,
                person=person,
                candidates=[person],
                similarity=0.76,
                margin=0.12,
            )

    runtime._engine = RedetectingEngine()
    persisted = []
    monkeypatch.setattr(runtime, "_persist_known_task", persisted.append)
    item = {
        "id": 126802,
        "crop_path": str(source_path),
        "captured_at": datetime(
            2026,
            7,
            30,
            18,
            20,
            tzinfo=timezone.utc,
        ).astimezone().isoformat(),
        "camera_key": "primary",
        "det_score": 0.6813,
        "landmarks": [
            [115.78369, 89.78691],
            [147.86841, 89.48404],
            [160.48596, 105.92670],
            [136.95886, 146.46979],
            [162.50452, 146.53186],
        ],
    }

    prepared = runtime._prepare_queued_crop_batch([item])
    queued_item, loaded_image, detected, embedding_prepared = prepared[0]
    result = runtime._process_queued_crop(
        queued_item,
        image=loaded_image,
        detected=detected,
        embedding_prepared=embedding_prepared,
    )

    assert detection_calls == [(250, 217, 3)]
    assert runtime._batch_direct_embeddings == 0
    assert runtime._batch_detection_fallbacks == 1
    if redetection_succeeds:
        assert result["status"] == "processed"
        assert result["result_kind"] == "known"
        assert len(persisted) == 1
        assert "_landmark_rejection" not in queued_item
    else:
        assert result["status"] == "discarded"
        assert result["result_kind"] == "invalid_landmarks"
        assert "nose_horizontal_outlier" in result["result_name"]
        assert persisted == []

