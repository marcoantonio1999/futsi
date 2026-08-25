from __future__ import annotations

import io
import json
import time
from pathlib import Path
from types import SimpleNamespace
from threading import Thread
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from face_station.app.config import ConfigManager
from face_station.app.mjpeg_index import MjpegPacket
from face_station.app.processor import StationRuntime
from face_station.app.recognition import DetectedFace
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


def test_segment_jobs_recover_and_report_without_losing_state(tmp_path):
    pending = write_job(tmp_path, "segment-1", "pending", 200)
    processing = write_job(tmp_path, "segment-2", "processing", 300)
    done = write_job(tmp_path, "segment-3", "done", 400)

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
    misleading = evidence_dir / "not-a-queue.avi.job.json"
    misleading.write_text("{}", encoding="utf-8")

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


def test_activity_windows_merge_scout_hits_and_apply_safe_padding():
    face = DetectedFace(
        bbox=(10, 10, 30, 30),
        embedding=None,
        score=0.9,
        quality=0.9,
    )
    anchors = [
        (0.5, (360, 640), (face,)),
        (1.0, (360, 640), (face,)),
        (4.0, (360, 640), (face,)),
    ]

    windows = StationRuntime._recorded_activity_windows(
        anchors,
        4.5,
        padding_seconds=1.0,
    )

    assert windows == [(0.0, 2.0), (3.0, 4.5)]


