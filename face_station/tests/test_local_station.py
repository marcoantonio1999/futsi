import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Queue
from threading import Event, Thread
from uuid import uuid4

import cv2
import numpy as np
import pytest
import requests

import face_station.app.processor as processor_module
from face_station.app.camera import CameraWorker
from face_station.app.config import ConfigManager
from face_station.app.face_quality import FACE_OVAL, FaceQualityEvaluator, FaceQualityResult, FaceQualityThresholds
from face_station.app.futsi_client import FutsiClient
from face_station.app.preview import save_crop
from face_station.app.processor import (
    RAW_FRAME_WORKER_COUNT,
    PersistenceTask,
    RawFrameTask,
    StationRuntime,
)
from face_station.app.recognition import DetectedFace, FaceDetector, FaceEngine
from face_station.app.reprocess_unknowns import CropAnalysis, UnknownCluster, promote_clusters
from face_station.app.store import LocalStore


def normalized(seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    value = generator.normal(size=512).astype(np.float32)
    return value / np.linalg.norm(value)


def cosine_variant(anchor: np.ndarray, seed: int, cosine: float) -> np.ndarray:
    candidate = normalized(seed)
    orthogonal = candidate - float(candidate @ anchor) * anchor
    orthogonal /= max(float(np.linalg.norm(orthogonal)), 1e-12)
    value = float(cosine) * anchor + np.sqrt(1.0 - float(cosine) ** 2) * orthogonal
    return value.astype(np.float32)


def test_config_is_atomic_and_blank_token_does_not_erase_secret(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({"station_token": "secret", "camera_url": "synthetic://qa", "target_fps": 5})
    manager.update({"station_token": "", "target_fps": 7})
    reloaded = ConfigManager(tmp_path)

    assert reloaded.config.station_token == "secret"
    assert reloaded.config.target_fps == 7
    assert reloaded.config.unknown_confirmation_threshold == pytest.approx(0.50)
    assert reloaded.config.monthly_fee_amount == pytest.approx(1000.0)
    assert reloaded.config.match_fee_amount == pytest.approx(0.0)
    assert reloaded.config.public_dict()["station_token_configured"] is True
    assert "station_token" not in reloaded.config.public_dict()

    manager.update({"monthly_fee_amount": 1250})
    assert ConfigManager(tmp_path).config.monthly_fee_amount == pytest.approx(1250.0)
    with pytest.raises(ValueError, match="monthly_fee_amount"):
        manager.update({"monthly_fee_amount": -1})

    manager.update({"match_fee_amount": 850})
    assert ConfigManager(tmp_path).config.match_fee_amount == pytest.approx(850.0)
    with pytest.raises(ValueError, match="match_fee_amount"):
        manager.update({"match_fee_amount": -1})

    with pytest.raises(ValueError, match="unknown_confirmation_threshold"):
        manager.update({"unknown_confirmation_threshold": 1.1})


def test_night_batch_time_is_normalized_and_validated(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({"night_batch_start_time": "0:30"})

    assert manager.config.night_batch_start_time == "00:30"
    with pytest.raises(ValueError, match="hora valida"):
        manager.update({"night_batch_start_time": "24:30"})


def test_async_mjpeg_config_is_reversible_and_validated(tmp_path):
    manager = ConfigManager(tmp_path)

    assert manager.config.camera_async_mjpeg_enabled is False
    assert manager.config.camera_mjpeg_decode_reduction == 4
    assert manager.config.tertiary_camera_enabled is False
    assert manager.config.tertiary_camera_async_mjpeg_enabled is True
    assert manager.config.tertiary_camera_mjpeg_decode_reduction == 2

    updated = manager.update({
        "camera_async_mjpeg_enabled": "true",
        "camera_mjpeg_decode_reduction": 2,
    })
    assert updated.camera_async_mjpeg_enabled is True
    assert updated.camera_mjpeg_decode_reduction == 2
    assert updated.public_dict()["camera_async_mjpeg_enabled"] is True
    assert updated.public_dict()["camera_mjpeg_decode_reduction"] == 2

    rolled_back = manager.update({"camera_async_mjpeg_enabled": False})
    assert rolled_back.camera_async_mjpeg_enabled is False

    with pytest.raises(ValueError, match="camera_mjpeg_decode_reduction"):
        manager.update({"camera_mjpeg_decode_reduction": 3})


def test_config_validates_horizontal_camera_roi(tmp_path):
    manager = ConfigManager(tmp_path)
    updated = manager.update({"camera_roi_left": 0.336, "camera_roi_right": 0.773})

    assert updated.camera_roi_left == pytest.approx(0.336)
    assert updated.camera_roi_right == pytest.approx(0.773)
    with pytest.raises(ValueError, match="izquierda"):
        manager.update({"camera_roi_left": 0.8, "camera_roi_right": 0.7})


def test_primary_camera_keeps_distinct_fallback_source(tmp_path):
    manager = ConfigManager(tmp_path)
    updated = manager.update({
        "camera_url": "http://192.168.1.42:8080/stream",
        "camera_fallback_url": "http://100.104.142.37:8080/stream",
    })

    assert updated.camera_url == "http://192.168.1.42:8080/stream"
    assert updated.camera_fallback_url == "http://100.104.142.37:8080/stream"
    definitions = StationRuntime._camera_definitions(updated)
    assert definitions["primary"]["source"] == updated.camera_url
    assert definitions["primary"]["fallback_source"] == updated.camera_fallback_url

    duplicate = manager.update({"camera_fallback_url": updated.camera_url})
    assert duplicate.camera_fallback_url == ""


def test_async_mjpeg_flags_are_scoped_to_each_http_camera(tmp_path):
    manager = ConfigManager(tmp_path)
    config = manager.update({
        "camera_url": "http://192.168.1.42:8080/stream",
        "camera_async_mjpeg_enabled": True,
        "camera_mjpeg_decode_reduction": 4,
        "secondary_camera_enabled": True,
        "secondary_camera_url": "rtsp://192.168.1.50:554/live",
        "tertiary_camera_enabled": True,
        "tertiary_camera_url": "http://192.168.1.44:8080/stream",
        "tertiary_camera_fallback_url": "http://100.70.80.90:8080/stream",
        "tertiary_camera_id": "raspberry_cancha_2",
        "tertiary_camera_label": "Raspberry entrada 2",
        "tertiary_camera_async_mjpeg_enabled": True,
        "tertiary_camera_mjpeg_decode_reduction": 8,
        "tertiary_camera_roi_left": 0.1,
        "tertiary_camera_roi_right": 0.9,
    })

    definitions = StationRuntime._camera_definitions(config)

    assert list(definitions) == ["primary", "secondary", "tertiary"]
    assert definitions["primary"]["async_mjpeg"] is True
    assert definitions["primary"]["mjpeg_decode_reduction"] == 4
    assert definitions["secondary"]["async_mjpeg"] is False
    assert definitions["secondary"]["mjpeg_decode_reduction"] == 1
    assert definitions["tertiary"] == {
        "source": "http://192.168.1.44:8080/stream",
        "fallback_source": "http://100.70.80.90:8080/stream",
        "camera_id": "raspberry_cancha_2",
        "label": "Raspberry entrada 2",
        "roi": [0.1, 0.9],
        "async_mjpeg": True,
        "mjpeg_decode_reduction": 8,
    }
    assert StationRuntime._camera_roi(config, "tertiary") == pytest.approx(
        (0.1, 0.9)
    )

    rtsp_primary = manager.update({
        "camera_url": "rtsp://192.168.1.51:554/live",
    })
    primary = StationRuntime._camera_definitions(rtsp_primary)["primary"]
    assert primary["async_mjpeg"] is False
    assert primary["mjpeg_decode_reduction"] == 1


def test_tertiary_camera_validation_preserves_existing_sources(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({
        "camera_url": "http://192.168.1.42:8080/stream",
        "secondary_camera_enabled": True,
        "secondary_camera_url": "rtsp://192.168.1.50:554/live",
        "tertiary_camera_enabled": True,
        "tertiary_camera_url": "http://192.168.1.44:8080/stream",
        "tertiary_camera_fallback_url": "http://100.70.80.90:8080/stream",
    })

    with pytest.raises(ValueError, match="HTTP o HTTPS"):
        manager.update({"tertiary_camera_url": "rtsp://192.168.1.44/live"})
    with pytest.raises(ValueError, match="camara distinta"):
        manager.update({"tertiary_camera_url": manager.config.camera_url})
    with pytest.raises(ValueError, match="tertiary_camera_id"):
        manager.update({"tertiary_camera_id": manager.config.camera_id})
    with pytest.raises(ValueError, match="tertiary_camera_mjpeg_decode_reduction"):
        manager.update({"tertiary_camera_mjpeg_decode_reduction": 3})
    with pytest.raises(ValueError, match="izquierda"):
        manager.update({
            "tertiary_camera_roi_left": 0.8,
            "tertiary_camera_roi_right": 0.7,
        })

    config = manager.config
    assert config.camera_url == "http://192.168.1.42:8080/stream"
    assert config.secondary_camera_url == "rtsp://192.168.1.50:554/live"
    assert config.tertiary_camera_url == "http://192.168.1.44:8080/stream"


def test_secondary_camera_credentials_stay_private_and_survive_blank_updates(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({
        "secondary_camera_enabled": True,
        "secondary_camera_url": "rtsp://192.168.1.50:554/cam/realmonitor?channel=1&subtype=1",
        "secondary_camera_username": "operator",
        "secondary_camera_password": "a private value",
    })
    manager.update({"secondary_camera_password": "", "target_fps": 4})
    config = ConfigManager(tmp_path).config

    assert config.secondary_camera_password == "a private value"
    assert "operator:a%20private%20value@" in config.secondary_camera_source()
    assert "secondary_camera_password" not in config.public_dict()
    assert config.public_dict()["secondary_camera_password_configured"] is True


def test_reference_download_falls_back_to_private_supabase_proxy(tmp_path, monkeypatch):
    client = FutsiClient("https://api.example", "station-secret", "https://project.supabase.co/functions/v1/photo")

    def unavailable_backend(*_args, **_kwargs):
        raise requests.HTTPError("backend storage unavailable")

    class ProxyResponse:
        content = b"private-photo"

        @staticmethod
        def raise_for_status():
            return None

    proxy_calls = []
    monkeypatch.setattr(client, "_request", unavailable_backend)
    monkeypatch.setattr(client.session, "post", lambda url, **kwargs: proxy_calls.append((url, kwargs)) or ProxyResponse())

    target = client.download_reference(
        {"person_key": "student:7", "person_type": "student", "remote_id": 7, "photo_url": "/private/photo/"},
        tmp_path,
    )

    assert target.read_bytes() == b"private-photo"
    assert proxy_calls[0][1]["json"] == {"person_type": "student", "person_id": 7}


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


def test_identity_catalog_groups_shared_references_and_keeps_missing_records(tmp_path):
    store = LocalStore(tmp_path)
    shared = "2026-07-01T12:00:00+00:00:supabase://private/players/9/photo.jpg"
    store.replace_bootstrap(
        [
            {"key": "player:9", "type": "player", "id": 9, "name": "Alex QA", "reference_version": shared},
            {"key": "player:10", "type": "player", "id": 10, "name": "Alex QA", "reference_version": shared.replace("12:00:00", "13:00:00")},
            {"key": "student:11", "type": "student", "id": 11, "name": "Sin Foto", "reference_version": ""},
        ],
        [],
    )
    reference = tmp_path / "alex.jpg"
    reference.write_bytes(b"reference")
    store.save_person_embedding("player:9", reference, normalized(31))

    catalog = store.identity_catalog()
    missing = store.identity_catalog(status="missing")

    assert catalog["summary"] == {
        "records": 3,
        "identities": 2,
        "ready": 1,
        "missing": 1,
        "duplicates": 1,
        "unknown_total": 0,
        "unknown_review": 0,
        "unknown_candidate": 0,
        "unknown_consolidated": 0,
        "unknown_linked": 0,
        "unknown_ignored": 0,
        "unknown_quarantined": 0,
        "unknown_archived": 0,
    }
    assert catalog["items"][0]["registration_count"] == 2
    assert catalog["items"][0]["reference_ready"] is True
    assert [row["name"] for row in missing["items"]] == ["Sin Foto"]


def test_unknown_catalog_lists_every_status_with_search_pagination_and_image_fallback(
    tmp_path,
):
    store = LocalStore(tmp_path)
    observed_at = datetime(2026, 7, 27, 14, 0, tzinfo=timezone.utc)

    def create_subject(
        subject_id: str,
        name: str,
        *,
        minutes: int,
        quality_pass: bool,
    ) -> tuple[dict, Path]:
        crop = (
            store.faces_dir
            / observed_at.date().isoformat()
            / "unknown"
            / f"{subject_id}.jpg"
        )
        crop.parent.mkdir(parents=True, exist_ok=True)
        crop.write_bytes(f"crop-{subject_id}".encode())
        seen_at = observed_at + timedelta(minutes=minutes)
        embedding = normalized(400 + minutes)
        subject = store.create_unknown(
            embedding,
            seen_at,
            str(crop),
            0.90 if quality_pass else 0.52,
            subject_id=subject_id,
            temporary_name=name,
            quality_pass=quality_pass,
            quality_payload={
                "accepted": quality_pass,
                "score": 0.90 if quality_pass else 0.52,
                "reasons": [] if quality_pass else ["pose"],
            },
            analysis_version="catalog-test-v1",
        )
        assert store.record_crop(
            subject_id,
            "unknown",
            seen_at,
            str(crop),
            0.78,
            0.90 if quality_pass else 0.52,
            "Raspberry",
            embedding=embedding,
            quality_pass=quality_pass,
        )
        return subject, crop

    candidate, candidate_crop = create_subject(
        "unknown-catalog-candidate",
        "Desconocido Perfil Auditable",
        minutes=1,
        quality_pass=False,
    )
    consolidated, consolidated_crop = create_subject(
        "unknown-catalog-consolidated",
        "Desconocido Frontal Auditado",
        minutes=2,
        quality_pass=True,
    )
    quarantined, _ = create_subject(
        "unknown-catalog-quarantined",
        "Desconocido No Valido",
        minutes=3,
        quality_pass=True,
    )
    archived, _ = create_subject(
        "unknown-catalog-archived",
        "Desconocido Fusionado",
        minutes=4,
        quality_pass=True,
    )
    with store.connection() as db:
        db.execute(
            "update unknown_subjects set status='quarantined' where subject_id=?",
            (quarantined["subject_id"],),
        )
        db.execute(
            """
            update unknown_subjects
            set status='archived',merged_into=?
            where subject_id=?
            """,
            (consolidated["subject_id"], archived["subject_id"]),
        )

    consolidated_crop.unlink()
    fallback_crop = consolidated_crop.with_name("consolidated-fallback.jpg")
    fallback_crop.write_bytes(b"fallback")
    fallback_seen_at = observed_at + timedelta(minutes=20)
    assert store.record_crop(
        consolidated["subject_id"],
        "unknown",
        fallback_seen_at,
        str(fallback_crop),
        0.76,
        0.84,
        "Raspberry",
        embedding=normalized(420),
        quality_pass=True,
    )

    review = store.unknown_catalog()

    assert review["status"] == "review"
    assert review["total"] == 2
    assert {row["subject_id"] for row in review["items"]} == {
        candidate["subject_id"],
        consolidated["subject_id"],
    }
    assert review["summary"] == {
        "total": 4,
        "review": 2,
        "candidate": 1,
        "consolidated": 1,
        "linked": 0,
        "ignored": 0,
        "quarantined": 1,
        "archived": 1,
    }

    candidate_row = next(
        row
        for row in review["items"]
        if row["subject_id"] == candidate["subject_id"]
    )
    assert candidate_row["image_available"] is True
    assert candidate_row["crop_count"] == 1
    assert candidate_row["valid_crop_count"] == 0
    assert store.unknown_catalog_image_path(candidate["subject_id"]) == (
        candidate_crop.resolve()
    )
    consolidated_row = next(
        row
        for row in review["items"]
        if row["subject_id"] == consolidated["subject_id"]
    )
    assert consolidated_row["image_available"] is True
    assert consolidated_row["quality_score"] == pytest.approx(0.84)
    assert store.unknown_catalog_image_path(consolidated["subject_id"]) == (
        fallback_crop.resolve()
    )
    assert not {
        "best_crop_path",
        "fallback_crop_path",
        "any_crop_path",
    }.intersection(consolidated_row)

    all_unknowns = store.unknown_catalog(status="all")
    assert all_unknowns["total"] == 4
    assert {row["status"] for row in all_unknowns["items"]} == {
        "candidate",
        "consolidated",
        "quarantined",
        "archived",
    }
    assert [
        row["subject_id"]
        for row in store.unknown_catalog(status="quarantined")["items"]
    ] == [quarantined["subject_id"]]
    assert [
        row["subject_id"]
        for row in store.unknown_catalog(status="archived")["items"]
    ] == [archived["subject_id"]]

    search = store.unknown_catalog(
        status="all",
        query="perfil auditable",
    )
    assert search["total"] == 1
    assert search["items"][0]["subject_id"] == candidate["subject_id"]

    first_page = store.unknown_catalog(status="all", offset=0, limit=1)
    new_subject, _ = create_subject(
        "unknown-catalog-after-snapshot",
        "Desconocido Posterior",
        minutes=5,
        quality_pass=False,
    )
    second_page = store.unknown_catalog(
        status="all",
        offset=1,
        limit=1,
        snapshot=first_page["snapshot"],
    )
    assert first_page["total"] == second_page["total"] == 4
    assert first_page["offset"] == 0
    assert second_page["offset"] == 1
    assert first_page["limit"] == second_page["limit"] == 1
    assert first_page["items"][0]["subject_id"] != second_page["items"][0]["subject_id"]
    assert new_subject["subject_id"] not in {
        first_page["items"][0]["subject_id"],
        second_page["items"][0]["subject_id"],
    }
    assert store.unknown_catalog(status="all")["total"] == 5


def test_image_lookups_allow_external_faces_root_and_reject_arbitrary_files(
    tmp_path,
):
    data_dir = tmp_path / "local-data"
    store = LocalStore(data_dir)
    external_faces = tmp_path / "external-volume" / "faces"
    external_faces.mkdir(parents=True)
    # This models the resolved target of a Windows junction on another drive.
    store.faces_dir = external_faces
    assert not external_faces.resolve().is_relative_to(data_dir.resolve())

    observed_at = datetime(2026, 8, 2, 18, 0, tzinfo=timezone.utc)
    crop = external_faces / "2026-08-02" / "unknown" / "allowed.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"allowed-crop")
    subject = store.create_unknown(
        normalized(430),
        observed_at,
        str(crop),
        0.91,
        subject_id="unknown-external-faces",
        quality_pass=True,
    )
    assert store.record_crop(
        subject["subject_id"],
        "unknown",
        observed_at,
        str(crop),
        0.88,
        0.91,
        "Raspberry",
        embedding=normalized(430),
        quality_pass=True,
    )

    catalog_row = next(
        row
        for row in store.unknown_catalog(status="all")["items"]
        if row["subject_id"] == subject["subject_id"]
    )
    assert catalog_row["image_available"] is True
    assert store.unknown_catalog_image_path(subject["subject_id"]) == crop.resolve()
    assert store.image_path("unknown", subject["subject_id"]) == crop.resolve()

    store.replace_bootstrap(
        [
            {
                "key": "student:external-photo",
                "type": "student",
                "id": 432,
                "name": "Alumno con foto externa",
                "reference_available": True,
                "reference_version": "external-photo-v1",
            }
        ],
        [],
    )
    store.save_person_embedding(
        "student:external-photo",
        crop,
        normalized(432),
    )
    assert store.image_path("person", "student:external-photo") == crop.resolve()

    registered_photo = store.references_dir / "registered.jpg"
    registered_photo.write_bytes(b"registered-photo")
    with store.connection() as db:
        db.execute(
            "update people set photo_path=? where person_key=?",
            (str(registered_photo), "student:external-photo"),
        )
    assert (
        store.image_path("person", "student:external-photo")
        == registered_photo.resolve()
    )

    arbitrary_file = tmp_path / "not-authorized" / "private.jpg"
    arbitrary_file.parent.mkdir()
    arbitrary_file.write_bytes(b"must-not-be-served")
    unsafe = store.create_unknown(
        normalized(431),
        observed_at + timedelta(minutes=1),
        str(arbitrary_file),
        0.92,
        subject_id="unknown-arbitrary-file",
        quality_pass=True,
    )
    assert store.record_crop(
        unsafe["subject_id"],
        "unknown",
        observed_at + timedelta(minutes=1),
        str(arbitrary_file),
        0.89,
        0.92,
        "Raspberry",
        embedding=normalized(431),
        quality_pass=True,
    )

    unsafe_catalog_row = next(
        row
        for row in store.unknown_catalog(status="all")["items"]
        if row["subject_id"] == unsafe["subject_id"]
    )
    assert unsafe_catalog_row["image_available"] is False
    assert store.unknown_catalog_image_path(unsafe["subject_id"]) is None
    assert store.image_path("unknown", unsafe["subject_id"]) is None
    with store.connection() as db:
        db.execute(
            "update people set photo_path=? where person_key=?",
            (str(arbitrary_file), "student:external-photo"),
        )
    assert store.image_path("person", "student:external-photo") is None


def test_store_skips_people_without_photos_and_reactivates_when_a_photo_is_added(tmp_path):
    store = LocalStore(tmp_path)
    no_photo_version = "2026-07-01T12:00:00+00:00:"
    photo_version = (
        "2026-07-01T12:00:00+00:00:"
        "supabase://student-private-photos/students/12/photo.jpg"
    )
    store.replace_bootstrap(
        [
            {
                "key": "student:11",
                "type": "student",
                "id": 11,
                "name": "Dummy sin foto",
                # Compatibility with the old backend: it exposed a proxy URL
                # even when the underlying photo reference was empty.
                "photo_url": "https://api.example/people/student/11/photo/",
                "reference_version": no_photo_version,
            },
            {
                "key": "student:12",
                "type": "student",
                "id": 12,
                "name": "Alumno con foto",
                "photo_url": "https://api.example/people/student/12/photo/",
                "reference_version": photo_version,
            },
        ],
        [],
    )

    assert [row["person_key"] for row in store.people_needing_embeddings()] == ["student:12"]
    assert store.reference_summary() == {
        "total": 2,
        "configured": 1,
        "ready": 0,
        "pending": 1,
        "missing": 1,
    }

    store.save_person_embedding("student:12", tmp_path / "student-12.jpg", normalized(12))
    assert store.people_needing_embeddings() == []
    assert store.reference_summary()["ready"] == 1

    # Removing the photo remotely invalidates the old embedding and keeps the
    # registration visible without scheduling another download.
    store.replace_bootstrap(
        [
            {
                "key": "student:11",
                "type": "student",
                "id": 11,
                "name": "Dummy sin foto",
                "photo_url": "https://api.example/people/student/11/photo/",
                "reference_version": no_photo_version,
                "reference_available": False,
            },
            {
                "key": "student:12",
                "type": "student",
                "id": 12,
                "name": "Alumno con foto",
                "photo_url": "https://api.example/people/student/12/photo/",
                "reference_version": "2026-07-02T12:00:00+00:00:",
                "reference_available": False,
            },
        ],
        [],
    )

    assert store.people_needing_embeddings() == []
    assert store.reference_summary() == {
        "total": 2,
        "configured": 0,
        "ready": 0,
        "pending": 0,
        "missing": 2,
    }


def test_store_clusters_unknown_and_queues_link_only_after_confirmation(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    poor_embedding = normalized(2)
    frontal_embedding = normalized(22)
    rejected_embedding = normalized(23)
    subject = store.create_unknown(poor_embedding, now, "", 0.0)
    candidates, _ = store.candidate_database(now - timedelta(minutes=1))

    assert subject["status"] == "candidate"
    assert [row["subject_id"] for row in candidates] == [subject["subject_id"]]
    assert store.unknown_database()[0] == []
    assert store.dashboard(now.date().isoformat())["unknown"] == []

    subject = store.update_unknown(
        subject["subject_id"],
        frontal_embedding,
        now + timedelta(seconds=3),
        str(tmp_path / "reference.jpg"),
        0.9,
        quality_pass=True,
        quality_payload={"accepted": True},
        analysis_version="test-quality-v1",
    )
    assert subject["status"] == "consolidated"
    assert subject["promoted"] is True
    assert subject["detection_count"] == 2
    assert subject["daily_detection_count"] == 2
    rows, matrix = store.unknown_database()
    assert len(rows) == 1
    assert np.allclose(matrix[0], frontal_embedding)

    subject = store.update_unknown(
        subject["subject_id"],
        rejected_embedding,
        now + timedelta(seconds=6),
        str(tmp_path / "evidence.jpg"),
        0.4,
    )

    assert subject["status"] == "consolidated"
    assert subject["promoted"] is False
    assert subject["detection_count"] == 3
    assert subject["daily_detection_count"] == 3
    assert np.allclose(store.unknown_database()[1][0], frontal_embedding)
    assert store.pending_queue("unknown_register") == []

    store.link_unknown(subject["subject_id"], "student:9", {"local_subject_id": subject["subject_id"], "events": [{}]})
    assert len(store.pending_queue("unknown_register")) == 1


def test_unknown_names_use_a_monotonic_sqlite_counter_and_seed_from_legacy_rows(tmp_path):
    store = LocalStore(tmp_path)

    first_id, first_name = store.next_unknown_name()
    second_id, second_name = store.next_unknown_name()

    assert first_id != second_id
    assert [first_name, second_name] == [
        "Desconocido 10000",
        "Desconocido 10001",
    ]

    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    store.create_unknown(
        normalized(200),
        observed_at,
        "",
        0.0,
        subject_id="legacy-high-unknown",
        temporary_name="Desconocido 12345",
    )
    with store.connection() as db:
        db.execute("delete from local_counters where counter_key='unknown_name'")

    reopened = LocalStore(tmp_path)
    _subject_id, migrated_name = reopened.next_unknown_name()

    assert migrated_name == "Desconocido 12346"


def test_unknown_name_counter_is_atomic_across_store_instances(tmp_path):
    stores = [LocalStore(tmp_path), LocalStore(tmp_path)]

    with ThreadPoolExecutor(max_workers=8) as executor:
        reservations = list(
            executor.map(
                lambda index: stores[index % len(stores)].next_unknown_name(),
                range(32),
            )
        )

    subject_ids = [subject_id for subject_id, _name in reservations]
    names = [name for _subject_id, name in reservations]
    suffixes = sorted(int(name.removeprefix("Desconocido ")) for name in names)

    assert len(set(subject_ids)) == 32
    assert len(set(names)) == 32
    assert suffixes == list(range(10000, 10032))


def test_candidate_database_bounds_the_historical_observation_window(tmp_path):
    store = LocalStore(tmp_path)
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    stale_embedding = normalized(210)
    active_embedding = normalized(211)
    future_embedding = normalized(212)

    store.create_unknown(
        stale_embedding,
        observed_at - timedelta(minutes=40),
        "",
        0.0,
        subject_id="candidate-stale",
        temporary_name="Candidato vencido",
    )
    store.create_unknown(
        active_embedding,
        observed_at - timedelta(minutes=20),
        "",
        0.0,
        subject_id="candidate-active",
        temporary_name="Candidato activo",
    )
    store.update_unknown(
        "candidate-active",
        normalized(213),
        observed_at - timedelta(minutes=5),
        "",
        0.0,
    )
    store.create_unknown(
        future_embedding,
        observed_at + timedelta(minutes=1),
        "",
        0.0,
        subject_id="candidate-future",
        temporary_name="Candidato futuro",
    )

    bounded_rows, bounded_matrix = store.candidate_database(
        observed_at - timedelta(minutes=30),
        active_before=observed_at,
    )
    unbounded_rows, _unbounded_matrix = store.candidate_database(
        observed_at - timedelta(minutes=30)
    )

    assert [row["subject_id"] for row in bounded_rows] == ["candidate-active"]
    assert bounded_matrix.shape == (1, 512)
    assert np.allclose(bounded_matrix[0], active_embedding)
    assert [row["subject_id"] for row in unbounded_rows] == [
        "candidate-future",
        "candidate-active",
    ]


def test_batch_candidate_cache_loads_against_observation_time(tmp_path, monkeypatch):
    manager = ConfigManager(tmp_path)
    manager.update({"candidate_ttl_minutes": 30})
    runtime = StationRuntime(manager)
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    embedding = normalized(220)
    runtime.store.create_unknown(
        embedding,
        observed_at,
        "",
        0.0,
        subject_id="historical-candidate",
        temporary_name="Candidato historico",
    )
    calls = []
    candidate_database = runtime.store.candidate_database

    def observed_candidate_database(active_after, active_before=None):
        calls.append((active_after, active_before))
        return candidate_database(active_after, active_before=active_before)

    monkeypatch.setattr(
        runtime.store,
        "candidate_database",
        observed_candidate_database,
    )

    matched, similarity = runtime._match_batch_candidate(
        embedding,
        observed_at + timedelta(minutes=5),
    )
    cached_match, cached_similarity = runtime._match_batch_candidate(
        embedding,
        observed_at + timedelta(minutes=6),
    )

    assert matched["subject_id"] == "historical-candidate"
    assert similarity == pytest.approx(1.0)
    assert cached_match["subject_id"] == "historical-candidate"
    assert cached_similarity == pytest.approx(1.0)
    assert calls == [
        (
            observed_at - timedelta(minutes=25),
            observed_at + timedelta(minutes=5),
        )
    ]


def test_batch_candidate_overlay_updates_incrementally_and_expires_on_observed_ttl(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update({"candidate_ttl_minutes": 2})
    runtime = StationRuntime(manager)
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    embedding = normalized(230)
    runtime._load_batch_candidate_database(observed_at)
    subject = {
        "subject_id": "incremental-candidate",
        "temporary_name": "Candidato incremental",
        "status": "candidate",
        "first_seen_at": observed_at.isoformat(),
        "last_seen_at": observed_at.isoformat(),
        "detection_count": 1,
        "promoted": False,
    }

    def forbidden_persistent_reload():
        raise AssertionError(
            "Un candidato ordinario no debe reconstruir la galeria persistente."
        )

    monkeypatch.setattr(
        runtime,
        "_reload_persistent_unknown_database",
        forbidden_persistent_reload,
    )

    runtime._apply_batch_unknown_result(
        subject,
        embedding,
        observed_at,
        quality_pass=True,
        landmarks_valid=True,
        reference_validated=True,
    )
    matched, similarity = runtime._match_batch_candidate(
        embedding,
        observed_at + timedelta(minutes=1),
    )
    expired, expired_similarity = runtime._match_batch_candidate(
        embedding,
        observed_at + timedelta(minutes=3),
    )

    assert matched["subject_id"] == "incremental-candidate"
    assert similarity == pytest.approx(1.0)
    assert expired is None
    assert expired_similarity == pytest.approx(0.0)


def test_batch_candidate_promotion_stays_in_overlay_for_the_entire_batch(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update({"candidate_ttl_minutes": 2})
    runtime = StationRuntime(manager)
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    embedding = normalized(240)
    runtime._load_batch_candidate_database(observed_at)
    candidate = {
        "subject_id": "promoted-candidate",
        "temporary_name": "Candidato promovido",
        "status": "candidate",
        "first_seen_at": observed_at.isoformat(),
        "last_seen_at": observed_at.isoformat(),
        "detection_count": 1,
        "promoted": False,
    }
    def forbidden_persistent_reload():
        raise AssertionError(
            "Una promocion individual no debe recargar la galeria persistente."
        )

    monkeypatch.setattr(
        runtime,
        "_reload_persistent_unknown_database",
        forbidden_persistent_reload,
    )

    runtime._apply_batch_unknown_result(
        candidate,
        embedding,
        observed_at,
        quality_pass=True,
        landmarks_valid=True,
        reference_validated=True,
    )
    promoted = {
        **candidate,
        "status": "consolidated",
        "last_seen_at": (observed_at + timedelta(seconds=5)).isoformat(),
        "detection_count": 2,
        "promoted": True,
    }
    runtime._apply_batch_unknown_result(
        promoted,
        embedding,
        observed_at + timedelta(seconds=5),
        quality_pass=True,
        landmarks_valid=True,
        reference_validated=True,
    )

    assert "promoted-candidate" not in runtime._batch_candidates
    assert "promoted-candidate" in runtime._batch_recent_unknowns

    runtime._load_batch_candidate_database(observed_at + timedelta(seconds=30))

    assert "promoted-candidate" in runtime._batch_recent_unknowns
    matched, similarity = runtime._match_batch_candidate(
        embedding,
        observed_at + timedelta(minutes=1),
    )
    matched_later, later_similarity = runtime._match_batch_candidate(
        embedding,
        observed_at + timedelta(hours=12),
    )

    assert matched["subject_id"] == "promoted-candidate"
    assert matched["status"] == "consolidated"
    assert similarity == pytest.approx(1.0)
    assert matched_later["subject_id"] == "promoted-candidate"
    assert matched_later["status"] == "consolidated"
    assert later_similarity == pytest.approx(1.0)
    assert "promoted-candidate" in runtime._batch_recent_unknowns


@pytest.mark.parametrize(
    ("quality_pass", "landmarks_valid", "reference_validated"),
    [
        (False, True, True),
        (True, False, True),
        (True, True, False),
    ],
)
def test_batch_cache_rejects_untrusted_unknown_anchors(
    tmp_path,
    quality_pass,
    landmarks_valid,
    reference_validated,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    embedding = normalized(242)
    runtime._load_batch_candidate_database(observed_at)
    subject = {
        "subject_id": "untrusted-anchor",
        "temporary_name": "Ancla no confiable",
        "status": "consolidated",
        "first_seen_at": observed_at.isoformat(),
        "last_seen_at": observed_at.isoformat(),
        "detection_count": 1,
        "promoted": True,
    }

    runtime._apply_batch_unknown_result(
        subject,
        embedding,
        observed_at,
        quality_pass=quality_pass,
        landmarks_valid=landmarks_valid,
        reference_validated=reference_validated,
    )

    assert "untrusted-anchor" not in runtime._batch_candidates
    assert "untrusted-anchor" not in runtime._batch_recent_unknowns
    matched, similarity = runtime._match_batch_candidate(
        embedding,
        observed_at + timedelta(seconds=1),
    )
    assert matched is None
    assert similarity == pytest.approx(0.0)


def test_rejected_batch_crop_cannot_replace_or_refresh_a_trusted_anchor(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({"candidate_ttl_minutes": 1})
    runtime = StationRuntime(manager)
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    trusted_embedding = normalized(243)
    rejected_embedding = normalized(244)
    runtime._load_batch_candidate_database(observed_at)
    trusted = {
        "subject_id": "trusted-anchor",
        "temporary_name": "Ancla confiable",
        "status": "candidate",
        "first_seen_at": observed_at.isoformat(),
        "last_seen_at": observed_at.isoformat(),
        "detection_count": 1,
        "promoted": False,
    }
    runtime._apply_batch_unknown_result(
        trusted,
        trusted_embedding,
        observed_at,
        quality_pass=True,
        landmarks_valid=True,
        reference_validated=True,
    )

    rejected = {
        **trusted,
        "last_seen_at": (observed_at + timedelta(seconds=50)).isoformat(),
        "detection_count": 2,
    }
    runtime._apply_batch_unknown_result(
        rejected,
        rejected_embedding,
        observed_at + timedelta(seconds=50),
        quality_pass=False,
        landmarks_valid=True,
        reference_validated=True,
    )

    cached_row, cached_embedding = runtime._batch_recent_unknowns["trusted-anchor"]
    assert cached_row["_last_seen_epoch"] == pytest.approx(observed_at.timestamp())
    assert np.allclose(cached_embedding, trusted_embedding)
    expired, similarity = runtime._match_batch_candidate(
        trusted_embedding,
        observed_at + timedelta(seconds=61),
    )
    assert expired is None
    assert similarity == pytest.approx(0.0)


def test_batch_persistent_gallery_reloads_exactly_at_crop_threshold(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    embedding = normalized(241)
    original_reload = runtime._reload_persistent_unknown_database
    reload_counters = []

    def observed_reload():
        reload_counters.append(runtime._batch_unknowns_since_persistent_reload)
        original_reload()

    monkeypatch.setattr(
        runtime,
        "_reload_persistent_unknown_database",
        observed_reload,
    )

    for index in range(processor_module.BATCH_PERSISTENT_REFRESH_CROPS - 1):
        runtime._apply_batch_unknown_result(
            {
                "subject_id": f"threshold-candidate-{index}",
                "temporary_name": f"Candidato {index}",
                "status": "candidate",
                "first_seen_at": observed_at.isoformat(),
                "last_seen_at": observed_at.isoformat(),
                "detection_count": 1,
                "promoted": False,
            },
            embedding,
            observed_at,
            quality_pass=True,
            landmarks_valid=True,
            reference_validated=True,
        )

    assert reload_counters == []

    runtime._apply_batch_unknown_result(
        {
            "subject_id": "threshold-candidate-final",
            "temporary_name": "Candidato final",
            "status": "consolidated",
            "first_seen_at": observed_at.isoformat(),
            "last_seen_at": observed_at.isoformat(),
            "detection_count": 1,
            "promoted": True,
        },
        embedding,
        observed_at,
        quality_pass=True,
        landmarks_valid=True,
        reference_validated=True,
    )

    assert reload_counters == [processor_module.BATCH_PERSISTENT_REFRESH_CROPS]
    assert runtime._batch_unknowns_since_persistent_reload == 0


def test_historical_batch_does_not_rebuild_recent_aggregates_per_crop(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._batch_state = "processing"
    observed_at = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    refreshes = []
    monkeypatch.setattr(
        runtime,
        "_refresh_recent",
        lambda selected_date=None: refreshes.append(selected_date),
    )

    for _ in range(25):
        runtime._record_recent(
            "unknown",
            "Desconocido QA",
            0.7,
            "",
            observed_at,
            "subject-qa",
            "primary",
            1,
        )
    runtime._record_recent(
        "unknown",
        "Desconocido QA",
        0.7,
        "",
        observed_at + timedelta(days=1),
        "subject-qa",
        "primary",
        1,
    )

    assert refreshes == ["2026-07-25", "2026-07-26"]


def test_store_retains_twelve_coherent_references_and_rejects_isolated_outlier(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    anchor = normalized(300)
    subject = store.create_unknown(
        anchor,
        now,
        str(tmp_path / "anchor.jpg"),
        0.80,
        subject_id="unknown-gallery",
        temporary_name="Desconocido Galeria",
        quality_pass=True,
        quality_payload={"accepted": True},
    )
    for index in range(12):
        subject = store.update_unknown(
            subject["subject_id"],
            cosine_variant(anchor, 301 + index, 0.86),
            now + timedelta(seconds=index + 1),
            str(tmp_path / f"coherent-{index}.jpg"),
            0.81 + index / 100,
            quality_pass=True,
            quality_payload={"accepted": True, "index": index},
        )

    centroid_before_outlier = store.unknown_database()[1][0].copy()
    outlier_path = str(tmp_path / "isolated-outlier.jpg")
    subject = store.update_unknown(
        subject["subject_id"],
        cosine_variant(anchor, 399, 0.10),
        now + timedelta(seconds=30),
        outlier_path,
        0.99,
        quality_pass=True,
        quality_payload={"accepted": True, "outlier": True},
    )

    reference_rows, reference_matrix = store.unknown_reference_database()
    assert len(reference_rows) == 12
    assert reference_matrix.shape == (12, 512)
    assert {row["subject_id"] for row in reference_rows} == {subject["subject_id"]}
    assert outlier_path not in {row["crop_path"] for row in reference_rows}
    assert subject["best_crop_path"] != outlier_path
    assert np.allclose(store.unknown_database()[1][0], centroid_before_outlier)


def test_unvalidated_track_crop_is_evidence_but_never_an_identity_reference(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    observed_at = datetime.now(timezone.utc).astimezone()
    anchor = normalized(410)
    subject = runtime.store.create_unknown(
        anchor,
        observed_at,
        str(tmp_path / "trusted-anchor.jpg"),
        0.90,
        subject_id="unknown-track-evidence",
        temporary_name="Desconocido Track",
        quality_pass=True,
        quality_payload={"accepted": True},
    )

    class AcceptedQuality:
        @staticmethod
        def analyze(_image):
            return FaceQualityResult(True, 0.98, ())

    runtime._quality_evaluator = AcceptedQuality()
    before_rows, before_matrix = runtime.store.unknown_reference_database()
    persisted = runtime._persist_unknown_task(
        PersistenceTask(
            kind="unknown",
            subject_key=subject["subject_id"],
            observed_at=observed_at + timedelta(seconds=1),
            crop=np.full((160, 140, 3), 180, dtype=np.uint8),
            similarity=0.20,
            detected_quality=0.95,
            camera_key="primary",
            embedding=cosine_variant(anchor, 411, 0.10),
            subject=dict(subject),
            reference_validated=False,
        )
    )
    after_rows, after_matrix = runtime.store.unknown_reference_database()

    assert persisted is True
    assert [row["reference_id"] for row in after_rows] == [
        row["reference_id"] for row in before_rows
    ]
    assert np.allclose(after_matrix, before_matrix)
    with runtime.store.connection() as db:
        evidence = db.execute(
            """
            select quality_pass from face_crops
            where subject_kind='unknown' and subject_key=?
            order by id desc limit 1
            """,
            (subject["subject_id"],),
        ).fetchone()
    assert evidence["quality_pass"] == 1


def test_candidate_crops_appear_in_recent_without_creating_attendance(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    crop = store.faces_dir / now.date().isoformat() / "unknown" / "candidate.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"candidate")
    subject = store.create_unknown(normalized(32), now, str(crop), 0.2)
    store.record_crop(
        subject["subject_id"],
        "unknown",
        now,
        str(crop),
        0.0,
        0.2,
        "Raspberry",
    )

    recent = store.recent_detections(now.date().isoformat())
    detail = store.detection_detail("unknown", subject["subject_id"], now.date().isoformat())

    assert store.dashboard(now.date().isoformat())["unknown"] == []
    assert store.detection_summary(now.date().isoformat()) == {"subjects": 1, "detections": 1}
    assert recent[0]["status"] == "candidate"
    assert recent[0]["crop_id"] is not None
    assert recent[0]["camera"] == "Raspberry"
    assert store.image_path("unknown", subject["subject_id"]) == crop.resolve()
    assert detail["summary"]["detections"] == 1
    assert detail["summary"]["crops"] == 1


def test_crop_processing_queue_is_persistent_paginated_and_recoverable(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    crop = store.spool_dir / now.date().isoformat() / "primary" / "queued.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"queued-face")
    queued = store.enqueue_crop_for_processing(
        captured_at=now,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(crop),
        file_bytes=crop.stat().st_size,
        crop_width=320,
        crop_height=400,
        det_score=0.97,
        bbox=(100, 120, 300, 380),
        landmarks=np.asarray([[150, 180], [240, 180], [195, 230], [165, 290], [230, 290]], dtype=np.float32),
    )

    listing = store.crop_queue(selected_date=now.date().isoformat(), status="active")
    claimed = store.claim_pending_crop()

    assert listing["total"] == 1
    assert listing["items"][0]["crop_width"] == 320
    assert listing["summary"]["active_bytes"] == len(b"queued-face")
    assert store.crop_queue_image_path(queued["id"]) == crop.resolve()
    assert claimed["id"] == queued["id"]
    assert len(claimed["landmarks"]) == 5
    assert store.crop_queue_summary()["processing"] == 1

    assert store.recover_processing_crops() == 1
    claimed = store.claim_pending_crop()
    store.finish_crop_processing(
        claimed["id"],
        status="processed",
        result_kind="known",
        result_key="student:7",
        result_name="Alumno QA",
        similarity=0.81,
    )

    summary = store.crop_queue_summary()
    assert summary["pending"] == 0
    assert summary["processed"] == 1
    assert summary["active_bytes"] == 0


def test_pending_crop_batch_is_ordered_read_only_and_claims_exact_item(tmp_path):
    store = LocalStore(tmp_path)
    observed_at = datetime.now(timezone.utc).astimezone()
    queued_ids = []
    for index in range(3):
        crop = store.spool_dir / observed_at.date().isoformat() / "primary" / f"batch-{index}.jpg"
        crop.parent.mkdir(parents=True, exist_ok=True)
        crop.write_bytes(f"batch-{index}".encode())
        queued = store.enqueue_crop_for_processing(
            captured_at=observed_at,
            camera_key="primary",
            camera_label="Raspberry",
            crop_path=str(crop),
            file_bytes=crop.stat().st_size,
            crop_width=160,
            crop_height=180,
            det_score=0.95,
            bbox=(20, 30, 140, 170),
            landmarks=np.ones((5, 2), dtype=np.float32),
        )
        queued_ids.append(queued["id"])

    pending = store.pending_crop_batch(2)

    assert [row["id"] for row in pending] == queued_ids[:2]
    assert store.crop_queue_total_summary()["pending"] == 3
    claimed = store.claim_pending_crop(queued_ids[1])
    assert claimed["id"] == queued_ids[1]
    assert store.crop_queue_total_summary()["pending"] == 2
    assert store.crop_queue_total_summary()["processing"] == 1
    assert store.claim_pending_crop(queued_ids[1]) is None
    assert store.claim_pending_crop()["id"] == queued_ids[0]


def test_crop_processing_stats_backfill_existing_queue_and_track_transitions(tmp_path):
    store = LocalStore(tmp_path)
    today = datetime.now(timezone.utc).astimezone()
    yesterday = today - timedelta(days=1)
    queued_ids = []
    for observed_at, name, size in (
        (yesterday, "older.jpg", 13),
        (today, "today.jpg", 29),
    ):
        crop = store.spool_dir / observed_at.date().isoformat() / "primary" / name
        crop.parent.mkdir(parents=True, exist_ok=True)
        crop.write_bytes(b"x" * size)
        queued = store.enqueue_crop_for_processing(
            captured_at=observed_at,
            camera_key="primary",
            camera_label="Raspberry",
            crop_path=str(crop),
            file_bytes=size,
            crop_width=120,
            crop_height=160,
            det_score=0.9,
            bbox=(10, 20, 130, 180),
            landmarks=None,
        )
        queued_ids.append(queued["id"])

    # Simulate an installation created before materialized queue statistics.
    with store.connection() as db:
        db.execute("drop trigger trg_crop_processing_stats_insert")
        db.execute("drop trigger trg_crop_processing_stats_delete")
        db.execute("drop trigger trg_crop_processing_stats_update")
        db.execute("drop table crop_processing_stats")

    migrated = LocalStore(tmp_path)
    total = migrated.crop_queue_total_summary()
    assert total["captured"] == 2
    assert total["pending"] == 2
    assert total["captured_bytes"] == 42
    assert migrated.crop_queue_summary(today.date().isoformat())["captured"] == 1

    claimed = migrated.claim_pending_crop()
    assert claimed["id"] == queued_ids[0]
    migrated.finish_crop_processing(claimed["id"], status="discarded")
    total = migrated.crop_queue_total_summary()
    assert total["pending"] == 1
    assert total["discarded"] == 1
    assert total["active_bytes"] == 29

    with migrated.connection() as db:
        db.execute("delete from crop_processing_queue where id=?", (queued_ids[1],))
    total = migrated.crop_queue_total_summary()
    assert total["captured"] == 1
    assert total["pending"] == 0
    assert total["captured_bytes"] == 13


def test_runtime_dashboard_does_not_recompute_station_status(tmp_path, monkeypatch):
    runtime = StationRuntime(ConfigManager(tmp_path))

    def unexpected_status():
        raise AssertionError("dashboard must not repeat the independently polled status")

    monkeypatch.setattr(runtime, "status", unexpected_status)
    result = runtime.dashboard(datetime.now().astimezone().date().isoformat())

    assert result["known"] == []
    assert result["unknown"] == []
    assert "status" not in result


def test_runtime_health_status_never_queries_sqlite_summaries(tmp_path, monkeypatch):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._state = "running"
    runtime._client_online = True
    runtime._cameras = {
        "primary": type("ConnectedCamera", (), {"connected": True})(),
    }

    def unexpected_query(*_args, **_kwargs):
        raise AssertionError("the health probe must not query SQLite")

    monkeypatch.setattr(runtime.store, "crop_queue_total_summary", unexpected_query)
    monkeypatch.setattr(runtime.store, "crop_queue_summary", unexpected_query)
    monkeypatch.setattr(runtime.store, "unassigned_summary", unexpected_query)
    monkeypatch.setattr(runtime.store, "sync_summary", unexpected_query)

    health = runtime.health_status()

    assert health == {
        "running": False,
        "state": "running",
        "camera_connected": True,
        "online": True,
    }


def test_missing_tertiary_preview_never_falls_back_to_primary(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._camera_labels = {
        "primary": "Raspberry",
        "tertiary": "Raspberry entrada 2",
    }
    runtime._preview_jpegs = {"primary": b"primary-preview"}

    payload = runtime.latest_preview("tertiary")

    assert payload != b"primary-preview"
    assert payload.startswith(b"\xff\xd8")


def test_status_reports_tertiary_camera_independently(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({
        "secondary_camera_enabled": True,
        "secondary_camera_url": "rtsp://192.168.1.50:554/live",
        "tertiary_camera_enabled": True,
        "tertiary_camera_url": "http://192.168.1.44:8080/stream",
    })
    runtime = StationRuntime(manager)

    class Camera:
        def __init__(self, connected, frames_read, pipeline_mode):
            self.connected = connected
            self.frames_read = frames_read
            self.frames_dropped = 0
            self.hardware_acceleration = False
            self.queue_depth = 0
            self.last_error = ""
            self.source_role = "primary"
            self.using_fallback = False
            self.failover_count = 0
            self.last_source_switch_at = 0.0
            self.last_failover_reason = ""
            self.status_metrics = {"pipeline_mode": pipeline_mode}

    runtime._cameras = {
        "primary": Camera(True, 10, "opencv"),
        "secondary": Camera(True, 20, "opencv"),
        "tertiary": Camera(False, 30, "async_mjpeg"),
    }

    status = runtime.status()

    assert list(status["cameras"]) == ["primary", "secondary", "tertiary"]
    assert status["cameras"]["tertiary"]["label"] == "Raspberry 2"
    assert status["cameras"]["tertiary"]["connected"] is False
    assert status["cameras"]["tertiary"]["capture_pipeline"]["pipeline_mode"] == (
        "async_mjpeg"
    )
    assert status["camera"]["configured_count"] == 3
    assert status["camera"]["connected_count"] == 2
    assert status["camera"]["frames_read"] == 60


def test_night_pause_drains_camera_packets_and_resumes_from_a_fresh_frame(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    calls = []

    class Camera:
        @staticmethod
        def set_processing_enabled(enabled):
            calls.append(("enabled", enabled))

        @staticmethod
        def clear_pending():
            calls.append(("clear", None))

    runtime._cameras = {
        "primary": Camera(),
        "secondary": Camera(),
        "tertiary": Camera(),
    }

    runtime._suspend_capture_workers()
    runtime._resume_capture_workers()

    assert calls == [
        ("enabled", False),
        ("clear", None),
        ("enabled", False),
        ("clear", None),
        ("enabled", False),
        ("clear", None),
        ("clear", None),
        ("enabled", True),
        ("clear", None),
        ("enabled", True),
        ("clear", None),
        ("enabled", True),
    ]


def test_manual_batch_request_is_explicit_and_cancel_does_not_consume_queue(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    now = datetime.now(timezone.utc).astimezone() - timedelta(days=1)
    crop = runtime.store.spool_dir / now.date().isoformat() / "primary" / "manual-pending.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"manual-pending")
    runtime.store.enqueue_crop_for_processing(
        captured_at=now,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(crop),
        file_bytes=crop.stat().st_size,
        crop_width=240,
        crop_height=300,
        det_score=0.95,
        bbox=(80, 100, 320, 400),
        landmarks=None,
    )
    release = Event()
    worker = Thread(target=release.wait)
    worker.start()
    runtime._processing_thread = worker
    try:
        response = runtime.request_manual_batch()

        assert response == {"queued": True, "pending": 1}
        status = runtime.status()["crop_queue"]
        assert status["pending"] == 1
        assert status["today"]["pending"] == 0
        assert status["manual"]["status"] == "queued"
        assert status["manual"]["detection_paused"] is True
        assert runtime.store.crop_queue_total_summary()["pending"] == 1

        assert runtime.cancel_manual_batch() == {"cancelling": True}
        runtime._finish_manual_batch("cancelled")

        manual = runtime.status()["crop_queue"]["manual"]
        assert manual["status"] == "cancelled"
        assert manual["requested"] is False
        assert manual["detection_paused"] is False
        assert runtime.store.crop_queue_total_summary()["pending"] == 1
    finally:
        release.set()
        worker.join(timeout=2)


def test_manual_batch_processes_temp_queue_and_resumes_detection(tmp_path, monkeypatch):
    runtime = StationRuntime(ConfigManager(tmp_path))
    now = datetime.now(timezone.utc).astimezone()
    crop = runtime.store.spool_dir / now.date().isoformat() / "primary" / "manual-process.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"manual-process")
    runtime.store.enqueue_crop_for_processing(
        captured_at=now,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(crop),
        file_bytes=crop.stat().st_size,
        crop_width=240,
        crop_height=300,
        det_score=0.96,
        bbox=(80, 100, 320, 400),
        landmarks=None,
    )
    runtime._engine = object()
    runtime._manual_batch_initial_pending = 1
    runtime._detection_paused = True
    runtime._manual_batch_requested.set()
    runtime._manual_detection_ready.set()
    monkeypatch.setattr(
        runtime,
        "_process_queued_crop",
        lambda _item: {
            "status": "processed",
            "result_kind": "known",
            "result_key": "student:smoke",
            "result_name": "Alumno Smoke",
            "similarity": 0.91,
        },
    )

    batch_thread = Thread(target=runtime._batch_loop)
    batch_thread.start()
    deadline = __import__("time").monotonic() + 3
    while runtime._manual_batch_requested.is_set() and __import__("time").monotonic() < deadline:
        __import__("time").sleep(0.01)
    runtime._stop.set()
    batch_thread.join(timeout=2)

    manual = runtime.status()["crop_queue"]["manual"]
    assert manual["status"] == "completed"
    assert manual["processed"] == 1
    assert manual["active"] is False
    assert manual["detection_paused"] is False
    assert runtime.store.crop_queue_summary()["processed"] == 1
    assert not crop.exists()


def test_automatic_batch_is_exclusive_once_per_day_and_resumes(tmp_path, monkeypatch):
    manager = ConfigManager(tmp_path)
    manager.update({"night_batch_start_time": "00:00"})
    runtime = StationRuntime(manager)
    now = datetime.now(timezone.utc).astimezone()
    run_date = now.date().isoformat()
    crop = runtime.store.spool_dir / run_date / "primary" / "automatic-process.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"automatic-process")
    runtime.store.enqueue_crop_for_processing(
        captured_at=now,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(crop),
        file_bytes=crop.stat().st_size,
        crop_width=240,
        crop_height=300,
        det_score=0.96,
        bbox=(80, 100, 320, 400),
        landmarks=np.ones((5, 2), dtype=np.float32),
    )
    runtime._engine = object()
    runtime._begin_automatic_batch(run_date)
    runtime._manual_detection_ready.set()
    monkeypatch.setattr(
        runtime,
        "_process_queued_crop",
        lambda _item: {
            "status": "processed",
            "result_kind": "known",
            "result_key": "student:automatic",
            "result_name": "Alumno Automatico",
            "similarity": 0.91,
        },
    )

    batch_thread = Thread(target=runtime._batch_loop)
    batch_thread.start()
    deadline = __import__("time").monotonic() + 3
    while runtime._automatic_batch_requested.is_set() and __import__("time").monotonic() < deadline:
        __import__("time").sleep(0.01)
    runtime._stop.set()
    batch_thread.join(timeout=2)

    automatic = runtime.status()["crop_queue"]["automatic"]
    assert automatic["active"] is False
    assert automatic["completed_date"] == run_date
    assert runtime.store.runtime_state(
        processor_module.AUTOMATIC_BATCH_COMPLETED_STATE_KEY
    ) == run_date
    assert runtime._automatic_batch_due_date(now) == ""
    assert runtime._detection_paused is False
    assert runtime.store.crop_queue_total_summary()["processed"] == 1
    assert not crop.exists()


def test_batch_waits_for_capture_persistence_fence(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._persistence_enqueued = 4
    runtime._persistence_completed = 2

    assert runtime._capture_persistence_drained() is False
    runtime._persistence_completed = 4
    assert runtime._capture_persistence_drained() is True

    runtime._persistence_failed = 1
    assert runtime._capture_persistence_drained() is False


def test_stop_preserves_queues_and_rejects_restart_while_a_worker_is_alive(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    monkeypatch.setattr(processor_module, "STOP_CONTROL_JOIN_SECONDS", 0.02)
    monkeypatch.setattr(processor_module, "STOP_RAW_DRAIN_SECONDS", 0.02)
    monkeypatch.setattr(processor_module, "STOP_PERSISTENCE_DRAIN_SECONDS", 0.02)
    release = Event()
    orphan = Thread(target=release.wait, name="qa-orphan", daemon=True)
    runtime._processing_thread = orphan
    observed_at = datetime.now(timezone.utc).astimezone()
    detected = DetectedFace((10, 10, 30, 30), None, 0.9, 0.8)
    runtime._raw_frame_queue.put_nowait(
        RawFrameTask(
            sequence=1,
            observed_at=observed_at,
            camera_key="primary",
            detection_shape=(40, 40),
            detections=(detected,),
            encoded_original=b"pending-jpeg",
        )
    )
    runtime._persistence_queue.put_nowait(
        PersistenceTask(
            kind="raw",
            subject_key="pending-crop",
            observed_at=observed_at,
            crop=np.zeros((20, 20, 3), dtype=np.uint8),
            similarity=0.0,
            detected_quality=0.9,
            camera_key="primary",
        )
    )
    orphan.start()

    try:
        with pytest.raises(RuntimeError, match="workers activos"):
            runtime.stop()

        assert runtime._stop.is_set()
        assert runtime._processing_thread is orphan
        assert runtime._raw_frame_queue.qsize() == 1
        assert runtime._persistence_queue.qsize() == 1
        assert runtime._state == "error"
        with pytest.raises(RuntimeError, match="workers anteriores"):
            runtime.start()
    finally:
        release.set()
        orphan.join(timeout=1)


def test_camera_stop_failure_is_aggregated_and_blocks_a_second_pipeline(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    calls = []

    class StuckCamera:
        @property
        def status_metrics(self):
            return {"receiver_alive": True, "decoder_alive": False}

        def stop(self):
            calls.append("stuck")
            raise RuntimeError("receptor no termino")

    class OtherCamera:
        @property
        def status_metrics(self):
            return {"receiver_alive": False, "decoder_alive": False}

        def stop(self):
            calls.append("other")

    cameras = {"primary": StuckCamera(), "secondary": OtherCamera()}
    runtime._cameras = cameras

    with pytest.raises(RuntimeError, match="primary.*receptor"):
        runtime.stop()

    assert calls == ["stuck", "other"]
    assert runtime._cameras is cameras
    assert runtime._stop.is_set()
    assert runtime._state == "error"
    with pytest.raises(RuntimeError, match=r"primary \(receptor\)"):
        runtime.start()
    assert runtime._cameras is cameras


def test_stop_waits_for_a_late_inflight_frame_before_raw_workers_exit(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    observed_at = datetime.now(timezone.utc).astimezone()
    detected = DetectedFace((10, 10, 30, 30), None, 0.9, 0.8)
    producer_started = Event()
    release_producer = Event()
    processed = []
    stop_errors = []
    runtime._capture_producer_done.clear()

    def delayed_producer():
        producer_started.set()
        try:
            assert release_producer.wait(2)
            assert runtime._enqueue_raw_frame(
                RawFrameTask(
                    sequence=77,
                    observed_at=observed_at,
                    camera_key="primary",
                    detection_shape=(40, 40),
                    detections=(detected,),
                    encoded_original=b"late-but-valid",
                )
            )
        finally:
            runtime._capture_producer_done.set()

    monkeypatch.setattr(
        runtime,
        "_process_raw_frame_task",
        lambda item: processed.append(item.sequence) or len(item.detections),
    )
    runtime._processing_thread = Thread(
        target=delayed_producer,
        name="qa-delayed-producer",
        daemon=True,
    )
    raw_worker = Thread(
        target=runtime._raw_frame_loop,
        name="qa-raw-consumer",
        daemon=True,
    )
    runtime._raw_frame_threads = [raw_worker]
    runtime._processing_thread.start()
    raw_worker.start()
    assert producer_started.wait(1)

    def stop_runtime():
        try:
            runtime.stop()
        except Exception as exc:  # pragma: no cover - asserted below
            stop_errors.append(exc)

    stopper = Thread(target=stop_runtime, name="qa-stop")
    stopper.start()
    assert runtime._stop.wait(1)
    __import__("time").sleep(0.05)
    assert raw_worker.is_alive()

    release_producer.set()
    stopper.join(timeout=2)

    assert not stopper.is_alive()
    assert stop_errors == []
    assert processed == [77]
    assert runtime._raw_frame_completed == 1
    assert runtime._raw_frame_dropped == 0
    assert runtime._capture_producer_done.is_set()
    assert runtime._stop.is_set()
    assert runtime._state == "stopped"


def test_processing_loop_failure_stops_all_auxiliary_workers(tmp_path, monkeypatch):
    runtime = StationRuntime(ConfigManager(tmp_path))
    stopped = []

    class Camera:
        def stop(self):
            stopped.append(True)

    class BrokenDetector:
        def __init__(self, _config):
            pass

        def load(self):
            raise RuntimeError("modelo roto QA")

    runtime._cameras = {"primary": Camera()}
    monkeypatch.setattr(processor_module, "FaceDetector", BrokenDetector)

    runtime._processing_loop()

    assert runtime._stop.is_set()
    assert runtime._state == "error"
    assert "modelo roto QA" in runtime._last_error
    assert stopped == [True]


def test_queued_crop_reuses_landmarks_without_running_detection(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    expected_embedding = normalized(950)
    calls = []

    class DirectEmbeddingEngine:
        def embedding_from_landmarks(self, image, landmarks):
            calls.append((image.shape, landmarks.copy()))
            return expected_embedding

        def detect(self, _image):
            raise AssertionError("SCRFD no debe repetirse cuando existen cinco landmarks.")

    runtime._engine = DirectEmbeddingEngine()
    image = np.zeros((180, 160, 3), dtype=np.uint8)
    landmarks = np.asarray(
        [[45, 62], [110, 61], [78, 91], [52, 124], [104, 123]],
        dtype=np.float32,
    )

    detected = runtime._embedding_from_queued_crop(
        {"id": 10, "det_score": 0.94, "landmarks": landmarks.tolist()},
        image,
    )

    assert detected is not None
    assert np.allclose(detected.embedding, expected_embedding)
    assert len(calls) == 1
    assert runtime._batch_direct_embeddings == 1
    assert runtime._batch_detection_fallbacks == 0


def test_queued_crop_rejects_d13768_landmarks_then_attempts_safe_redetection(
    tmp_path,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    detection_calls = []

    class ForbiddenEngine:
        def embedding_from_landmarks(self, _image, _landmarks):
            raise AssertionError("ArcFace no debe recibir landmarks invalidos.")

        def detect(self, image):
            detection_calls.append(image.shape)
            return []

    runtime._engine = ForbiddenEngine()
    image = np.zeros((250, 217, 3), dtype=np.uint8)
    item = {
        "id": 126802,
        "det_score": 0.6813,
        "landmarks": [
            [115.78369, 89.78691],
            [147.86841, 89.48404],
            [160.48596, 105.92670],
            [136.95886, 146.46979],
            [162.50452, 146.53186],
        ],
    }

    detected = runtime._embedding_from_queued_crop(item, image)

    assert detected is None
    assert "eye_mouth_ratio_too_large" in item["_landmark_rejection"]
    assert "nose_horizontal_outlier" in item["_landmark_rejection"]
    assert detection_calls == [image.shape]
    assert runtime._batch_direct_embeddings == 0
    assert runtime._batch_detection_fallbacks == 1


def test_queued_crop_batch_runs_one_arcface_call_and_preserves_order(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({"night_embedding_batch_size": 32})
    runtime = StationRuntime(manager)
    expected_embeddings = [normalized(960 + index) for index in range(3)]
    calls = []

    class BatchEmbeddingEngine:
        def embeddings_from_landmarks_batch(self, images, landmarks_batch):
            calls.append((list(images), list(landmarks_batch)))
            return expected_embeddings

        def embedding_from_landmarks(self, _image, _landmarks):
            raise AssertionError("La ruta individual no debe ejecutarse.")

        def detect(self, _image):
            raise AssertionError("SCRFD no debe repetirse.")

    runtime._engine = BatchEmbeddingEngine()
    observed_at = datetime.now(timezone.utc).astimezone()
    queued_ids = []
    for index in range(3):
        crop = runtime.store.spool_dir / observed_at.date().isoformat() / "primary" / f"arcface-{index}.jpg"
        crop.parent.mkdir(parents=True, exist_ok=True)
        image = np.full((180 + index, 160 + index, 3), 80 + index, dtype=np.uint8)
        assert cv2.imwrite(str(crop), image)
        queued = runtime.store.enqueue_crop_for_processing(
            captured_at=observed_at,
            camera_key="primary",
            camera_label="Raspberry",
            crop_path=str(crop),
            file_bytes=crop.stat().st_size,
            crop_width=image.shape[1],
            crop_height=image.shape[0],
            det_score=0.94,
            bbox=(10, 20, 140, 170),
            landmarks=np.asarray(
                [[45, 62], [110, 61], [78, 91], [52, 124], [104, 123]],
                dtype=np.float32,
            ),
        )
        queued_ids.append(queued["id"])

    prepared = runtime._prepare_queued_crop_batch(
        runtime.store.pending_crop_batch(32)
    )

    assert [entry[0]["id"] for entry in prepared] == queued_ids
    assert len(calls) == 1
    assert len(calls[0][0]) == 3
    assert [
        entry[2].embedding.tolist()
        for entry in prepared
        if entry[2] is not None
    ] == [embedding.tolist() for embedding in expected_embeddings]
    assert runtime._batch_direct_embeddings == 3
    assert runtime._batch_embedding_batches == 1
    assert runtime._batch_embedding_batch_failures == 0
    assert runtime._batch_detection_fallbacks == 0
    assert runtime.store.crop_queue_total_summary()["pending"] == 3


def test_queued_crop_batch_prefilters_invalid_landmarks_without_breaking_batch(
    tmp_path,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    expected_embeddings = [normalized(968), normalized(969)]
    batch_sizes = []
    detection_calls = []

    class BatchEmbeddingEngine:
        def embeddings_from_landmarks_batch(self, images, landmarks_batch):
            batch_sizes.append((len(images), len(landmarks_batch)))
            return expected_embeddings

        def embedding_from_landmarks(self, _image, _landmarks):
            raise AssertionError("El lote valido no debe degradarse a la ruta individual.")

        def detect(self, image):
            detection_calls.append(image.shape)
            return []

    runtime._engine = BatchEmbeddingEngine()
    observed_at = datetime.now(timezone.utc).astimezone()
    valid_path = runtime.store.spool_dir / "valid-landmarks.jpg"
    valid_path_2 = runtime.store.spool_dir / "valid-landmarks-2.jpg"
    invalid_path = runtime.store.spool_dir / "invalid-landmarks.jpg"
    assert cv2.imwrite(str(valid_path), np.full((180, 160, 3), 80, dtype=np.uint8))
    assert cv2.imwrite(str(valid_path_2), np.full((180, 160, 3), 81, dtype=np.uint8))
    assert cv2.imwrite(str(invalid_path), np.full((250, 217, 3), 80, dtype=np.uint8))
    valid = runtime.store.enqueue_crop_for_processing(
        captured_at=observed_at,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(valid_path),
        file_bytes=valid_path.stat().st_size,
        crop_width=160,
        crop_height=180,
        det_score=0.94,
        bbox=(10, 20, 140, 170),
        landmarks=np.asarray(
            [[45, 62], [110, 61], [78, 91], [52, 124], [104, 123]],
            dtype=np.float32,
        ),
    )
    valid_2 = runtime.store.enqueue_crop_for_processing(
        captured_at=observed_at + timedelta(microseconds=1),
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(valid_path_2),
        file_bytes=valid_path_2.stat().st_size,
        crop_width=160,
        crop_height=180,
        det_score=0.94,
        bbox=(10, 20, 140, 170),
        landmarks=np.asarray(
            [[45, 62], [110, 61], [78, 91], [52, 124], [104, 123]],
            dtype=np.float32,
        ),
    )
    invalid = runtime.store.enqueue_crop_for_processing(
        captured_at=observed_at + timedelta(microseconds=2),
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(invalid_path),
        file_bytes=invalid_path.stat().st_size,
        crop_width=217,
        crop_height=250,
        det_score=0.6813,
        bbox=(1801, 35, 1946, 198),
        landmarks=np.asarray(
            [
                [115.78369, 89.78691],
                [147.86841, 89.48404],
                [160.48596, 105.92670],
                [136.95886, 146.46979],
                [162.50452, 146.53186],
            ],
            dtype=np.float32,
        ),
    )

    prepared = runtime._prepare_queued_crop_batch(
        runtime.store.pending_crop_batch(32)
    )

    assert [entry[0]["id"] for entry in prepared] == [
        valid["id"],
        valid_2["id"],
        invalid["id"],
    ]
    assert batch_sizes == [(2, 2)]
    assert np.allclose(prepared[0][2].embedding, expected_embeddings[0])
    assert np.allclose(prepared[1][2].embedding, expected_embeddings[1])
    assert prepared[2][2] is None
    assert detection_calls == [(250, 217, 3)]
    assert "nose_horizontal_outlier" in prepared[2][0]["_landmark_rejection"]
    result = runtime._process_queued_crop(
        prepared[2][0],
        image=prepared[2][1],
        detected=None,
        embedding_prepared=True,
    )
    assert result["status"] == "discarded"
    assert result["result_kind"] == "invalid_landmarks"
    assert "nose_horizontal_outlier" in result["result_name"]
    assert runtime._batch_embedding_batches == 1
    assert runtime._batch_embedding_batch_failures == 0
    assert runtime._batch_detection_fallbacks == 1


def test_queued_crop_batch_falls_back_to_individual_embeddings(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    expected_embedding = normalized(970)
    individual_calls = []

    class FailingBatchEngine:
        def embeddings_from_landmarks_batch(self, _images, _landmarks_batch):
            raise RuntimeError("batch no disponible")

        def embedding_from_landmarks(self, image, landmarks):
            individual_calls.append((image.shape, landmarks.shape))
            return expected_embedding

        def detect(self, _image):
            raise AssertionError("SCRFD no debe repetirse.")

    runtime._engine = FailingBatchEngine()
    observed_at = datetime.now(timezone.utc).astimezone()
    for index in range(2):
        crop = runtime.store.spool_dir / observed_at.date().isoformat() / "primary" / f"fallback-{index}.jpg"
        crop.parent.mkdir(parents=True, exist_ok=True)
        assert cv2.imwrite(str(crop), np.full((180, 160, 3), 90, dtype=np.uint8))
        runtime.store.enqueue_crop_for_processing(
            captured_at=observed_at,
            camera_key="primary",
            camera_label="Raspberry",
            crop_path=str(crop),
            file_bytes=crop.stat().st_size,
            crop_width=160,
            crop_height=180,
            det_score=0.94,
            bbox=(10, 20, 140, 170),
            landmarks=np.asarray(
                [[45, 62], [110, 61], [78, 91], [52, 124], [104, 123]],
                dtype=np.float32,
            ),
        )

    prepared = runtime._prepare_queued_crop_batch(
        runtime.store.pending_crop_batch(32)
    )

    assert len(prepared) == 2
    assert len(individual_calls) == 2
    assert runtime._batch_direct_embeddings == 2
    assert runtime._batch_embedding_batches == 0
    assert runtime._batch_embedding_batch_failures == 1
    assert runtime._batch_detection_fallbacks == 0


def test_crop_queue_discards_existing_side_zone_crops(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    queued_paths = []
    for name, bbox in (
        ("left", (80, 200, 180, 340)),
        ("center", (600, 200, 700, 340)),
        ("right", (1080, 200, 1180, 340)),
    ):
        crop = store.spool_dir / now.date().isoformat() / "primary" / f"{name}.jpg"
        crop.parent.mkdir(parents=True, exist_ok=True)
        crop.write_bytes(name.encode())
        queued_paths.append(crop)
        store.enqueue_crop_for_processing(
            captured_at=now,
            camera_key="primary",
            camera_label="Raspberry",
            crop_path=str(crop),
            file_bytes=crop.stat().st_size,
            crop_width=100,
            crop_height=140,
            det_score=0.9,
            bbox=bbox,
            landmarks=None,
        )

    result = store.discard_queued_crops_outside_horizontal_roi(
        camera_key="primary",
        selected_date=now.date().isoformat(),
        frame_width=1280,
        roi_left=430 / 1280,
        roi_right=990 / 1280,
    )

    assert result["discarded"] == 2
    assert not queued_paths[0].exists()
    assert queued_paths[1].exists()
    assert not queued_paths[2].exists()
    summary = store.crop_queue_summary(now.date().isoformat())
    assert summary["pending"] == 1
    assert summary["discarded"] == 2


def test_capture_pipeline_detects_original_frame_and_queues_original_crop(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({"camera_roi_left": 0.25, "camera_roi_right": 0.75})
    runtime = StationRuntime(manager)
    original_shape = (1944, 2592, 3)
    frame = np.full(original_shape, 150, dtype=np.uint8)
    landmarks = np.asarray(
        [[412, 820], [512, 820], [462, 880], [422, 950], [502, 950]],
        dtype=np.float32,
    )

    class OriginalFrameDetector:
        seen_shape = None

        def detect(self, source):
            self.seen_shape = source.shape
            return [DetectedFace((352, 760, 572, 1020), None, 0.98, 0.9, landmarks)]

    detector = OriginalFrameDetector()
    runtime._detector = detector
    runtime._camera_labels = {"primary": "Raspberry"}
    runtime._last_preview_at["primary"] = __import__("time").monotonic()
    observed_at = datetime.now(timezone.utc).astimezone()

    runtime._capture_frame(frame, observed_at.timestamp(), "primary")
    task = runtime._persistence_queue.get_nowait()
    runtime._persist_task(task)
    runtime._persistence_queue.task_done()

    queued = runtime.store.crop_queue(
        selected_date=observed_at.date().isoformat(),
        status="active",
    )["items"][0]
    stored_crop = cv2.imread(str(runtime.store.crop_queue_image_path(queued["id"])))
    assert detector.seen_shape == (1944, 1296, 3)
    assert queued["crop_width"] == 330
    assert queued["crop_height"] == 426
    assert stored_crop.shape[:2] == (426, 330)
    assert runtime.status()["capture"]["faces_today"] == 1


def test_reduced_capture_skips_original_decode_when_scrfd_finds_no_faces(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({
        "camera_roi_left": 0.25,
        "camera_roi_right": 0.75,
        "min_face_size": 70,
    })
    runtime = StationRuntime(manager)
    reduced = np.full((486, 648, 3), 150, dtype=np.uint8)
    original = np.full((1944, 2592, 3), 150, dtype=np.uint8)
    calls = {"decode": 0, "threshold": None, "shape": None}

    class EmptyDetector:
        def detect(self, source, *, min_face_size=None):
            calls["shape"] = source.shape
            calls["threshold"] = min_face_size
            return []

    class Packet:
        sequence = 40
        captured_at = datetime.now(timezone.utc).timestamp()
        detection_frame = reduced
        decode_reduction = 4
        encoded_original = b"unused-source-jpeg"

        @staticmethod
        def decode_original():
            calls["decode"] += 1
            return original

    runtime._detector = EmptyDetector()
    runtime._last_preview_at["primary"] = __import__("time").monotonic()

    runtime._capture_packet(Packet(), "primary")

    assert calls["shape"] == (486, 324, 3)
    assert calls["threshold"] == 18
    assert calls["decode"] == 0
    assert runtime._raw_frame_queue.empty()
    assert runtime._persistence_queue.empty()
    assert runtime.status()["capture"]["frames_today"] == 1
    assert runtime.status()["capture"]["faces_today"] == 0


def test_reduced_capture_defers_one_original_decode_and_scales_all_faces(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update({
        "camera_roi_left": 0.25,
        "camera_roi_right": 0.75,
        "min_face_size": 70,
    })
    runtime = StationRuntime(manager)
    reduced = np.full((486, 648, 3), 140, dtype=np.uint8)
    original = np.full((1944, 2592, 3), 140, dtype=np.uint8)
    calls = {"packet_decode": 0, "worker_decode": 0, "threshold": None}
    first_landmarks = np.asarray(
        [[100, 205], [130, 205], [115, 220], [104, 240], [126, 240]],
        dtype=np.float32,
    )
    second_landmarks = np.asarray(
        [[170, 112], [195, 112], [182, 128], [173, 148], [193, 148]],
        dtype=np.float32,
    )

    class TwoFaceDetector:
        def detect(self, source, *, min_face_size=None):
            assert source.shape == (486, 324, 3)
            calls["threshold"] = min_face_size
            return [
                DetectedFace((88, 190, 143, 255), None, 0.98, 0.9, first_landmarks),
                DetectedFace((160, 100, 210, 160), None, 0.96, 0.8, second_landmarks),
            ]

    class Packet:
        sequence = 41
        captured_at = datetime.now(timezone.utc).timestamp()
        detection_frame = reduced
        decode_reduction = 4
        encoded_original = b"exact-source-jpeg"

        @staticmethod
        def decode_original():
            calls["packet_decode"] += 1
            raise AssertionError("SCRFD no debe esperar el decode 4K.")

    runtime._detector = TwoFaceDetector()
    runtime._last_preview_at["primary"] = __import__("time").monotonic()

    runtime._capture_packet(Packet(), "primary")

    raw_task = runtime._raw_frame_queue.get_nowait()
    runtime._raw_frame_queue.task_done()
    assert raw_task.sequence == 41
    assert len(raw_task.detections) == 2
    assert calls["packet_decode"] == 0
    assert runtime._persistence_queue.empty()

    def decode_original(encoded, mode):
        assert encoded.tobytes() == Packet.encoded_original
        assert mode == cv2.IMREAD_COLOR
        calls["worker_decode"] += 1
        return original

    monkeypatch.setattr(processor_module.cv2, "imdecode", decode_original)
    assert runtime._process_raw_frame_task(raw_task) == 2

    first = runtime._persistence_queue.get_nowait()
    second = runtime._persistence_queue.get_nowait()
    runtime._persistence_queue.task_done()
    runtime._persistence_queue.task_done()

    assert calls["threshold"] == 18
    assert calls["worker_decode"] == 1
    assert first.bbox == (1000, 760, 1220, 1020)
    assert first.crop.shape[:2] == (426, 330)
    assert np.allclose(
        first.landmarks,
        np.asarray(
            [[103, 143], [223, 143], [163, 203], [119, 283], [207, 283]],
            dtype=np.float32,
        ),
    )
    assert second.bbox == (1288, 400, 1488, 640)
    assert runtime._persistence_queue.empty()
    assert runtime.status()["capture"]["faces_today"] == 2


def test_scrfd_accepts_a_detector_scale_minimum_without_changing_default(tmp_path):
    config = ConfigManager(tmp_path).config
    detector = FaceDetector(config)

    class Model:
        @staticmethod
        def detect(_frame, max_num=0, metric="default"):
            assert max_num == 0
            assert metric == "default"
            return (
                np.asarray(
                    [
                        [10, 10, 30, 30, 0.95],
                        [40, 40, 57, 57, 0.95],
                    ],
                    dtype=np.float32,
                ),
                None,
            )

    detector.model = Model()
    frame = np.zeros((160, 160, 3), dtype=np.uint8)

    assert detector.detect(frame) == []
    scaled = detector.detect(frame, min_face_size=18)

    assert len(scaled) == 1
    assert scaled[0].bbox == (10, 10, 30, 30)


def test_original_frame_queue_is_nonblocking_and_reports_drops(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._raw_frame_queue = Queue(maxsize=2)
    detected = DetectedFace((10, 10, 40, 40), None, 0.9, 0.8)
    observed_at = datetime.now(timezone.utc).astimezone()

    def task(sequence):
        return RawFrameTask(
            sequence=sequence,
            observed_at=observed_at,
            camera_key="primary",
            detection_shape=(100, 100),
            detections=(detected,),
            encoded_original=f"jpeg-{sequence}".encode(),
        )

    assert runtime._enqueue_raw_frame(task(1)) is True
    assert runtime._enqueue_raw_frame(task(2)) is True
    assert runtime._enqueue_raw_frame(task(3)) is False
    assert runtime._raw_frame_dropped == 1
    assert runtime._raw_frame_dropped_faces == 1
    assert runtime._capture_persistence_drained() is False

    processed = []
    monkeypatch.setattr(
        runtime,
        "_process_raw_frame_task",
        lambda item: processed.append(item.sequence) or len(item.detections),
    )
    runtime._stop.set()
    runtime._raw_frame_loop()

    assert sorted(processed) == [1, 2]
    assert runtime._raw_frame_completed == 2
    assert runtime._raw_frame_crops_enqueued == 2
    assert runtime._capture_persistence_drained() is True
    status = runtime.status()["persistence"]["original_frames"]
    assert status["queue_depth"] == 0
    assert status["queue_high_water"] == 2
    assert status["dropped"] == 1
    assert status["last_sequence"] == 2


def test_full_original_queue_never_labels_the_preview_as_enqueued(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._raw_frame_queue = Queue(maxsize=1)
    observed_at = datetime.now(timezone.utc).astimezone()
    detected = DetectedFace((12, 14, 42, 48), None, 0.93, 0.8)
    runtime._raw_frame_queue.put_nowait(
        RawFrameTask(
            sequence=1,
            observed_at=observed_at,
            camera_key="primary",
            detection_shape=(80, 100),
            detections=(detected,),
            encoded_original=b"already-pending",
        )
    )
    labels = []

    class Detector:
        @staticmethod
        def detect(_frame, *, min_face_size=None):
            assert min_face_size is not None
            return [detected]

    class Packet:
        sequence = 2
        captured_at = observed_at.timestamp()
        detection_frame = np.full((80, 100, 3), 128, dtype=np.uint8)
        decode_reduction = 4
        encoded_original = b"new-frame"

        @staticmethod
        def decode_original():
            raise AssertionError("La captura asincrona no debe decodificar aqui.")

    runtime._detector = Detector()
    monkeypatch.setattr(
        processor_module,
        "draw_face",
        lambda _frame, _detected, label, color: labels.append((label, color)),
    )
    monkeypatch.setattr(processor_module, "encode_preview", lambda *_args: b"preview")

    runtime._capture_packet(Packet(), "primary")

    assert labels
    assert all("Recorte en cola" not in label for label, _color in labels)
    assert all("No guardado: cola llena" in label for label, _color in labels)
    assert all(color == processor_module.AMBER for _label, color in labels)
    status = runtime.status()["persistence"]["original_frames"]
    assert status["dropped"] == 1
    assert status["dropped_faces"] == 1
    assert status["queue_depth"] == 1


def test_raw_persistence_uses_bounded_inline_fallback_without_losing_crop(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._persistence_queue = Queue(maxsize=1)
    observed_at = datetime.now(timezone.utc).astimezone()
    blocker = PersistenceTask(
        kind="raw",
        subject_key="blocker",
        observed_at=observed_at,
        crop=np.zeros((20, 20, 3), dtype=np.uint8),
        similarity=0.0,
        detected_quality=0.9,
        camera_key="primary",
    )
    runtime._persistence_queue.put_nowait(blocker)
    task = PersistenceTask(
        kind="raw",
        subject_key="must-survive",
        observed_at=observed_at,
        crop=np.full((20, 20, 3), 150, dtype=np.uint8),
        similarity=0.0,
        detected_quality=0.95,
        camera_key="primary",
    )
    persisted = []
    monkeypatch.setattr(
        processor_module,
        "RAW_PERSISTENCE_BACKPRESSURE_SECONDS",
        0.02,
    )
    monkeypatch.setattr(
        processor_module,
        "RAW_PERSISTENCE_BACKPRESSURE_SLICE_SECONDS",
        0.005,
    )
    monkeypatch.setattr(
        runtime,
        "_persist_raw_crop_batch",
        lambda tasks: persisted.extend(tasks) or [{}],
    )

    runtime._enqueue_raw_persistence(task)

    assert persisted == [task]
    assert runtime._persistence_inline_completed == 1
    assert runtime._persistence_dropped == 0
    assert runtime._capture_persistence_drained() is True
    status = runtime.status()["persistence"]
    assert status["backpressure_retries"] >= 1
    assert status["inline_completed"] == 1


def test_failed_raw_persistence_is_not_completed_and_stops_before_batch(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._persistence_queue = Queue(maxsize=1)
    observed_at = datetime.now(timezone.utc).astimezone()
    runtime._persistence_queue.put_nowait(
        PersistenceTask(
            kind="raw",
            subject_key="blocker",
            observed_at=observed_at,
            crop=np.zeros((20, 20, 3), dtype=np.uint8),
            similarity=0.0,
            detected_quality=0.9,
            camera_key="primary",
        )
    )
    image = np.full((80, 80, 3), 170, dtype=np.uint8)
    encoded_ok, encoded = cv2.imencode(".jpg", image)
    assert encoded_ok
    detected = DetectedFace((20, 18, 58, 62), None, 0.95, 0.8)
    assert runtime._enqueue_raw_frame(
        RawFrameTask(
            sequence=9,
            observed_at=observed_at,
            camera_key="primary",
            detection_shape=(80, 80),
            detections=(detected,),
            encoded_original=encoded.tobytes(),
        )
    )
    monkeypatch.setattr(
        processor_module,
        "RAW_PERSISTENCE_BACKPRESSURE_SECONDS",
        0.02,
    )
    monkeypatch.setattr(
        processor_module,
        "RAW_PERSISTENCE_BACKPRESSURE_SLICE_SECONDS",
        0.005,
    )
    monkeypatch.setattr(
        runtime,
        "_persist_raw_crop_batch",
        lambda _tasks: (_ for _ in ()).throw(RuntimeError("sqlite QA")),
    )

    runtime._raw_frame_loop()

    assert runtime._stop.is_set()
    assert runtime._raw_frame_completed == 0
    assert runtime._raw_frame_failed == 1
    assert runtime._persistence_failed == 1
    assert runtime._capture_persistence_drained() is False
    assert runtime._state == "error"
    assert "sqlite QA" in runtime._last_error


def test_two_original_frame_workers_decode_concurrently_and_keep_timestamps(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._raw_frame_queue = Queue(maxsize=4)
    observed = [
        datetime.now(timezone.utc).astimezone(),
        datetime.now(timezone.utc).astimezone() + timedelta(milliseconds=10),
    ]
    detected = DetectedFace((10, 10, 40, 40), None, 0.9, 0.8)
    started = []
    both_started = Event()
    release = Event()

    def process(item):
        started.append((item.sequence, item.observed_at))
        if len(started) == 2:
            both_started.set()
        assert release.wait(2)
        return 1

    monkeypatch.setattr(runtime, "_process_raw_frame_task", process)
    for index in range(2):
        assert runtime._enqueue_raw_frame(
            RawFrameTask(
                sequence=index + 1,
                observed_at=observed[index],
                camera_key="primary",
                detection_shape=(100, 100),
                detections=(detected,),
                encoded_original=b"jpeg",
            )
        )
    runtime._raw_frame_threads = [
        Thread(
            target=runtime._raw_frame_loop,
            name=f"test-original-{index}",
            daemon=True,
        )
        for index in range(RAW_FRAME_WORKER_COUNT)
    ]
    for thread in runtime._raw_frame_threads:
        thread.start()

    try:
        assert both_started.wait(2)
        status = runtime.status()["persistence"]["original_frames"]
        assert status["worker_count"] == 2
        assert status["workers_active"] == 2
        assert status["active"] == 2
    finally:
        runtime._stop.set()
        release.set()
        for thread in runtime._raw_frame_threads:
            thread.join(timeout=2)

    assert sorted(started) == [(1, observed[0]), (2, observed[1])]
    assert runtime._raw_frame_completed == 2
    assert runtime._raw_frame_crops_enqueued == 2


def test_raw_persistence_writer_batches_64_crops_without_loss(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._camera_labels = {"primary": "Raspberry"}
    observed_at = datetime.now(timezone.utc).astimezone()
    crop = np.full((48, 36, 3), 150, dtype=np.uint8)
    for index in range(64):
        assert runtime._enqueue_persistence(
            PersistenceTask(
                kind="raw",
                subject_key=f"raw-{index:02d}",
                observed_at=observed_at + timedelta(milliseconds=index),
                crop=crop.copy(),
                similarity=0.0,
                detected_quality=0.9,
                camera_key="primary",
                bbox=(10, 12, 30, 42),
            )
        )

    runtime._stop.set()
    runtime._persistence_loop()

    summary = runtime.store.crop_queue_summary(observed_at.date().isoformat())
    persistence = runtime.status()["persistence"]
    assert summary["captured"] == 64
    assert persistence["completed"] == 64
    assert persistence["failed"] == 0
    assert persistence["dropped"] == 0
    assert persistence["raw_batch"]["batches"] == 1
    assert persistence["raw_batch"]["largest"] == 64
    assert len(list(runtime.store.spool_dir.rglob("*.jpg"))) == 64


def test_raw_persistence_batch_removes_files_when_sqlite_rolls_back(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._camera_labels = {"primary": "Raspberry"}
    observed_at = datetime.now(timezone.utc).astimezone()
    tasks = [
        PersistenceTask(
            kind="raw",
            subject_key=f"rollback-{index}",
            observed_at=observed_at + timedelta(milliseconds=index),
            crop=np.full((48, 36, 3), 150 + index, dtype=np.uint8),
            similarity=0.0,
            detected_quality=0.9,
            camera_key="primary",
            bbox=(10, 12, 30, 42),
        )
        for index in range(3)
    ]
    monkeypatch.setattr(
        runtime.store,
        "enqueue_crops_for_processing",
        lambda _items: (_ for _ in ()).throw(RuntimeError("rollback QA")),
    )

    with pytest.raises(RuntimeError, match="rollback QA"):
        runtime._persist_raw_crop_batch(tasks)

    assert list(runtime.store.spool_dir.rglob("*.jpg")) == []
    assert runtime.store.crop_queue_total_summary()["captured"] == 0


def test_secondary_camera_crop_keeps_its_origin_in_the_night_queue(tmp_path):
    manager = ConfigManager(tmp_path)
    manager.update({
        "secondary_camera_enabled": True,
        "secondary_camera_url": "rtsp://192.168.1.55/live",
        "secondary_camera_label": "Dahua Cancha",
        "secondary_camera_roi_left": 0.0,
        "secondary_camera_roi_right": 1.0,
    })
    runtime = StationRuntime(manager)
    frame = np.full((1520, 2688, 3), 140, dtype=np.uint8)
    landmarks = np.asarray(
        [[1050, 620], [1170, 620], [1110, 700], [1065, 790], [1160, 790]],
        dtype=np.float32,
    )

    class SecondaryCameraDetector:
        def detect(self, source):
            assert source.shape == frame.shape
            return [DetectedFace((960, 540, 1260, 860), None, 0.98, 0.9, landmarks)]

    runtime._detector = SecondaryCameraDetector()
    runtime._camera_labels = {"secondary": "Dahua Cancha"}
    runtime._last_preview_at["secondary"] = __import__("time").monotonic()
    observed_at = datetime.now(timezone.utc).astimezone()

    runtime._capture_frame(frame, observed_at.timestamp(), "secondary")
    task = runtime._persistence_queue.get_nowait()
    assert task.camera_key == "secondary"
    runtime._persist_task(task)
    runtime._persistence_queue.task_done()

    queued = runtime.store.crop_queue(
        selected_date=observed_at.date().isoformat(),
        status="active",
    )["items"][0]
    claimed = runtime.store.claim_pending_crop()

    assert queued["camera_key"] == "secondary"
    assert queued["camera_label"] == "Dahua Cancha"
    assert claimed["camera_key"] == "secondary"
    assert claimed["camera_label"] == "Dahua Cancha"


def test_comparison_engine_stays_lazy_until_the_daily_batch_time(tmp_path, monkeypatch):
    manager = ConfigManager(tmp_path)
    manager.update({
        "night_batch_start_time": "00:30",
        "quality_filter_enabled": False,
    })
    runtime = StationRuntime(manager)
    loaded = []

    class NightEngine:
        def load(self):
            loaded.append("loaded")

        def set_known_database(self, _people, _matrix):
            return None

    monkeypatch.setattr(processor_module, "FaceEngine", lambda _config: NightEngine())

    assert runtime._engine is None
    assert runtime._automatic_batch_due_date(
        datetime(2026, 7, 23, 0, 29, 59).astimezone()
    ) == ""
    assert runtime._automatic_batch_due_date(
        datetime(2026, 7, 23, 0, 30).astimezone()
    ) == "2026-07-23"
    runtime._automatic_batch_completed_date = "2026-07-23"
    assert runtime._automatic_batch_due_date(
        datetime(2026, 7, 23, 23, 59).astimezone()
    ) == ""
    assert runtime._automatic_batch_due_date(
        datetime(2026, 7, 24, 0, 30).astimezone()
    ) == "2026-07-24"

    runtime._ensure_night_pipeline()
    runtime._ensure_night_pipeline()

    assert isinstance(runtime._engine, NightEngine)
    assert loaded == ["loaded"]


def test_store_merges_unknown_groups_and_redirects_pending_writes(tmp_path):
    store = LocalStore(tmp_path)
    first_seen = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc).astimezone()
    subjects = []
    for index, quality in enumerate((0.74, 0.81, 0.92), start=1):
        crop = store.faces_dir / first_seen.date().isoformat() / "unknown" / f"merge-{index}.jpg"
        crop.parent.mkdir(parents=True, exist_ok=True)
        crop.write_bytes(f"crop-{index}".encode())
        subject = store.create_unknown(
            normalized(50 + index),
            first_seen + timedelta(minutes=index),
            str(crop),
            quality,
            temporary_name=f"Desconocido QA {index}",
            subject_id=f"unknown-merge-{index}",
            quality_pass=True,
            quality_payload={"accepted": True, "index": index},
            analysis_version="test-quality-v1",
        )
        store.record_crop(
            subject["subject_id"],
            "unknown",
            first_seen + timedelta(minutes=index),
            str(crop),
            0.6 + index / 100,
            quality,
            "Raspberry",
            embedding=normalized(50 + index),
            quality_pass=True,
        )
        queued = store.enqueue_crop_for_processing(
            captured_at=first_seen + timedelta(minutes=index),
            camera_key="primary",
            camera_label="Raspberry",
            crop_path=str(crop),
            file_bytes=crop.stat().st_size,
            crop_width=120,
            crop_height=160,
            det_score=0.9,
            bbox=(10, 20, 130, 180),
            landmarks=None,
        )
        store.finish_crop_processing(
            queued["id"],
            status="processed",
            result_kind="unknown",
            result_key=subject["subject_id"],
            result_name=subject["temporary_name"],
            similarity=0.6 + index / 100,
        )
        subjects.append(subject)

    store.upsert_presence(
        subjects[1]["subject_id"],
        "unknown",
        first_seen + timedelta(days=1),
        0.83,
        subjects[1]["best_crop_path"],
    )
    result = store.merge_unknowns(
        subjects[2]["subject_id"],
        [subjects[0]["subject_id"], subjects[1]["subject_id"]],
    )

    assert result["target"]["subject_id"] == subjects[2]["subject_id"]
    assert result["target"]["temporary_name"] == "Desconocido QA 3"
    assert result["target"]["detection_count"] == 3
    assert result["target"]["best_quality"] == 0.92
    assert Path(result["backup_path"]).is_file()
    assert result["crops_moved"] == 2
    assert result["queue_results_moved"] == 2
    assert result["attendance_rows_merged"] == 3
    assert len(store.detection_detail("unknown", subjects[2]["subject_id"], "2026-07-22")["crops"]) == 3
    assert store.detection_summary("2026-07-22") == {"subjects": 1, "detections": 3}
    assert store.monthly_attendance("2026-07", kind="unknown")["summary"]["attendance_days"] == 2

    rows, _ = store.unknown_database()
    assert [row["subject_id"] for row in rows] == [subjects[2]["subject_id"]]
    assert store.get_unknown(subjects[0]["subject_id"])["subject_id"] == subjects[2]["subject_id"]
    with store.connection() as db:
        archived = list(
            db.execute(
                """
                select subject_id,status,merged_into from unknown_subjects
                where subject_id in (?,?) order by subject_id
                """,
                (subjects[0]["subject_id"], subjects[1]["subject_id"]),
            )
        )
        queue_results = list(
            db.execute(
                """
                select result_key,result_name from crop_processing_queue
                order by id
                """
            )
        )
    assert all(row["status"] == "archived" for row in archived)
    assert all(row["merged_into"] == subjects[2]["subject_id"] for row in archived)
    assert all(row["result_key"] == subjects[2]["subject_id"] for row in queue_results)
    assert all(row["result_name"] == "Desconocido QA 3" for row in queue_results)

    redirected = store.update_unknown(
        subjects[0]["subject_id"],
        normalized(99),
        first_seen + timedelta(minutes=10),
        str(tmp_path / "pending-write.jpg"),
        0.2,
    )
    assert redirected["subject_id"] == subjects[2]["subject_id"]
    assert redirected["detection_count"] == 4
    assert store.detection_summary("2026-07-22") == {"subjects": 1, "detections": 4}


def test_store_excludes_unknown_from_attendance_but_keeps_recognition_reference(tmp_path):
    store = LocalStore(tmp_path)
    observed_at = datetime(2026, 7, 22, 17, 30, tzinfo=timezone.utc).astimezone()
    crop = store.faces_dir / observed_at.date().isoformat() / "unknown" / "ignored.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"ignored-face")
    embedding = normalized(108)
    subject = store.create_unknown(
        embedding,
        observed_at,
        str(crop),
        0.91,
        subject_id="unknown-ignored",
        temporary_name="Desconocido Excluido",
        quality_pass=True,
        quality_payload={"accepted": True},
        analysis_version="test-quality-v1",
    )
    store.record_crop(
        subject["subject_id"],
        "unknown",
        observed_at,
        str(crop),
        0.82,
        0.91,
        "Raspberry",
        embedding=embedding,
        quality_pass=True,
    )

    assert len(store.dashboard("2026-07-22")["unknown"]) == 1
    assert store.detection_summary("2026-07-22") == {"subjects": 1, "detections": 1}
    assert store.monthly_attendance("2026-07", kind="unknown")["summary"]["people"] == 1

    result = store.set_unknowns_ignored([subject["subject_id"]], True)

    assert result["ignored"] is True
    assert result["names"] == ["Desconocido Excluido"]
    rows, matrix = store.unknown_database()
    assert rows[0]["status"] == "ignored"
    assert rows[0]["subject_id"] == subject["subject_id"]
    assert np.allclose(matrix[0], embedding)
    assert store.dashboard("2026-07-22")["unknown"] == []
    assert store.recent_detections("2026-07-22") == []
    assert store.detection_summary("2026-07-22") == {"subjects": 0, "detections": 0}
    assert store.monthly_attendance("2026-07", kind="unknown")["summary"]["people"] == 0
    ignored = store.ignored_unknowns(query="excluido")
    assert ignored["total"] == 1
    assert ignored["items"][0]["subject_id"] == subject["subject_id"]
    ignored_update = store.update_unknown(
        subject["subject_id"],
        normalized(110),
        observed_at + timedelta(minutes=1),
        str(tmp_path / "must-not-be-used.jpg"),
        0.99,
        quality_pass=True,
    )
    assert ignored_update["status"] == "ignored"
    assert ignored_update["detection_count"] == 1
    assert store.record_crop(
        subject["subject_id"],
        "unknown",
        observed_at + timedelta(minutes=1),
        str(tmp_path / "must-not-be-recorded.jpg"),
        0.99,
        0.99,
    ) is False

    restored = store.set_unknowns_ignored([subject["subject_id"]], False)

    assert restored["ignored"] is False
    assert store.get_unknown(subject["subject_id"])["status"] == "consolidated"
    assert len(store.dashboard("2026-07-22")["unknown"]) == 1
    assert len(store.recent_detections("2026-07-22")) == 1
    assert store.monthly_attendance("2026-07", kind="unknown")["summary"]["people"] == 1


def test_store_quarantines_invalid_unknown_without_deleting_audit_evidence(tmp_path):
    store = LocalStore(tmp_path)
    observed_at = datetime(2026, 7, 22, 17, 30, tzinfo=timezone.utc).astimezone()
    crop = store.faces_dir / observed_at.date().isoformat() / "unknown" / "invalid.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"invalid-face")
    embedding = normalized(111)
    subject = store.create_unknown(
        embedding,
        observed_at,
        str(crop),
        0.91,
        subject_id="unknown-quarantined",
        temporary_name="Desconocido Invalido",
        quality_pass=True,
        quality_payload={"accepted": True, "score": 0.91},
        analysis_version="test-quality-v1",
    )
    assert store.record_crop(
        subject["subject_id"],
        "unknown",
        observed_at,
        str(crop),
        0.82,
        0.91,
        "Raspberry",
        embedding=embedding,
        quality_pass=True,
    )
    spool_crop = store.spool_dir / observed_at.date().isoformat() / "camera" / "queued.jpg"
    spool_crop.parent.mkdir(parents=True)
    spool_crop.write_bytes(b"queued-face")
    queued = store.enqueue_crop_for_processing(
        captured_at=observed_at,
        camera_key="camera",
        camera_label="Raspberry",
        crop_path=str(spool_crop),
        file_bytes=spool_crop.stat().st_size,
        crop_width=128,
        crop_height=128,
        det_score=0.9,
        bbox=(0, 0, 128, 128),
        landmarks=None,
    )
    assert store.finish_crop_processing(
        queued["id"],
        status="processed",
        result_kind="unknown",
        result_key=subject["subject_id"],
        result_name=subject["temporary_name"],
        similarity=0.82,
    )
    with store.connection() as db:
        db.execute(
            """
            insert into daily_detection_stats
                (subject_key,subject_kind,evidence_date,detection_count,
                 first_seen_at,last_seen_at,retained_count,curated_at)
            values (?,'unknown',?,1,?,?,1,?)
            """,
            (
                subject["subject_id"],
                observed_at.date().isoformat(),
                observed_at.isoformat(),
                observed_at.isoformat(),
                observed_at.isoformat(),
            ),
        )

    result = store.quarantine_unknown(
        subject["subject_id"],
        "Landmarks imposibles; identidad compuesta por personas distintas.",
    )

    assert result["quarantined"] is True
    assert result["already_quarantined"] is False
    assert result["attendance_rows_hidden"] == 1
    assert result["attendance_detections_hidden"] == 1
    assert result["references_preserved"] == 1
    assert result["crops_preserved"] == 1
    assert result["queue_rows_preserved"] == 1
    assert Path(result["backup_path"]).is_file()
    quarantined = store.get_unknown(subject["subject_id"])
    assert quarantined["status"] == "quarantined"
    assert json.loads(quarantined["quality_json"])["quarantine"]["previous_status"] == "consolidated"

    rows, matrix = store.unknown_database()
    assert rows == []
    assert matrix.shape == (0, 512)
    reference_rows, reference_matrix = store.unknown_reference_database()
    assert reference_rows == []
    assert reference_matrix.shape == (0, 512)
    assert store.dashboard("2026-07-22")["unknown"] == []
    assert store.recent_detections("2026-07-22") == []
    assert store.detection_summary("2026-07-22") == {"subjects": 0, "detections": 0}
    assert store.monthly_attendance("2026-07", kind="unknown")["summary"]["people"] == 0

    detail = store.detection_detail(
        "unknown",
        subject["subject_id"],
        selected_month="2026-07",
    )
    assert detail["subject"]["status"] == "quarantined"
    assert len(detail["crops"]) == 1
    with store.connection() as db:
        assert db.execute(
            "select count(*) from unknown_references where subject_id=?",
            (subject["subject_id"],),
        ).fetchone()[0] == 1
        assert db.execute(
            "select count(*) from daily_detection_stats where subject_key=?",
            (subject["subject_id"],),
        ).fetchone()[0] == 1
        assert db.execute(
            "select count(*) from crop_processing_queue where result_key=?",
            (subject["subject_id"],),
        ).fetchone()[0] == 1
        assert db.execute(
            "select count(*) from daily_presence where subject_key=?",
            (subject["subject_id"],),
        ).fetchone()[0] == 1

    stale_update = store.update_unknown(
        subject["subject_id"],
        normalized(112),
        observed_at + timedelta(minutes=1),
        str(tmp_path / "must-not-be-used.jpg"),
        0.99,
        quality_pass=True,
    )
    assert stale_update["status"] == "quarantined"
    assert stale_update["detection_count"] == 1
    assert store.record_crop(
        subject["subject_id"],
        "unknown",
        observed_at + timedelta(minutes=1),
        str(tmp_path / "must-not-be-recorded.jpg"),
        0.99,
        0.99,
    ) is False

    with sqlite3.connect(result["backup_path"]) as backup:
        assert backup.execute(
            "select status from unknown_subjects where subject_id=?",
            (subject["subject_id"],),
        ).fetchone()[0] == "consolidated"
        assert backup.execute(
            "select count(*) from daily_presence where subject_key=?",
            (subject["subject_id"],),
        ).fetchone()[0] == 1
        assert backup.execute("pragma integrity_check").fetchone()[0] == "ok"

    repeated = store.quarantine_unknown(
        subject["subject_id"],
        "Este segundo intento no debe cambiar la auditoria original.",
    )
    assert repeated["already_quarantined"] is True
    assert repeated["backup_path"] == ""
    repeated_payload = json.loads(
        store.get_unknown(subject["subject_id"])["quality_json"]
    )["quarantine"]
    assert repeated_payload["previous_status"] == "consolidated"
    assert repeated_payload["reason"].startswith("Landmarks imposibles")
    quarantined_listing = store.quarantined_unknowns(query="invalido")
    assert quarantined_listing["total"] == 1
    assert quarantined_listing["items"][0]["subject_id"] == subject["subject_id"]
    assert quarantined_listing["items"][0]["quarantine_reason"].startswith(
        "Landmarks imposibles"
    )


def test_store_registers_unknown_as_student_with_selected_crop_and_moves_attendance(tmp_path):
    store = LocalStore(tmp_path)
    observed_at = datetime(2026, 7, 22, 17, 30, tzinfo=timezone.utc).astimezone()
    store.replace_bootstrap(
        [],
        [
            {
                "id": 77,
                "type": "academy_class",
                "date": observed_at.date().isoformat(),
                "starts_at": "11:00:00",
                "ends_at": "13:00:00",
                "duration_minutes": 120,
                "label": "Academia",
                "closed": False,
                "roster": [],
            }
        ],
    )
    crops = []
    subject = None
    for index, quality in enumerate((0.41, 0.88), start=1):
        crop = (
            store.faces_dir
            / observed_at.date().isoformat()
            / "unknown"
            / f"student-{index}.jpg"
        )
        crop.parent.mkdir(parents=True, exist_ok=True)
        crop.write_bytes(f"student-crop-{index}".encode())
        if subject is None:
            subject = store.create_unknown(
                normalized(70),
                observed_at,
                str(crop),
                quality,
                temporary_name="Desconocido Alta QA",
                subject_id="unknown-student-qa",
                quality_pass=True,
                quality_payload={"accepted": True},
                analysis_version="test-quality-v1",
            )
        store.record_crop(
            subject["subject_id"],
            "unknown",
            observed_at + timedelta(seconds=index),
            str(crop),
            0.6 + index / 100,
            quality,
            "Raspberry",
            embedding=normalized(70 + index),
            quality_pass=True,
        )
        crops.append(crop)

    registration = store.unknown_registration_crops(subject["subject_id"])
    selected_crop_id = next(
        row["id"] for row in registration["crops"] if row["quality"] == 0.88
    )
    assert registration["suggested_crop_id"] == selected_crop_id
    crop_evidence = store.unknown_registration_crop(
        subject["subject_id"],
        selected_crop_id,
    )
    person = {
        "key": "student:9001",
        "type": "student",
        "id": 9001,
        "name": "Alumna Nueva Local",
        "group_name": "",
        "team_name": "",
        "photo_url": "/api/face-station/people/student/9001/photo/",
        "reference_version": "v1:selected-crop",
    }
    registered = store.register_student_from_unknown(
        subject["subject_id"],
        selected_crop_id,
        person,
        crop_evidence["embedding"],
        "remote-subject-qa",
        {f"{observed_at.date().isoformat()}:-1": 77},
    )

    assert registered["person_key"] == "student:9001"
    assert registered["name"] == "Alumna Nueva Local"
    assert registered["photo_path"] == str(crops[1].resolve())
    dashboard = store.dashboard(observed_at.date().isoformat())
    assert [row["name"] for row in dashboard["known"]] == ["Alumna Nueva Local"]
    assert dashboard["known"][0]["session_id"] == 77
    assert dashboard["unknown"] == []
    assert store.monthly_attendance("2026-07", kind="known")["summary"]["attendance_days"] == 1
    assert (
        store.detection_detail(
            "known",
            "student:9001",
            observed_at.date().isoformat(),
        )["summary"]["crops"]
        == 2
    )
    linked = store.get_unknown(subject["subject_id"])
    assert linked["status"] == "linked"
    assert linked["linked_person_key"] == "student:9001"
    with store.connection() as db:
        roster = json.loads(
            db.execute(
                "select roster_json from sessions where remote_id=77"
            ).fetchone()[0]
        )
    assert roster == ["student:9001"]


def test_store_registers_unknown_as_collaborator_without_academy_session(tmp_path):
    store = LocalStore(tmp_path)
    observed_at = datetime(2026, 7, 22, 17, 30, tzinfo=timezone.utc).astimezone()
    crop = store.faces_dir / observed_at.date().isoformat() / "unknown" / "collaborator.jpg"
    crop.parent.mkdir(parents=True, exist_ok=True)
    crop.write_bytes(b"collaborator-crop")
    subject = store.create_unknown(
        normalized(170),
        observed_at,
        str(crop),
        0.91,
        temporary_name="Desconocido Colaborador QA",
        subject_id="unknown-collaborator-qa",
        quality_pass=True,
        quality_payload={"accepted": True},
        analysis_version="test-quality-v1",
    )
    store.record_crop(
        subject["subject_id"],
        "unknown",
        observed_at,
        str(crop),
        0.81,
        0.91,
        "Raspberry",
        embedding=normalized(170),
        quality_pass=True,
    )
    registration = store.unknown_registration_crops(subject["subject_id"])
    selected_crop_id = registration["suggested_crop_id"]
    evidence = store.unknown_registration_crop(subject["subject_id"], selected_crop_id)
    person = {
        "key": "collaborator:7001",
        "type": "collaborator",
        "id": 7001,
        "name": "Colaboradora Nueva Local",
        "group_name": "Colaborador",
        "team_name": "",
        "photo_url": "/api/face-station/people/collaborator/7001/photo/",
        "reference_version": "v1:selected-crop",
    }

    registered = store.register_person_from_unknown(
        subject["subject_id"],
        selected_crop_id,
        person,
        evidence["embedding"],
        "remote-collaborator-qa",
        {},
        expected_person_type="collaborator",
    )

    dashboard = store.dashboard(observed_at.date().isoformat())
    assert registered["person_key"] == "collaborator:7001"
    assert registered["person_type"] == "collaborator"
    assert dashboard["known"][0]["name"] == "Colaboradora Nueva Local"
    assert dashboard["known"][0]["session_id"] == -1
    assert dashboard["unknown"] == []
    assert store.get_unknown(subject["subject_id"])["linked_person_key"] == "collaborator:7001"


def test_reprocess_promotes_only_the_coherent_medoid_core(tmp_path):
    now = datetime.now(timezone.utc).astimezone()
    base = np.zeros(512, dtype=np.float32)
    base[0] = 1.0
    coherent_embeddings = []
    for index in range(3):
        embedding = base.copy()
        embedding[index + 1] = 0.04 * (index + 1)
        embedding /= np.linalg.norm(embedding)
        coherent_embeddings.append(embedding)
    outlier = np.zeros(512, dtype=np.float32)
    outlier[20] = 1.0
    good = FaceQualityResult(True, 0.9, ())
    rejected = FaceQualityResult(False, 0.2, ("desenfoque",))
    samples = [
        CropAnalysis(
            crop_id=index + 1,
            old_subject_key=f"old-{index}",
            path=tmp_path / f"crop-{index}.jpg",
            seen_at=now + timedelta(seconds=index * 2),
            camera="QA",
            quality=good if index == 0 else rejected,
            embedding=embedding,
        )
        for index, embedding in enumerate([*coherent_embeddings, outlier])
    ]
    cluster = UnknownCluster(samples=samples)

    promoted = promote_clusters([cluster], now.date().isoformat())

    assert promoted == [cluster]
    assert cluster.raw_count == 4
    assert len(cluster.samples) == 3
    assert cluster.temporal_evidence == 3
    assert all(sample.assignment_kind == "unknown" for sample in samples[:3])
    assert samples[3].assignment_kind == "candidate"


def test_reprocess_promotes_one_reference_quality_frontal_crop(tmp_path):
    now = datetime.now(timezone.utc).astimezone()
    sample = CropAnalysis(
        crop_id=1,
        old_subject_key="candidate-1",
        path=tmp_path / "frontal.jpg",
        seen_at=now,
        camera="QA",
        quality=FaceQualityResult(True, 0.82, ()),
        embedding=normalized(41),
    )
    cluster = UnknownCluster(samples=[sample])

    promoted = promote_clusters([cluster], now.date().isoformat())

    assert promoted == [cluster]
    assert sample.assignment_kind == "unknown"
    assert cluster.temporal_evidence == 1
    assert np.allclose(cluster.centroid, sample.embedding)


def test_runtime_restores_recent_detections_from_local_store(tmp_path):
    manager = ConfigManager(tmp_path)
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    embedding = normalized(15)
    subject = store.create_unknown(
        embedding,
        now,
        str(tmp_path / "crop.jpg"),
        0.81,
        quality_pass=True,
    )
    subject = store.update_unknown(
        subject["subject_id"],
        embedding,
        now + timedelta(seconds=3),
        str(tmp_path / "second-crop.jpg"),
        0.75,
    )

    runtime = StationRuntime(manager)
    recent = runtime.status()["recent"]

    assert len(recent) == 1
    assert recent[0]["subject_key"] == subject["subject_id"]
    assert recent[0]["name"] == subject["temporary_name"]
    assert recent[0]["seen_at"] == (now + timedelta(seconds=3)).isoformat()
    assert recent[0]["detection_count"] == 2
    assert runtime.status()["recent_total_today"] == 2
    assert store.detection_summary(now.date().isoformat()) == {"subjects": 1, "detections": 2}

    presence = store.upsert_presence(
        subject["subject_id"],
        "unknown",
        now + timedelta(seconds=6),
        0.62,
        str(tmp_path / "third-crop.jpg"),
    )

    runtime._record_recent(
        "unknown",
        subject["temporary_name"],
        0.62,
        str(tmp_path / "second-crop.jpg"),
        now + timedelta(seconds=6),
        subject["subject_id"],
        "primary",
        presence["detection_count"],
    )

    assert runtime.status()["recent_visible"] == 1
    assert runtime.status()["recent_subjects_today"] == 1
    assert runtime.status()["recent_total_today"] == 3
    assert runtime.status()["recent"][0]["detection_count"] == 3


def test_unknown_quality_and_persistence_run_in_background_queue(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    runtime._camera_labels = {"primary": "QA"}
    now = datetime.now(timezone.utc).astimezone()
    frame = np.full((720, 1280, 3), 170, dtype=np.uint8)
    detected = DetectedFace((420, 180, 620, 430), normalized(49), 0.93, 0.86)

    provisional = runtime._handle_unknown(detected, None, 0.0, now, frame, "primary")

    assert provisional["status"] == "candidate"
    assert runtime._persistence_queue.qsize() == 1
    try:
        runtime.store.get_unknown(provisional["subject_id"])
    except LookupError:
        pass
    else:
        raise AssertionError("La deteccion no debe escribir SQLite antes de que trabaje la cola.")

    worker = Thread(target=runtime._persistence_loop, daemon=True)
    runtime._persistence_thread = worker
    worker.start()
    runtime._persistence_queue.join()
    runtime._stop.set()
    worker.join(timeout=5)

    stored = runtime.store.get_unknown(provisional["subject_id"])
    recent = runtime.store.recent_detections(now.date().isoformat())
    persistence = runtime.status()["persistence"]
    assert stored["status"] == "consolidated"
    assert recent[0]["subject_key"] == provisional["subject_id"]
    assert persistence["queue_depth"] == 0
    assert persistence["completed"] == 1
    assert persistence["failed"] == 0
    assert persistence["dropped"] == 0


def test_recent_detections_supports_grouped_pagination(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    for index in range(3):
        store.create_unknown(
            normalized(50 + index),
            now + timedelta(seconds=index),
            str(tmp_path / f"crop-{index}.jpg"),
            0.8,
            subject_id=f"subject-{index}",
            temporary_name=f"Desconocido {index}",
            quality_pass=True,
        )

    first_page = store.recent_detections(now.date().isoformat(), limit=2, offset=0)
    second_page = store.recent_detections(now.date().isoformat(), limit=2, offset=2)

    assert [row["subject_key"] for row in first_page] == ["subject-2", "subject-1"]
    assert [row["subject_key"] for row in second_page] == ["subject-0"]
    assert store.detection_summary(now.date().isoformat()) == {"subjects": 3, "detections": 3}


def test_monthly_attendance_counts_distinct_days_for_known_and_unknown(tmp_path):
    store = LocalStore(tmp_path)
    store.replace_bootstrap(
        [{
            "key": "student:77",
            "type": "student",
            "id": 77,
            "name": "Alumno Mensual",
            "group_name": "Sub 12",
            "reference_version": "",
        }],
        [],
        [{
            "person_key": "student:77",
            "month": "2026-07",
            "payment_count": 2,
            "amount": "650.00",
            "last_paid_at": "2026-07-18T18:30:00-06:00",
        }],
    )
    july_second = datetime(2026, 7, 2, 18, tzinfo=timezone.utc).astimezone()
    store.upsert_presence("student:77", "known", july_second, 0.71)
    store.upsert_presence("student:77", "known", july_second + timedelta(minutes=2), 0.75)
    store.upsert_presence("student:77", "known", july_second + timedelta(days=13), 0.78)
    store.upsert_presence("student:77", "known", july_second + timedelta(days=30), 0.80)

    july_third = july_second + timedelta(days=1)
    unknown = store.create_unknown(
        normalized(61),
        july_third,
        str(tmp_path / "monthly-unknown.jpg"),
        0.82,
        quality_pass=True,
    )
    store.upsert_presence(unknown["subject_id"], "unknown", july_third + timedelta(days=17), 0.84)

    monthly = store.monthly_attendance("2026-07")
    known_only = store.monthly_attendance("2026-07", query="alumno", kind="known")
    unknown_only = store.monthly_attendance("2026-07", kind="unknown")
    second_page = store.monthly_attendance("2026-07", offset=1, limit=1)

    assert monthly["summary"] == {
        "people": 2,
        "known": 1,
        "unknown": 1,
        "attendance_days": 4,
        "sessions": 4,
        "detections": 5,
        "expected_payers": 1,
        "expected_revenue": 1000.0,
        "payment_registered": 1,
        "payment_missing": 0,
    }
    assert monthly["revenue_policy"] == {
        "monthly_fee_amount": 1000.0,
        "minimum_attendance_days": 3,
        "registered_minimum_attendance_days": 1,
        "unknown_minimum_attendance_days": 3,
    }
    assert {row["subject_key"]: row["attendance_days"] for row in monthly["items"]} == {
        "student:77": 2,
        unknown["subject_id"]: 2,
    }
    assert [row["name"] for row in known_only["items"]] == ["Alumno Mensual"]
    assert known_only["items"][0]["payment_applicable"] == 1
    assert known_only["items"][0]["payment_registered"] == 1
    assert known_only["items"][0]["payment_count"] == 2
    assert known_only["items"][0]["payment_amount"] == pytest.approx(650.0)
    assert known_only["items"][0]["last_paid_at"] == "2026-07-18T18:30:00-06:00"
    assert known_only["items"][0]["expected_fee_minimum_days"] == 1
    assert known_only["items"][0]["expected_fee_eligible"] == 1
    assert [row["subject_kind"] for row in unknown_only["items"]] == ["unknown"]
    assert unknown_only["items"][0]["payment_applicable"] == 0
    assert unknown_only["items"][0]["expected_fee_minimum_days"] == 3
    assert unknown_only["items"][0]["expected_fee_eligible"] == 0
    assert len(second_page["items"]) == 1
    assert monthly["total"] == 2


def test_monthly_expected_revenue_uses_one_day_for_registered_and_three_for_unknown(tmp_path):
    store = LocalStore(tmp_path)
    store.replace_bootstrap(
        [{
            "key": "student:registered",
            "type": "student",
            "id": 91,
            "name": "Alumno registrado sin pago",
            "reference_version": "",
        }],
        [],
    )
    first_day = datetime(2026, 7, 1, 18, tzinfo=timezone.utc).astimezone()
    store.upsert_presence("student:registered", "known", first_day, 0.75)
    for day_offset in range(3):
        store.upsert_presence(
            "unknown-three-days",
            "unknown",
            first_day + timedelta(days=day_offset),
            0.75,
        )
    for day_offset in range(2):
        store.upsert_presence(
            "unknown-two-days",
            "unknown",
            first_day + timedelta(days=day_offset),
            0.75,
        )

    monthly = store.monthly_attendance("2026-07", monthly_fee_amount=1250)
    rows = {row["subject_key"]: row for row in monthly["items"]}

    assert monthly["summary"]["expected_payers"] == 2
    assert monthly["summary"]["expected_revenue"] == pytest.approx(2500.0)
    assert monthly["summary"]["payment_missing"] == 1
    assert monthly["revenue_policy"] == {
        "monthly_fee_amount": 1250.0,
        "minimum_attendance_days": 3,
        "registered_minimum_attendance_days": 1,
        "unknown_minimum_attendance_days": 3,
    }
    assert rows["student:registered"]["payment_registered"] == 0
    assert rows["student:registered"]["expected_fee_minimum_days"] == 1
    assert rows["student:registered"]["expected_fee_eligible"] == 1
    assert rows["student:registered"]["expected_monthly_amount"] == pytest.approx(1250.0)
    assert rows["unknown-three-days"]["expected_fee_minimum_days"] == 3
    assert rows["unknown-three-days"]["expected_fee_eligible"] == 1
    assert rows["unknown-three-days"]["expected_monthly_amount"] == pytest.approx(1250.0)
    assert rows["unknown-two-days"]["expected_fee_minimum_days"] == 3
    assert rows["unknown-two-days"]["expected_fee_eligible"] == 0
    assert rows["unknown-two-days"]["expected_monthly_amount"] == pytest.approx(0.0)


def test_monthly_expected_revenue_excludes_collaborators_but_keeps_their_attendance(tmp_path):
    store = LocalStore(tmp_path)
    store.replace_bootstrap(
        [
            {
                "key": "student:monthly-revenue",
                "type": "student",
                "id": 201,
                "name": "Alumno con cuota",
                "reference_version": "",
            },
            {
                "key": "collaborator:monthly-revenue",
                "type": "collaborator",
                "id": 202,
                "name": "Colaborador sin cuota",
                "reference_version": "",
            },
        ],
        [],
    )
    observed_at = datetime(2026, 7, 8, 18, tzinfo=timezone.utc).astimezone()
    store.upsert_presence("student:monthly-revenue", "known", observed_at, 0.80)
    store.upsert_presence(
        "collaborator:monthly-revenue",
        "known",
        observed_at,
        0.80,
    )

    monthly = store.monthly_attendance("2026-07")
    rows = {row["subject_key"]: row for row in monthly["items"]}

    assert monthly["summary"]["people"] == 2
    assert monthly["summary"]["expected_payers"] == 1
    assert monthly["summary"]["expected_revenue"] == pytest.approx(1000.0)
    assert rows["student:monthly-revenue"]["expected_fee_applicable"] == 1
    assert rows["student:monthly-revenue"]["expected_fee_eligible"] == 1
    assert rows["collaborator:monthly-revenue"]["expected_fee_applicable"] == 0
    assert rows["collaborator:monthly-revenue"]["expected_fee_eligible"] == 0
    assert rows["collaborator:monthly-revenue"]["expected_monthly_amount"] == 0

    financial = store.monthly_attendance("2026-07", revenue_only=True)

    assert financial["total"] == 1
    assert [row["subject_key"] for row in financial["items"]] == [
        "student:monthly-revenue"
    ]
    assert financial["summary"]["expected_revenue"] == pytest.approx(1000.0)


def test_match_analysis_detects_ten_unique_people_in_fifty_minutes(tmp_path):
    store = LocalStore(tmp_path)
    people = [
        {
            "key": f"student:match-{index}",
            "type": "student",
            "id": 200 + index,
            "name": f"Jugador {index}",
            "reference_version": "",
        }
        for index in range(10)
    ]
    collaborator = {
        "key": "collaborator:match-staff",
        "type": "collaborator",
        "id": 299,
        "name": "Personal de cancha",
        "reference_version": "",
    }
    store.replace_bootstrap([*people, collaborator], [])
    match_start = datetime(2026, 7, 20, 18, tzinfo=timezone.utc).astimezone()
    clear_start = match_start + timedelta(days=1)

    with store.connection(immediate=True) as db:
        for index, person in enumerate(people):
            observed_at = match_start + timedelta(minutes=index * 5)
            db.execute(
                """
                insert into face_crops
                    (subject_key,subject_kind,seen_at,crop_path,
                     similarity,quality,camera,created_at)
                values (?,'known',?,?,?,?,?,?)
                """,
                (
                    person["key"],
                    observed_at.isoformat(),
                    str(tmp_path / f"match-{index}.jpg"),
                    0.8,
                    80 + index,
                    "camera-1",
                    observed_at.isoformat(),
                ),
            )
        for index, person in enumerate(people[:9]):
            observed_at = clear_start + timedelta(minutes=index * 5)
            db.execute(
                """
                insert into face_crops
                    (subject_key,subject_kind,seen_at,crop_path,
                     similarity,quality,camera,created_at)
                values (?,'known',?,?,?,?,?,?)
                """,
                (
                    person["key"],
                    observed_at.isoformat(),
                    str(tmp_path / f"clear-{index}.jpg"),
                    0.8,
                    80 + index,
                    "camera-1",
                    observed_at.isoformat(),
                ),
            )
        for observed_at, suffix in (
            (match_start + timedelta(minutes=20), "match"),
            (clear_start + timedelta(minutes=20), "clear"),
        ):
            db.execute(
                """
                insert into face_crops
                    (subject_key,subject_kind,seen_at,crop_path,
                     similarity,quality,camera,created_at)
                values (?,'known',?,?,?,?,?,?)
                """,
                (
                    collaborator["key"],
                    observed_at.isoformat(),
                    str(tmp_path / f"{suffix}-collaborator.jpg"),
                    0.8,
                    95,
                    "camera-1",
                    observed_at.isoformat(),
                ),
            )
    for person in people:
        store.upsert_presence(
            person["key"],
            "known",
            match_start,
            0.8,
        )
    for person in people[:9]:
        store.upsert_presence(
            person["key"],
            "known",
            clear_start,
            0.8,
        )
    store.upsert_presence(
        collaborator["key"],
        "known",
        match_start + timedelta(minutes=20),
        0.8,
    )
    store.upsert_presence(
        collaborator["key"],
        "known",
        clear_start + timedelta(minutes=20),
        0.8,
    )

    result = store.analyze_match_history(force=True)
    history = store.match_history()

    assert result["last_error"] == ""
    assert history["summary"] == {
        "total_days": 2,
        "detected_days": 1,
        "clear_days": 1,
        "processing_days": 0,
        "total_windows": 1,
        "scheduled_matches": 8,
        "scheduled_confirmed": 0,
        "scheduled_unconfirmed": 8,
        "unscheduled_matches": 1,
        "first_date": "2026-07-20",
        "last_date": "2026-07-21",
    }
    detected_day = next(
        item for item in history["items"]
        if item["analysis_date"] == "2026-07-20"
    )
    clear_day = next(
        item for item in history["items"]
        if item["analysis_date"] == "2026-07-21"
    )
    assert detected_day["match_detected"] == 1
    assert detected_day["max_unique_people"] == 10
    outside_window = next(
        window for window in detected_day["windows"]
        if window["window_type"] == "unscheduled"
    )
    assert len(detected_day["windows"]) == 5
    assert outside_window["duration_minutes"] == 50
    assert (
        datetime.fromisoformat(outside_window["ends_at"])
        - datetime.fromisoformat(outside_window["starts_at"])
        == timedelta(minutes=50)
    )
    assert outside_window["participant_count"] == 10
    assert outside_window["participants"] == []
    with store.connection(immediate=True) as db:
        stored_participants = json.loads(db.execute(
            """
            select participants_json from match_analysis_windows
            where id=?
            """,
            (outside_window["id"],),
        ).fetchone()[0])
        for stored_participant in stored_participants:
            stored_participant.pop("best_crop_seen_at", None)
        db.execute(
            """
            update match_analysis_windows set participants_json=?
            where id=?
            """,
            (
                json.dumps(stored_participants),
                outside_window["id"],
            ),
        )
    participants = store.match_window_participants(
        outside_window["id"]
    )
    assert participants is not None
    assert participants["total"] == 10
    assert len(participants["items"]) == 10
    assert all(
        item["person_type"] != "collaborator"
        for item in participants["items"]
    )
    assert all(
        item["best_crop_seen_at"]
        for item in participants["items"]
    )
    assert {
        item["key"]: item["best_crop_seen_at"]
        for item in participants["items"]
    } == {
        person["key"]: (
            match_start + timedelta(minutes=index * 5)
        ).isoformat()
        for index, person in enumerate(people)
    }
    assert clear_day["match_detected"] == 0
    assert clear_day["max_unique_people"] == 9


def test_match_analysis_keeps_a_fast_arrival_as_a_full_fifty_minute_window():
    starts_at = datetime(2026, 7, 20, 18, tzinfo=timezone.utc).astimezone()

    def event(index: int, seen_at: datetime) -> dict:
        return {
            "id": index + 1,
            "seen_at": seen_at.isoformat(),
            "crop_path": f"/tmp/match-{index}.jpg",
            "quality": 90 - index,
            "quality_pass": 1,
            "evidence_selected": 1,
            "evidence_score": 0.9,
            "camera": "camera-1",
            "identity_kind": "known",
            "identity_key": f"student:{index}",
            "name": f"Jugador {index}",
            "person_type": "student",
        }

    events = [
        event(
            index,
            starts_at + timedelta(seconds=index * 50),
        )
        for index in range(10)
    ]

    windows, daily_max = LocalStore._detect_match_windows(events)

    assert daily_max == 10
    assert len(windows) == 1
    assert windows[0]["starts_at"] == starts_at.isoformat()
    assert windows[0]["ends_at"] == (
        starts_at + timedelta(minutes=50)
    ).isoformat()
    assert windows[0]["duration_minutes"] == 50
    assert windows[0]["participant_count"] == 10


def test_match_analysis_splits_continuous_activity_into_fixed_windows():
    starts_at = datetime(2026, 7, 20, 18, tzinfo=timezone.utc).astimezone()
    events = [
        {
            "id": index + 1,
            "seen_at": (
                starts_at + timedelta(minutes=index * 5)
            ).isoformat(),
            "crop_path": f"/tmp/continuous-{index}.jpg",
            "quality": 80,
            "quality_pass": 1,
            "evidence_selected": 1,
            "evidence_score": 0.8,
            "camera": "camera-1",
            "identity_kind": "unknown",
            "identity_key": f"unknown:{index}",
            "name": f"Desconocido {index}",
            "person_type": "unknown",
        }
        for index in range(61)
    ]

    windows, daily_max = LocalStore._detect_match_windows(events)

    assert daily_max == 11
    assert len(windows) == 5
    assert all(window["duration_minutes"] == 50 for window in windows)
    assert all(
        datetime.fromisoformat(window["ends_at"])
        - datetime.fromisoformat(window["starts_at"])
        == timedelta(minutes=50)
        for window in windows
    )
    assert all(
        datetime.fromisoformat(current["starts_at"])
        >= datetime.fromisoformat(previous["ends_at"])
        for previous, current in zip(windows, windows[1:])
    )


def test_match_schedule_separates_authorized_evidence_from_outside_schedule(
    tmp_path,
):
    store = LocalStore(tmp_path)
    people = [
        {
            "key": f"student:schedule-{index}",
            "type": "student",
            "id": 500 + index,
            "name": f"Jugador calendario {index}",
            "reference_version": "",
        }
        for index in range(20)
    ]
    collaborator = {
        "key": "collaborator:schedule-staff",
        "type": "collaborator",
        "id": 599,
        "name": "Personal de cancha",
        "reference_version": "",
    }
    store.replace_bootstrap([*people, collaborator], [])
    imported = store.upsert_match_schedule([{
        "match_date": "2026-07-21",
        "start_time": "20:00",
        "expected_duration_minutes": 50,
        "tolerance_minutes": 5,
        "tournament": "Premier",
        "home_team": "Beatriz FC",
        "away_team": "Mainz",
        "referee": "18",
    }], source="test")
    scheduled_start = datetime.fromisoformat(
        imported["items"][0]["starts_at"]
    )
    with store.connection(immediate=True) as db:
        for index, person in enumerate(people[:10]):
            # Includes one arrival exactly five minutes before kickoff.
            observed_at = (
                scheduled_start
                - timedelta(minutes=5)
                + timedelta(minutes=index * 4)
            )
            db.execute(
                """
                insert into face_crops
                    (subject_key,subject_kind,seen_at,crop_path,
                     similarity,quality,camera,created_at)
                values (?,'known',?,?,?,?,?,?)
                """,
                (
                    person["key"],
                    observed_at.isoformat(),
                    str(tmp_path / f"scheduled-{index}.jpg"),
                    0.8,
                    90,
                    "camera-1",
                    observed_at.isoformat(),
                ),
            )
        outside_start = scheduled_start - timedelta(minutes=120)
        for index, person in enumerate(people[10:]):
            observed_at = outside_start + timedelta(minutes=index * 4)
            db.execute(
                """
                insert into face_crops
                    (subject_key,subject_kind,seen_at,crop_path,
                     similarity,quality,camera,created_at)
                values (?,'known',?,?,?,?,?,?)
                """,
                (
                    person["key"],
                    observed_at.isoformat(),
                    str(tmp_path / f"outside-{index}.jpg"),
                    0.8,
                    85,
                    "camera-1",
                    observed_at.isoformat(),
                ),
            )
        for suffix, observed_at in (
            ("scheduled", scheduled_start + timedelta(minutes=20)),
            ("outside", outside_start + timedelta(minutes=20)),
        ):
            db.execute(
                """
                insert into face_crops
                    (subject_key,subject_kind,seen_at,crop_path,
                     similarity,quality,camera,created_at)
                values (?,'known',?,?,?,?,?,?)
                """,
                (
                    collaborator["key"],
                    observed_at.isoformat(),
                    str(tmp_path / f"collaborator-{suffix}.jpg"),
                    0.9,
                    95,
                    "camera-1",
                    observed_at.isoformat(),
                ),
            )

    store.analyze_match_history(force=True)
    history = store.match_history()
    day = history["items"][0]
    scheduled = next(
        window
        for window in day["windows"]
        if window["window_type"] == "scheduled"
    )
    outside = next(
        window
        for window in day["windows"]
        if window["window_type"] == "unscheduled"
    )

    assert day["scheduled_count"] == 4
    assert day["scheduled_confirmed_count"] == 1
    assert day["unscheduled_count"] == 1
    assert scheduled["window_status"] == "scheduled_with_evidence"
    assert scheduled["participant_count"] == 10
    assert scheduled["tolerance_minutes"] == 15
    assert scheduled["home_team"] == "Beatriz FC"
    assert scheduled["away_team"] == "Mainz"
    assert outside["window_status"] == "outside_schedule"
    assert outside["participant_count"] == 10
    assert outside["starts_at"] == outside_start.isoformat()
    assert outside["ends_at"] == (
        outside_start + timedelta(minutes=50)
    ).isoformat()
    assert outside["evidence_ends_at"] == (
        outside_start + timedelta(minutes=36)
    ).isoformat()
    assert history["summary"]["scheduled_matches"] == 4
    assert history["summary"]["scheduled_confirmed"] == 1
    assert history["summary"]["unscheduled_matches"] == 1

    scheduled_people = store.match_window_participants(scheduled["id"])
    outside_people = store.match_window_participants(outside["id"])
    assert scheduled_people["total"] == 10
    assert outside_people["total"] == 10
    assert all(
        item["person_type"] != "collaborator"
        for item in [
            *scheduled_people["items"],
            *outside_people["items"],
        ]
    )

    calendar = store.match_schedule(
        start_date="2026-07-21",
        end_date="2026-07-21",
    )
    assert calendar[0]["analysis_status"] == "scheduled_with_evidence"
    assert calendar[0]["participant_count"] == 10


def test_match_schedule_repeats_weekly_and_preserves_explicit_teams(tmp_path):
    store = LocalStore(tmp_path)
    store.upsert_match_schedule([{
        "match_date": "2026-07-27",
        "start_time": "20:00",
        "expected_duration_minutes": 50,
        "tolerance_minutes": 5,
        "tournament": "Femenil",
        "home_team": "Equipo Local",
        "away_team": "Equipo Visitante",
    }], source="test")

    monday = store.match_schedule(
        start_date="2026-07-27",
        end_date="2026-07-27",
    )
    next_year_monday = store.match_schedule(
        start_date="2027-07-26",
        end_date="2027-07-26",
    )
    saturday = store.match_schedule(
        start_date="2026-08-01",
        end_date="2026-08-01",
    )
    sunday = store.match_schedule(
        start_date="2026-08-02",
        end_date="2026-08-02",
    )

    assert [item["starts_at"][11:16] for item in monday] == [
        "20:00",
        "20:50",
        "21:40",
        "22:30",
    ]
    assert monday[0]["home_team"] == "Equipo Local"
    assert monday[0]["away_team"] == "Equipo Visitante"
    assert monday[0]["tolerance_minutes"] == 15
    assert len(next_year_monday) == 4
    assert len(saturday) == 17
    assert len(sunday) == 16
    assert all(
        item["source"] == "weekly-template"
        for item in next_year_monday
    )


def test_match_schedule_assigns_early_arrival_by_dominant_presence(tmp_path):
    store = LocalStore(tmp_path)
    store.upsert_match_schedule([
        {
            "match_date": "2026-07-21",
            "start_time": "16:00",
            "expected_duration_minutes": 50,
            "tolerance_minutes": 15,
        },
        {
            "match_date": "2026-07-21",
            "start_time": "17:00",
            "expected_duration_minutes": 50,
            "tolerance_minutes": 15,
        },
    ], source="test")
    schedule = [
        item
        for item in store._match_schedule_for_date("2026-07-21")
        if item["starts_at"][11:16] in {"16:00", "17:00"}
    ]
    early = datetime.fromisoformat(schedule[1]["starts_at"]) - timedelta(
        minutes=10
    )
    events = []
    for index, minute_offset in enumerate((0, 12, 22, 32), start=1):
        events.append({
            "id": index,
            "seen_at": (early + timedelta(minutes=minute_offset)).isoformat(),
            "identity_kind": "known",
            "identity_key": "student:arrives-early",
            "name": "Jugador que llega temprano",
            "person_type": "student",
            "quality": 80,
            "quality_pass": 1,
            "evidence_selected": 1,
            "evidence_score": 0.8,
            "camera": "camera-1",
        })
    previous_start = datetime.fromisoformat(schedule[0]["starts_at"])
    for index, minute_offset in enumerate((10, 20), start=10):
        events.append({
            "id": index,
            "seen_at": (
                previous_start + timedelta(minutes=minute_offset)
            ).isoformat(),
            "identity_kind": "known",
            "identity_key": "student:previous-match",
            "name": "Jugador del partido anterior",
            "person_type": "student",
            "quality": 75,
            "quality_pass": 1,
            "evidence_selected": 1,
            "evidence_score": 0.7,
            "camera": "camera-1",
        })

    windows, assigned_ids = LocalStore._scheduled_match_windows(
        events,
        schedule,
    )
    previous, upcoming = windows
    previous_people = {
        participant["key"]: participant
        for participant in previous["participants"]
    }
    upcoming_people = {
        participant["key"]: participant
        for participant in upcoming["participants"]
    }

    assert set(assigned_ids) == {1, 2, 3, 4, 10, 11}
    assert "student:arrives-early" not in previous_people
    assert upcoming_people["student:arrives-early"]["detection_count"] == 4
    assert previous_people["student:previous-match"]["detection_count"] == 2
    assert previous["window_status"] == "scheduled_insufficient_evidence"
    assert upcoming["window_status"] == "scheduled_insufficient_evidence"


def test_scheduled_match_requires_ten_people_inside_fifty_minutes():
    starts_at = datetime(2026, 7, 21, 20, tzinfo=timezone.utc).astimezone()
    ends_at = starts_at + timedelta(minutes=50)
    schedule = [{
        "id": 1,
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "expected_duration_minutes": 50,
        "tolerance_minutes": 15,
    }]
    observed_times = [
        starts_at - timedelta(minutes=15) + timedelta(seconds=index)
        for index in range(5)
    ] + [
        ends_at + timedelta(minutes=15) - timedelta(seconds=index)
        for index in range(5)
    ]
    events = [
        {
            "id": index + 1,
            "seen_at": observed_at.isoformat(),
            "identity_kind": "known",
            "identity_key": f"student:spread-{index}",
            "name": f"Jugador separado {index}",
            "person_type": "student",
            "quality": 80,
            "quality_pass": 1,
            "evidence_selected": 1,
            "evidence_score": 0.8,
            "camera": "camera-1",
        }
        for index, observed_at in enumerate(observed_times)
    ]

    windows, assigned_ids = LocalStore._scheduled_match_windows(
        events,
        schedule,
    )

    assert assigned_ids == set(range(1, 11))
    assert windows[0]["participant_count"] == 10
    assert windows[0]["max_unique_people"] == 5
    assert windows[0]["window_status"] == "scheduled_insufficient_evidence"


def test_match_participant_keeps_the_timestamp_of_its_best_crop():
    starts_at = datetime(
        2026, 7, 21, 17, 0, tzinfo=timezone.utc
    ).astimezone()
    events = [
        {
            "id": 1,
            "seen_at": starts_at.isoformat(),
            "identity_kind": "unknown",
            "identity_key": "unknown:best-time",
            "name": "Desconocido best-time",
            "person_type": "unknown",
            "quality": 45,
            "quality_pass": 0,
            "evidence_selected": 0,
            "evidence_score": 0.2,
            "camera": "camera-1",
        },
        {
            "id": 2,
            "seen_at": (
                starts_at + timedelta(minutes=8, seconds=13)
            ).isoformat(),
            "identity_kind": "unknown",
            "identity_key": "unknown:best-time",
            "name": "Desconocido best-time",
            "person_type": "unknown",
            "quality": 92,
            "quality_pass": 1,
            "evidence_selected": 1,
            "evidence_score": 0.9,
            "camera": "camera-2",
        },
    ]

    participant = LocalStore._match_participants(events)[0]

    assert participant["best_crop_id"] == 2
    assert participant["best_crop_seen_at"] == events[1]["seen_at"]
    assert participant["first_seen_at"] == events[0]["seen_at"]
    assert participant["last_seen_at"] == events[1]["seen_at"]


def test_monthly_detection_detail_pages_all_crops_with_a_stable_cursor(tmp_path):
    store = LocalStore(tmp_path)
    store.replace_bootstrap(
        [{
            "key": "student:88",
            "type": "student",
            "id": 88,
            "name": "Alumna con Evidencia",
            "group_name": "Sub 14",
            "reference_version": "",
        }],
        [],
    )
    july_days = [
        (datetime(2026, 7, 2, 18, tzinfo=timezone.utc).astimezone(), 40),
        (datetime(2026, 7, 15, 18, tzinfo=timezone.utc).astimezone(), 25),
        (datetime(2026, 7, 31, 18, tzinfo=timezone.utc).astimezone(), 15),
    ]
    for day, count in july_days:
        store.upsert_presence("student:88", "known", day, 0.83)
        for index in range(count):
            seen_at = day + timedelta(seconds=index)
            crop = store.faces_dir / seen_at.date().isoformat() / "known" / f"monthly-{day.day}-{index}.jpg"
            crop.parent.mkdir(parents=True, exist_ok=True)
            crop.write_bytes(b"crop")
            store.record_crop("student:88", "known", seen_at, str(crop), 0.74, 0.84, "Raspberry")

    august = datetime(2026, 8, 1, 18, tzinfo=timezone.utc).astimezone()
    august_crop = store.faces_dir / august.date().isoformat() / "known" / "august.jpg"
    august_crop.parent.mkdir(parents=True, exist_ok=True)
    august_crop.write_bytes(b"crop")
    store.record_crop("student:88", "known", august, str(august_crop), 0.75, 0.85, "Raspberry")

    first = store.detection_detail(
        "known",
        "student:88",
        selected_month="2026-07",
        limit=36,
    )
    late_crop_at = datetime(2026, 7, 31, 20, tzinfo=timezone.utc).astimezone()
    late_crop = store.faces_dir / late_crop_at.date().isoformat() / "known" / "late-arrival.jpg"
    late_crop.write_bytes(b"crop")
    store.record_crop("student:88", "known", late_crop_at, str(late_crop), 0.79, 0.89, "Raspberry")
    second = store.detection_detail(
        "known",
        "student:88",
        selected_month="2026-07",
        cursor=first["next_cursor"],
        limit=36,
    )
    third = store.detection_detail(
        "known",
        "student:88",
        selected_month="2026-07",
        cursor=second["next_cursor"],
        limit=36,
    )

    all_crops = first["crops"] + second["crops"] + third["crops"]
    assert first["scope"] == "month"
    assert first["month"] == "2026-07"
    assert first["subject"]["name"] == "Alumna con Evidencia"
    assert first["summary"]["attendance_days"] == 3
    assert first["summary"]["crops"] == 80
    assert first["total_crops"] == 80
    assert [day["crops"] for day in first["days"]] == [15, 25, 40]
    assert [len(first["crops"]), len(second["crops"]), len(third["crops"])] == [36, 36, 8]
    assert first["next_cursor"]
    assert second["next_cursor"]
    assert third["next_cursor"] is None
    assert len({crop["id"] for crop in all_crops}) == 80
    assert [(crop["seen_at"], crop["id"]) for crop in all_crops] == sorted(
        [(crop["seen_at"], crop["id"]) for crop in all_crops],
        reverse=True,
    )
    assert {crop["date"] for crop in all_crops} == {"2026-07-02", "2026-07-15", "2026-07-31"}
    reopened = store.detection_detail("known", "student:88", selected_month="2026-07", limit=36)
    assert reopened["total_crops"] == 81
    assert reopened["crops"][0]["seen_at"] == late_crop_at.isoformat()

    with pytest.raises(ValueError, match="Cursor"):
        store.detection_detail(
            "known",
            "student:88",
            selected_month="2026-07",
            cursor="cursor-invalido",
        )
    with pytest.raises(ValueError, match="Cursor"):
        store.detection_detail(
            "known",
            "student:88",
            selected_month="2026-07",
            cursor=f"{first['next_cursor']}!!!",
        )
    with pytest.raises(ValueError, match="no corresponde"):
        store.detection_detail(
            "known",
            "student:88",
            selected_month="2026-08",
            cursor=first["next_cursor"],
        )
    with pytest.raises(ValueError, match="fecha o un mes"):
        store.detection_detail(
            "known",
            "student:88",
            "2026-07-02",
            selected_month="2026-07",
        )


def test_detection_detail_groups_one_subject_and_serves_all_crops(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    first_crop = store.faces_dir / now.date().isoformat() / "unknown" / "first.jpg"
    second_crop = store.faces_dir / now.date().isoformat() / "unknown" / "second.jpg"
    first_crop.parent.mkdir(parents=True)
    first_crop.write_bytes(b"first")
    second_crop.write_bytes(b"second")
    subject = store.create_unknown(
        normalized(17),
        now,
        str(first_crop),
        0.81,
        quality_pass=True,
    )
    store.record_crop(subject["subject_id"], "unknown", now, str(first_crop), 0.31, 0.81, "Raspberry")
    later = now + timedelta(seconds=3)
    subject = store.update_unknown(subject["subject_id"], normalized(17), later, str(second_crop), 0.86)
    store.record_crop(subject["subject_id"], "unknown", later, str(second_crop), 0.72, 0.86, "Raspberry")

    detail = store.detection_detail("unknown", subject["subject_id"], now.date().isoformat())

    assert detail["subject"]["name"] == subject["temporary_name"]
    assert detail["summary"]["detections"] == 2
    assert detail["summary"]["crops"] == 2
    assert [crop["similarity"] for crop in detail["crops"]] == [0.72, 0.31]
    assert store.crop_image_path(detail["crops"][0]["id"]) == second_crop.resolve()


def test_detection_detail_can_page_every_unknown_crop_without_changing_default(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime(2026, 7, 24, 18, tzinfo=timezone.utc).astimezone()
    day = now.date().isoformat()
    crop_paths = [
        store.faces_dir / day / "unknown" / f"catalog-{index}.jpg"
        for index in range(4)
    ]
    crop_paths[0].parent.mkdir(parents=True)
    for index, crop_path in enumerate(crop_paths):
        crop_path.write_bytes(f"crop-{index}".encode())

    anchor = normalized(517)
    subject = store.create_unknown(
        anchor,
        now,
        str(crop_paths[0]),
        0.91,
        quality_pass=True,
    )
    for index, crop_path in enumerate(crop_paths):
        store.record_crop(
            subject["subject_id"],
            "unknown",
            now + timedelta(seconds=index),
            str(crop_path),
            0.80 + index / 100,
            0.91 - index / 100,
            "Raspberry",
            embedding=anchor,
            quality_pass=index < 2,
        )

    with store.connection() as db:
        for crop_path, evidence_selected, evidence_reason in (
            (crop_paths[0], 1, "selected_best_quality"),
            (crop_paths[1], 1, "selected_time_diversity"),
            (crop_paths[2], 0, "quality_rejected"),
            (crop_paths[3], 0, "manual_rejected"),
        ):
            db.execute(
                """
                update face_crops
                set evidence_selected=?,evidence_reason=?
                where crop_path=?
                """,
                (
                    evidence_selected,
                    evidence_reason,
                    str(crop_path.resolve()),
                ),
            )

    default_detail = store.detection_detail(
        "unknown",
        subject["subject_id"],
        day,
        limit=10,
    )
    first_page = store.detection_detail(
        "unknown",
        subject["subject_id"],
        day,
        limit=2,
        include_all_crops=True,
    )
    second_page = store.detection_detail(
        "unknown",
        subject["subject_id"],
        day,
        cursor=first_page["next_cursor"],
        limit=2,
        include_all_crops=True,
    )

    assert default_detail["total_crops"] == 2
    assert default_detail["summary"]["crops"] == 2
    assert {crop["evidence_selected"] for crop in default_detail["crops"]} == {1}
    assert {
        crop["evidence_reason"] for crop in default_detail["crops"]
    } == {"selected_best_quality", "selected_time_diversity"}

    all_crops = first_page["crops"] + second_page["crops"]
    assert first_page["total_crops"] == 4
    assert first_page["summary"]["crops"] == 4
    assert first_page["evidence_policy"]["full_catalog"] is True
    assert len(first_page["crops"]) == 2
    assert first_page["next_cursor"]
    assert len(second_page["crops"]) == 2
    assert second_page["next_cursor"] is None
    assert {crop["evidence_selected"] for crop in all_crops} == {0, 1}
    assert {crop["evidence_reason"] for crop in all_crops} == {
        "selected_best_quality",
        "selected_time_diversity",
        "quality_rejected",
        "manual_rejected",
    }


def test_manual_crop_rejection_removes_reference_and_recalculates_attendance(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    day = now.date().isoformat()
    first_crop = store.faces_dir / day / "unknown" / "manual-reject-first.jpg"
    second_crop = store.faces_dir / day / "unknown" / "manual-reject-second.jpg"
    first_crop.parent.mkdir(parents=True)
    first_crop.write_bytes(b"first")
    second_crop.write_bytes(b"second")
    anchor = normalized(417)
    subject = store.create_unknown(
        anchor,
        now,
        str(first_crop),
        0.83,
        quality_pass=True,
        quality_payload={"complete_face": True},
    )
    store.record_crop(
        subject["subject_id"],
        "unknown",
        now,
        str(first_crop),
        0.77,
        0.83,
        "Raspberry",
        embedding=anchor,
        quality_pass=True,
    )
    later = now + timedelta(seconds=5)
    second_embedding = cosine_variant(anchor, 418, 0.94)
    store.update_unknown(
        subject["subject_id"],
        second_embedding,
        later,
        str(second_crop),
        0.91,
        quality_pass=True,
        quality_payload={"complete_face": True},
    )
    store.record_crop(
        subject["subject_id"],
        "unknown",
        later,
        str(second_crop),
        0.84,
        0.91,
        "Raspberry",
        embedding=second_embedding,
        quality_pass=True,
    )
    detail = store.detection_detail(
        "unknown",
        subject["subject_id"],
        day,
    )
    crop_ids = {
        Path(store.crop_image_path(crop["id"])).name: crop["id"]
        for crop in detail["crops"]
    }
    assert (
        store.dashboard(day)["unknown"][0]["best_crop_id"]
        == crop_ids[second_crop.name]
    )

    first_result = store.reject_unknown_crop(
        crop_ids[first_crop.name],
        "Rostro cubierto por la malla",
    )

    assert first_result["remaining_references"] == 1
    assert first_result["attendance_removed"] is False
    store.curate_daily_evidence(day, limit=30)
    remaining_detail = store.detection_detail(
        "unknown",
        subject["subject_id"],
        day,
    )
    assert remaining_detail["total_crops"] == 1
    assert store.dashboard(day)["unknown"][0]["detection_count"] == 1
    assert (
        store.dashboard(day)["unknown"][0]["best_crop_id"]
        == crop_ids[second_crop.name]
    )
    with store.connection() as db:
        rejected = db.execute(
            "select * from face_crops where id=?",
            (crop_ids[first_crop.name],),
        ).fetchone()
        assert rejected["evidence_reason"] == "manual_rejected"
        assert rejected["evidence_selected"] == 0
        assert db.execute(
            "select count(*) from unknown_references where subject_id=?",
            (subject["subject_id"],),
        ).fetchone()[0] == 1

    second_result = store.reject_unknown_crop(
        crop_ids[second_crop.name],
        "Rostro cubierto por la malla",
    )

    assert second_result["attendance_removed"] is True
    assert second_result["remaining_crops"] == 0
    assert store.dashboard(day)["unknown"] == []
    assert store.get_unknown(subject["subject_id"])["status"] == "quarantined"
    assert (
        store.reject_unknown_crop(crop_ids[second_crop.name])["status"]
        == "already_rejected"
    )


def test_face_match_respects_similarity_margin(tmp_path):
    config = ConfigManager(tmp_path).config
    engine = FaceEngine(config)
    first, second = normalized(3), normalized(4)
    engine.set_known_database([{"person_key": "student:1"}, {"person_key": "student:2"}], np.vstack([first, second]))

    assert engine.match_known(first).person["person_key"] == "student:1"
    assert engine.match_known(normalized(10)).person is None


def test_face_match_margin_ignores_another_reference_of_same_identity(tmp_path):
    config = ConfigManager(tmp_path).config
    engine = FaceEngine(config)
    anchor = normalized(301)
    same_identity = cosine_variant(anchor, 302, 0.99)
    other_identity = cosine_variant(anchor, 303, 0.20)
    engine.set_known_database(
        [
            {"person_key": "student:1"},
            {"person_key": "student:1"},
            {"person_key": "student:2"},
        ],
        np.vstack([anchor, same_identity, other_identity]),
    )

    match = engine.match_known(anchor)

    assert match.person["person_key"] == "student:1"
    assert match.similarity == pytest.approx(1.0)
    assert match.margin == pytest.approx(0.80, abs=1e-5)
    assert [person["person_key"] for person in match.candidates] == ["student:1"]


def test_face_match_can_use_a_secondary_reference_of_identity(tmp_path):
    config = ConfigManager(tmp_path).config
    engine = FaceEngine(config)
    primary = normalized(311)
    secondary = cosine_variant(primary, 312, 0.30)
    other_identity = cosine_variant(secondary, 313, 0.10)
    engine.set_known_database(
        [
            {"person_key": "student:1"},
            {"person_key": "student:1"},
            {"person_key": "student:2"},
        ],
        np.vstack([primary, secondary, other_identity]),
    )

    match = engine.match_known(secondary)

    assert match.person["person_key"] == "student:1"
    assert match.similarity == pytest.approx(1.0)
    assert match.margin == pytest.approx(0.90, abs=1e-5)


def test_face_match_margin_still_compares_a_nearby_other_identity(tmp_path):
    config = ConfigManager(tmp_path).config
    engine = FaceEngine(config)
    anchor = normalized(321)
    same_identity = cosine_variant(anchor, 322, 0.99)
    nearby_identity = cosine_variant(anchor, 323, 0.98)
    engine.set_known_database(
        [
            {"person_key": "student:1"},
            {"person_key": "student:1"},
            {"person_key": "student:2"},
        ],
        np.vstack([anchor, same_identity, nearby_identity]),
    )

    match = engine.match_known(anchor)

    assert match.person is None
    assert match.similarity == pytest.approx(1.0)
    assert match.margin == pytest.approx(0.02, abs=1e-5)


def test_face_engine_loads_only_detection_and_recognition_modules(tmp_path):
    captured = {}

    class FakeAnalysis:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def prepare(self, **kwargs):
            captured["prepare"] = kwargs

    config = ConfigManager(tmp_path).config
    engine = FaceEngine(config)
    prepared = engine._prepare_app(FakeAnalysis, ["CPUExecutionProvider"])

    assert isinstance(prepared, FakeAnalysis)
    assert captured["allowed_modules"] == ("detection", "recognition")
    assert captured["providers"] == ["CPUExecutionProvider"]


def test_face_match_groups_duplicate_roster_rows_as_one_identity(tmp_path):
    config = ConfigManager(tmp_path).config
    engine = FaceEngine(config)
    duplicate = normalized(13)
    different = normalized(14)
    shared_source = "2026-07-01T12:00:00+00:00:supabase://adult-private-photos/players/9/photo.jpg"
    engine.set_known_database(
        [
            {"person_key": "player:10", "reference_version": shared_source},
            {"person_key": "player:10", "reference_version": shared_source},
            {"person_key": "player:11", "reference_version": shared_source.replace("12:00:00", "13:00:00")},
            {
                "person_key": "player:12",
                "reference_version": "2026-07-01T12:00:00+00:00:supabase://adult-private-photos/players/12/photo.jpg",
            },
        ],
        np.vstack([duplicate, duplicate, duplicate, different]),
    )

    match = engine.match_known(duplicate)

    assert match.matched is True
    assert [person["person_key"] for person in match.candidates] == ["player:10", "player:11"]
    assert match.margin > config.min_margin


def test_reference_portrait_retries_with_context_padding(tmp_path, monkeypatch):
    class ReferenceFace:
        bbox = np.array([30, 40, 90, 120], dtype=np.float32)
        det_score = 0.92
        normed_embedding = normalized(12)

    class FakeAnalysis:
        def __init__(self):
            self.shapes = []

        def get(self, image):
            self.shapes.append(image.shape[:2])
            return [] if len(self.shapes) == 1 else [ReferenceFace()]

    portrait = np.full((100, 80, 3), 150, dtype=np.uint8)
    portrait_path = tmp_path / "portrait.jpg"
    cv2.imwrite(str(portrait_path), portrait)
    engine = FaceEngine(ConfigManager(tmp_path).config)
    engine.app = FakeAnalysis()

    embedding = engine.embedding_from_reference(portrait_path)

    assert np.allclose(embedding, ReferenceFace.normed_embedding)
    assert engine.app.shapes == [(100, 80), (300, 280)]


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


def test_camera_worker_fails_over_and_recovers_without_status_flapping(monkeypatch):
    state = {"primary": "down"}
    opened = []

    class FakeCapture:
        def __init__(self, source):
            self.source = source
            self.session_reads = 0
            self.released = False
            opened.append(source)

        def isOpened(self):
            return not self.released

        def set(self, *_args):
            return True

        def get(self, *_args):
            return 0

        def read(self):
            __import__("time").sleep(0.002)
            if self.released:
                return False, None
            self.session_reads += 1
            if self.source == "lan://primary":
                if state["primary"] == "down":
                    return False, None
                if state["primary"] == "unstable" and self.session_reads > 1:
                    return False, None
            return True, np.full((24, 32, 3), self.session_reads % 255, dtype=np.uint8)

        def release(self):
            self.released = True

    worker = CameraWorker(
        "lan://primary",
        fallback_source="tailscale://fallback",
        failover_after=1,
        primary_retry_seconds=0.02,
        primary_recovery_frames=3,
    )
    monkeypatch.setattr(worker, "_open", lambda source=None: FakeCapture(source))

    def wait_until(predicate, timeout=2.0):
        deadline = __import__("time").monotonic() + timeout
        while __import__("time").monotonic() < deadline:
            if predicate():
                return True
            __import__("time").sleep(0.01)
        return False

    worker.start()
    try:
        assert wait_until(lambda: worker.connected and worker.using_fallback)
        assert worker.source_role == "fallback"
        failovers = worker.failover_count

        # A source that only returns one frame never exits probation, so status
        # remains on fallback instead of oscillating on every retry.
        state["primary"] = "unstable"
        assert wait_until(lambda: opened.count("lan://primary") >= 2)
        __import__("time").sleep(0.08)
        assert worker.source_role == "fallback"
        assert worker.using_fallback is True
        assert worker.failover_count == failovers

        state["primary"] = "stable"
        assert wait_until(
            lambda: worker.connected and worker.source_role == "primary",
            timeout=3.0,
        )
        assert worker.using_fallback is False
        assert "tailscale://fallback" in opened
        assert opened.count("lan://primary") >= 3
    finally:
        worker.stop()


def test_camera_worker_http_open_has_bounded_ffmpeg_timeouts(monkeypatch):
    calls = []

    class FakeCapture:
        @staticmethod
        def isOpened():
            return True

        @staticmethod
        def set(*_args):
            return True

    def fake_video_capture(*args):
        calls.append(args)
        return FakeCapture()

    monkeypatch.setattr(cv2, "VideoCapture", fake_video_capture)
    worker = CameraWorker("http://192.168.1.42:8080/stream")

    worker._open()

    source, backend, params = calls[0]
    assert source == "http://192.168.1.42:8080/stream"
    assert backend == cv2.CAP_FFMPEG
    options = dict(zip(params[::2], params[1::2]))
    assert options[cv2.CAP_PROP_OPEN_TIMEOUT_MSEC] == worker.NETWORK_TIMEOUT_MSEC
    assert options[cv2.CAP_PROP_READ_TIMEOUT_MSEC] == worker.NETWORK_TIMEOUT_MSEC


def test_camera_status_reports_safe_failover_role_without_source_urls(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    camera = CameraWorker(
        "http://192.168.1.42:8080/stream",
        fallback_source="http://100.104.142.37:8080/stream",
    )
    camera._set_source_role("fallback")
    camera.connected = True
    camera.last_failover_reason = "La fuente principal no responde."
    runtime._cameras = {"primary": camera}

    status = runtime.status()["cameras"]["primary"]

    assert status["source_role"] == "fallback"
    assert status["using_fallback"] is True
    assert status["failover_count"] == 1
    assert status["capture_pipeline"]["pipeline_mode"] == "opencv"
    assert "source" not in status
    assert "192.168.1.42" not in json.dumps(status)
    assert "100.104.142.37" not in json.dumps(status)


def test_face_crop_uses_original_camera_resolution(tmp_path):
    source = np.full((1080, 1920, 3), 180, dtype=np.uint8)
    detection_frame = np.full((540, 960, 3), 180, dtype=np.uint8)
    detected = DetectedFace((100, 100, 200, 200), normalized(11), 0.9, 0.8)

    source_detection = StationRuntime._detection_for_source(detected, detection_frame, source)
    path = save_crop(tmp_path, source, source_detection, "unknown", "quality-test", datetime.now(timezone.utc))
    crop = cv2.imread(path)

    assert source_detection.bbox == (200, 200, 400, 400)
    assert crop.shape[:2] == (328, 300)
    assert Path(path).parent == tmp_path / datetime.now(timezone.utc).date().isoformat() / "unknown"
    assert Path(path).name.startswith("quality-test_")


def test_quality_gate_accepts_a_complete_frontal_face_at_detector_scale():
    evaluator = object.__new__(FaceQualityEvaluator)
    evaluator.thresholds = FaceQualityThresholds()
    points = np.full((478, 2), (100.0, 100.0), dtype=np.float32)
    points[list(FACE_OVAL)] = (100.0, 100.0)
    points[10] = (100.0, 60.0)
    points[152] = (100.0, 140.0)
    points[234] = (60.0, 100.0)
    points[454] = (140.0, 100.0)
    points[33] = (75.0, 90.0)
    points[263] = (125.0, 90.0)
    image = np.random.default_rng(7).integers(20, 236, size=(200, 200, 3), dtype=np.uint8)

    result = evaluator._measure(image, points, yaw=0.5, pitch=2.5, roll=-3.0)

    assert evaluator.thresholds.min_face_width == 70
    assert evaluator.thresholds.min_face_height == 75
    assert evaluator.thresholds.max_bright_fraction == 0.18
    assert result.accepted is True


def test_unknown_tracking_keeps_identity_across_pose_change(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    subject = {"subject_id": "unknown-1", "status": "candidate"}
    runtime._unknown_tracks["primary"] = [{
        "subject_id": subject["subject_id"],
        "subject": subject,
        "embedding": normalized(50),
        "bbox": (100, 100, 200, 220),
        "updated_at": __import__("time").monotonic(),
    }]
    changed_pose = DetectedFace((112, 106, 212, 226), normalized(51), 0.9, 0.7)

    matches, lingering = runtime._assign_unknown_tracks("primary", [changed_pose])

    assert matches[0]["subject_id"] == subject["subject_id"]
    assert lingering == []


def test_runtime_recognizes_ignored_unknown_without_queueing_persistence(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    observed_at = datetime.now(timezone.utc).astimezone()
    crop = runtime.store.faces_dir / observed_at.date().isoformat() / "unknown" / "ignored-runtime.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"ignored-runtime")
    embedding = normalized(109)
    subject = runtime.store.create_unknown(
        embedding,
        observed_at,
        str(crop),
        0.92,
        subject_id="unknown-runtime-ignored",
        temporary_name="Desconocido Runtime",
        quality_pass=True,
    )
    runtime.set_unknowns_ignored([subject["subject_id"]], True)

    class IgnoredFaceEngine:
        @staticmethod
        def detect(_frame):
            return [DetectedFace((100, 80, 220, 240), embedding, 0.96, 0.88)]

        @staticmethod
        def match_known(_embedding):
            return None

    runtime._engine = IgnoredFaceEngine()
    runtime._last_preview_at["primary"] = __import__("time").monotonic()
    before = runtime.store.get_unknown(subject["subject_id"])["detection_count"]

    runtime._process_frame(
        np.full((480, 640, 3), 160, dtype=np.uint8),
        observed_at.timestamp(),
        "primary",
    )

    assert runtime._persistence_queue.qsize() == 0
    assert runtime.store.get_unknown(subject["subject_id"])["detection_count"] == before
    assert runtime.store.dashboard(observed_at.date().isoformat())["unknown"] == []


def test_store_flattens_legacy_crop_layout_without_breaking_database_paths(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(timezone.utc).astimezone()
    subject_id, temporary_name = store.next_unknown_name()
    legacy_dir = store.faces_dir / now.date().isoformat() / "unknown" / subject_id
    legacy_dir.mkdir(parents=True)
    legacy_crop = legacy_dir / "123456.jpg"
    legacy_crop.write_bytes(b"legacy-crop")
    store.create_unknown(
        normalized(16),
        now,
        str(legacy_crop.resolve()),
        0.82,
        subject_id=subject_id,
        temporary_name=temporary_name,
        quality_pass=True,
    )

    result = store.flatten_legacy_crop_layout()
    subject = store.get_unknown(subject_id)
    migrated_crop = Path(subject["best_crop_path"])

    assert result["moved"] == 1
    assert result["updated_references"] == 3
    assert migrated_crop.parent == store.faces_dir / now.date().isoformat() / "unknown"
    assert migrated_crop.name == f"{subject_id}_123456.jpg"
    assert migrated_crop.read_bytes() == b"legacy-crop"
    assert not legacy_crop.exists()
    assert store.image_path("unknown", subject_id) == migrated_crop.resolve()


def test_runtime_global_reconciliation_is_dry_run_then_safe_apply(tmp_path):
    runtime = StationRuntime(ConfigManager(tmp_path))
    observed_at = datetime(2026, 7, 26, 22, 0, tzinfo=timezone.utc).astimezone()
    groups = (
        (normalized(700), ("reconcile-a-target", "reconcile-a-source"), 710),
        (normalized(800), ("reconcile-b-target", "reconcile-b-source"), 810),
    )

    for group_index, (person_anchor, subject_ids, seed_base) in enumerate(groups):
        for subject_index, subject_id in enumerate(subject_ids):
            first_embedding = cosine_variant(
                person_anchor,
                seed_base + subject_index * 20,
                0.96,
            )
            subject = runtime.store.create_unknown(
                first_embedding,
                observed_at + timedelta(seconds=group_index * 100 + subject_index),
                str(tmp_path / f"{subject_id}-0.jpg"),
                0.90,
                subject_id=subject_id,
                temporary_name=f"Desconocido Reconcile {group_index}-{subject_index}",
                quality_pass=True,
                quality_payload={"accepted": True},
            )
            for reference_index in range(1, 9):
                subject = runtime.store.update_unknown(
                    subject["subject_id"],
                    cosine_variant(
                        person_anchor,
                        seed_base + subject_index * 20 + reference_index,
                        0.95,
                    ),
                    observed_at
                    + timedelta(
                        seconds=(
                            group_index * 100
                            + subject_index * 20
                            + reference_index
                        )
                    ),
                    str(tmp_path / f"{subject_id}-{reference_index}.jpg"),
                    0.90 - reference_index / 100,
                    quality_pass=True,
                    quality_payload={"accepted": True},
                )

    dry_run = runtime.reconcile_unknowns(apply=False)

    assert dry_run["summary"]["mode"] == "dry_run"
    assert dry_run["summary"]["proposal_count"] == 2
    assert dry_run["summary"]["applied_count"] == 0
    with runtime.store.connection() as db:
        assert (
            db.execute(
                "select count(*) from unknown_subjects where status='archived'"
            ).fetchone()[0]
            == 0
        )

    with pytest.raises(RuntimeError, match="Pausa la deteccion"):
        runtime.reconcile_unknowns(apply=True)

    runtime._detection_paused = True
    applied = runtime.reconcile_unknowns(apply=True)

    assert applied["summary"]["mode"] == "applied"
    assert applied["summary"]["applied_count"] == 2
    assert len(applied["applied"]) == 2
    backup_paths = {item["backup_path"] for item in applied["applied"]}
    assert len(backup_paths) == 1
    assert Path(next(iter(backup_paths))).is_file()
    assert list((tmp_path / "backups").glob("unknown-merge-*.sqlite3")) == [
        Path(next(iter(backup_paths)))
    ]
    with runtime.store.connection() as db:
        active = db.execute(
            """
            select subject_id from unknown_subjects
            where status='consolidated'
            """
        ).fetchall()
        archived = db.execute(
            """
            select subject_id,merged_into from unknown_subjects
            where status='archived'
            """
        ).fetchall()
        assert len(active) == 2
        assert len(archived) == 2
        assert {row["merged_into"] for row in archived} == {
            row["subject_id"] for row in active
        }
        assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
        assert list(db.execute("pragma foreign_key_check")) == []
