from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np

from face_station.app import processor as processor_module
from face_station.app.config import ConfigManager
from face_station.app.match_video import (
    MatchEvidenceWriter,
    segment_needs_evidence_candidate,
    square_evidence_frame,
)
from face_station.app.recorded_pipeline import find_media_binary
from face_station.app.processor import StationRuntime
from face_station.app.store import MATCH_ANALYSIS_VERSION, LocalStore, utc_now
from face_station.app.time_utils import BUSINESS_TIME_ZONE


def test_segment_evidence_window_covers_afternoon_and_after_midnight():
    zone = timezone(timedelta(hours=-6))
    assert segment_needs_evidence_candidate(
        datetime(2026, 8, 10, 14, 59, tzinfo=zone),
        datetime(2026, 8, 10, 15, 2, tzinfo=zone),
    )
    assert segment_needs_evidence_candidate(
        datetime(2026, 8, 11, 0, 55, tzinfo=zone),
        datetime(2026, 8, 11, 1, 2, tzinfo=zone),
    )
    assert not segment_needs_evidence_candidate(
        datetime(2026, 8, 10, 9, 0, tzinfo=zone),
        datetime(2026, 8, 10, 9, 5, tzinfo=zone),
    )


def test_square_evidence_frame_preserves_content_with_letterbox():
    frame = np.full((100, 200, 3), 255, dtype=np.uint8)
    result = square_evidence_frame(frame, 420)
    assert result.shape == (420, 420, 3)
    assert int(result[210, 210].mean()) == 255
    assert int(result[10, 210].mean()) == 0


def test_match_evidence_writer_creates_browser_mp4(tmp_path):
    output = tmp_path / "evidence.mp4"
    writer = MatchEvidenceWriter(find_media_binary("ffmpeg"), output, fps=2.0)
    for index in range(6):
        frame = np.full((240, 320, 3), index * 30, dtype=np.uint8)
        writer.write(frame)
    result = writer.close()
    assert result["ok"] is True
    assert result["frames"] == 6
    assert output.stat().st_size > 0
    capture = cv2.VideoCapture(str(output))
    try:
        ok, frame = capture.read()
        assert ok is True
        assert frame.shape[:2] == (420, 420)
    finally:
        capture.release()


def test_match_video_decision_waits_for_current_queue_and_retains_overlap(tmp_path):
    store = LocalStore(tmp_path / "data")
    analysis_date = "2025-08-10"
    now = utc_now()
    with store.connection(immediate=True) as db:
        db.execute(
            "insert into crop_processing_stats values (?,?,?,?)",
            (analysis_date, "processed", 12, 1200),
        )
        db.execute(
            """
            insert into match_analysis_days
                (analysis_date,status,source_queue_count,unresolved_queue_count,
                 analysis_version,analyzed_at)
            values (?,?,?,?,?,?)
            """,
            (analysis_date, "complete", 12, 0, MATCH_ANALYSIS_VERSION, now),
        )
        db.execute(
            """
            insert into match_analysis_windows
                (analysis_date,window_index,starts_at,ends_at,window_type,
                 window_status,created_at)
            values (?,?,?,?,?,?,?)
            """,
            (
                analysis_date,
                1,
                "2025-08-10T18:00:00-06:00",
                "2025-08-10T18:50:00-06:00",
                "unscheduled",
                "outside_schedule",
                now,
            ),
        )
    decision = store.match_video_decision(
        analysis_date,
        "2025-08-10T18:20:00-06:00",
        "2025-08-10T18:25:00-06:00",
    )
    assert decision["ready"] is True
    assert decision["retain"] is True
    assert len(decision["windows"]) == 1

    with store.connection(immediate=True) as db:
        db.execute(
            "update crop_processing_stats set item_count=13 where capture_date=?",
            (analysis_date,),
        )
    stale = store.match_video_decision(
        analysis_date,
        "2025-08-10T18:20:00-06:00",
        "2025-08-10T18:25:00-06:00",
    )
    assert stale["ready"] is False