def test_mjpeg_single_pass_scouts_and_recovers_original_active_frames(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update(
        {
            "recorded_processing_width": 640,
            "recorded_sample_fps": 2,
            "processing_width": 640,
            "camera_roi_left": 0.0,
            "camera_roi_right": 1.0,
        }
    )
    runtime = StationRuntime(manager)
    offsets = [index / 4 for index in range(13)]
    source_frames = [
        np.full(
            (80, 120, 3),
            200 if offset == 1.0 else 20,
            dtype=np.uint8,
        )
        for offset in offsets
    ]
    encoded_frames = []
    for frame in source_frames:
        ok, encoded = cv2.imencode(".jpg", frame)
        assert ok
        encoded_frames.append(encoded.tobytes())
    stream_payload = b"".join(encoded_frames)
    timestamp_log = b"".join(
        (
            f"[vist#0:0/mjpeg] demuxer -> ist_index:0:0 type:video "
            f"pkt_pts_time:{offset}\n"
        ).encode("utf-8")
        for offset in offsets
    )

    class FakeDecodedBatch:
        def __init__(self, originals, width, height):
            self.originals = originals
            self.resized_frames = tuple(
                cv2.resize(frame, (width, height)) for frame in originals
            )
            self.closed = False

        def copy_original(self, index):
            assert not self.closed
            return self.originals[index].copy()

        def close(self):
            self.closed = True

    class FakeDecoder:
        def __init__(self):
            self.requested_batches = []

        def image_info(self, _jpeg):
            return object()

        def recommended_batch_size(
            self,
            _info,
            _width,
            _height,
            requested,
        ):
            self.requested_batches.append(requested)
            return min(requested, 3)

        def decode_resize_batch(self, payloads, width, height):
            originals = [
                cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
                for payload in payloads
            ]
            return FakeDecodedBatch(originals, width, height)

    class FakeDetector:
        def detect(self, frame, min_face_size):
            assert min_face_size > 0
            if float(frame.mean()) < 150:
                return []
            return [
                DetectedFace(
                    bbox=(100, 100, 300, 300),
                    embedding=None,
                    score=0.9,
                    quality=0.9,
                )
            ]

    class FakeProcess:
        def __init__(self):
            self.stdout = io.BytesIO(stream_payload)
            self.stderr = io.BytesIO(timestamp_log)
            self.returncode = None

        def poll(self):
            return self.returncode

        def wait(self, timeout=None):
            self.returncode = 0
            return 0

        def kill(self):
            self.returncode = -9

    class FakeEvidenceWriter:
        def __init__(self):
            self.frames = 0

        def write(self, frame):
            assert frame.shape[1] == 640
            self.frames += 1

    decoder = FakeDecoder()
    evidence = FakeEvidenceWriter()
    runtime._recorded_nvjpeg = decoder
    runtime._detector = FakeDetector()
    runtime._recorded_ffmpeg = tmp_path / "ffmpeg.exe"
    enqueued_offsets = []

    def enqueue(
        source_frame,
        _detection_shape,
        detections,
        _camera_key,
        _started_at,
        offset,
    ):
        assert source_frame.shape == (80, 120, 3)
        enqueued_offsets.append(offset)
        return len(detections)

    monkeypatch.setattr(
        runtime,
        "_probe_recorded_packet_offsets",
        lambda _path: pytest.fail(
            "El pipeline de una pasada no debe recorrer los paquetes antes."
        ),
    )
    monkeypatch.setattr(
        runtime,
        "_enqueue_recorded_source_detections",
        enqueue,
    )
    monkeypatch.setattr(
        "face_station.app.processor.subprocess.Popen",
        lambda *_args, **_kwargs: FakeProcess(),
    )
    monkeypatch.setattr(
        "face_station.app.processor.update_segment_job",
        lambda *_args, **_kwargs: {},
    )

    anchors, scan, windows, activity = (
        runtime._process_recorded_mjpeg_single_pass(
            tmp_path / "segment.mkv",
            "primary",
            {"started_at": "2026-08-11T10:00:00-06:00"},
            {
                "width": 120,
                "height": 80,
                "duration_seconds": 3.0,
                "source_fps": 4.0,
                "codec": "mjpeg",
                "pixel_format": "yuvj422p",
            },
            {},
            evidence_writer=evidence,
        )
    )

    assert decoder.requested_batches == [10]
    assert evidence.frames == 7
    assert len(anchors) == 1
    assert scan["sampled_frames"] == 7
    assert scan["faces"] == 1
    assert scan["packet_timestamps"] == len(offsets)
    assert scan["timestamp_fallbacks"] == 0
    assert scan["timestamp_source"] == "ffmpeg_live_demux"
    assert windows == [(0.0, 2.0)]
    assert activity["full_fps_frames"] == 9
    assert activity["full_fps_expected_frames"] == 9
    assert activity["faces"] == 1
    assert activity["crops_enqueued"] == 1
    assert enqueued_offsets == [pytest.approx(1.0)]


def test_mjpeg_indexed_pipeline_reads_only_scouts_and_active_packets(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update(
        {
            "recorded_processing_width": 640,
            "recorded_sample_fps": 2,
            "processing_width": 640,
            "camera_roi_left": 0.0,
            "camera_roi_right": 1.0,
        }
    )
    runtime = StationRuntime(manager)
    offsets = [index / 4 for index in range(13)]
    packets = []
    video = tmp_path / "segment.mkv"
    with video.open("wb") as stream:
        for offset in offsets:
            frame = np.full(
                (80, 120, 3),
                200 if offset == 1.0 else 20,
                dtype=np.uint8,
            )
            ok, encoded = cv2.imencode(".jpg", frame)
            assert ok
            payload = encoded.tobytes()
            position = stream.tell()
            stream.write(b"\x81\x00\x00\x80")
            stream.write(payload)
            packets.append(
                MjpegPacket(
                    offset=offset,
                    position=position,
                    size=len(payload),
                )
            )

    class FakeDecodedBatch:
        def __init__(self, originals, width, height):
            self.originals = originals
            self.resized_frames = tuple(
                cv2.resize(frame, (width, height)) for frame in originals
            )
            self.closed = False

        def copy_original(self, index):
            assert not self.closed
            return self.originals[index].copy()

        def close(self):
            self.closed = True

    class FakeDecoder:
        def image_info(self, _jpeg):
            return object()

        def recommended_batch_size(
            self,
            _info,
            _width,
            _height,
            requested,
        ):
            return min(requested, 3)

        def decode_resize_batch(self, payloads, width, height):
            originals = [
                cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
                for payload in payloads
            ]
            return FakeDecodedBatch(originals, width, height)

    class FakeDetector:
        def detect(self, frame, min_face_size):
            assert min_face_size > 0
            if float(frame.mean()) < 150:
                return []
            return [
                DetectedFace(
                    bbox=(100, 100, 300, 300),
                    embedding=None,
                    score=0.9,
                    quality=0.9,
                )
            ]

    class FakeEvidenceWriter:
        def __init__(self):
            self.frames = 0

        def write(self, frame):
            assert frame.shape[1] == 640
            self.frames += 1

    evidence = FakeEvidenceWriter()
    runtime._recorded_nvjpeg = FakeDecoder()
    runtime._detector = FakeDetector()
    enqueued_offsets = []

    def enqueue(
        source_frame,
        _detection_shape,
        detections,
        _camera_key,
        _started_at,
        offset,
    ):
        assert source_frame.shape == (80, 120, 3)
        enqueued_offsets.append(offset)
        return len(detections)

    monkeypatch.setattr(
        runtime,
        "_enqueue_recorded_source_detections",
        enqueue,
    )
    monkeypatch.setattr(
        "face_station.app.processor.update_segment_job",
        lambda *_args, **_kwargs: {},
    )

    anchors, scan, windows, activity = runtime._process_recorded_mjpeg_indexed(
        video,
        "primary",
        {"started_at": "2026-08-11T10:00:00-06:00"},
        {
            "width": 120,
            "height": 80,
            "duration_seconds": 3.0,
            "source_fps": 4.0,
            "codec": "mjpeg",
            "pixel_format": "yuvj422p",
            "file_bytes": video.stat().st_size,
        },
        {},
        packets,
        evidence_writer=evidence,
    )

    assert evidence.frames == 7
    assert len(anchors) == 1
    assert scan["pipeline_mode"] == "mjpeg_indexed_selective"
    assert scan["sampled_frames"] == 7
    assert scan["faces"] == 1
    assert scan["timestamp_source"] == "matroska_packet_index"
    assert windows == [(0.0, 2.0)]
    assert activity["full_fps_frames"] == 9
    assert activity["full_fps_expected_frames"] == 9
    assert activity["faces"] == 1
    assert activity["crops_enqueued"] == 1
    assert enqueued_offsets == [pytest.approx(1.0)]


def test_activity_pass_analyzes_every_source_frame_in_detected_window(
    tmp_path,
    monkeypatch,
):
    manager = ConfigManager(tmp_path)
    manager.update(
        {
            "recorded_processing_width": 640,
            "processing_width": 1280,
            "camera_roi_left": 0.0,
            "camera_roi_right": 1.0,
        }
    )
    runtime = StationRuntime(manager)
    source_frames = [
        np.full((80, 120, 3), index, dtype=np.uint8)
        for index in range(30)
    ]

    class FakeCapture:
        def __init__(self):
            self.position = 0

        def isOpened(self):
            return True

        def get(self, prop):
            return 10.0 if prop == cv2.CAP_PROP_FPS else 0.0

        def set(self, prop, value):
            assert prop == cv2.CAP_PROP_POS_FRAMES
            self.position = int(value)
            return True

        def read(self):
            if self.position >= len(source_frames):
                return False, None
            frame = source_frames[self.position]
            self.position += 1
            return True, frame.copy()

        def release(self):
            return None

    class FakeDetector:
        def __init__(self):
            self.calls = 0

        def detect(self, _frame, min_face_size):
            assert min_face_size > 0
            self.calls += 1
            return [
                DetectedFace(
                    bbox=(20, 20, 80, 70),
                    embedding=None,
                    score=0.9,
                    quality=0.9,
                )
            ]

    detector = FakeDetector()
    runtime._detector = detector
    observed_offsets = []

    def enqueue(
        source_frame,
        _detection_shape,
        detections,
        _camera_key,
        _started_at,
        offset,
    ):
        assert source_frame.shape == (80, 120, 3)
        observed_offsets.append(offset)
        return len(detections)

    monkeypatch.setattr(cv2, "VideoCapture", lambda *_args: FakeCapture())
    monkeypatch.setattr(
        runtime,
        "_enqueue_recorded_source_detections",
        enqueue,
    )
    monkeypatch.setattr(
        "face_station.app.processor.update_segment_job",
        lambda *_args, **_kwargs: {},
    )

    stats = runtime._persist_recorded_activity_windows(
        tmp_path / "segment.mkv",
        "primary",
        {"started_at": "2026-08-11T10:00:00-06:00"},
        {
            "width": 120,
            "height": 80,
            "source_fps": 10.0,
            "codec": "h264",
        },
        [(1.0, 2.0)],
        {},
    )

    assert detector.calls == 11
    assert stats["full_fps_frames"] == 11
    assert stats["face_frames"] == 11
    assert stats["faces"] == 11
    assert stats["crops_enqueued"] == 11
    assert observed_offsets[0] == pytest.approx(1.0)
    assert observed_offsets[-1] == pytest.approx(2.0)


def test_h264_empty_selective_activity_retries_sequential_full_segment(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    observed_windows = []
    state_updates = []
    job_updates = []

    def persist(
        _video_path,
        _camera_key,
        _job,
        _info,
        windows,
        _current,
    ):
        observed_windows.append(windows)
        return {
            "full_fps_frames": 3001,
            "face_frames": 8,
            "faces": 8,
            "crops_enqueued": 8,
        }

    monkeypatch.setattr(runtime, "_persist_recorded_activity_windows", persist)
    monkeypatch.setattr(
        runtime,
        "_set_recorded_pipeline_state",
        lambda state, **kwargs: state_updates.append((state, kwargs)),
    )
    monkeypatch.setattr(
        "face_station.app.processor.update_segment_job",
        lambda path, **changes: job_updates.append((path, changes)) or changes,
    )

    current = {}
    result = runtime._recover_empty_h264_activity(
        tmp_path / "segment.mkv",
        tmp_path / "segment.mkv.job.json",
        "secondary",
        {"started_at": "2026-08-16T14:47:40-06:00"},
        {"codec": "h264", "source_fps": 10.0},
        300.058,
        {"faces": 2},
        {"faces": 0, "crops_enqueued": 0},
        current,
    )

    assert observed_windows == [[(0.0, 300.058)]]
    assert result["faces"] == 8
    assert result["crops_enqueued"] == 8
    assert current["recovery_mode"] == "h264_full_segment_sequential"
    assert state_updates[0][0] == "processing"
    assert job_updates[0][1]["stage"] == "recovering_activity"
    assert job_updates[-1][1]["recovery_faces"] == 8
    assert result["recovery_exhaustive"] is True
    assert result["recovery_outcome"] == "confirmed_faces"


def test_h264_exhaustive_empty_recovery_marks_scout_as_false_positive(
    tmp_path,
    monkeypatch,
):
    runtime = StationRuntime(ConfigManager(tmp_path))
    job_updates = []

    monkeypatch.setattr(
        runtime,
        "_persist_recorded_activity_windows",
        lambda *_args, **_kwargs: {
            "full_fps_frames": 2994,
            "face_frames": 0,
            "faces": 0,
            "crops_enqueued": 0,
        },
    )
    monkeypatch.setattr(runtime, "_set_recorded_pipeline_state", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "face_station.app.processor.update_segment_job",
        lambda path, **changes: job_updates.append((path, changes)) or changes,
    )

    result = runtime._recover_empty_h264_activity(
        tmp_path / "segment.mkv",
        tmp_path / "segment.mkv.job.json",
        "secondary",
        {"started_at": "2026-08-20T14:44:31-06:00"},
        {"codec": "h264", "source_fps": 10.0},
        300.0,
        {"faces": 1},
        {"faces": 0, "crops_enqueued": 0},
        {},
    )

    assert result["recovery_exhaustive"] is True
    assert result["recovery_outcome"] == "scout_false_positive"
    assert runtime._scout_recovery_requires_retry({"faces": 1}, result) is False
    assert job_updates[-1][1]["recovery_outcome"] == "scout_false_positive"


def test_incomplete_empty_recovery_still_requires_retry():
    assert StationRuntime._scout_recovery_requires_retry(
        {"faces": 1},
        {"faces": 0, "recovery_exhaustive": False},
    ) is True


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
        label="Raspberry",
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

    queued = worker._preview_queue.get_nowait()
    assert queued == jpeg
    assert published == []
    assert worker.status_metrics["live_preview_enabled"] is True
    assert worker.status_metrics["live_preview_frames"] == 0
    assert worker.status_metrics["live_preview_frames_dropped"] == 1
    assert worker.status_metrics["live_preview_decoupled"] is True


def test_http_recorder_preview_callback_runs_outside_pipe_reader(tmp_path):
    published: list[bytes] = []
    worker = RecordedCameraWorker(
        "http://192.0.2.20:8080/stream",
        name="primary",
        label="Raspberry",
        storage_root=tmp_path,
        ffmpeg=tmp_path / "ffmpeg.exe",
        ffprobe=tmp_path / "ffprobe.exe",
        segment_seconds=300,
        preview_callback=published.append,
    )
    payload = b"jpeg"
    worker._offer_preview(payload)

    thread = Thread(target=worker._run_preview_publisher, daemon=True)
    thread.start()
    for _ in range(50):
        if published:
            break
        time.sleep(0.01)
    worker._stop.set()
    thread.join(timeout=1)

    assert published == [payload]
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
