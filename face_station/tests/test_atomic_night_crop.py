from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid5

import cv2
import numpy as np
import pytest

from face_station.app.config import ConfigManager, StationConfig
from face_station.app.face_quality import FaceQualityResult
from face_station.app.processor import StationRuntime
from face_station.app.recognition import DetectedFace
from face_station.app.store import LocalStore


def normalized(seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    value = generator.normal(size=512).astype(np.float32)
    return value / np.linalg.norm(value)


def queue_and_claim_crop(
    store: LocalStore,
    seen_at: datetime,
    filename: str,
    *,
    kind: str = "unknown",
) -> tuple[dict, Path]:
    spool_path = (
        store.spool_dir
        / seen_at.astimezone().date().isoformat()
        / "primary"
        / filename
    )
    spool_path.parent.mkdir(parents=True, exist_ok=True)
    spool_path.write_bytes(b"queued-face")
    queued = store.enqueue_crop_for_processing(
        captured_at=seen_at,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(spool_path),
        file_bytes=spool_path.stat().st_size,
        crop_width=180,
        crop_height=240,
        det_score=0.96,
        bbox=(10, 20, 190, 260),
        landmarks=np.asarray(
            [[55, 80], [130, 80], [92, 125], [65, 175], [120, 175]],
            dtype=np.float32,
        ),
    )
    claimed = store.claim_pending_crop()
    assert claimed is not None
    assert claimed["id"] == queued["id"]
    assert claimed["status"] == "processing"

    target_path = (
        store.faces_dir
        / seen_at.astimezone().date().isoformat()
        / kind
        / f"night-{queued['id']}.jpg"
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(b"persisted-face")
    return claimed, target_path.resolve()


def unknown_plan(
    *,
    seen_at: datetime,
    crop_path: Path,
    embedding: np.ndarray,
    subject_id: str = "",
    temporary_name: str = "",
    quality_pass: bool = True,
    reference_quality_pass: bool = True,
) -> dict:
    return {
        "status": "processed",
        "result_kind": "unknown",
        "subject_id": subject_id,
        "temporary_name": temporary_name,
        "embedding": embedding,
        "seen_at": seen_at,
        "crop_path": str(crop_path),
        "similarity": 0.82,
        "quality": 0.91,
        "camera": "Raspberry",
        "quality_pass": quality_pass,
        "reference_quality_pass": reference_quality_pass,
        "quality_payload": {
            "accepted": quality_pass,
            "score": 0.91,
            "reasons": [],
        },
        "analysis_version": "test-atomic-v1",
    }


def unassigned_plan(
    *,
    seen_at: datetime,
    crop_path: Path,
    embedding: np.ndarray,
    reason: str = "calidad_insuficiente",
) -> dict:
    return {
        "status": "processed",
        "result_kind": "unassigned",
        "embedding": embedding,
        "seen_at": seen_at,
        "crop_path": str(crop_path),
        "similarity": 0.51,
        "quality": 0.22,
        "det_score": 0.94,
        "camera": "Raspberry",
        "reason": reason,
        "match_metadata": {
            "reason": reason,
            "best_similarity": 0.51,
            "runner_up_similarity": 0.50,
            "margin": 0.01,
        },
        "quality_payload": {
            "accepted": False,
            "score": 0.22,
            "reasons": ["pitch"],
        },
        "analysis_version": "test-unassigned-v1",
    }


def fetch_atomic_rows(store: LocalStore, crop_id: int) -> dict:
    with store.connection() as db:
        return {
            "subjects": [
                dict(row)
                for row in db.execute(
                    """
                    select subject_id,temporary_name,status,best_crop_path,best_quality,
                           first_seen_at,last_seen_at,detection_count,quality_hits,
                           quality_version,quality_json
                    from unknown_subjects order by subject_id
                    """
                )
            ],
            "references": [
                dict(row)
                for row in db.execute(
                    """
                    select subject_id,crop_path,quality,captured_at,quality_json
                    from unknown_references order by id
                    """
                )
            ],
            "presence": [
                dict(row)
                for row in db.execute(
                    """
                    select subject_key,presence_date,subject_kind,first_seen_at,last_seen_at,
                           detection_count,best_similarity,best_crop_path,session_id
                    from daily_presence order by subject_key,presence_date,session_id
                    """
                )
            ],
            "crops": [
                dict(row)
                for row in db.execute(
                    """
                    select subject_key,subject_kind,seen_at,crop_path,similarity,quality,
                           camera,analysis_version,quality_pass,quality_json
                    from face_crops order by id
                    """
                )
            ],
            "queue": dict(
                db.execute(
                    """
                    select status,result_kind,result_key,result_name,similarity,last_error,
                           processed_at
                    from crop_processing_queue where id=?
                    """,
                    (crop_id,),
                ).fetchone()
            ),
            "counter": int(
                db.execute(
                    """
                    select next_value from local_counters
                    where counter_key='unknown_name'
                    """
                ).fetchone()["next_value"]
            ),
        }


def test_station_config_keeps_atomic_commit_opt_in_and_parses_true_values():
    assert StationConfig().night_batch_atomic_commit_enabled is False
    assert StationConfig().night_embedding_batch_size == 1
    assert StationConfig.from_dict(
        {"night_batch_atomic_commit_enabled": "true"}
    ).night_batch_atomic_commit_enabled is True
    assert StationConfig.from_dict(
        {"night_embedding_batch_size": 32}
    ).night_embedding_batch_size == 32
    with pytest.raises(ValueError, match="night_embedding_batch_size"):
        StationConfig.from_dict({"night_embedding_batch_size": 2})


def test_commit_night_crop_known_is_atomic_through_queue_finalize(tmp_path):
    store = LocalStore(tmp_path)
    seen_at = datetime(2026, 7, 26, 22, 15, tzinfo=timezone.utc).astimezone()
    starts_at = (seen_at - timedelta(minutes=10)).time().replace(microsecond=0).isoformat()
    store.replace_bootstrap(
        [
            {
                "key": "student:atomic-known",
                "type": "student",
                "id": 707,
                "name": "Alumno Atomico",
                "reference_version": "1",
            }
        ],
        [
            {
                "id": 88,
                "type": "academy_class",
                "date": seen_at.date().isoformat(),
                "starts_at": starts_at,
                "duration_minutes": 90,
                "label": "Sesion Atomica",
                "closed": False,
                "roster": ["student:atomic-known"],
            }
        ],
    )
    claimed, target_path = queue_and_claim_crop(
        store,
        seen_at,
        "known-atomic.jpg",
        kind="known",
    )
    plan = {
        "status": "processed",
        "result_kind": "known",
        "result_key": "student:atomic-known",
        "result_name": "Alumno Atomico",
        "person_key": "student:atomic-known",
        "person_type": "student",
        "person_id": 707,
        "seen_at": seen_at,
        "crop_path": str(target_path),
        "similarity": 0.88,
        "quality": 0.93,
        "camera": "Raspberry",
        "camera_id": "cancha_1",
        "source_subject_id": "",
        "station_id": "atomic-station",
    }

    with store.connection() as db:
        db.execute(
            f"""
            create trigger test_abort_known_atomic_queue_finalize
            before update of status on crop_processing_queue
            when old.id={int(claimed["id"])} and new.status='processed'
            begin
                select raise(abort,'injected known queue finalize failure');
            end
            """
        )

    with pytest.raises(
        sqlite3.IntegrityError,
        match="injected known queue finalize failure",
    ):
        store.commit_night_crop(claimed["id"], plan)

    with store.connection() as db:
        assert db.execute("select count(*) from daily_presence").fetchone()[0] == 0
        assert db.execute("select count(*) from face_crops").fetchone()[0] == 0
        assert db.execute("select count(*) from sync_queue").fetchone()[0] == 0
        queue_after_failure = db.execute(
            """
            select status,result_kind,result_key,result_name,processed_at
            from crop_processing_queue where id=?
            """,
            (claimed["id"],),
        ).fetchone()
        assert dict(queue_after_failure) == {
            "status": "processing",
            "result_kind": "",
            "result_key": "",
            "result_name": "",
            "processed_at": "",
        }
        db.execute("drop trigger test_abort_known_atomic_queue_finalize")

    outcome = store.commit_night_crop(claimed["id"], plan)

    with store.connection() as db:
        presence = dict(db.execute("select * from daily_presence").fetchone())
        crop = dict(db.execute("select * from face_crops").fetchone())
        event = dict(db.execute("select * from sync_queue").fetchone())
        queue = dict(
            db.execute(
                """
                select status,result_kind,result_key,result_name,similarity,processed_at
                from crop_processing_queue where id=?
                """,
                (claimed["id"],),
            ).fetchone()
        )

    assert outcome["queue_committed"] is True
    assert presence["subject_key"] == "student:atomic-known"
    assert presence["subject_kind"] == "known"
    assert presence["session_id"] == 88
    assert presence["detection_count"] == 1
    assert presence["best_crop_path"] == str(target_path)

    assert crop["subject_key"] == "student:atomic-known"
    assert crop["subject_kind"] == "known"
    assert crop["crop_path"] == str(target_path)
    assert crop["camera"] == "Raspberry"

    assert event["event_id"] == str(
        uuid5(
            NAMESPACE_URL,
            (
                "futsi:atomic-station:student:atomic-known:"
                f"{seen_at.date().isoformat()}:88"
            ),
        )
    )
    assert event["event_type"] == "known_event"
    assert event["status"] == "pending"
    payload = json.loads(event["payload_json"])
    assert payload["person_key"] == "student:atomic-known"
    assert payload["person_id"] == 707
    assert payload["presence_date"] == seen_at.date().isoformat()
    assert payload["session_id"] == 88

    assert queue["status"] == "processed"
    assert queue["result_kind"] == "known"
    assert queue["result_key"] == "student:atomic-known"
    assert queue["result_name"] == "Alumno Atomico"
    assert queue["similarity"] == pytest.approx(0.88)
    assert queue["processed_at"]
    summary = store.crop_queue_summary(seen_at.date().isoformat())
    assert summary["processing"] == 0
    assert summary["processed"] == 1
    replay = store.commit_night_crop(claimed["id"], plan)
    assert replay["already_committed"] is True
    assert replay["queue_committed"] is True
    with store.connection() as db:
        assert db.execute("select count(*) from daily_presence").fetchone()[0] == 1
        assert db.execute("select detection_count from daily_presence").fetchone()[0] == 1
        assert db.execute("select count(*) from face_crops").fetchone()[0] == 1
        assert db.execute("select count(*) from sync_queue").fetchone()[0] == 1


def test_disabled_atomic_flag_keeps_known_night_result_on_legacy_path(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    runtime = StationRuntime(manager)
    runtime._begin_manual_batch()
    assert manager.config.night_batch_atomic_commit_enabled is False
    assert runtime._batch_atomic_commit_active is False

    seen_at = datetime(2026, 7, 26, 22, 45, tzinfo=timezone.utc).astimezone()
    source_path = tmp_path / "legacy-known.jpg"
    assert cv2.imwrite(
        str(source_path),
        np.full((120, 120, 3), 180, dtype=np.uint8),
    )
    person = {
        "person_key": "student:legacy-known",
        "person_type": "student",
        "remote_id": 808,
        "name": "Alumno Legacy",
    }
    match = SimpleNamespace(
        matched=True,
        person=person,
        candidates=[person],
        similarity=0.87,
    )
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: match)
    monkeypatch.setattr(
        runtime,
        "_embedding_from_queued_crop",
        lambda _item, _image: DetectedFace(
            bbox=(0, 0, 120, 120),
            embedding=normalized(401),
            score=0.96,
            quality=0.90,
        ),
    )
    persisted = []
    monkeypatch.setattr(runtime, "_persist_known_task", persisted.append)

    def unexpected_atomic_path(*_args, **_kwargs):
        raise AssertionError("La bandera apagada no debe usar el commit atomico.")

    monkeypatch.setattr(
        runtime,
        "_persist_known_night_task_atomic",
        unexpected_atomic_path,
    )

    result = runtime._process_queued_crop(
        {
            "id": 1,
            "crop_path": str(source_path),
            "captured_at": seen_at.isoformat(),
            "camera_key": "primary",
        }
    )

    assert len(persisted) == 1
    assert persisted[0].kind == "known"
    assert persisted[0].subject_key == "student:legacy-known"
    assert result == {
        "status": "processed",
        "result_kind": "known",
        "result_key": "student:legacy-known",
        "result_name": "Alumno Legacy",
        "similarity": 0.87,
    }


def test_enabled_atomic_flag_commits_unknown_through_processor(tmp_path, monkeypatch):
    manager = ConfigManager(tmp_path)
    manager.update({"night_batch_atomic_commit_enabled": True})
    runtime = StationRuntime(manager)
    runtime._camera_labels = {"primary": "Raspberry"}
    runtime._camera_ids = {"primary": "cancha_1"}
    runtime._begin_manual_batch()
    assert runtime._batch_atomic_commit_active is True

    seen_at = datetime(2026, 7, 26, 22, 55, tzinfo=timezone.utc).astimezone()
    source_path = runtime.store.spool_dir / "atomic-processor-unknown.jpg"
    assert cv2.imwrite(
        str(source_path),
        np.full((160, 160, 3), 190, dtype=np.uint8),
    )
    queued = runtime.store.enqueue_crop_for_processing(
        captured_at=seen_at,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(source_path),
        file_bytes=source_path.stat().st_size,
        crop_width=160,
        crop_height=160,
        det_score=0.94,
        bbox=(0, 0, 160, 160),
        landmarks=[],
    )
    claimed = runtime.store.claim_pending_crop()
    assert claimed and claimed["id"] == queued["id"]

    detected_embedding = normalized(501)
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: None)
    monkeypatch.setattr(
        runtime,
        "_embedding_from_queued_crop",
        lambda _item, _image: DetectedFace(
            bbox=(0, 0, 160, 160),
            embedding=detected_embedding,
            score=0.94,
            quality=0.90,
        ),
    )
    monkeypatch.setattr(
        runtime,
        "_match_persistent_unknown",
        lambda _embedding: (None, 0.0, None),
    )
    monkeypatch.setattr(
        runtime,
        "_match_batch_candidate",
        lambda _embedding, _seen_at: (None, 0.0),
    )

    result = runtime._process_queued_crop(claimed)

    assert result["status"] == "processed"
    assert result["result_kind"] == "unknown"
    assert result["queue_committed"] is True
    queue_result = runtime.store.crop_processing_result(claimed["id"])
    assert queue_result and queue_result["status"] == "processed"
    assert queue_result["result_key"] == result["result_key"]
    with runtime.store.connection() as db:
        assert db.execute("select count(*) from unknown_subjects").fetchone()[0] == 1
        assert db.execute("select count(*) from unknown_references").fetchone()[0] == 1
        assert db.execute("select count(*) from daily_presence").fetchone()[0] == 1
        assert db.execute("select count(*) from face_crops").fetchone()[0] == 1


@pytest.mark.parametrize(
    ("persistent_result", "accepted", "expected_reason"),
    [
        (
            (
                None,
                0.57,
                {
                    "reason": "ambiguous_margin",
                    "best_similarity": 0.57,
                    "runner_up_similarity": 0.56,
                    "margin": 0.01,
                },
            ),
            True,
            "margen_ambiguo",
        ),
        ((None, 0.0, {"reason": "below_threshold"}), False, "calidad_insuficiente"),
    ],
)
def test_processor_keeps_ambiguous_or_low_quality_crop_unassigned(
    tmp_path,
    monkeypatch,
    persistent_result,
    accepted,
    expected_reason,
):
    manager = ConfigManager(tmp_path)
    manager.update({"night_batch_atomic_commit_enabled": True})
    runtime = StationRuntime(manager)
    runtime._camera_labels = {"primary": "Raspberry"}
    runtime._begin_manual_batch()
    seen_at = datetime(2026, 7, 26, 23, 0, tzinfo=timezone.utc).astimezone()
    source_path = runtime.store.spool_dir / f"{expected_reason}.jpg"
    assert cv2.imwrite(
        str(source_path),
        np.full((180, 180, 3), 175, dtype=np.uint8),
    )
    queued = runtime.store.enqueue_crop_for_processing(
        captured_at=seen_at,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(source_path),
        file_bytes=source_path.stat().st_size,
        crop_width=180,
        crop_height=180,
        det_score=0.96,
        bbox=(0, 0, 180, 180),
        landmarks=[],
    )
    claimed = runtime.store.claim_pending_crop()
    assert claimed and claimed["id"] == queued["id"]
    embedding = normalized(520 if accepted else 521)
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: None)
    monkeypatch.setattr(
        runtime,
        "_embedding_from_queued_crop",
        lambda _item, _image: DetectedFace(
            bbox=(0, 0, 180, 180),
            embedding=embedding,
            score=0.96,
            quality=0.92,
        ),
    )
    monkeypatch.setattr(
        runtime,
        "_match_persistent_unknown",
        lambda _embedding: persistent_result,
    )
    candidate_calls = []

    def match_candidate(_embedding, _seen_at):
        candidate_calls.append(True)
        return None, 0.0

    monkeypatch.setattr(runtime, "_match_batch_candidate", match_candidate)

    class CountingQuality:
        calls = 0

        def analyze(self, _image):
            self.calls += 1
            return FaceQualityResult(
                accepted,
                0.88 if accepted else 0.20,
                () if accepted else ("pitch",),
            )

    quality = CountingQuality()
    runtime._quality_evaluator = quality
    with runtime.store.connection() as db:
        counter_before = int(
            db.execute(
                """
                select next_value from local_counters
                where counter_key='unknown_name'
                """
            ).fetchone()[0]
        )

    runtime._process_claimed_queued_crop(claimed, manual_run=True)

    queue = runtime.store.crop_processing_result(claimed["id"])
    with runtime.store.connection() as db:
        unassigned = dict(db.execute("select * from unassigned_crops").fetchone())
        assert db.execute("select count(*) from unknown_subjects").fetchone()[0] == 0
        assert db.execute("select count(*) from daily_presence").fetchone()[0] == 0
        assert db.execute("select count(*) from face_crops").fetchone()[0] == 0
        next_value = int(
            db.execute(
                """
                select next_value from local_counters
                where counter_key='unknown_name'
                """
            ).fetchone()[0]
        )
    assert queue and queue["status"] == "processed"
    assert queue["result_kind"] == "unassigned"
    assert unassigned["reason"] == expected_reason
    assert Path(unassigned["crop_path"]).is_file()
    assert source_path.is_file()
    assert quality.calls == 1
    assert next_value == counter_before
    assert candidate_calls == ([] if accepted else [True])


