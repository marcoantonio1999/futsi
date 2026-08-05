from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

from face_station.app.repair_historical_candidates import (
    TEMPORARY_NAME_ERROR,
    repair_historical_candidates,
)
from face_station.app.store import LocalStore


def _embedding(seed: int) -> np.ndarray:
    value = np.random.default_rng(seed).normal(size=512).astype(np.float32)
    return value / np.linalg.norm(value)


def _write_crop(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def test_repair_requeues_only_recoverable_historical_candidates(tmp_path):
    store = LocalStore(tmp_path)
    observed_at = datetime.now(timezone.utc) - timedelta(hours=2)
    recovery_path = store.faces_dir / "2026-07-25" / "unknown" / "broken.jpg"
    original_spool = store.spool_dir / "primary" / "broken.jpg"
    payload = b"\xff\xd8faceguard-recoverable-crop\xff\xd9"
    _write_crop(recovery_path, payload)
    _write_crop(original_spool, payload)

    subject = store.create_unknown(
        _embedding(1),
        observed_at,
        str(recovery_path),
        0.2,
        temporary_name="Desconocido 4000",
    )
    store.record_crop(
        subject["subject_id"],
        "unknown",
        observed_at,
        str(recovery_path),
        0.0,
        0.2,
        "Raspberry",
        embedding=_embedding(1),
    )
    queued = store.enqueue_crop_for_processing(
        captured_at=observed_at,
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(original_spool),
        file_bytes=len(payload),
        crop_width=24,
        crop_height=24,
        det_score=0.8,
        bbox=(0, 0, 24, 24),
        landmarks=None,
    )
    store.finish_crop_processing(
        queued["id"],
        status="processed",
        result_kind="unknown",
        result_key=subject["subject_id"],
        result_name=subject["temporary_name"],
    )
    original_spool.unlink()

    error_spool = store.spool_dir / "primary" / "name-error.jpg"
    _write_crop(error_spool, b"\xff\xd8name-error\xff\xd9")
    error = store.enqueue_crop_for_processing(
        captured_at=observed_at + timedelta(seconds=1),
        camera_key="primary",
        camera_label="Raspberry",
        crop_path=str(error_spool),
        file_bytes=error_spool.stat().st_size,
        crop_width=12,
        crop_height=12,
        det_score=0.7,
        bbox=(0, 0, 12, 12),
        landmarks=None,
    )
    store.finish_crop_processing(
        error["id"],
        status="error",
        error=TEMPORARY_NAME_ERROR,
    )

    protected_crop = store.faces_dir / "2026-07-25" / "unknown" / "protected.jpg"
    _write_crop(protected_crop, b"\xff\xd8protected\xff\xd9")
    protected = store.create_unknown(
        _embedding(2),
        observed_at,
        str(protected_crop),
        0.95,
        temporary_name="Desconocido 4001",
        quality_pass=True,
        quality_payload={"accepted": True},
        analysis_version="test",
    )

    dry_run = repair_historical_candidates(tmp_path)
    assert dry_run["apply"] is False
    assert dry_run["broken_candidates"] == 1
    assert dry_run["name_errors"] == 1
    assert recovery_path.is_file()
    with store.connection() as db:
        assert (
            db.execute(
                "select status from crop_processing_queue where id=?",
                (queued["id"],),
            ).fetchone()[0]
            == "processed"
        )

    result = repair_historical_candidates(tmp_path, apply=True)
    assert result["broken_candidates"] == 1
    assert result["name_errors"] == 1
    assert result["integrity_check"] == "ok"
    assert Path(result["backup_path"]).is_file()
    assert Path(result["manifest_path"]).is_file()
    assert recovery_path.is_file()
    assert error_spool.is_file()
    assert store.get_unknown(protected["subject_id"])["status"] == "consolidated"
    with pytest.raises(LookupError):
        store.get_unknown(subject["subject_id"])
    with store.connection() as db:
        repaired = db.execute(
            """
            select status,crop_path,result_kind,result_key,last_error
            from crop_processing_queue where id=?
            """,
            (queued["id"],),
        ).fetchone()
        name_error = db.execute(
            "select status,last_error from crop_processing_queue where id=?",
            (error["id"],),
        ).fetchone()
        assert repaired["status"] == "pending"
        assert Path(repaired["crop_path"]).is_file()
        assert repaired["result_kind"] == ""
        assert repaired["result_key"] == ""
        assert repaired["last_error"] == ""
        assert name_error["status"] == "pending"
        assert name_error["last_error"] == ""
        assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
        assert db.execute("pragma foreign_key_check").fetchall() == []

    second_run = repair_historical_candidates(tmp_path)
    assert second_run["broken_candidates"] == 0
    assert second_run["name_errors"] == 0

    backup = sqlite3.connect(result["backup_path"])
    try:
        assert backup.execute("pragma integrity_check").fetchone()[0] == "ok"
    finally:
        backup.close()
