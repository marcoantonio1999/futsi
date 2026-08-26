from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pytest

from face_station.app.config import ConfigManager
from face_station.app.processor import PersistenceTask, StationRuntime
from face_station.app.recognition import DetectedFace


def normalized(seed: int) -> np.ndarray:
    value = np.random.default_rng(seed).normal(size=512).astype(np.float32)
    return value / np.linalg.norm(value)


def known_task(
    *,
    similarity: float = 0.82,
    match_margin: float = 0.12,
    source_subject_id: str = "",
) -> PersistenceTask:
    return PersistenceTask(
        kind="known",
        subject_key="student:adaptive",
        observed_at=datetime(2026, 7, 27, 12, 30, tzinfo=timezone.utc).astimezone(),
        crop=np.full((120, 100, 3), 180, dtype=np.uint8),
        similarity=similarity,
        detected_quality=0.96,
        camera_key="primary",
        match_margin=match_margin,
        embedding=normalized(1),
        person={
            "person_key": "student:adaptive",
            "person_type": "student",
            "remote_id": 101,
            "name": "Alumno Adaptativo",
        },
        source_subject_id=source_subject_id,
        quality_pass=True,
        quality_score=0.91,
        quality_payload={"accepted": True, "score": 0.91},
        analysis_version="test-quality-v1",
    )