def test_runtime_retains_matching_proxy_and_exposes_it(tmp_path, monkeypatch):
    manager = ConfigManager(tmp_path / "config")
    job_root = tmp_path / "hot-segments"
    evidence_root = tmp_path / "archive-segments"
    manager.update({"recorded_video_dir": str(evidence_root)})
    runtime = StationRuntime(manager)
    runtime._recorded_storage_root = evidence_root
    runtime._recorded_storage_roots = (job_root, evidence_root)
    local_now = datetime.now(timezone.utc).astimezone(BUSINESS_TIME_ZONE)
    day = local_now.date() - timedelta(days=1)
    analysis_date = day.isoformat()
    starts = datetime.combine(day, datetime.min.time(), local_now.tzinfo).replace(
        hour=18,
        minute=20,
    )
    ends = starts + timedelta(minutes=5)
    window_start = starts.replace(minute=0)
    window_end = window_start + timedelta(minutes=50)
    created = utc_now()
    with runtime.store.connection(immediate=True) as db:
        db.execute(
            "insert into crop_processing_stats values (?,?,?,?)",
            (analysis_date, "processed", 12, 1200),
        )
        db.execute(
            """
            insert into match_analysis_days
                (analysis_date,status,source_queue_count,unresolved_queue_count,
                 analysis_version,analyzed_at)
            values (?,?,?,?,?,?)
            """,
            (analysis_date, "complete", 12, 0, MATCH_ANALYSIS_VERSION, created),
        )
        cursor = db.execute(
            """
            insert into match_analysis_windows
                (analysis_date,window_index,starts_at,ends_at,window_type,
                 window_status,created_at)
            values (?,?,?,?,?,?,?)
            """,
            (
                analysis_date,
                1,
                window_start.isoformat(),
                window_end.isoformat(),
                "unscheduled",
                "outside_schedule",
                created,
            ),
        )
        window_id = int(cursor.lastrowid)
    folder = job_root / "primary" / analysis_date
    folder.mkdir(parents=True)
    video = folder / "segment.mkv"
    proxy = evidence_root / "_match-evidence" / "candidates" / analysis_date / "primary" / "segment.mp4"
    proxy.parent.mkdir(parents=True)
    proxy.write_bytes(b"fake-browser-video")
    job = video.with_suffix(".mkv.job.json")
    job.write_text(
        json.dumps(
            {
                "camera_key": "primary",
                "camera_label": "ELP 1",
                "path": str(video),
                "filename": video.name,
                "started_at": starts.isoformat(),
                "finished_at": ends.isoformat(),
                "duration_seconds": 300,
                "status": "done",
                "stage": "complete",
                "updated_at": created,
                "original_deleted": True,
                "evidence_status": "candidate",
                "evidence_video_path": str(proxy),
                "evidence_window_ids": [],
            }
        ),
        encoding="utf-8",
    )

    runtime._reconcile_match_video_evidence(datetime.now(timezone.utc))

    payload = json.loads(job.read_text(encoding="utf-8"))
    assert payload["evidence_status"] == "retained"
    assert payload["evidence_window_ids"] == [window_id]
    assert Path(payload["evidence_video_path"]).is_relative_to(
        evidence_root / "_match-evidence" / "retained"
    )

    # Startup can recover the query index exclusively from durable job JSONs.
    with runtime.store.connection(immediate=True) as db:
        db.execute("delete from match_evidence_videos")
    rebuilt = runtime._rebuild_match_evidence_index()
    assert rebuilt == {"videos": 1, "links": 1}

    # Serving the list and a video must never rescan the recording tree.
    monkeypatch.setattr(
        processor_module,
        "list_segment_jobs_in_roots",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("the evidence API scanned recording jobs")
        ),
    )
    retained = runtime.match_window_videos(window_id)
    assert retained is not None
    assert len(retained) == 1
    assert runtime.match_window_video_path(
        window_id,
        retained[0]["video_id"],
    ).is_file()
