from concurrent.futures import ThreadPoolExecutor
from threading import Lock, RLock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from face_station.app import synchronizer
from face_station.app.config import StationConfig
from face_station.app.store import LocalStore
from face_station.app.synchronizer import StationSynchronizer


def runtime_stub(tmp_path):
    return SimpleNamespace(
        config_manager=SimpleNamespace(config=SimpleNamespace(
            api_url="https://example.invalid", station_token="test-token",
            reference_proxy_url="", report_sync_interval_seconds=300,
            sync_interval_seconds=10,
        )),
        _bootstrap_lock=Lock(), _state_lock=RLock(), _last_bootstrap_at="previous",
        _engine=None, _client_online=False, _client_error="", _device_name="Local",
        _station_id="station", _site_name="Local site", store=LocalStore(tmp_path),
        _update_reference_summary=Mock(),
    )


def client_stub():
    return SimpleNamespace(
        online=True, last_error="", session=SimpleNamespace(close=Mock()),
        heartbeat=Mock(), bootstrap=Mock(return_value={
            "people": [{"key": "player:1", "type": "player", "id": 1, "name": "Actualizado"}],
            "sessions": [], "monthly_payments": [],
            "device": {"name": "Remote", "site_name": "Updated site"},
        }),
    )


@pytest.mark.parametrize("upload_fails", [False, True])
def test_background_sync_never_downloads_bootstrap(monkeypatch, tmp_path, upload_fails):
    runtime = runtime_stub(tmp_path)
    client = client_stub()
    clock = {"now": 1000.0, "loops": 0}
    runtime._stop = SimpleNamespace(
        is_set=lambda: clock["loops"] >= 12,
        wait=lambda seconds: clock.update(now=clock["now"] + 360, loops=clock["loops"] + 1),
    )
    monkeypatch.setattr(synchronizer.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(synchronizer, "FutsiClient", lambda *args: client)
    sync = StationSynchronizer(runtime)
    monkeypatch.setattr(sync, "_sync_person_renames", Mock())
    upload = Mock(side_effect=RuntimeError("upload failed") if upload_fails else None)
    monkeypatch.setattr(sync, "_sync_known_events", upload)
    monkeypatch.setattr(sync, "_sync_unknown_registrations", Mock())
    monkeypatch.setattr(sync, "_sync_daily_reports", Mock())
    sync.run()
    client.bootstrap.assert_not_called()
    assert client.heartbeat.call_count == 12


def test_night_download_once_across_concurrency_and_restart(monkeypatch, tmp_path):
    runtime = runtime_stub(tmp_path)
    client = client_stub()
    monkeypatch.setattr(synchronizer, "FutsiClient", lambda *args: client)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: StationSynchronizer(runtime).refresh_for_night("2026-10-11"), range(8)))
    assert all(result["status"] == "synced" for result in results)
    client.bootstrap.assert_called_once()
    restarted = runtime_stub(tmp_path)
    assert StationSynchronizer(restarted).refresh_for_night("2026-10-11")["reused"]
    assert restarted._last_bootstrap_at != "previous"
    client.bootstrap.assert_called_once()
    StationSynchronizer(restarted).refresh_for_night("2026-10-12")
    assert client.bootstrap.call_count == 2


def test_failed_or_interrupted_download_uses_cache_and_does_not_loop(monkeypatch, tmp_path):
    runtime = runtime_stub(tmp_path)
    runtime.store.replace_bootstrap([{"key":"student:1", "type":"student", "id":1, "name":"Cached"}], [])
    client = client_stub()
    client.bootstrap.side_effect = RuntimeError("offline")
    monkeypatch.setattr(synchronizer, "FutsiClient", lambda *args: client)
    assert StationSynchronizer(runtime).refresh_for_night("2026-10-11")["status"] == "failed"
    StationSynchronizer(runtime_stub(tmp_path)).refresh_for_night("2026-10-11")
    client.bootstrap.assert_called_once()
    with runtime.store.connection() as db:
        assert db.execute("select name from people where active=1").fetchone()[0] == "Cached"
    runtime.store.claim_runtime_operation('nightly_bootstrap:2026-10-12', '{"status":"started"}')
    StationSynchronizer(runtime).refresh_for_night("2026-10-12")
    client.bootstrap.assert_called_once()


def test_legacy_config_migrates_report_interval():
    config = StationConfig.from_dict({"bootstrap_interval_seconds": 600})
    assert config.report_sync_interval_seconds == 600
    assert "bootstrap_interval_seconds" not in config.public_dict()
