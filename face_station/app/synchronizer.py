from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from .futsi_client import FutsiClient
from .time_utils import BUSINESS_TIME_ZONE

if TYPE_CHECKING:
    from .processor import StationRuntime


LOGGER = logging.getLogger("futsi.face_station")
DAILY_REPORT_STATE_PREFIX = "daily_report_sync:"


class StationSynchronizer:
    def __init__(self, runtime: StationRuntime):
        self.runtime = runtime

    def run(self) -> None:
        last_bootstrap = 0.0
        last_heartbeat = 0.0
        last_reference_refresh = 0.0
        last_daily_report_sync = 0.0
        client = None
        client_signature = None
        while not self.runtime._stop.is_set():
            config = self.runtime.config_manager.config
            if not config.station_token:
                self.runtime._client_online = False
                self.runtime._client_error = (
                    "Falta configurar el token de la estacion. El procesamiento offline sigue activo."
                )
                self.runtime._stop.wait(5)
                continue
            signature = (config.api_url, config.station_token, config.reference_proxy_url)
            if client is None or signature != client_signature:
                client = FutsiClient(config.api_url, config.station_token, config.reference_proxy_url)
                client_signature = signature
                last_bootstrap = 0.0
                last_heartbeat = 0.0
                last_reference_refresh = 0.0
                last_daily_report_sync = 0.0
            try:
                now = time.monotonic()
                if now - last_bootstrap >= config.bootstrap_interval_seconds:
                    self._bootstrap(client)
                    last_bootstrap = now
                if self.runtime._engine and now - last_reference_refresh >= config.bootstrap_interval_seconds:
                    last_reference_refresh = now
                    self.runtime._refresh_reference_embeddings()
                if now - last_heartbeat >= 60:
                    client.heartbeat()
                    last_heartbeat = now
                self._sync_known_events(client)
                self._sync_unknown_registrations(client)
                if (
                    now - last_daily_report_sync
                    >= config.bootstrap_interval_seconds
                ):
                    last_daily_report_sync = now
                    if not getattr(
                        self.runtime,
                        "_automatic_batch_active",
                        False,
                    ) and not getattr(
                        self.runtime,
                        "_manual_batch_active",
                        False,
                    ):
                        self._sync_daily_reports(client)
                self.runtime._client_online = client.online
                self.runtime._client_error = client.last_error
            except Exception as exc:
                self.runtime._client_online = False
                self.runtime._client_error = str(exc)
                LOGGER.warning("Sincronizacion pendiente: %s", exc)
            self.runtime._stop.wait(max(2, config.sync_interval_seconds))

    def _bootstrap(self, client: FutsiClient) -> None:
        payload = client.bootstrap()
        self.runtime.store.replace_bootstrap(
            payload.get("people", []),
            payload.get("sessions", []),
            payload.get("monthly_payments", []),
        )
        self.runtime._update_reference_summary()
        with self.runtime._state_lock:
            device = payload.get("device", {})
            self.runtime._device_name = device.get("name", self.runtime._device_name)
            self.runtime._station_id = device.get("id", self.runtime._station_id)
            self.runtime._site_name = device.get("site_name", self.runtime._site_name)
            self.runtime._last_bootstrap_at = datetime.now(timezone.utc).isoformat()
            self.runtime._client_online = client.online
            self.runtime._client_error = client.last_error

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

    def _sync_daily_reports(self, client: FutsiClient) -> None:
        today = datetime.now(BUSINESS_TIME_ZONE).date()
        today_value = today.isoformat()
        current_month = today_value[:7]
        config = self.runtime.config_manager.config
        policy = {
            "monthly_fee_amount": config.monthly_fee_amount,
            "registered_minimum_days": 1,
            "unknown_minimum_days": 3,
        }
        for report_date in self.runtime.store.attendance_report_dates():
            try:
                parsed_date = datetime.strptime(
                    report_date,
                    "%Y-%m-%d",
                ).date()
            except ValueError:
                LOGGER.warning(
                    "Se omitio una fecha de asistencia invalida: %s",
                    report_date,
                )
                continue
            state_key = f"{DAILY_REPORT_STATE_PREFIX}{report_date}"
            try:
                state = json.loads(
                    self.runtime.store.runtime_state(state_key, "{}")
                    or "{}"
                )
            except (TypeError, json.JSONDecodeError):
                state = {}
            report_policy = (
                policy
                if report_date[:7] == current_month
                else state.get("policy") or policy
            )
            rows = self.runtime.store.daily_attendance_report(report_date)
            source = {
                "schema_version": 1,
                "report_date": report_date,
                "finalized": parsed_date < today,
                "policy": report_policy,
                "rows": rows,
            }
            source_hash = hashlib.sha256(
                json.dumps(
                    source,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest()
            unchanged = state.get("source_hash") == source_hash
            already_synced_today = (
                state.get("last_synced_date") == today_value
            )
            if unchanged and (
                report_date[:7] != current_month
                or already_synced_today
            ):
                continue
            revision = max(1, int(state.get("revision") or 0))
            if not unchanged:
                revision += 1 if state else 0
            payload = {
                **source,
                "revision": revision,
                "base_revision": int(state.get("revision") or 0),
                "base_payload_sha256": state.get("server_hash") or "",
                "generated_at": datetime.now(
                    timezone.utc
                ).astimezone().isoformat(),
                "payload_hash": f"sha256:{source_hash}",
            }
            try:
                response = client.sync_daily_report(payload)
            except Exception as exc:
                LOGGER.warning(
                    "No se pudo sincronizar el reporte diario %s: %s",
                    report_date,
                    exc,
                )
                continue
            self.runtime.store.set_runtime_state(
                state_key,
                json.dumps(
                    {
                        "source_hash": source_hash,
                        "server_hash": response.get(
                            "payload_sha256",
                            "",
                        ),
                        "revision": int(
                            response.get("revision", revision)
                        ),
                        "policy": report_policy,
                        "last_synced_date": today_value,
                        "synced_at": datetime.now(
                            timezone.utc
                        ).isoformat(),
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )
