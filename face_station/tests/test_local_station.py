from datetime import datetime, timedelta, timezone
from uuid import uuid4

import numpy as np

from face_station.app.camera import CameraWorker
from face_station.app.config import ConfigManager
from face_station.app.recognition import FaceEngine
from face_station.app.store import LocalStore


def normalized(seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    value = generator.normal(size=512).astype(np.float32)
    return value / np.linalg.norm(value)


def test_config_is_atomic_and_blank_token_does_not_erase_secret(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({"station_token": "secret", "camera_url": "synthetic://qa", "target_fps": 5})
    manager.update({"station_token": "", "target_fps": 7})
    reloaded = ConfigManager(tmp_path)

    assert reloaded.config.station_token == "secret"
    assert reloaded.config.target_fps == 7
    assert reloaded.config.public_dict()["station_token_configured"] is True
    assert "station_token" not in reloaded.config.public_dict()


def test_store_consolidates_presence_and_marks_synced_queue(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    starts_at = (now - timedelta(minutes=10)).time().replace(microsecond=0).isoformat()
    store.replace_bootstrap(
        [{"key": "student:7", "type": "student", "id": 7, "name": "Alumno QA", "reference_version": "1"}],
        [{
            "id": 88,
            "type": "academy_class",
            "date": now.date().isoformat(),
            "starts_at": starts_at,
            "duration_minutes": 90,
            "label": "Sub-10",
            "closed": False,
            "roster": ["student:7"],
        }],
    )
    store.save_person_embedding("student:7", tmp_path / "reference.jpg", normalized(1))
    first = store.upsert_presence("student:7", "known", now, 0.72)
    second = store.upsert_presence("student:7", "known", now + timedelta(seconds=2), 0.75)
    event_id = str(uuid4())
    store.queue_event(event_id, "known_event", {
        "event_id": event_id,
        "person_key": "student:7",
        "presence_date": first["presence_date"],
        "session_id": 88,
    })
    store.mark_queue_done([event_id])
    dashboard = store.dashboard(now.date().isoformat())

    assert first["session_id"] == 88
    assert second["detection_count"] == 2
    assert dashboard["known"][0]["synced"] == 1
    assert dashboard["known"][0]["session_label"] == "Sub-10"


def test_store_clusters_unknown_and_queues_link_only_after_confirmation(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    embedding = normalized(2)
    subject = store.create_unknown(embedding, now, "", 0.8)
    subject = store.update_unknown(subject["subject_id"], embedding, now + timedelta(seconds=3), "", 0.9, min_hits=2)

    assert subject["status"] == "consolidated"
    assert subject["detection_count"] == 2
    assert store.pending_queue("unknown_register") == []

    store.link_unknown(subject["subject_id"], "student:9", {"local_subject_id": subject["subject_id"], "events": [{}]})
    assert len(store.pending_queue("unknown_register")) == 1


def test_face_match_respects_similarity_margin(tmp_path):
    config = ConfigManager(tmp_path).config
    engine = FaceEngine(config)
    first, second = normalized(3), normalized(4)
    engine.set_known_database([{"person_key": "student:1"}, {"person_key": "student:2"}], np.vstack([first, second]))

    assert engine.match_known(first).person["person_key"] == "student:1"
    assert engine.match_known(normalized(10)).person is None


def test_synthetic_camera_keeps_latest_frame():
    worker = CameraWorker("synthetic://qa")
    worker.start()
    try:
        for _ in range(30):
            frame, captured_at = worker.latest()
            if frame is not None:
                break
            __import__("time").sleep(0.05)
        assert worker.connected is True
        assert frame is not None
        assert frame.shape == (540, 960, 3)
        assert captured_at > 0
    finally:
        worker.stop()
