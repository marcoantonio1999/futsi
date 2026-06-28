from datetime import timedelta

import pytest
from django.utils import timezone

from core.api import automatic_attendance as attendance_jobs
from core.api import automatic_attendance_jobs


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
