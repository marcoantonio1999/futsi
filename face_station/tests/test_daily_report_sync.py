from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import numpy as np

from face_station.app.store import LocalStore
from face_station.app.synchronizer import (
    BUSINESS_TIME_ZONE,
    StationSynchronizer,
)


def normalized(seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    value = generator.normal(size=512).astype(np.float32)
    return value / np.linalg.norm(value)


class RecordingClient:
    def __init__(self):
        self.payloads: list[dict] = []

    def sync_daily_report(self, payload: dict) -> dict:
        self.payloads.append(payload)
        return {
            "status": "stored",
            "duplicate": False,
            "revision": payload["revision"],
            "payload_sha256": f"server-{len(self.payloads)}",
            "rows": len(payload["rows"]),
        }


class FailsOneDateClient(RecordingClient):
    def __init__(self, rejected_date: str):
        super().__init__()
        self.rejected_date = rejected_date

    def sync_daily_report(self, payload: dict) -> dict:
        if payload["report_date"] == self.rejected_date:
            raise RuntimeError("rechazo de prueba")
        return super().sync_daily_report(payload)


def build_runtime(store: LocalStore, monthly_fee=1000.0):
    return SimpleNamespace(
        store=store,
        config_manager=SimpleNamespace(
            config=SimpleNamespace(monthly_fee_amount=monthly_fee)
        ),
    )


def test_daily_report_sync_retries_changes_and_removes_obsolete_day(tmp_path):
    store = LocalStore(tmp_path)
    now = datetime.now(BUSINESS_TIME_ZONE)
    store.replace_bootstrap(
        [
            {
                "key": "student:17",
                "type": "student",
                "id": 17,
                "name": "Alumno QA",
                "group_name": "Sub-12",
                "team_name": "",
            }
        ],
        [],
    )
    store.save_person_embedding(
        "student:17",
        tmp_path / "student.jpg",
        normalized(17),
    )
    store.upsert_presence(
        "student:17",
        "known",
        now,
        0.81,
        str(tmp_path / "student.jpg"),
    )
    runtime = build_runtime(store)
    synchronizer = StationSynchronizer(runtime)
    client = RecordingClient()

    synchronizer._sync_daily_reports(client)
    synchronizer._sync_daily_reports(client)

    assert len(client.payloads) == 1
    assert client.payloads[0]["base_revision"] == 0
    assert client.payloads[0]["rows"][0]["canonical_person_key"] == "student:17"
    assert client.payloads[0]["rows"][0]["detection_count"] == 1

    store.upsert_presence(
        "student:17",
        "known",
        now,
        0.84,
        str(tmp_path / "student.jpg"),
    )
    synchronizer._sync_daily_reports(client)

    assert len(client.payloads) == 2
    assert client.payloads[-1]["revision"] == 2
    assert client.payloads[-1]["base_revision"] == 1
    assert client.payloads[-1]["base_payload_sha256"] == "server-1"
    assert client.payloads[-1]["rows"][0]["detection_count"] == 2

    with store.connection() as db:
        db.execute(
            "delete from daily_presence where presence_date=?",
            (now.date().isoformat(),),
        )
    synchronizer._sync_daily_reports(client)

    assert len(client.payloads) == 3
    assert client.payloads[-1]["revision"] == 3
    assert client.payloads[-1]["base_revision"] == 2
    assert client.payloads[-1]["rows"] == []


def test_historical_policy_stays_frozen_when_current_fee_changes(tmp_path):
    store = LocalStore(tmp_path)
    past = datetime.now(BUSINESS_TIME_ZONE) - timedelta(days=40)
    store.upsert_presence(
        "unknown-policy",
        "unknown",
        past,
        0.72,
        str(tmp_path / "unknown.jpg"),
    )
    runtime = build_runtime(store)
    client = RecordingClient()
    synchronizer = StationSynchronizer(runtime)

    synchronizer._sync_daily_reports(client)
    runtime.config_manager.config.monthly_fee_amount = 2500.0
    synchronizer._sync_daily_reports(client)

    assert len(client.payloads) == 1
    assert client.payloads[0]["policy"]["monthly_fee_amount"] == 1000.0


def test_one_rejected_date_does_not_block_later_reports(tmp_path):
    store = LocalStore(tmp_path)
    first = datetime.now(BUSINESS_TIME_ZONE) - timedelta(days=2)
    second = first + timedelta(days=1)
    for index, seen_at in enumerate((first, second), start=1):
        store.upsert_presence(
            f"unknown-{index}",
            "unknown",
            seen_at,
            0.7,
            str(tmp_path / f"unknown-{index}.jpg"),
        )
    runtime = build_runtime(store)
    client = FailsOneDateClient(first.date().isoformat())

    StationSynchronizer(runtime)._sync_daily_reports(client)

    assert [payload["report_date"] for payload in client.payloads] == [
        second.date().isoformat()
    ]


def test_presence_date_uses_mexico_business_day(tmp_path):
    store = LocalStore(tmp_path)
    after_midnight_utc = datetime(
        2026,
        7,
        28,
        1,
        30,
        tzinfo=timezone.utc,
    )

    store.upsert_presence(
        "unknown-time-zone",
        "unknown",
        after_midnight_utc,
        0.73,
        str(tmp_path / "unknown.jpg"),
    )

    assert store.attendance_report_dates() == ["2026-07-27"]
