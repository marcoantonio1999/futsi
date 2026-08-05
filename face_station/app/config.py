from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from threading import RLock
from urllib.parse import quote, urlsplit, urlunsplit


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
    reference_proxy_url: str = ""
    station_token: str = ""
    camera_url: str = "http://192.168.137.2:8080/stream.mjpg"
    camera_fallback_url: str = ""
    camera_id: str = "cancha_1"
    camera_label: str = "Raspberry"
    camera_roi_left: float = 0.0
    camera_roi_right: float = 1.0
    secondary_camera_enabled: bool = False
    secondary_camera_url: str = ""
    secondary_camera_id: str = "dahua_cancha_1"
    secondary_camera_label: str = "Dahua"
    secondary_camera_username: str = ""
    secondary_camera_password: str = ""
    secondary_camera_roi_left: float = 0.0
    secondary_camera_roi_right: float = 1.0
    processing_device: str = "auto"
    model_name: str = "buffalo_l"
    detector_size: int = 640
    processing_width: int = 1280
    preview_width: int = 480
    preview_fps: int = 1
    target_fps: float = 30
    benchmark_seconds: int = 8
    known_threshold: float = 0.45
    min_margin: float = 0.03
    unknown_threshold: float = 0.55
    unknown_confirmation_threshold: float = 0.50
    min_det_score: float = 0.65
    min_face_size: int = 70
    quality_filter_enabled: bool = True
    quality_model_path: str = ""
    quality_max_yaw: float = 15.0
    quality_max_pitch: float = 18.0
    quality_max_roll: float = 20.0
    quality_min_face_width: int = 70
    quality_min_face_height: int = 75
    quality_min_interocular: int = 34
    quality_min_sharpness: float = 40.0
    semantic_reference_filter_enabled: bool = False
    semantic_reference_model_path: str = ""
    adaptive_known_min_similarity: float = 0.60
    adaptive_known_min_margin: float = 0.08
    adaptive_unknown_min_similarity: float = 0.60
    daily_evidence_limit: int = 30
    evidence_safety_days: int = 7
    monthly_fee_amount: float = 1000.0
    candidate_ttl_minutes: int = 30
    detection_debounce_seconds: float = 2.0
    capture_priority_start_hour: int = 9
    capture_priority_end_hour: int = 23
    night_batch_start_time: str = "00:30"
    night_batch_atomic_commit_enabled: bool = False
    night_embedding_batch_size: int = 1
    batch_idle_seconds: int = 10
    spool_jpeg_quality: int = 95
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
        self.reference_proxy_url = str(self.reference_proxy_url).strip()
        if self.reference_proxy_url and not self.reference_proxy_url.startswith("https://"):
            raise ValueError("reference_proxy_url debe usar HTTPS.")
        self.camera_url = str(self.camera_url).strip()
        self.camera_fallback_url = str(self.camera_fallback_url).strip()
        if self.camera_fallback_url == self.camera_url:
            self.camera_fallback_url = ""
        self.camera_id = str(self.camera_id).strip() or "cancha_1"
        self.camera_label = str(self.camera_label).strip() or "Raspberry"
        self.camera_roi_left, self.camera_roi_right = self._validated_horizontal_roi(
            self.camera_roi_left,
            self.camera_roi_right,
            "camera",
        )
        self.secondary_camera_enabled = self._as_bool(self.secondary_camera_enabled)
        self.secondary_camera_url = str(self.secondary_camera_url).strip()
        self.secondary_camera_id = str(self.secondary_camera_id).strip() or "dahua_cancha_1"
        self.secondary_camera_label = str(self.secondary_camera_label).strip() or "Dahua"
        self.secondary_camera_username = str(self.secondary_camera_username).strip()
        self.secondary_camera_password = str(self.secondary_camera_password)
        self.secondary_camera_roi_left, self.secondary_camera_roi_right = self._validated_horizontal_roi(
            self.secondary_camera_roi_left,
            self.secondary_camera_roi_right,
            "secondary_camera",
        )
        if self.secondary_camera_enabled and not self.secondary_camera_url:
            raise ValueError("Configura la URL de la camara secundaria antes de activarla.")
        if self.secondary_camera_password and not self.secondary_camera_username:
            raise ValueError("Configura el usuario de la camara secundaria.")
        if self.secondary_camera_url:
            try:
                parsed_secondary = urlsplit(self.secondary_camera_url)
                _ = parsed_secondary.port
            except ValueError as exc:
                raise ValueError("La URL de la camara secundaria no es valida.") from exc
            if parsed_secondary.password is not None:
                raise ValueError("Captura el usuario y la contrasena RTSP en sus campos separados.")
        self.processing_device = self.processing_device.lower()
        if self.processing_device not in {"auto", "cpu", "gpu"}:
            raise ValueError("processing_device debe ser auto, cpu o gpu.")
        if not 320 <= int(self.detector_size) <= 1280:
            raise ValueError("detector_size debe estar entre 320 y 1280.")
        if not 640 <= int(self.processing_width) <= 3840:
            raise ValueError("processing_width debe estar entre 640 y 3840.")
        if not 320 <= int(self.preview_width) <= 1920:
            raise ValueError("preview_width debe estar entre 320 y 1920.")
        if not 1 <= int(self.preview_fps) <= 20:
            raise ValueError("preview_fps debe estar entre 1 y 20.")
        if not 0 <= float(self.target_fps) <= 30:
            raise ValueError("target_fps debe estar entre 0 y 30; 0 activa el benchmark.")
        for name in (
            "known_threshold",
            "unknown_threshold",
            "unknown_confirmation_threshold",
            "min_det_score",
        ):
            if not -1 <= float(getattr(self, name)) <= 1:
                raise ValueError(f"{name} debe estar entre -1 y 1.")
        if not 0 <= float(self.min_margin) <= 1:
            raise ValueError("min_margin debe estar entre 0 y 1.")
        self.quality_filter_enabled = self._as_bool(self.quality_filter_enabled)
        self.quality_model_path = str(self.quality_model_path).strip()
        self.semantic_reference_filter_enabled = self._as_bool(
            self.semantic_reference_filter_enabled
        )
        self.semantic_reference_model_path = str(
            self.semantic_reference_model_path
        ).strip()
        if self.semantic_reference_filter_enabled and not self.quality_filter_enabled:
            raise ValueError(
                "semantic_reference_filter_enabled requiere quality_filter_enabled."
            )
        for name in ("quality_max_yaw", "quality_max_pitch", "quality_max_roll"):
            if not 0 < float(getattr(self, name)) <= 90:
                raise ValueError(f"{name} debe estar entre 0 y 90.")
        for name in ("quality_min_face_width", "quality_min_face_height", "quality_min_interocular"):
            if not 1 <= int(getattr(self, name)) <= 2000:
                raise ValueError(f"{name} debe estar entre 1 y 2000.")
        if not 0 <= float(self.quality_min_sharpness) <= 10000:
            raise ValueError("quality_min_sharpness debe estar entre 0 y 10000.")
        for name in (
            "adaptive_known_min_similarity",
            "adaptive_unknown_min_similarity",
        ):
            if not 0.0 <= float(getattr(self, name)) <= 1.0:
                raise ValueError(f"{name} debe estar entre 0 y 1.")
        if not 0.0 <= float(self.adaptive_known_min_margin) <= 1.0:
            raise ValueError("adaptive_known_min_margin debe estar entre 0 y 1.")
        if not 12 <= int(self.daily_evidence_limit) <= 100:
            raise ValueError("daily_evidence_limit debe estar entre 12 y 100.")
        self.daily_evidence_limit = int(self.daily_evidence_limit)
        if not 1 <= int(self.evidence_safety_days) <= 90:
            raise ValueError("evidence_safety_days debe estar entre 1 y 90.")
        self.evidence_safety_days = int(self.evidence_safety_days)
        if not 0 <= float(self.monthly_fee_amount) <= 1_000_000:
            raise ValueError(
                "monthly_fee_amount debe estar entre 0 y 1000000."
            )
        self.monthly_fee_amount = round(float(self.monthly_fee_amount), 2)
        if not 1 <= int(self.candidate_ttl_minutes) <= 1440:
            raise ValueError("candidate_ttl_minutes debe estar entre 1 y 1440.")
        if not 0 <= int(self.capture_priority_start_hour) <= 23:
            raise ValueError("capture_priority_start_hour debe estar entre 0 y 23.")
        if not 1 <= int(self.capture_priority_end_hour) <= 24:
            raise ValueError("capture_priority_end_hour debe estar entre 1 y 24.")
        if int(self.capture_priority_start_hour) >= int(self.capture_priority_end_hour):
            raise ValueError("El horario prioritario de captura debe iniciar antes de terminar.")
        self.night_batch_start_time = self._validated_time(
            self.night_batch_start_time,
            "night_batch_start_time",
        )
        self.night_batch_atomic_commit_enabled = self._as_bool(
            self.night_batch_atomic_commit_enabled
        )
        if int(self.night_embedding_batch_size) not in {1, 8, 16, 32, 64}:
            raise ValueError(
                "night_embedding_batch_size debe ser 1, 8, 16, 32 o 64."
            )
        self.night_embedding_batch_size = int(self.night_embedding_batch_size)
        if not 0 <= int(self.batch_idle_seconds) <= 3600:
            raise ValueError("batch_idle_seconds debe estar entre 0 y 3600.")
        if not 85 <= int(self.spool_jpeg_quality) <= 100:
            raise ValueError("spool_jpeg_quality debe estar entre 85 y 100.")

    @staticmethod
    def _as_bool(value) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "si", "on"}
        return bool(value)

    @staticmethod
    def _validated_horizontal_roi(left, right, prefix: str) -> tuple[float, float]:
        left_value = float(left)
        right_value = float(right)
        if not 0.0 <= left_value < right_value <= 1.0:
            raise ValueError(
                f"{prefix}_roi_left y {prefix}_roi_right deben cumplir 0 <= izquierda < derecha <= 1."
            )
        if right_value - left_value < 0.1:
            raise ValueError(f"El area activa de {prefix} debe conservar al menos 10% del ancho.")
        return left_value, right_value

    @staticmethod
    def _validated_time(value, name: str) -> str:
        parts = str(value).strip().split(":")
        if len(parts) != 2:
            raise ValueError(f"{name} debe usar el formato HH:MM.")
        try:
            hour, minute = (int(part) for part in parts)
        except ValueError as exc:
            raise ValueError(f"{name} debe usar el formato HH:MM.") from exc
        if not 0 <= hour <= 23 or not 0 <= minute <= 59:
            raise ValueError(f"{name} debe representar una hora valida.")
        return f"{hour:02d}:{minute:02d}"

    def secondary_camera_source(self) -> str:
        """Build the authenticated URL only in memory so APIs never expose the secret."""
        if not self.secondary_camera_url or not self.secondary_camera_username:
            return self.secondary_camera_url
        parsed = urlsplit(self.secondary_camera_url)
        if not parsed.scheme or not parsed.hostname:
            return self.secondary_camera_url
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        port = f":{parsed.port}" if parsed.port else ""
        username = quote(self.secondary_camera_username, safe="")
        password = quote(self.secondary_camera_password, safe="")
        userinfo = f"{username}:{password}@" if self.secondary_camera_password else f"{username}@"
        return urlunsplit((parsed.scheme, f"{userinfo}{host}{port}", parsed.path, parsed.query, parsed.fragment))

    def public_dict(self) -> dict:
        payload = asdict(self)
        payload["station_token_configured"] = bool(payload.pop("station_token"))
        payload["secondary_camera_password_configured"] = bool(payload.pop("secondary_camera_password"))
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
            if not patch.get("secondary_camera_password") and "secondary_camera_password" in patch:
                current["secondary_camera_password"] = self._config.secondary_camera_password
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
