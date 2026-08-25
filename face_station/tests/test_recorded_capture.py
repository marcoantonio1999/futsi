from __future__ import annotations

import io
import json
import time
from pathlib import Path
from threading import Thread
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from face_station.app.config import ConfigManager
from face_station.app.mjpeg_index import (
    IndexedMjpegReader,
    MjpegPacket,
    mjpeg_packets_in_windows,
    select_mjpeg_scout_packets,
)
from face_station.app.recorded_pipeline import (
    RecordedCameraWorker,
    TieredRecordingStorage,
    list_segment_jobs,
    list_segment_jobs_in_roots,
    recover_segment_jobs,
    segment_job_summary,
    segment_job_summary_in_roots,
    update_segment_job,
)


def write_job(root: Path, name: str, status: str, file_bytes: int = 100) -> Path:
    folder = root / "primary" / "2026-08-10"
    folder.mkdir(parents=True, exist_ok=True)
    video = folder / f"{name}.mkv"
    video.write_bytes(b"video")
    job = video.with_suffix(".mkv.job.json")
    job.write_text(
        json.dumps(
            {
                "camera_key": "primary",
                "camera_label": "Cancha",
                "path": str(video),
                "filename": video.name,
                "started_at": f"2026-08-10T10:00:0{name[-1]}-06:00",
                "updated_at": f"2026-08-10T10:01:0{name[-1]}-06:00",
                "status": status,
                "stage": status,
                "file_bytes": file_bytes,
            }
        ),
        encoding="utf-8",
    )
    return job


def test_recorded_config_validates_production_defaults(tmp_path):
    manager = ConfigManager(tmp_path)
    updated = manager.update(
        {
            "recorded_detection_enabled": True,
            "recorded_video_dir": str(tmp_path / "segments"),
            "recorded_hot_video_dir": str(tmp_path / "hot-segments"),
            "recorded_hot_min_free_gb": 35,
            "recorded_hot_resume_free_gb": 45,
            "recorded_segment_minutes": 5,
            "recorded_sample_fps": 2,
            "recorded_processing_width": 640,
            "recorded_original_retention_hours": 0,
        }
    )

    assert updated.recorded_detection_enabled is True
    assert updated.recorded_hot_min_free_gb == pytest.approx(35.0)
    assert updated.recorded_hot_resume_free_gb == pytest.approx(45.0)
    assert updated.recorded_segment_minutes == 5
    assert updated.recorded_sample_fps == pytest.approx(2.0)
    assert updated.recorded_processing_width == 640
    assert updated.recorded_original_retention_hours == 0


def test_recorded_config_rejects_unsafe_values(tmp_path):
    manager = ConfigManager(tmp_path)
    with pytest.raises(ValueError, match="recorded_sample_fps"):
        manager.update({"recorded_sample_fps": 0.1})
    with pytest.raises(ValueError, match="recorded_segment_minutes"):
        manager.update({"recorded_segment_minutes": 60})
    with pytest.raises(ValueError, match="recorded_hot_resume_free_gb"):
        manager.update(
            {
                "recorded_hot_min_free_gb": 35,
                "recorded_hot_resume_free_gb": 30,
            }
        )


def test_segment_jobs_recover_and_report_without_losing_state(tmp_path):
    pending = write_job(tmp_path, "segment-1", "pending", 200)
    processing = write_job(tmp_path, "segment-2", "processing", 300)
    write_job(tmp_path, "segment-3", "done", 400)

    assert recover_segment_jobs(tmp_path) == 1
    recovered = json.loads(processing.read_text(encoding="utf-8"))
    assert recovered["status"] == "pending"
    assert "interrupción" in recovered["last_error"]

    summary = segment_job_summary(tmp_path)
    assert summary["pending"] == 2
    assert summary["processing"] == 0
    assert summary["done"] == 1
    assert summary["pending_bytes"] == 500
    assert len(summary["recent"]) == 3

    rows = list_segment_jobs(tmp_path, statuses={"pending"})
    assert [path for path, _ in rows] == [pending, processing]
    updated = update_segment_job(pending, status="done", stage="complete")
    assert updated["status"] == "done"
    assert not pending.with_suffix(pending.suffix + ".tmp").exists()