def test_clear_existing_match_with_bad_crop_assigns_without_new_reference(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update({"night_batch_atomic_commit_enabled": True})
    runtime = StationRuntime(manager)
    runtime._camera_labels = {"primary": "Raspberry"}
    runtime._begin_manual_batch()
    seen_at = datetime(2026, 7, 26, 23, 5, tzinfo=timezone.utc).astimezone()
    anchor = normalized(530)
    subject = runtime.store.create_unknown(
        anchor,
        seen_at - timedelta(minutes=1),
        str(tmp_path / "trusted.jpg"),
        0.92,
        subject_id="trusted-existing",
        temporary_name="Desconocido Confiable",
        quality_pass=True,
        quality_payload={"accepted": True},
    )
    source_path = runtime.store.spool_dir / "existing-low-quality.jpg"
    assert cv2.imwrite(
        str(source_path),
        np.full((180, 180, 3), 160, dtype=np.uint8),
    )
    runtime.store.enqueue_crop_for_processing(
        captured_at=seen_at,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(source_path),
        file_bytes=source_path.stat().st_size,
        crop_width=180,
        crop_height=180,
        det_score=0.95,
        bbox=(0, 0, 180, 180),
        landmarks=[],
    )
    claimed = runtime.store.claim_pending_crop()
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: None)
    monkeypatch.setattr(
        runtime,
        "_embedding_from_queued_crop",
        lambda _item, _image: DetectedFace(
            bbox=(0, 0, 180, 180),
            embedding=anchor,
            score=0.95,
            quality=0.90,
        ),
    )
    monkeypatch.setattr(
        runtime,
        "_match_persistent_unknown",
        lambda _embedding: (
            dict(subject),
            0.91,
            {"reason": "accepted", "best_similarity": 0.91, "margin": 0.20},
        ),
    )

    class RejectedQuality:
        @staticmethod
        def analyze(_image):
            return FaceQualityResult(False, 0.18, ("pitch",))

    runtime._quality_evaluator = RejectedQuality()
    before_references = runtime.store.unknown_reference_database()[0]

    runtime._process_claimed_queued_crop(claimed, manual_run=True)

    queue = runtime.store.crop_processing_result(claimed["id"])
    after_references = runtime.store.unknown_reference_database()[0]
    with runtime.store.connection() as db:
        crop = dict(db.execute("select * from face_crops").fetchone())
        assert db.execute("select count(*) from unassigned_crops").fetchone()[0] == 0
        assert db.execute("select count(*) from unknown_subjects").fetchone()[0] == 1
    assert queue and queue["result_kind"] == "unknown"
    assert queue["result_key"] == subject["subject_id"]
    assert len(after_references) == len(before_references)
    assert crop["quality_pass"] == 0
    assert subject["subject_id"] not in runtime._batch_candidates
    assert subject["subject_id"] not in runtime._batch_recent_unknowns
    assert not source_path.exists()


