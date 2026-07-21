from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from threading import RLock


def default_data_dir() -> Path:
    configured = os.getenv("FUTSI_FACE_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if os.name == "nt" and os.getenv("PROGRAMDATA"):
        return Path(os.environ["PROGRAMDATA"]) / "FutsiFaceStation"
    return Path.home() / ".futsi-face-station"


@dataclass
class StationConfig:
    api_url: str = "https://futsi.onrender.com"
    station_token: str = ""
    camera_url: str = "http://192.168.137.2:8080/stream.mjpg"
    camera_id: str = "cancha_1"
    processing_device: str = "auto"
    model_name: str = "buffalo_l"
    detector_size: int = 640
    processing_width: int = 1280
    preview_width: int = 960
    preview_fps: int = 8
    target_fps: float = 0
    benchmark_seconds: int = 8
    known_threshold: float = 0.45
    min_margin: float = 0.03
    unknown_threshold: float = 0.55
    min_det_score: float = 0.65
    min_face_size: int = 70
    unknown_min_hits: int = 3
    detection_debounce_seconds: float = 2.0
    bootstrap_interval_seconds: int = 300
    sync_interval_seconds: int = 10
    retention_days: int = 90
    auto_start_engine: bool = True
    open_browser: bool = True
    host: str = "127.0.0.1"
    port: int = 8765

    @classmethod
    def from_dict(cls, payload: dict) -> "StationConfig":
        allowed = {item.name for item in fields(cls)}
        values = {key: value for key, value in payload.items() if key in allowed}
        config = cls(**values)
        config.validate()
        return config

    def validate(self) -> None:
        self.api_url = self.api_url.rstrip("/")
        self.camera_url = str(self.camera_url).strip()
        self.processing_device = self.processing_device.lower()
        if self.processing_device not in {"auto", "cpu", "gpu"}:
            raise ValueError("processing_device debe ser auto, cpu o gpu.")
        if not 320 <= int(self.detector_size) <= 1280:
            raise ValueError("detector_size debe estar entre 320 y 1280.")
        if not 640 <= int(self.processing_width) <= 3840:
            raise ValueError("processing_width debe estar entre 640 y 3840.")
        if not 1 <= int(self.preview_fps) <= 20:
            raise ValueError("preview_fps debe estar entre 1 y 20.")
        if not 0 <= float(self.target_fps) <= 30:
            raise ValueError("target_fps debe estar entre 0 y 30; 0 activa el benchmark.")
        for name in ("known_threshold", "unknown_threshold", "min_det_score"):
            if not -1 <= float(getattr(self, name)) <= 1:
                raise ValueError(f"{name} debe estar entre -1 y 1.")

    def public_dict(self) -> dict:
        payload = asdict(self)
        payload["station_token_configured"] = bool(payload.pop("station_token"))
        return payload


class ConfigManager:
    def __init__(self, data_dir: Path | None = None):
        self.data_dir = (data_dir or default_data_dir()).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / "config.json"
        self._lock = RLock()
        self._config = self._load()

    @property
    def config(self) -> StationConfig:
        with self._lock:
            return StationConfig.from_dict(asdict(self._config))

    def _load(self) -> StationConfig:
        if not self.path.exists():
            config = StationConfig()
            self._write(config)
            return config
        try:
            return StationConfig.from_dict(json.loads(self.path.read_text(encoding="utf-8")))
        except Exception:
            backup = self.path.with_suffix(".invalid.json")
            self.path.replace(backup)
            config = StationConfig()
            self._write(config)
            return config

    def update(self, patch: dict) -> StationConfig:
        with self._lock:
            current = asdict(self._config)
            current.update(patch)
            if not patch.get("station_token") and "station_token" in patch:
                current["station_token"] = self._config.station_token
            updated = StationConfig.from_dict(current)
            self._write(updated)
            self._config = updated
            return self.config

    def _write(self, config: StationConfig) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        descriptor, temp_name = tempfile.mkstemp(prefix="config-", suffix=".json", dir=self.data_dir)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(asdict(config), handle, indent=2, ensure_ascii=True)
            os.replace(temp_name, self.path)
        finally:
            Path(temp_name).unlink(missing_ok=True)