def test_tiered_storage_protects_reserve_and_resumes_with_hysteresis(tmp_path):
    archive = tmp_path / "archive"
    hot = tmp_path / "hot"
    router = TieredRecordingStorage(
        archive,
        hot_root=hot,
        min_free_gb=35,
        resume_free_gb=45,
    )

    with patch(
        "face_station.app.recorded_pipeline.shutil.disk_usage",
        return_value=SimpleNamespace(free=80 * 1024**3),
    ):
        assert router.reserve("primary", large_mjpeg=True) == hot.resolve()
    router.release("primary", hot.resolve(), 9 * 1024**3)

    with patch(
        "face_station.app.recorded_pipeline.shutil.disk_usage",
        return_value=SimpleNamespace(free=45 * 1024**3),
    ):
        assert router.reserve("primary", large_mjpeg=True) == archive.resolve()
        assert router.status()["fallback_active"] is True

    with patch(
        "face_station.app.recorded_pipeline.shutil.disk_usage",
        return_value=SimpleNamespace(free=54 * 1024**3),
    ):
        assert router.reserve("primary", large_mjpeg=True) == archive.resolve()

    with patch(
        "face_station.app.recorded_pipeline.shutil.disk_usage",
        return_value=SimpleNamespace(free=57 * 1024**3),
    ):
        assert router.reserve("primary", large_mjpeg=True) == hot.resolve()
        assert router.status()["fallback_active"] is False


def test_segment_queue_spans_hot_and_archive_roots(tmp_path):
    hot = tmp_path / "hot"
    archive = tmp_path / "archive"
    hot_job = write_job(hot, "segment-1", "pending", 200)
    archive_job = write_job(archive, "segment-2", "error", 300)

    rows = list_segment_jobs_in_roots(
        (hot, archive),
        statuses={"pending", "error"},
    )
    assert {path for path, _ in rows} == {hot_job, archive_job}

    summary = segment_job_summary_in_roots((hot, archive))
    assert summary["pending"] == 1
    assert summary["error"] == 1
    assert summary["pending_bytes"] == 500


def test_segment_queue_does_not_descend_into_match_evidence(tmp_path):
    queue_job = write_job(tmp_path, "segment-1", "pending")
    evidence_dir = tmp_path / "_match-evidence" / "candidates" / "2026-08-10"
    evidence_dir.mkdir(parents=True)
    (evidence_dir / "not-a-queue.avi.job.json").write_text("{}", encoding="utf-8")

    rows = list_segment_jobs(tmp_path)
    assert [path for path, _ in rows] == [queue_job]


def test_http_mjpeg_uses_indexed_avi_and_rtsp_keeps_matroska(tmp_path):
    http_worker = RecordedCameraWorker(
        "http://192.0.2.20:8080/stream",
        name="primary",
        label="ELP",
        storage_root=tmp_path,
        ffmpeg=tmp_path / "ffmpeg.exe",
        ffprobe=tmp_path / "ffprobe.exe",
        segment_seconds=300,
    )
    rtsp_worker = RecordedCameraWorker(
        "rtsp://192.0.2.30/live",
        name="secondary",
        label="Dahua",
        storage_root=tmp_path,
        ffmpeg=tmp_path / "ffmpeg.exe",
        ffprobe=tmp_path / "ffprobe.exe",
        segment_seconds=300,
    )

    assert http_worker._segment_suffix == ".avi"
    assert http_worker._segment_format == "avi"
    assert rtsp_worker._segment_suffix == ".mkv"
    assert rtsp_worker._segment_format == "matroska"


def test_segment_job_listing_includes_indexed_avi(tmp_path):
    folder = tmp_path / "primary" / "2026-08-10"
    folder.mkdir(parents=True)
    video = folder / "segment-avi.avi"
    video.write_bytes(b"video")
    job = video.with_suffix(".avi.job.json")
    job.write_text(
        json.dumps(
            {
                "camera_key": "primary",
                "path": str(video),
                "filename": video.name,
                "started_at": "2026-08-10T10:00:00-06:00",
                "updated_at": "2026-08-10T10:01:00-06:00",
                "status": "pending",
                "stage": "waiting",
                "file_bytes": 500,
            }
        ),
        encoding="utf-8",
    )

    rows = list_segment_jobs(tmp_path, statuses={"pending"})
    assert [path for path, _ in rows] == [job]
    assert segment_job_summary(tmp_path)["pending_bytes"] == 500


