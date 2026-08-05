from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timezone
from threading import Event, Thread

import numpy as np
import pytest

from face_station.app.store import LocalStore


CAPTURED_AT = datetime(2026, 8, 5, 18, 30, tzinfo=timezone.utc)


def crop_item(path, *, camera_key="primary", file_bytes=1234):
    return {
        "captured_at": CAPTURED_AT,
        "camera_key": camera_key,
        "camera_label": camera_key.title(),
        "crop_path": str(path),
        "file_bytes": file_bytes,
        "crop_width": 160,
        "crop_height": 220,
        "det_score": 0.91,
        "bbox": (10, 20, 150, 210),
        "landmarks": np.asarray(
            [[50, 70], [110, 70], [80, 110], [58, 160], [102, 160]],
            dtype=np.float32,
        ),
    }


def test_single_and_batch_crop_enqueue_are_equivalent(tmp_path):
    store = LocalStore(tmp_path)
    first = crop_item(tmp_path / "first.jpg")
    second = crop_item(
        tmp_path / "second.jpg",
        camera_key="secondary",
        file_bytes=4321,
    )

    legacy = store.enqueue_crop_for_processing(**first)
    batched = store.enqueue_crops_for_processing([second])

    assert len(batched) == 1
    assert legacy["status"] == batched[0]["status"] == "pending"
    assert legacy["captured_at"] == batched[0]["captured_at"]
    assert legacy["det_score"] == pytest.approx(batched[0]["det_score"])
    with store.connection() as db:
        rows = db.execute(
            """
            select camera_key,crop_path,bbox_json,landmarks_json
            from crop_processing_queue order by id
            """
        ).fetchall()
    assert [row["camera_key"] for row in rows] == ["primary", "secondary"]
    assert [row["crop_path"] for row in rows] == [
        first["crop_path"],
        second["crop_path"],
    ]
    assert rows[0]["bbox_json"] == rows[1]["bbox_json"]
    assert rows[0]["landmarks_json"] == rows[1]["landmarks_json"]
    summary = store.crop_queue_summary("2026-08-05")
    assert summary["captured"] == 2
    assert summary["pending"] == 2
    assert summary["captured_bytes"] == 5555


def test_batch_crop_enqueue_rolls_back_rows_and_stats_together(tmp_path):
    store = LocalStore(tmp_path)
    duplicate_path = tmp_path / "duplicate.jpg"

    with pytest.raises(sqlite3.IntegrityError):
        store.enqueue_crops_for_processing(
            [crop_item(duplicate_path), crop_item(duplicate_path)]
        )

    with store.connection() as db:
        assert db.execute(
            "select count(*) from crop_processing_queue"
        ).fetchone()[0] == 0
        assert db.execute(
            "select count(*) from crop_processing_stats"
        ).fetchone()[0] == 0


def test_batch_ingest_is_not_blocked_by_global_report_lock(tmp_path):
    store = LocalStore(tmp_path)
    report_started = Event()
    release_report = Event()
    report_errors = []

    def hold_read_snapshot():
        try:
            with store.connection() as db:
                db.execute("begin")
                db.execute("select count(*) from crop_processing_queue").fetchone()
                report_started.set()
                release_report.wait(timeout=5)
        except Exception as exc:  # pragma: no cover - asserted below
            report_errors.append(exc)

    report = Thread(target=hold_read_snapshot, daemon=True)
    report.start()
    assert report_started.wait(timeout=2)
    started_at = time.monotonic()
    try:
        result = store.enqueue_crops_for_processing(
            [crop_item(tmp_path / "during-report.jpg")]
        )
    finally:
        release_report.set()
        report.join(timeout=2)

    assert time.monotonic() - started_at < 1.0
    assert len(result) == 1
    assert result[0]["status"] == "pending"
    assert not report_errors
