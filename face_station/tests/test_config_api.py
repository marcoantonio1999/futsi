from __future__ import annotations

import asyncio
import importlib
import json
import sys

import pytest
from fastapi import HTTPException
from starlette.requests import Request


def _json_request(payload: dict) -> Request:
    body = json.dumps(payload).encode("utf-8")
    delivered = False

    async def receive():
        nonlocal delivered
        if delivered:
            return {"type": "http.disconnect"}
        delivered = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "method": "PATCH",
            "path": "/api/config",
            "headers": [(b"content-type", b"application/json")],
        },
        receive,
    )


def _load_main(monkeypatch, tmp_path):
    monkeypatch.setenv("FUTSI_FACE_DATA_DIR", str(tmp_path))
    sys.modules.pop("face_station.app.main", None)
    return importlib.import_module("face_station.app.main")


def test_config_api_accepts_async_mjpeg_fields_without_exposing_secrets(
    monkeypatch,
    tmp_path,
):
    main = _load_main(monkeypatch, tmp_path)
    response = asyncio.run(main.update_config(_json_request({
        "station_token": "private-token",
        "camera_async_mjpeg_enabled": True,
        "camera_mjpeg_decode_reduction": 8,
        "tertiary_camera_enabled": True,
        "tertiary_camera_url": "http://192.168.1.44:8080/stream",
        "tertiary_camera_fallback_url": "http://100.70.80.90:8080/stream",
        "tertiary_camera_id": "raspberry_cancha_2",
        "tertiary_camera_label": "Raspberry entrada 2",
        "tertiary_camera_async_mjpeg_enabled": True,
        "tertiary_camera_mjpeg_decode_reduction": 4,
        "tertiary_camera_roi_left": 0.1,
        "tertiary_camera_roi_right": 0.9,
    })))

    assert response["saved"] is True
    assert response["config"]["camera_async_mjpeg_enabled"] is True
    assert response["config"]["camera_mjpeg_decode_reduction"] == 8
    assert response["config"]["tertiary_camera_enabled"] is True
    assert response["config"]["tertiary_camera_url"] == (
        "http://192.168.1.44:8080/stream"
    )
    assert response["config"]["tertiary_camera_fallback_url"] == (
        "http://100.70.80.90:8080/stream"
    )
    assert response["config"]["tertiary_camera_mjpeg_decode_reduction"] == 4
    assert response["config"]["station_token_configured"] is True
    assert "station_token" not in response["config"]


def test_config_api_rejects_invalid_mjpeg_reduction(monkeypatch, tmp_path):
    main = _load_main(monkeypatch, tmp_path)

    with pytest.raises(HTTPException) as captured:
        asyncio.run(main.update_config(_json_request({
            "camera_mjpeg_decode_reduction": 3,
        })))

    assert captured.value.status_code == 400
    assert "camera_mjpeg_decode_reduction" in str(captured.value.detail)

    with pytest.raises(HTTPException) as captured:
        asyncio.run(main.update_config(_json_request({
            "tertiary_camera_mjpeg_decode_reduction": 3,
        })))

    assert captured.value.status_code == 400
    assert "tertiary_camera_mjpeg_decode_reduction" in str(captured.value.detail)


@pytest.mark.parametrize(
    "field_name",
    [
        "camera_url",
        "camera_fallback_url",
        "tertiary_camera_url",
        "tertiary_camera_fallback_url",
    ],
)
def test_config_api_redacts_and_preserves_camera_urls_with_embedded_credentials(
    monkeypatch,
    tmp_path,
    field_name,
):
    main = _load_main(monkeypatch, tmp_path)

    secret_source = "http://private-user:private-password@camera.local/stream"
    response = asyncio.run(main.update_config(_json_request({
        field_name: secret_source,
    })))

    assert "private-user" not in response["config"][field_name]
    assert "private-password" not in response["config"][field_name]
    assert response["config"][f"{field_name}_credentials_configured"] is True
    assert getattr(main.config_manager.config, field_name) == secret_source

    redacted_source = response["config"][field_name]
    asyncio.run(main.update_config(_json_request({field_name: redacted_source})))
    assert getattr(main.config_manager.config, field_name) == secret_source


def test_config_api_reports_restart_from_one_atomic_running_snapshot(
    monkeypatch,
    tmp_path,
):
    main = _load_main(monkeypatch, tmp_path)

    class RacingRuntime:
        def __init__(self):
            self.running_reads = 0
            self.restart_calls = 0

        @property
        def running(self):
            self.running_reads += 1
            return self.running_reads == 1

        def restart(self):
            self.restart_calls += 1

    runtime = RacingRuntime()
    monkeypatch.setattr(main, "runtime", runtime)

    response = asyncio.run(main.update_config(_json_request({
        "camera_mjpeg_decode_reduction": 2,
    })))

    assert response["restarting"] is True
    assert runtime.running_reads == 1
    for _ in range(100):
        if runtime.restart_calls:
            break
        __import__("time").sleep(0.001)
    assert runtime.restart_calls == 1