@pytest.mark.parametrize(
    ("similarity", "margin", "source_subject_id", "expected_reference"),
    [
        (0.82, 0.12, "", True),
        (0.82, 0.02, "", False),
        (0.40, 0.00, "unknown-linked", True),
    ],
)
def test_known_evidence_is_always_recorded_but_only_safe_crop_improves_gallery(
    tmp_path,
    monkeypatch,
    similarity,
    margin,
    source_subject_id,
    expected_reference,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    persisted_evidence: list[tuple[tuple, dict]] = []
    adaptive_references: list[tuple] = []
    reloaded: list[bool] = []
    saved_path = tmp_path / "known-evidence.jpg"

    monkeypatch.setattr(
        "face_station.app.processor.save_crop_image",
        lambda *_args, **_kwargs: str(saved_path),
    )
    monkeypatch.setattr(
        runtime.store,
        "upsert_presence",
        lambda *_args, **_kwargs: {
            "presence_date": "2026-07-27",
            "session_id": -1,
            "first_seen_at": "2026-07-27T12:30:00+00:00",
            "detection_count": 1,
        },
    )
    monkeypatch.setattr(
        runtime.store,
        "record_crop",
        lambda *args, **kwargs: persisted_evidence.append((args, kwargs)) or True,
    )
    monkeypatch.setattr(runtime.store, "queue_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        runtime.store,
        "save_known_observation_reference",
        lambda *args, **_kwargs: adaptive_references.append(args) or {
            "retained": True,
            "reference_count": 2,
        },
    )
    monkeypatch.setattr(
        runtime,
        "_reload_known_database",
        lambda: reloaded.append(True),
    )
    monkeypatch.setattr(runtime, "_record_recent", lambda *_args, **_kwargs: None)

    runtime._persist_known_task(
        known_task(
            similarity=similarity,
            match_margin=margin,
            source_subject_id=source_subject_id,
        )
    )

    assert len(persisted_evidence) == 1
    _, evidence_kwargs = persisted_evidence[0]
    assert evidence_kwargs["quality_pass"] is True
    assert evidence_kwargs["analysis_version"] == "test-quality-v1"
    assert len(adaptive_references) == int(expected_reference)
    assert len(reloaded) == int(expected_reference)


@pytest.mark.parametrize(
    ("similarity", "reference_validated", "expected_reference"),
    [
        (0.78, True, True),
        (0.59, True, False),
        (0.92, False, False),
    ],
)
def test_existing_unknown_requires_accepted_strict_match_to_add_reference(
    tmp_path,
    monkeypatch,
    similarity,
    reference_validated,
    expected_reference,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    reference_flags: list[bool] = []
    saved_path = tmp_path / "unknown-evidence.jpg"
    subject = {
        "subject_id": "unknown-adaptive",
        "temporary_name": "Desconocido Adaptativo",
        "status": "consolidated",
        "best_crop_path": str(saved_path),
        "detection_count": 8,
        "daily_detection_count": 2,
    }

    monkeypatch.setattr(
        "face_station.app.processor.save_crop_image",
        lambda *_args, **_kwargs: str(saved_path),
    )
    monkeypatch.setattr(runtime.store, "get_unknown", lambda _key: dict(subject))

    def update_unknown(*_args, **kwargs):
        reference_flags.append(bool(kwargs["quality_pass"]))
        return dict(subject)

    monkeypatch.setattr(runtime.store, "update_unknown", update_unknown)
    monkeypatch.setattr(runtime.store, "record_crop", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(runtime, "_record_recent", lambda *_args, **_kwargs: None)

    persisted = runtime._persist_unknown_task(
        PersistenceTask(
            kind="unknown",
            subject_key=subject["subject_id"],
            observed_at=datetime(
                2026,
                7,
                27,
                13,
                0,
                tzinfo=timezone.utc,
            ).astimezone(),
            crop=np.full((120, 100, 3), 180, dtype=np.uint8),
            similarity=similarity,
            detected_quality=0.96,
            camera_key="primary",
            embedding=normalized(2),
            subject=dict(subject),
            reference_validated=reference_validated,
            quality_pass=True,
            quality_score=0.91,
            quality_payload={"accepted": True, "score": 0.91},
            analysis_version="test-quality-v1",
        )
    )

    assert persisted is True
    assert reference_flags == [expected_reference]


def test_night_known_plan_contains_embedding_quality_and_safe_reference_flag(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    captured_plans: list[dict] = []
    saved_path = tmp_path / "known-night.jpg"

    monkeypatch.setattr(
        "face_station.app.processor.save_crop_image",
        lambda *_args, **_kwargs: str(saved_path),
    )

    def commit(_crop_id, plan, _created_crop_path=""):
        captured_plans.append(plan)
        return {
            "status": "processed",
            "result_kind": "known",
            "presence": {"detection_count": 1},
        }

    monkeypatch.setattr(runtime, "_commit_atomic_night_plan", commit)
    monkeypatch.setattr(
        runtime,
        "_record_recent_after_atomic_commit",
        lambda *_args, **_kwargs: None,
    )

    task = known_task(similarity=0.84, match_margin=0.11)
    runtime._persist_known_night_task_atomic(77, task)

    assert len(captured_plans) == 1
    plan = captured_plans[0]
    assert np.array_equal(plan["embedding"], task.embedding)
    assert plan["quality_pass"] is True
    assert plan["reference_quality_pass"] is True
    assert plan["quality"] == pytest.approx(0.91)
    assert plan["analysis_version"] == "test-quality-v1"


def test_queued_known_match_propagates_match_margin(tmp_path, monkeypatch):
    runtime = StationRuntime(ConfigManager(tmp_path))
    person = {
        "person_key": "student:adaptive",
        "person_type": "student",
        "remote_id": 101,
        "name": "Alumno Adaptativo",
    }
    runtime._engine = SimpleNamespace(
        match_known=lambda _embedding: SimpleNamespace(
            matched=True,
            person=person,
            candidates=[person],
            similarity=0.83,
            margin=0.17,
        )
    )
    monkeypatch.setattr(runtime.store, "find_session", lambda *_args: None)
    persisted: list[PersistenceTask] = []
    monkeypatch.setattr(runtime, "_persist_known_task", persisted.append)
    image = np.full((100, 100, 3), 180, dtype=np.uint8)
    detected = DetectedFace(
        bbox=(0, 0, 100, 100),
        embedding=normalized(3),
        score=0.96,
        quality=0.90,
    )

    result = runtime._process_queued_crop(
        {
            "id": 9,
            "crop_path": str(tmp_path / "queued.jpg"),
            "captured_at": datetime(
                2026,
                7,
                27,
                14,
                0,
                tzinfo=timezone.utc,
            ).astimezone().isoformat(),
            "camera_key": "primary",
        },
        image=image,
        detected=detected,
        embedding_prepared=True,
    )

    assert result["result_kind"] == "known"
    assert len(persisted) == 1
    assert persisted[0].match_margin == pytest.approx(0.17)
    assert np.array_equal(persisted[0].embedding, detected.embedding)


def test_reload_known_database_publishes_all_curated_references(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    rows = [
        {"person_key": "student:adaptive", "name": "Alumno Adaptativo"},
        {"person_key": "student:adaptive", "name": "Alumno Adaptativo"},
    ]
    matrix = np.vstack([normalized(11), normalized(12)]).astype(np.float32)
    published: list[tuple[list[dict], np.ndarray]] = []
    runtime._engine = SimpleNamespace(
        set_known_database=lambda people, embeddings: published.append(
            (people, embeddings)
        )
    )
    monkeypatch.setattr(
        runtime.store,
        "known_reference_database",
        lambda: (rows, matrix),
    )

    def unexpected_centroid_fallback():
        raise AssertionError("No debe degradarse al centroide si hay galería.")

    monkeypatch.setattr(
        runtime.store,
        "known_database",
        unexpected_centroid_fallback,
    )

    runtime._reload_known_database()

    assert len(published) == 1
    assert published[0][0] == rows
    assert np.array_equal(published[0][1], matrix)


def test_queued_unknown_match_propagates_validation_and_margin(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: None)
    subject = {
        "subject_id": "unknown-adaptive",
        "temporary_name": "Desconocido Adaptativo",
        "status": "consolidated",
        "linked_person_key": None,
    }
    monkeypatch.setattr(
        runtime,
        "_match_persistent_unknown",
        lambda _embedding: (
            subject,
            0.81,
            {"matched": True, "reason": "matched", "margin": 0.19},
        ),
    )
    persisted: list[PersistenceTask] = []
    monkeypatch.setattr(
        runtime,
        "_persist_unknown_task",
        lambda task: persisted.append(task) or True,
    )
    monkeypatch.setattr(
        runtime,
        "_apply_batch_unknown_result",
        lambda *_args, **_kwargs: None,
    )
    detected = DetectedFace(
        bbox=(0, 0, 100, 100),
        embedding=normalized(13),
        score=0.96,
        quality=0.90,
    )

    result = runtime._process_queued_crop(
        {
            "id": 10,
            "crop_path": str(tmp_path / "queued-unknown.jpg"),
            "captured_at": datetime(
                2026,
                7,
                27,
                14,
                10,
                tzinfo=timezone.utc,
            ).astimezone().isoformat(),
            "camera_key": "primary",
        },
        image=np.full((100, 100, 3), 180, dtype=np.uint8),
        detected=detected,
        embedding_prepared=True,
    )

    assert result["result_kind"] == "unknown"
    assert len(persisted) == 1
    assert persisted[0].reference_validated is True
    assert persisted[0].match_margin == pytest.approx(0.19)


def test_queued_known_match_below_reference_threshold_skips_quality_but_attends(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    person = {
        "person_key": "student:comparison-first",
        "person_type": "student",
        "remote_id": 202,
        "name": "Alumno Existente",
    }
    runtime._engine = SimpleNamespace(
        match_known=lambda _embedding: SimpleNamespace(
            matched=True,
            person=person,
            candidates=[person],
            similarity=0.58,
            margin=0.20,
        )
    )
    monkeypatch.setattr(runtime.store, "find_session", lambda *_args: None)
    monkeypatch.setattr(
        runtime,
        "_analyze_unknown_quality",
        lambda *_args, **_kwargs: pytest.fail(
            "Una coincidencia sin opcion de referencia no debe analizar calidad."
        ),
    )
    persisted: list[PersistenceTask] = []
    monkeypatch.setattr(runtime, "_persist_known_task", persisted.append)
    detected = DetectedFace(
        bbox=(0, 0, 100, 100),
        embedding=normalized(21),
        score=0.96,
        quality=0.90,
    )

    result = runtime._process_queued_crop(
        {
            "id": 21,
            "crop_path": str(tmp_path / "known-skip.jpg"),
            "captured_at": datetime(
                2026, 7, 27, 14, 20, tzinfo=timezone.utc
            ).astimezone().isoformat(),
            "camera_key": "primary",
        },
        image=np.full((100, 100, 3), 180, dtype=np.uint8),
        detected=detected,
        embedding_prepared=True,
    )

    assert result["result_kind"] == "known"
    assert len(persisted) == 1
    assert persisted[0].quality_pass is False
    assert persisted[0].quality_payload["skipped"] is True
    assert runtime._batch_quality_evaluated == 0
    assert runtime._batch_quality_skipped_ineligible == 1


def test_existing_reference_probe_evaluates_every_eligible_view(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    analyzed: list[bool] = []

    def analyze(_crop, _detected_quality):
        analyzed.append(True)
        return True, 0.92, {"accepted": True, "score": 0.92}, "quality-test"

    monkeypatch.setattr(runtime, "_analyze_unknown_quality", analyze)
    crop = np.full((120, 100, 3), 180, dtype=np.uint8)
    first = runtime._quality_for_existing_match(
        crop=crop,
        detected_quality=0.95,
        reference_eligible=True,
    )
    second = runtime._quality_for_existing_match(
        crop=crop,
        detected_quality=0.95,
        reference_eligible=True,
    )

    assert first[0] is True
    assert second[0] is True
    assert len(analyzed) == 2
    assert runtime._batch_quality_evaluated == 2
    assert runtime._batch_reference_probes == 2


def test_unmatched_crop_still_runs_full_quality_before_new_identity(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: None)
    monkeypatch.setattr(
        runtime,
        "_match_persistent_unknown",
        lambda _embedding: (None, 0.31, {"reason": "below_threshold"}),
    )
    monkeypatch.setattr(
        runtime,
        "_match_batch_candidate",
        lambda _embedding, _observed_at: (None, 0.28),
    )
    analyzed: list[bool] = []

    def analyze(_crop, _detected_quality):
        analyzed.append(True)
        return False, 0.30, {"accepted": False, "score": 0.30}, "quality-test"

    monkeypatch.setattr(runtime, "_analyze_unknown_quality", analyze)
    captured: list[dict] = []
    monkeypatch.setattr(
        runtime,
        "_persist_unassigned_night_crop",
        lambda *_args, **kwargs: captured.append(kwargs)
        or {"status": "processed", "result_kind": "unassigned"},
    )
    detected = DetectedFace(
        bbox=(0, 0, 100, 100),
        embedding=normalized(22),
        score=0.96,
        quality=0.90,
    )

    result = runtime._process_queued_crop(
        {
            "id": 22,
            "crop_path": str(tmp_path / "new-face.jpg"),
            "captured_at": datetime(
                2026, 7, 27, 15, 10, tzinfo=timezone.utc
            ).astimezone().isoformat(),
            "camera_key": "primary",
        },
        image=np.full((100, 100, 3), 180, dtype=np.uint8),
        detected=detected,
        embedding_prepared=True,
    )

    assert result["result_kind"] == "unassigned"
    assert analyzed == [True]
    assert captured[0]["reason"] == "calidad_insuficiente"
    assert runtime._batch_quality_evaluated == 1