def test_mjpeg_index_selects_scouts_windows_and_exact_payloads(tmp_path):
    packets = [
        MjpegPacket(offset=0.0, position=4, size=7),
        MjpegPacket(offset=0.25, position=15, size=7),
        MjpegPacket(offset=0.5, position=26, size=7),
        MjpegPacket(offset=1.0, position=37, size=7),
    ]
    assert select_mjpeg_scout_packets(packets, 2.0) == [
        packets[0],
        packets[2],
        packets[3],
    ]
    assert mjpeg_packets_in_windows(packets, [(0.2, 0.6)]) == [
        packets[1],
        packets[2],
    ]

    payloads = [b"\xff\xd8one\xff\xd9", b"\xff\xd8two\xff\xd9", b"\xff\xd8tri\xff\xd9", b"\xff\xd8for\xff\xd9"]
    video = tmp_path / "packets.avi"
    video.write_bytes(b"HEAD" + b"JUNK".join(payloads))
    with IndexedMjpegReader(video) as reader:
        assert reader.read(packets[0]) == payloads[0]


def test_recorder_never_exposes_camera_credentials(tmp_path):
    worker = RecordedCameraWorker(
        "rtsp://admin:private-password@192.0.2.10:554/live",
        name="secondary",
        label="Cámara",
        storage_root=tmp_path,
        ffmpeg=tmp_path / "ffmpeg.exe",
        ffprobe=tmp_path / "ffprobe.exe",
        segment_seconds=300,
    )

    safe = worker._safe_error(
        "Error rtsp://admin:private-password@192.0.2.10:554/live "
        "for admin/private-password"
    )
    assert "private-password" not in safe
    assert "admin" not in safe
    assert "<fuente de cámara>" in safe


def test_http_recorder_queues_latest_throttled_preview_without_blocking(tmp_path):
    published: list[bytes] = []
    worker = RecordedCameraWorker(
        "http://192.0.2.20:8080/stream",
        name="primary",
        label="ELP",
        storage_root=tmp_path,
        ffmpeg=tmp_path / "ffmpeg.exe",
        ffprobe=tmp_path / "ffprobe.exe",
        segment_seconds=300,
        preview_callback=published.append,
        preview_fps=1,
    )
    frame = np.full((24, 32, 3), 127, dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", frame)
    assert ok
    jpeg = encoded.tobytes()

    with patch(
        "face_station.app.recorded_pipeline.time.monotonic",
        side_effect=[10.0, 10.2, 11.1],
    ):
        worker._consume_preview_stream(io.BytesIO(jpeg + jpeg + jpeg))

    assert worker._preview_queue.get_nowait() == jpeg
    assert published == []
    assert worker.status_metrics["live_preview_frames_dropped"] == 1
    assert worker.status_metrics["live_preview_decoupled"] is True


def test_http_recorder_preview_callback_runs_outside_pipe_reader(tmp_path):
    published: list[bytes] = []
    worker = RecordedCameraWorker(
        "http://192.0.2.20:8080/stream",
        name="primary",
        label="ELP",
        storage_root=tmp_path,
        ffmpeg=tmp_path / "ffmpeg.exe",
        ffprobe=tmp_path / "ffprobe.exe",
        segment_seconds=300,
        preview_callback=published.append,
    )
    worker._offer_preview(b"jpeg")

    thread = Thread(target=worker._run_preview_publisher, daemon=True)
    thread.start()
    for _ in range(50):
        if published:
            break
        time.sleep(0.01)
    worker._stop.set()
    thread.join(timeout=1)

    assert published == [b"jpeg"]
    assert worker.status_metrics["live_preview_frames"] == 1


def test_rtsp_recorder_uses_independent_preview_process(tmp_path):
    worker = RecordedCameraWorker(
        "rtsp://192.0.2.30/live",
        name="secondary",
        label="Dahua",
        storage_root=tmp_path,
        ffmpeg=tmp_path / "ffmpeg.exe",
        ffprobe=tmp_path / "ffprobe.exe",
        segment_seconds=300,
        preview_callback=lambda _payload: None,
    )

    assert worker.status_metrics["live_preview_enabled"] is True
    assert worker._preview_mode == "dahua_snapshot"
