from datetime import timedelta

import pytest
from django.utils import timezone

from core.api import automatic_attendance as attendance_jobs
from core.api import automatic_attendance_jobs
from core.api import automatic_attendance_neighbors
from core.api import automatic_attendance_worker


pytestmark = pytest.mark.api


@pytest.fixture
def isolated_job_store(tmp_path, monkeypatch):
    monkeypatch.setattr(attendance_jobs.settings, "MEDIA_ROOT", str(tmp_path))
    monkeypatch.setattr(attendance_jobs, "video_clips_table_exists", lambda: False)
    attendance_jobs.ensure_dirs()


def write_job(job):
    attendance_jobs.write_json(attendance_jobs.job_path(job["id"]), job)


def test_active_job_from_previous_backend_is_marked_interrupted(isolated_job_store):
    heartbeat_at = attendance_jobs.PROCESS_STARTED_AT - timedelta(seconds=5)
    job = {
        "id": "previous-backend-job",
        "status": "processing",
        "created_at": heartbeat_at.isoformat(),
        "updated_at": heartbeat_at.isoformat(),
        "heartbeat_at": heartbeat_at.isoformat(),
        "worker_pid": attendance_jobs.PROCESS_ID + 1000,
        "results": [],
    }
    write_job(job)

    attendance_jobs.expire_stale_jobs()

    saved_job = attendance_jobs.read_job(job["id"])
    assert saved_job["status"] == "error"
    assert saved_job["phase"] == "error"
    assert "interrumpido" in saved_job["detail"].lower()


def test_active_job_with_old_heartbeat_is_marked_interrupted(isolated_job_store, monkeypatch):
    monkeypatch.setattr(automatic_attendance_jobs, "JOB_STALE_AFTER_SECONDS", 60)
    heartbeat_at = timezone.now() - timedelta(seconds=120)
    job = {
        "id": "stale-heartbeat-job",
        "status": "processing",
        "created_at": heartbeat_at.isoformat(),
        "updated_at": heartbeat_at.isoformat(),
        "heartbeat_at": heartbeat_at.isoformat(),
        "worker_pid": attendance_jobs.PROCESS_ID,
        "results": [],
    }
    write_job(job)

    assert attendance_jobs.active_job() is None

    saved_job = attendance_jobs.read_job(job["id"])
    assert saved_job["status"] == "error"
    assert saved_job["phase_label"] == "Procesamiento interrumpido"


def test_camera_context_is_added_to_session_results_and_evidence():
    result = {
        "session": {"id": 123},
        "marked": [{"student_id": 1, "student_name": "Jugador Uno"}],
        "review": [{"student_id": 2, "student_name": "Jugador Dos"}],
        "off_roster": [{"student_id": 3, "student_name": "Jugador Tres"}],
        "unknown_faces": [{"unknown_id": 1}],
    }
    metadata = {"camera_id": "dahua_cancha_2"}

    annotated = automatic_attendance_worker.annotate_session_result_with_camera(result, metadata)

    assert annotated["camera_id"] == "dahua_cancha_2"
    assert annotated["camera_label"] == "Camara 2"
    for list_name in ("marked", "review", "off_roster", "unknown_faces"):
        assert annotated[list_name][0]["source_camera_id"] == "dahua_cancha_2"
        assert annotated[list_name][0]["source_camera_label"] == "Camara 2"


def test_neighbor_expansion_keeps_clips_inside_same_camera(monkeypatch):
    rows = [
        {"id": "cam1-prev", "camera_id": "dahua_cancha_1", "site_id": 10},
        {"id": "cam2-prev", "camera_id": "dahua_cancha_2", "site_id": 10},
        {"id": "cam2-main", "camera_id": "dahua_cancha_2", "site_id": 10},
        {"id": "cam1-main", "camera_id": "dahua_cancha_1", "site_id": 10},
        {"id": "cam2-next", "camera_id": "dahua_cancha_2", "site_id": 10},
        {"id": "cam1-next", "camera_id": "dahua_cancha_1", "site_id": 10},
    ]
    monkeypatch.setattr(automatic_attendance_neighbors, "base_video_clip_rows_for_neighbor_lookup", lambda clip_id: rows)
    monkeypatch.setattr(automatic_attendance_neighbors, "video_clip_session_cache", lambda clip_rows: {})
    monkeypatch.setattr(automatic_attendance_neighbors, "metadata_for_video_clip_row", lambda row, session_cache=None: {"site_id": row["site_id"]})

    assert automatic_attendance_neighbors.expanded_neighbor_clip_ids("cam2-main") == ["cam2-prev", "cam2-main", "cam2-next"]