def test_profile_match_accepted_by_gallery_records_attendance_without_reference(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update({"night_batch_atomic_commit_enabled": True})
    runtime = StationRuntime(manager)
    runtime._camera_labels = {"primary": "Raspberry"}
    runtime._begin_manual_batch()
    seen_at = datetime(2026, 7, 26, 23, 8, tzinfo=timezone.utc).astimezone()
    anchor = normalized(540)
    subject = runtime.store.create_unknown(
        anchor,
        seen_at - timedelta(days=1),
        str(tmp_path / "trusted-frontal.jpg"),
        0.92,
        subject_id="trusted-profile-target",
        temporary_name="Desconocido Confiable",
        quality_pass=True,
        quality_payload={"accepted": True},
    )
    source_path = runtime.store.spool_dir / "profile-below-eighty.jpg"
    assert cv2.imwrite(
        str(source_path),
        np.full((180, 180, 3), 160, dtype=np.uint8),
    )
    runtime.store.enqueue_crop_for_processing(
        captured_at=seen_at,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(source_path),
        file_bytes=source_path.stat().st_size,
        crop_width=180,
        crop_height=180,
        det_score=0.95,
        bbox=(0, 0, 180, 180),
        landmarks=[],
    )
    claimed = runtime.store.claim_pending_crop()
    runtime._engine = SimpleNamespace(match_known=lambda _embedding: None)
    monkeypatch.setattr(
        runtime,
        "_embedding_from_queued_crop",
        lambda _item, _image: DetectedFace(
            bbox=(0, 0, 180, 180),
            embedding=anchor,
            score=0.95,
            quality=0.90,
        ),
    )
    monkeypatch.setattr(
        runtime,
        "_match_persistent_unknown",
        lambda _embedding: (
            dict(subject),
            0.74,
            {"reason": "accepted", "best_similarity": 0.74, "margin": 0.12},
        ),
    )

    class ProfileQuality:
        @staticmethod
        def analyze(_image):
            return FaceQualityResult(
                False,
                0.36,
                ("rostro_de_lado",),
                yaw=43.0,
            )

    runtime._quality_evaluator = ProfileQuality()
    before_references = runtime.store.unknown_reference_database()[0]

    runtime._process_claimed_queued_crop(claimed, manual_run=True)

    queue = runtime.store.crop_processing_result(claimed["id"])
    after_references = runtime.store.unknown_reference_database()[0]
    with runtime.store.connection() as db:
        crop = dict(
            db.execute(
                "select * from face_crops where subject_key=?",
                (subject["subject_id"],),
            ).fetchone()
        )
        presence = dict(
            db.execute(
                """
                select * from daily_presence
                where subject_key=? and presence_date=?
                """,
                (subject["subject_id"], seen_at.date().isoformat()),
            ).fetchone()
        )
        unassigned_count = db.execute(
            "select count(*) from unassigned_crops",
        ).fetchone()[0]
        crop_count = db.execute(
            "select count(*) from face_crops where subject_key=?",
            (subject["subject_id"],),
        ).fetchone()[0]
    assert queue and queue["result_kind"] == "unknown"
    assert queue["result_key"] == subject["subject_id"]
    assert unassigned_count == 0
    assert crop_count == 1
    assert crop["quality_pass"] == 0
    assert presence["detection_count"] == 1
    assert float(presence["best_similarity"]) == pytest.approx(0.74)
    assert len(after_references) == len(before_references)
    assert runtime.store.get_unknown(subject["subject_id"])["detection_count"] == 2


def test_commit_night_crop_atomically_creates_consolidated_unknown(tmp_path):
    store = LocalStore(tmp_path)
    seen_at = datetime(2026, 7, 26, 23, 10, tzinfo=timezone.utc).astimezone()
    claimed, target_path = queue_and_claim_crop(store, seen_at, "new-unknown.jpg")
    plan = unknown_plan(
        seen_at=seen_at,
        crop_path=target_path,
        embedding=normalized(101),
    )

    store.commit_night_crop(claimed["id"], plan)

    rows = fetch_atomic_rows(store, claimed["id"])
    assert len(rows["subjects"]) == 1
    subject = rows["subjects"][0]
    assert subject["temporary_name"] == "Desconocido 10000"
    assert subject["status"] == "consolidated"
    assert subject["detection_count"] == 1
    assert subject["quality_hits"] == 1
    assert subject["best_crop_path"] == str(target_path)
    assert subject["quality_version"] == "test-atomic-v1"

    assert len(rows["references"]) == 1
    assert rows["references"][0]["subject_id"] == subject["subject_id"]
    assert rows["references"][0]["crop_path"] == str(target_path)

    assert len(rows["presence"]) == 1
    presence = rows["presence"][0]
    assert presence["subject_key"] == subject["subject_id"]
    assert presence["subject_kind"] == "unknown"
    assert presence["detection_count"] == 1
    assert presence["best_crop_path"] == str(target_path)

    assert len(rows["crops"]) == 1
    crop = rows["crops"][0]
    assert crop["subject_key"] == subject["subject_id"]
    assert crop["subject_kind"] == "unknown"
    assert crop["crop_path"] == str(target_path)
    assert crop["quality_pass"] == 1
    assert crop["analysis_version"] == "test-atomic-v1"

    assert rows["queue"]["status"] == "processed"
    assert rows["queue"]["result_kind"] == "unknown"
    assert rows["queue"]["result_key"] == subject["subject_id"]
    assert rows["queue"]["result_name"] == subject["temporary_name"]
    assert rows["queue"]["processed_at"]
    assert store.crop_queue_summary(seen_at.date().isoformat())["processing"] == 0
    assert store.crop_queue_summary(seen_at.date().isoformat())["processed"] == 1

    replay = store.commit_night_crop(claimed["id"], plan)

    assert replay["already_committed"] is True
    assert fetch_atomic_rows(store, claimed["id"]) == rows


def test_commit_night_crop_atomically_preserves_unassigned_without_identity(tmp_path):
    store = LocalStore(tmp_path)
    seen_at = datetime(2026, 7, 26, 23, 12, tzinfo=timezone.utc).astimezone()
    claimed, target_path = queue_and_claim_crop(
        store,
        seen_at,
        "unassigned-quality.jpg",
        kind="unassigned",
    )
    plan = unassigned_plan(
        seen_at=seen_at,
        crop_path=target_path,
        embedding=normalized(111),
    )
    counter_before = fetch_atomic_rows(store, claimed["id"])["counter"]

    outcome = store.commit_night_crop(claimed["id"], plan)

    with store.connection() as db:
        unassigned = dict(db.execute("select * from unassigned_crops").fetchone())
        assert db.execute("select count(*) from unknown_subjects").fetchone()[0] == 0
        assert db.execute("select count(*) from unknown_references").fetchone()[0] == 0
        assert db.execute("select count(*) from daily_presence").fetchone()[0] == 0
        assert db.execute("select count(*) from face_crops").fetchone()[0] == 0
    queue = store.crop_processing_result(claimed["id"])

    assert outcome["result_kind"] == "unassigned"
    assert outcome["result_key"] == f"unassigned:{unassigned['id']}"
    assert queue and queue["status"] == "processed"
    assert queue["result_kind"] == "unassigned"
    assert queue["result_key"] == outcome["result_key"]
    assert unassigned["queue_crop_id"] == claimed["id"]
    assert unassigned["status"] == "pending"
    assert unassigned["reason"] == "calidad_insuficiente"
    assert unassigned["crop_path"] == str(target_path)
    assert json.loads(unassigned["match_json"])["margin"] == pytest.approx(0.01)
    assert store.unassigned_crop_image_path(unassigned["id"]) == target_path
    assert store.unassigned_summary() == {
        "total": 1,
        "pending": 1,
        "resolved": 0,
        "discarded": 0,
        "low_quality": 1,
        "ambiguous": 0,
    }
    assert fetch_atomic_rows(store, claimed["id"])["counter"] == counter_before

    replay = store.commit_night_crop(claimed["id"], plan)
    assert replay["already_committed"] is True
    with store.connection() as db:
        assert db.execute("select count(*) from unassigned_crops").fetchone()[0] == 1


def test_unassigned_commit_rolls_back_if_queue_finalize_fails(tmp_path):
    store = LocalStore(tmp_path)
    seen_at = datetime(2026, 7, 26, 23, 14, tzinfo=timezone.utc).astimezone()
    claimed, target_path = queue_and_claim_crop(
        store,
        seen_at,
        "unassigned-rollback.jpg",
        kind="unassigned",
    )
    plan = unassigned_plan(
        seen_at=seen_at,
        crop_path=target_path,
        embedding=normalized(112),
        reason="margen_ambiguo",
    )
    with store.connection() as db:
        db.execute(
            f"""
            create trigger test_abort_unassigned_queue_finalize
            before update of status on crop_processing_queue
            when old.id={int(claimed["id"])} and new.status='processed'
            begin
                select raise(abort,'injected unassigned queue finalize failure');
            end
            """
        )

    with pytest.raises(
        sqlite3.IntegrityError,
        match="injected unassigned queue finalize failure",
    ):
        store.commit_night_crop(claimed["id"], plan)

    with store.connection() as db:
        assert db.execute("select count(*) from unassigned_crops").fetchone()[0] == 0
        queue = dict(
            db.execute(
                """
                select status,result_kind,result_key,result_name,processed_at
                from crop_processing_queue where id=?
                """,
                (claimed["id"],),
            ).fetchone()
        )
    assert queue == {
        "status": "processing",
        "result_kind": "",
        "result_key": "",
        "result_name": "",
        "processed_at": "",
    }


def test_commit_night_crop_atomically_promotes_candidate_and_backfills_presence(tmp_path):
    store = LocalStore(tmp_path)
    first_seen = datetime(2026, 7, 26, 21, 0, tzinfo=timezone.utc).astimezone()
    subject_id = "atomic-existing-candidate"
    temporary_name = "Desconocido QA atomico"
    store.create_unknown(
        normalized(201),
        first_seen,
        "",
        0.40,
        subject_id=subject_id,
        temporary_name=temporary_name,
        quality_pass=False,
    )
    seen_at = first_seen + timedelta(minutes=15)
    claimed, target_path = queue_and_claim_crop(store, seen_at, "promoted-unknown.jpg")

    store.commit_night_crop(
        claimed["id"],
        unknown_plan(
            seen_at=seen_at,
            crop_path=target_path,
            embedding=normalized(202),
            subject_id=subject_id,
            temporary_name=temporary_name,
        ),
    )

    rows = fetch_atomic_rows(store, claimed["id"])
    assert len(rows["subjects"]) == 1
    subject = rows["subjects"][0]
    assert subject["subject_id"] == subject_id
    assert subject["status"] == "consolidated"
    assert subject["detection_count"] == 2
    assert subject["quality_hits"] == 1
    assert subject["first_seen_at"] == first_seen.isoformat()
    assert subject["last_seen_at"] == seen_at.isoformat()

    assert len(rows["references"]) == 1
    assert rows["references"][0]["subject_id"] == subject_id
    assert len(rows["presence"]) == 1
    presence = rows["presence"][0]
    assert presence["subject_key"] == subject_id
    assert presence["first_seen_at"] == first_seen.isoformat()
    assert presence["last_seen_at"] == seen_at.isoformat()
    assert presence["detection_count"] == 2

    assert len(rows["crops"]) == 1
    assert rows["crops"][0]["subject_key"] == subject_id
    assert rows["queue"]["status"] == "processed"
    assert rows["queue"]["result_key"] == subject_id
    assert rows["queue"]["result_name"] == temporary_name


def test_commit_night_crop_rolls_back_every_table_when_queue_finalize_fails(tmp_path):
    store = LocalStore(tmp_path)
    seen_at = datetime(2026, 7, 26, 22, 30, tzinfo=timezone.utc).astimezone()
    claimed, target_path = queue_and_claim_crop(store, seen_at, "rollback-unknown.jpg")
    plan = unknown_plan(
        seen_at=seen_at,
        crop_path=target_path,
        embedding=normalized(301),
    )
    before = fetch_atomic_rows(store, claimed["id"])

    with store.connection() as db:
        db.execute(
            f"""
            create trigger test_abort_atomic_queue_finalize
            before update of status on crop_processing_queue
            when old.id={int(claimed["id"])} and new.status='processed'
            begin
                select raise(abort,'injected queue finalize failure');
            end
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="injected queue finalize failure"):
        store.commit_night_crop(claimed["id"], plan)

    after_failure = fetch_atomic_rows(store, claimed["id"])
    assert after_failure == before
    assert after_failure["subjects"] == []
    assert after_failure["references"] == []
    assert after_failure["presence"] == []
    assert after_failure["crops"] == []
    assert after_failure["queue"]["status"] == "processing"
    assert after_failure["queue"]["result_kind"] == ""
    assert after_failure["queue"]["result_key"] == ""
    assert after_failure["queue"]["processed_at"] == ""
    failed_summary = store.crop_queue_summary(seen_at.date().isoformat())
    assert failed_summary["processing"] == 1
    assert failed_summary["processed"] == 0

    with store.connection() as db:
        db.execute("drop trigger test_abort_atomic_queue_finalize")

    store.commit_night_crop(claimed["id"], plan)

    after_retry = fetch_atomic_rows(store, claimed["id"])
    assert len(after_retry["subjects"]) == 1
    assert len(after_retry["references"]) == 1
    assert len(after_retry["presence"]) == 1
    assert len(after_retry["crops"]) == 1
    assert after_retry["queue"]["status"] == "processed"
    assert after_retry["counter"] == before["counter"] + 1
    retried_summary = store.crop_queue_summary(seen_at.date().isoformat())
    assert retried_summary["processing"] == 0
    assert retried_summary["processed"] == 1
