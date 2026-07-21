from __future__ import annotations

import base64
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from .futsi_client import FutsiClient

if TYPE_CHECKING:
    from .processor import StationRuntime


LOGGER = logging.getLogger("futsi.face_station")


class StationSynchronizer:
    def __init__(self, runtime: StationRuntime):
        self.runtime = runtime

    def run(self) -> None:
        last_bootstrap = 0.0
        last_heartbeat = 0.0
        while not self.runtime._stop.is_set():
            config = self.runtime.config_manager.config
            if not config.station_token:
                self.runtime._client_online = False
                self.runtime._client_error = (
                    "Falta configurar el token de la estacion. El procesamiento offline sigue activo."
                )
                self.runtime._stop.wait(5)
                continue
            client = FutsiClient(config.api_url, config.station_token)
            try:
                now = time.monotonic()
                if now - last_bootstrap >= config.bootstrap_interval_seconds:
                    self._bootstrap(client)
                    last_bootstrap = now
                if now - last_heartbeat >= 60:
                    client.heartbeat()
                    last_heartbeat = now
                self._sync_known_events(client)
                self._sync_unknown_registrations(client)
                self.runtime._client_online = client.online
                self.runtime._client_error = client.last_error
            except Exception as exc:
                self.runtime._client_online = False
                self.runtime._client_error = str(exc)
                LOGGER.warning("Sincronizacion pendiente: %s", exc)
            self.runtime._stop.wait(max(2, config.sync_interval_seconds))

    def _bootstrap(self, client: FutsiClient) -> None:
        payload = client.bootstrap()
        self.runtime.store.replace_bootstrap(payload.get("people", []), payload.get("sessions", []))
        with self.runtime._state_lock:
            device = payload.get("device", {})
            self.runtime._device_name = device.get("name", self.runtime._device_name)
            self.runtime._station_id = device.get("id", self.runtime._station_id)
            self.runtime._site_name = device.get("site_name", self.runtime._site_name)
            self.runtime._last_bootstrap_at = datetime.now(timezone.utc).isoformat()
        self.runtime._refresh_reference_embeddings()

    def _sync_known_events(self, client: FutsiClient) -> None:
        rows = self.runtime.store.pending_queue("known_event", limit=100)
        if not rows:
            return
        response = client.send_events([row["payload"] for row in rows])
        by_id = {row["event_id"]: row for row in rows}
        completed = []
        for result in response.get("results", []):
            event_id = result.get("event_id", "")
            if result.get("status") in {"synced", "no_session"} or result.get("duplicate"):
                completed.append(event_id)
            elif event_id in by_id:
                attempts = int(by_id[event_id].get("attempts", 0)) + 1
                self.runtime.store.mark_queue_failed(
                    event_id,
                    result.get("detail", "Evento rechazado"),
                    min(3600, 10 * 2**attempts),
                )
        self.runtime.store.mark_queue_done(completed)

    def _sync_unknown_registrations(self, client: FutsiClient) -> None:
        for row in self.runtime.store.pending_queue("unknown_register", limit=10):
            payload = dict(row["payload"])
            crop_path = Path(payload.pop("best_crop_path", ""))
            if crop_path.is_file():
                encoded = base64.b64encode(crop_path.read_bytes()).decode("ascii")
                payload["best_crop"] = f"data:image/jpeg;base64,{encoded}"
            try:
                response = client.register_unknown(payload)
                if not response.get("linked"):
                    raise RuntimeError(response.get("detail", "No se vinculo el desconocido."))
                self.runtime.store.complete_unknown_link(
                    payload["local_subject_id"], response.get("remote_subject_id")
                )
                self.runtime.store.mark_queue_done([row["event_id"]])
            except Exception as exc:
                attempts = int(row.get("attempts", 0)) + 1
                self.runtime.store.mark_queue_failed(
                    row["event_id"], str(exc), min(3600, 10 * 2**attempts)
                )