def test_multicamera_expansion_includes_same_session_cameras_and_their_neighbors(monkeypatch):
    rows = [
        {"id": "cam1-prev", "camera_id": "dahua_cancha_1", "site_id": 10, "session_id": 200, "attendance_session_id": 200, "match_id": 50, "recording_started_at": 1, "recording_ended_at": 2},
        {"id": "cam2-prev", "camera_id": "dahua_cancha_2", "site_id": 10, "session_id": 200, "attendance_session_id": 200, "match_id": 50, "recording_started_at": 1, "recording_ended_at": 2},
        {"id": "cam1-main", "camera_id": "dahua_cancha_1", "site_id": 10, "session_id": 200, "attendance_session_id": 200, "match_id": 50, "recording_started_at": 2, "recording_ended_at": 3},
        {"id": "cam2-main", "camera_id": "dahua_cancha_2", "site_id": 10, "session_id": 200, "attendance_session_id": 200, "match_id": 50, "recording_started_at": 2, "recording_ended_at": 3},
        {"id": "cam1-next", "camera_id": "dahua_cancha_1", "site_id": 10, "session_id": 200, "attendance_session_id": 200, "match_id": 50, "recording_started_at": 3, "recording_ended_at": 4},
        {"id": "cam2-next", "camera_id": "dahua_cancha_2", "site_id": 10, "session_id": 200, "attendance_session_id": 200, "match_id": 50, "recording_started_at": 3, "recording_ended_at": 4},
        {"id": "other-session", "camera_id": "dahua_cancha_1", "site_id": 10, "session_id": 201, "attendance_session_id": 201, "match_id": 51, "recording_started_at": 2, "recording_ended_at": 3},
    ]
    monkeypatch.setattr(automatic_attendance_neighbors, "base_video_clip_rows_for_neighbor_lookup", lambda clip_id: rows)
    monkeypatch.setattr(automatic_attendance_neighbors, "video_clip_session_cache", lambda clip_rows: {})
    monkeypatch.setattr(
        automatic_attendance_neighbors,
        "metadata_for_video_clip_row",
        lambda row, session_cache=None: {"site_id": row["site_id"], "session_id": row["session_id"], "match_id": row["match_id"]},
    )

    expanded = automatic_attendance_neighbors.expanded_multicamera_neighbor_clip_ids("cam2-main")

    assert expanded == ["cam1-prev", "cam1-main", "cam1-next", "cam2-prev", "cam2-main", "cam2-next"]
    assert "other-session" not in expanded


def test_multicamera_expansion_trusts_same_session_even_without_time_overlap(monkeypatch):
    rows = [
        {"id": "cam2-main", "camera_id": "dahua_cancha_2", "site_id": 10, "session_id": 206, "attendance_session_id": 206, "match_id": None, "recording_started_at": 10, "recording_ended_at": 20},
        {"id": "cam1-main", "camera_id": "dahua_cancha_1", "site_id": 10, "session_id": 206, "attendance_session_id": 206, "match_id": None, "recording_started_at": 30, "recording_ended_at": 40},
        {"id": "other-session", "camera_id": "dahua_cancha_1", "site_id": 10, "session_id": 207, "attendance_session_id": 207, "match_id": None, "recording_started_at": 30, "recording_ended_at": 40},
    ]
    monkeypatch.setattr(automatic_attendance_neighbors, "base_video_clip_rows_for_neighbor_lookup", lambda clip_id: rows)
    monkeypatch.setattr(automatic_attendance_neighbors, "video_clip_session_cache", lambda clip_rows: {})
    monkeypatch.setattr(
        automatic_attendance_neighbors,
        "metadata_for_video_clip_row",
        lambda row, session_cache=None: {"site_id": row["site_id"], "session_id": row["session_id"], "match_id": row["match_id"]},
    )

    expanded = automatic_attendance_neighbors.expanded_multicamera_neighbor_clip_ids("cam2-main")

    assert "cam1-main" in expanded
    assert "cam2-main" in expanded
    assert "other-session" not in expanded


def test_processing_order_groups_same_session_cameras():
    videos = [
        {"filename": "s2-cam2.mp4", "modified_at": "2026-06-30T20:10:00", "metadata": {"recorded_date": "2026-06-30", "site_id": 1, "match_id": 20, "session_id": 200, "camera_id": "dahua_cancha_2", "recording_started_at": "2026-06-30T20:10:00"}},
        {"filename": "s1-cam2.mp4", "modified_at": "2026-06-30T20:00:00", "metadata": {"recorded_date": "2026-06-30", "site_id": 1, "match_id": 10, "session_id": 100, "camera_id": "dahua_cancha_2", "recording_started_at": "2026-06-30T20:00:00"}},
        {"filename": "s1-cam1.mp4", "modified_at": "2026-06-30T20:00:00", "metadata": {"recorded_date": "2026-06-30", "site_id": 1, "match_id": 10, "session_id": 100, "camera_id": "dahua_cancha_1", "recording_started_at": "2026-06-30T20:00:00"}},
    ]

    ordered = automatic_attendance_worker.sort_videos_for_processing(videos)

    assert [item["filename"] for item in ordered] == ["s1-cam1.mp4", "s1-cam2.mp4", "s2-cam2.mp4"]


def test_interrupted_job_collects_all_target_clip_ids():
    job = {
        "target_path": "video_clip:root",
        "target_paths": ["video_clip:cam1-prev", "video_clip:root", "video_clip:cam2-main", "local-file.mp4"],
    }

    assert automatic_attendance_jobs.interrupted_clip_ids(job) == ["cam1-prev", "root", "cam2-main"]
