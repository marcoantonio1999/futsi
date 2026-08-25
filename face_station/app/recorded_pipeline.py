from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event, RLock, Thread
from uuid import uuid4
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import requests
from requests.auth import HTTPDigestAuth

from .mjpeg_index import build_mjpeg_index, mjpeg_index_path
from .mjpeg_stream import MjpegStreamError, OctetStreamJpegParser


CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
SEGMENT_JOB_PATTERNS = ("*.mkv.job.json", "*.avi.job.json")
GIB = 1024**3


def _segment_job_paths(root: Path):
    """Scan only the fixed camera/date queue layout.

    A recursive glob also descended into ``_match-evidence`` and inspected
    every retained video. On a large archive that made a queue refresh take
    minutes even though only a few job JSON files existed.
    """
    if not root.is_dir():
        return
    try:
        camera_entries = list(os.scandir(root))
    except OSError:
        return
    for camera_entry in camera_entries:
        if camera_entry.name.startswith("_") or not camera_entry.is_dir(
            follow_symlinks=False
        ):
            continue
        try:
            date_entries = list(os.scandir(camera_entry.path))
        except OSError:
            continue
        for date_entry in date_entries:
            if not date_entry.is_dir(follow_symlinks=False):
                continue
            try:
                job_entries = list(os.scandir(date_entry.path))
            except OSError:
                continue
            for job_entry in job_entries:
                if not job_entry.is_file(follow_symlinks=False):
                    continue
                if job_entry.name.endswith(
                    tuple(pattern.removeprefix("*") for pattern in SEGMENT_JOB_PATTERNS)
                ):
                    yield Path(job_entry.path)


def _atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


def read_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def update_segment_job(path: Path, **changes) -> dict:
    payload = read_json(path)
    payload.update(changes)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    _atomic_json(path, payload)
    return payload


def recover_segment_jobs(root: Path) -> int:
    recovered = 0
    if not root.exists():
        return recovered
    for path in _segment_job_paths(root):
        payload = read_json(path)
        if payload.get("status") not in {"processing", "indexing"}:
            continue
        update_segment_job(
            path,
            status="pending",
            stage="waiting",
            last_error="Recuperado después de una interrupción.",
        )
        recovered += 1
    return recovered


def list_segment_jobs(
    root: Path,
    *,
    statuses: set[str] | None = None,
    limit: int | None = None,
) -> list[tuple[Path, dict]]:
    rows: list[tuple[Path, dict]] = []
    if not root.exists():
        return rows
    for path in _segment_job_paths(root):
        payload = read_json(path)
        status = str(payload.get("status") or "")
        if statuses is not None and status not in statuses:
            continue
        rows.append((path, payload))
    rows.sort(
        key=lambda item: (
            str(item[1].get("started_at") or ""),
            str(item[0]),
        )
    )
    return rows[:limit] if limit is not None else rows


def list_segment_jobs_in_roots(
    roots: tuple[Path, ...] | list[Path],
    *,
    statuses: set[str] | None = None,
    limit: int | None = None,
) -> list[tuple[Path, dict]]:
    """Return one chronological queue spanning hot and archive roots."""
    rows: list[tuple[Path, dict]] = []
    seen: set[Path] = set()
    for root in roots:
        resolved = root.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        rows.extend(list_segment_jobs(resolved, statuses=statuses))
    rows.sort(
        key=lambda item: (
            str(item[1].get("started_at") or ""),
            str(item[0]),
        )
    )
    return rows[:limit] if limit is not None else rows


def segment_job_summary(root: Path, *, recent_limit: int = 12) -> dict:
    counters = {"pending": 0, "processing": 0, "done": 0, "error": 0}
    pending_bytes = 0
    rows = list_segment_jobs(root)
    for _, payload in rows:
        status = str(payload.get("status") or "")
        if status == "indexing":
            counters["pending"] += 1
        elif status in counters:
            counters[status] += 1
        if status in {"indexing", "pending", "processing", "error"}:
            pending_bytes += int(payload.get("file_bytes") or 0)
    recent = [
        payload
        for _, payload in sorted(
            rows,
            key=lambda item: str(item[1].get("updated_at") or ""),
            reverse=True,
        )[:recent_limit]
    ]
    return {
        **counters,
        "total": sum(counters.values()),
        "pending_bytes": pending_bytes,
        "recent": recent,
    }


def segment_job_summary_in_roots(
    roots: tuple[Path, ...] | list[Path],
    *,
    recent_limit: int = 12,
) -> dict:
    counters = {"pending": 0, "processing": 0, "done": 0, "error": 0}
    pending_bytes = 0
    rows = list_segment_jobs_in_roots(roots)
    for _, payload in rows:
        status = str(payload.get("status") or "")
        if status == "indexing":
            counters["pending"] += 1
        elif status in counters:
            counters[status] += 1
        if status in {"indexing", "pending", "processing", "error"}:
            pending_bytes += int(payload.get("file_bytes") or 0)
    recent = [
        payload
        for _, payload in sorted(
            rows,
            key=lambda item: str(item[1].get("updated_at") or ""),
            reverse=True,
        )[:recent_limit]
    ]
    return {
        **counters,
        "total": sum(counters.values()),
        "pending_bytes": pending_bytes,
        "recent": recent,
    }


class TieredRecordingStorage:
    """Select an SSD hot tier without consuming its configured free-space reserve."""

    def __init__(
        self,
        archive_root: Path,
        *,
        hot_root: Path | None = None,
        min_free_gb: float = 35.0,
        resume_free_gb: float = 45.0,
    ) -> None:
        self.archive_root = archive_root.resolve()
        self.hot_root = hot_root.resolve() if hot_root is not None else None
        if self.hot_root == self.archive_root:
            self.hot_root = None
        self.min_free_bytes = max(0, int(float(min_free_gb) * GIB))
        self.resume_free_bytes = max(
            self.min_free_bytes,
            int(float(resume_free_gb) * GIB),
        )
        self.archive_root.mkdir(parents=True, exist_ok=True)
        if self.hot_root is not None:
            self.hot_root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._fallback_active = False
        self._reservations: dict[str, int] = {}
        self._estimates: dict[str, int] = {}
        self._last_reason = "hot_disabled" if self.hot_root is None else "hot_ready"

    @property
    def roots(self) -> tuple[Path, ...]:
        if self.hot_root is None:
            return (self.archive_root,)
        return (self.hot_root, self.archive_root)

    def reserve(self, camera_key: str, *, large_mjpeg: bool) -> Path:
        hot_root = self.hot_root
        if hot_root is None:
            return self.archive_root
        with self._lock:
            self._reservations.pop(camera_key, None)
            default_estimate = 12 * GIB if large_mjpeg else 2 * GIB
            estimate = max(
                512 * 1024**2,
                int(self._estimates.get(camera_key, default_estimate)),
            )
            try:
                free_bytes = int(shutil.disk_usage(hot_root).free)
            except OSError:
                self._fallback_active = True
                self._last_reason = "hot_unavailable"
                return self.archive_root
            available = free_bytes - sum(self._reservations.values())
            if self._fallback_active:
                if available - estimate >= self.resume_free_bytes:
                    self._fallback_active = False
                    self._last_reason = "hot_resumed"
            elif available - estimate < self.min_free_bytes:
                self._fallback_active = True
                self._last_reason = "reserve_protected"
            if self._fallback_active:
                return self.archive_root
            self._reservations[camera_key] = estimate
            self._last_reason = "hot_selected"
            return hot_root

    def release(self, camera_key: str, root: Path, actual_bytes: int) -> None:
        with self._lock:
            self._reservations.pop(camera_key, None)
            if root == self.hot_root and actual_bytes > 0:
                # A little headroom protects the reserve if the next segment grows.
                self._estimates[camera_key] = max(
                    512 * 1024**2,
                    int(actual_bytes * 1.20),
                )

    def status(self) -> dict:
        with self._lock:
            hot_root = self.hot_root
            free_bytes = 0
            if hot_root is not None:
                try:
                    free_bytes = int(shutil.disk_usage(hot_root).free)
                except OSError:
                    pass
            return {
                "enabled": hot_root is not None,
                "hot_dir": str(hot_root) if hot_root is not None else "",
                "archive_dir": str(self.archive_root),
                "hot_free_bytes": free_bytes,
                "min_free_bytes": self.min_free_bytes,
                "resume_free_bytes": self.resume_free_bytes,
                "fallback_active": self._fallback_active,
                "reserved_bytes": sum(self._reservations.values()),
                "reason": self._last_reason,
            }


def find_media_binary(name: str, configured: str = "") -> Path:
    filename = f"{name}.exe" if os.name == "nt" else name
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured).expanduser())
    discovered = shutil.which(name)
    if discovered:
        candidates.append(Path(discovered))
    if os.name == "nt":
        local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
        winget_root = local_app_data / "Microsoft" / "WinGet" / "Packages"
        if winget_root.is_dir():
            candidates.extend(
                winget_root.glob(f"Gyan.FFmpeg*/*/bin/{filename}")
            )
            candidates.extend(
                winget_root.glob(f"Gyan.FFmpeg*/ffmpeg*/bin/{filename}")
            )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(
        f"No se encontró {filename}. Instala FFmpeg o configura su ruta."
    )


class RecordedCameraWorker:
    """Records one camera losslessly into independently recoverable segments."""

    def __init__(
        self,
        source: str,
        *,
        name: str,
        label: str,
        storage_root: Path,
        storage_router: TieredRecordingStorage | None = None,
        ffmpeg: Path,
        ffprobe: Path,
        segment_seconds: int,
        preview_callback: Callable[[bytes], None] | None = None,
        preview_fps: float = 1.0,
    ) -> None:
        self.source = source
        self.name = name
        self.label = label
        self.storage_root = storage_root
        self.storage_router = storage_router
        self.storage_roots = (
            storage_router.roots if storage_router is not None else (storage_root,)
        )
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe
        self.segment_seconds = max(10, int(segment_seconds))
        source_lower = source.lower()
        self._mjpeg_index_enabled = source_lower.startswith(("http://", "https://"))
        # AVI/OpenDML records an offset table for every independent MJPEG
        # frame. FFprobe can enumerate a five-minute 4K segment from that
        # table in milliseconds instead of scanning the complete 12-14 GB
        # Matroska payload. RTSP/H.264 remains in Matroska.
        self._segment_suffix = ".avi" if self._mjpeg_index_enabled else ".mkv"
        self._segment_format = "avi" if self._mjpeg_index_enabled else "matroska"
        self._preview_callback = (
            preview_callback
            if source_lower.startswith(("http://", "https://", "rtsp://"))
            else None
        )
        self._preview_mode = (
            "packet_tap"
            if self._preview_callback is not None
            and source_lower.startswith(("http://", "https://"))
            else "dahua_snapshot"
            if self._preview_callback is not None
            and source_lower.startswith("rtsp://")
            else ""
        )
        self._preview_interval = 1.0 / max(0.1, float(preview_fps))
        self._stop = Event()
        self._processing_enabled = Event()
        self._processing_enabled.set()
        self._thread: Thread | None = None
        self._process: subprocess.Popen | None = None
        self._preview_thread: Thread | None = None
        self._index_thread: Thread | None = None
        self._segment_index_queue: Queue[tuple[Path, Path]] = Queue()
        self._lock = RLock()
        self._current_partial: Path | None = None
        self._current_started_at = ""
        self._current_started_monotonic = 0.0
        self._connected = False
        self._last_error = ""
        self._segments_completed = 0
        self._bytes_recorded = 0
        self._last_segment_at = ""
        self._frame = None
        self._captured_at = 0.0
        self._preview_frames = 0
        self._preview_frames_dropped = 0
        self._preview_last_monotonic = 0.0
        self._preview_error = ""
        self._preview_queue: Queue[bytes] = Queue(maxsize=1)

    @property
    def connected(self) -> bool:
        with self._lock:
            return self._connected

    @property
    def last_error(self) -> str:
        with self._lock:
            return self._last_error

    @property
    def frames_read(self) -> int:
        return 0

    @property
    def frames_dropped(self) -> int:
        return 0

    @property
    def hardware_acceleration(self) -> bool:
        return False

    @property
    def source_role(self) -> str:
        return "primary"

    @property
    def using_fallback(self) -> bool:
        return False

    @property
    def failover_count(self) -> int:
        return 0

    @property
    def last_source_switch_at(self) -> float:
        return 0.0

    @property
    def last_failover_reason(self) -> str:
        return ""

    @property
    def queue_depth(self) -> int:
        return 0

    @property
    def status_metrics(self) -> dict:
        with self._lock:
            partial = self._current_partial
            current_bytes = 0
            if partial is not None:
                try:
                    current_bytes = partial.stat().st_size
                except OSError:
                    current_bytes = 0
            elapsed = (
                max(0.0, time.monotonic() - self._current_started_monotonic)
                if self._current_started_monotonic
                else 0.0
            )
            thread_alive = bool(self._thread and self._thread.is_alive())
            process_alive = bool(self._process and self._process.poll() is None)
            preview_age = (
                max(0.0, time.monotonic() - self._preview_last_monotonic)
                if self._preview_last_monotonic
                else None
            )
            return {
                "pipeline_mode": "recorded_segments",
                "recording": bool(process_alive and self._connected),
                "connecting": bool(process_alive and not self._connected),
                "processing_enabled": self._processing_enabled.is_set(),
                "receiver_alive": thread_alive,
                "decoder_alive": False,
                "segment_seconds": self.segment_seconds,
                "segment_elapsed_seconds": round(elapsed, 1),
                "segment_progress": round(
                    min(1.0, elapsed / max(self.segment_seconds, 1)),
                    4,
                ),
                "current_segment_bytes": current_bytes,
                "current_storage_root": (
                    str(partial.parents[2]) if partial is not None else ""
                ),
                "segments_completed": self._segments_completed,
                "bytes_recorded": self._bytes_recorded,
                "last_segment_at": self._last_segment_at,
                "live_preview_enabled": self._preview_callback is not None,
                "live_preview_active": bool(
                    self._preview_callback is not None
                    and preview_age is not None
                    and preview_age <= max(3.0, self._preview_interval * 3.0)
                ),
                "live_preview_fps": round(1.0 / self._preview_interval, 2),
                "live_preview_frames": self._preview_frames,
                "live_preview_frames_dropped": self._preview_frames_dropped,
                "live_preview_decoupled": self._preview_mode == "packet_tap",
                "live_preview_age_seconds": (
                    round(preview_age, 2) if preview_age is not None else None
                ),
                "live_preview_error": self._preview_error,
            }

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._clear_preview_queue()
        self._index_thread = Thread(
            target=self._run_segment_indexer,
            name=f"faceguard-indexer-{self.name}",
            daemon=True,
        )
        self._index_thread.start()
        if self._preview_mode == "packet_tap":
            self._preview_thread = Thread(
                target=self._run_preview_publisher,
                name=f"faceguard-preview-publisher-{self.name}",
                daemon=True,
            )
            self._preview_thread.start()
        elif self._preview_mode == "dahua_snapshot":
            self._preview_thread = Thread(
                target=self._run_dahua_snapshot_preview,
                name=f"faceguard-preview-{self.name}",
                daemon=True,
            )
            self._preview_thread.start()
        self._thread = Thread(
            target=self._run,
            name=f"faceguard-recorder-{self.name}",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._request_process_stop()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=12)
        if thread and thread.is_alive():
            raise RuntimeError(f"La grabación de {self.label} no se detuvo a tiempo.")
        self._thread = None
        preview_thread = self._preview_thread
        if preview_thread and preview_thread.is_alive():
            preview_thread.join(timeout=8)
        self._preview_thread = None
        index_thread = self._index_thread
        if index_thread and index_thread.is_alive():
            index_thread.join(timeout=12)
        self._index_thread = None

    def set_processing_enabled(self, enabled: bool) -> None:
        if enabled:
            self._processing_enabled.set()
        else:
            self._processing_enabled.clear()
            self._request_process_stop()

    def wait_until_idle(self, timeout: float) -> bool:
        deadline = time.monotonic() + max(0.0, timeout)
        while time.monotonic() < deadline:
            with self._lock:
                process = self._process
            if process is None or process.poll() is not None:
                return True
            time.sleep(0.05)
        return False

    def clear_pending(self) -> None:
        return

    def next_packet(self):
        return None

    def wait_for_frame(self, timeout: float) -> bool:
        self._stop.wait(max(0.0, timeout))
        return False

    def latest(self):
        with self._lock:
            frame = self._frame
            captured_at = self._captured_at
        return (None if frame is None else frame.copy(), captured_at)

    def publish_detection_frame(self, frame, captured_at: float) -> None:
        with self._lock:
            self._frame = frame.copy()
            self._captured_at = float(captured_at)

    def _request_process_stop(self) -> None:
        with self._lock:
            process = self._process
        if process is None or process.poll() is not None:
            return
        try:
            if process.stdin is not None:
                process.stdin.write(b"q\n")
                process.stdin.flush()
        except (BrokenPipeError, OSError):
            pass

    def _run(self) -> None:
        self._recover_partial_segments()
        while not self._stop.is_set():
            if not self._processing_enabled.wait(0.25):
                continue
            try:
                self._record_one_segment()
            except Exception as exc:
                with self._lock:
                    self._process = None
                    self._current_partial = None
                    self._current_started_at = ""
                    self._current_started_monotonic = 0.0
                    self._connected = False
                    self._last_error = self._safe_error(str(exc))[:500]
                if not self._stop.is_set():
                    self._stop.wait(2.0)
        with self._lock:
            self._connected = False

    def _record_one_segment(self) -> None:
        router = self.storage_router
        storage_root = (
            router.reserve(self.name, large_mjpeg=self._mjpeg_index_enabled)
            if router is not None
            else self.storage_root
        )
        actual_bytes = 0
        try:
            actual_bytes = self._record_one_segment_at_root(storage_root)
        finally:
            if router is not None:
                router.release(self.name, storage_root, actual_bytes)

    def _record_one_segment_at_root(self, storage_root: Path) -> int:
        now = datetime.now().astimezone()
        folder = storage_root / self.name / now.date().isoformat()
        folder.mkdir(parents=True, exist_ok=True)
        stem = f"{now.strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}"
        partial = folder / f"{stem}.partial{self._segment_suffix}"
        final = folder / f"{stem}{self._segment_suffix}"
        log_path = folder / f"{stem}.ffmpeg.log"
        command = [
            str(self.ffmpeg),
            "-hide_banner",
            "-loglevel",
            "warning",
            "-fflags",
            "+genpts+discardcorrupt",
        ]
        if self.source.lower().startswith("rtsp://"):
            command += ["-rtsp_transport", "tcp", "-timeout", "10000000"]
        elif self.source.lower().startswith(("http://", "https://")):
            command += ["-rw_timeout", "10000000"]
        command += [
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            self.source,
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "copy",
            "-t",
            str(self.segment_seconds),
            "-f",
            self._segment_format,
            "-y",
            str(partial),
        ]
        preview_enabled = self._preview_mode == "packet_tap"
        if preview_enabled:
            # The FIFO muxer owns a bounded worker queue for the preview. If
            # the dashboard is slower than the 4K MJPEG source, preview
            # packets are discarded instead of blocking the lossless file
            # output or exerting backpressure on the Raspberry capture.
            command += [
                "-map",
                "0:v:0",
                "-an",
                "-c:v",
                "copy",
                "-t",
                str(self.segment_seconds),
                "-f",
                "fifo",
                "-fifo_format",
                "image2pipe",
                "-queue_size",
                "2",
                "-drop_pkts_on_overflow",
                "1",
                "pipe:1",
            ]
        started_at = now.isoformat()
        with log_path.open("wb") as log_stream:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE if preview_enabled else subprocess.DEVNULL,
                stderr=log_stream,
                creationflags=CREATE_NO_WINDOW,
            )
            preview_thread = None
            if preview_enabled and process.stdout is not None:
                preview_thread = Thread(
                    target=self._consume_preview_stream,
                    args=(process.stdout,),
                    name=f"faceguard-preview-{self.name}",
                    daemon=True,
                )
                preview_thread.start()
            with self._lock:
                self._process = process
                self._current_partial = partial
                self._current_started_at = started_at
                self._current_started_monotonic = time.monotonic()
                self._last_error = ""
            saw_data = False
            while process.poll() is None:
                if self._stop.is_set() or not self._processing_enabled.is_set():
                    self._request_process_stop()
                try:
                    size = partial.stat().st_size
                except OSError:
                    size = 0
                if size > 0:
                    saw_data = True
                    with self._lock:
                        self._connected = True
                time.sleep(0.1)
            return_code = process.wait()
            if preview_thread is not None:
                preview_thread.join(timeout=5.0)
        if not saw_data or not partial.is_file() or partial.stat().st_size <= 0:
            if self._stop.is_set() or not self._processing_enabled.is_set():
                partial.unlink(missing_ok=True)
                log_path.unlink(missing_ok=True)
                with self._lock:
                    self._process = None
                    self._current_partial = None
                    self._current_started_at = ""
                    self._current_started_monotonic = 0.0
                    self._connected = False
                return 0
            message = self._read_log_tail(log_path) or "FFmpeg no recibió video."
            partial.unlink(missing_ok=True)
            raise RuntimeError(message)
        if return_code not in {0, 255}:
            message = self._read_log_tail(log_path) or f"FFmpeg terminó con código {return_code}."
            raise RuntimeError(message)
        partial.replace(final)
        file_bytes = final.stat().st_size
        finished_at = datetime.now().astimezone().isoformat()
        job_path = final.with_suffix(final.suffix + ".job.json")
        initial_status = "indexing" if self._mjpeg_index_enabled else "pending"
        initial_stage = "indexing" if self._mjpeg_index_enabled else "waiting"
        _atomic_json(
            job_path,
            {
                "version": 1,
                "camera_key": self.name,
                "camera_label": self.label,
                "path": str(final),
                "filename": final.name,
                "started_at": started_at,
                "finished_at": finished_at,
                "status": initial_status,
                "stage": initial_stage,
                "attempts": 0,
                "file_bytes": file_bytes,
                "updated_at": finished_at,
                "last_error": "",
            },
        )
        if self._mjpeg_index_enabled:
            self._segment_index_queue.put((final, job_path))
        log_path.unlink(missing_ok=True)
        with self._lock:
            self._segments_completed += 1
            self._bytes_recorded += file_bytes
            self._last_segment_at = finished_at
            self._process = None
            self._current_partial = None
            self._current_started_at = ""
            self._current_started_monotonic = 0.0
            self._connected = False
        return file_bytes

    def _run_segment_indexer(self) -> None:
        while not self._stop.is_set() or not self._segment_index_queue.empty():
            try:
                video_path, job_path = self._segment_index_queue.get(timeout=0.2)
            except Empty:
                continue
            try:
                if self._stop.is_set():
                    raise InterruptedError(
                        "La indexacion quedo pendiente al detener la estacion."
                    )
                packets, elapsed, cached = build_mjpeg_index(
                    self.ffprobe,
                    video_path,
                    stop_event=self._stop,
                )
                update_segment_job(
                    job_path,
                    status="pending",
                    stage="waiting",
                    mjpeg_index_path=str(mjpeg_index_path(video_path)),
                    mjpeg_index_packets=len(packets),
                    mjpeg_index_seconds=round(elapsed, 3),
                    mjpeg_index_cached=bool(cached),
                    mjpeg_index_error="",
                )
            except Exception as exc:
                # The processor can construct the index lazily or fall back to
                # the proven single-pass route. Never strand a recorded video.
                update_segment_job(
                    job_path,
                    status="pending",
                    stage="waiting",
                    mjpeg_index_error=self._safe_error(str(exc))[:1000],
                )
            finally:
                self._segment_index_queue.task_done()

    def _consume_preview_stream(self, stream) -> None:
        parser = OctetStreamJpegParser()
        parsing = True
        last_selected = 0.0
        try:
            while True:
                chunk = stream.read(256 * 1024)
                if not chunk:
                    break
                if not parsing:
                    continue
                try:
                    frames = parser.feed(chunk)
                except MjpegStreamError as exc:
                    parsing = False
                    with self._lock:
                        self._preview_error = self._safe_error(str(exc))[:500]
                    continue
                for payload in frames:
                    now = time.monotonic()
                    if now - last_selected < self._preview_interval:
                        continue
                    last_selected = now
                    self._offer_preview(payload)
        except (OSError, ValueError) as exc:
            with self._lock:
                self._preview_error = self._safe_error(str(exc))[:500]
        finally:
            try:
                stream.close()
            except OSError:
                pass

    def _offer_preview(self, payload: bytes) -> None:
        if self._preview_callback is None:
            return
        try:
            self._preview_queue.put_nowait(payload)
            return
        except Full:
            pass
        try:
            self._preview_queue.get_nowait()
        except Empty:
            pass
        else:
            with self._lock:
                self._preview_frames_dropped += 1
        try:
            self._preview_queue.put_nowait(payload)
        except Full:
            with self._lock:
                self._preview_frames_dropped += 1

    def _run_preview_publisher(self) -> None:
        while not self._stop.is_set():
            try:
                payload = self._preview_queue.get(timeout=0.2)
            except Empty:
                continue
            callback = self._preview_callback
            if callback is None:
                continue
            try:
                callback(payload)
            except Exception as exc:
                with self._lock:
                    self._preview_error = self._safe_error(str(exc))[:500]
                continue
            now = time.monotonic()
            with self._lock:
                self._preview_frames += 1
                self._preview_last_monotonic = now
                self._preview_error = ""

    def _clear_preview_queue(self) -> None:
        while True:
            try:
                self._preview_queue.get_nowait()
            except Empty:
                return

    def _run_dahua_snapshot_preview(self) -> None:
        parsed = urlsplit(self.source)
        query = parse_qs(parsed.query)
        channel = str((query.get("channel") or ["1"])[0])
        hostname = parsed.hostname or ""
        if ":" in hostname and not hostname.startswith("["):
            hostname = f"[{hostname}]"
        snapshot_url = urlunsplit(
            (
                "http",
                hostname,
                "/cgi-bin/snapshot.cgi",
                urlencode({"channel": channel}),
                "",
            )
        )
        session = requests.Session()
        session.trust_env = False
        auth = HTTPDigestAuth(parsed.username or "", parsed.password or "")
        try:
            while not self._stop.is_set():
                started = time.monotonic()
                try:
                    response = session.get(
                        snapshot_url,
                        auth=auth,
                        timeout=(2.0, 5.0),
                        headers={"Accept": "image/jpeg"},
                    )
                    response.raise_for_status()
                    payload = bytes(response.content)
                    if not payload.startswith(b"\xff\xd8") or not payload.endswith(b"\xff\xd9"):
                        raise ValueError("La captura Dahua no es un JPEG completo.")
                    callback = self._preview_callback
                    if callback is not None:
                        callback(payload)
                    now = time.monotonic()
                    with self._lock:
                        self._preview_frames += 1
                        self._preview_last_monotonic = now
                        self._preview_error = ""
                except (OSError, ValueError, requests.RequestException) as exc:
                    with self._lock:
                        self._preview_error = self._safe_error(str(exc))[:500]
                remaining = self._preview_interval - (time.monotonic() - started)
                if remaining > 0:
                    self._stop.wait(remaining)
        finally:
            session.close()

    def _recover_partial_segments(self) -> None:
        for storage_root in self.storage_roots:
            self._recover_partial_segments_at_root(storage_root)

    def _recover_partial_segments_at_root(self, storage_root: Path) -> None:
        camera_root = storage_root / self.name
        if not camera_root.exists():
            return
        partials = [
            *camera_root.rglob("*.partial.mkv"),
            *camera_root.rglob("*.partial.avi"),
        ]
        for partial in partials:
            final = partial.with_name(partial.name.replace(".partial", "", 1))
            if final.exists():
                partial.unlink(missing_ok=True)
                continue
            try:
                probe = subprocess.run(
                    [
                        str(self.ffprobe),
                        "-v",
                        "error",
                        "-select_streams",
                        "v:0",
                        "-show_entries",
                        "stream=width,height",
                        "-of",
                        "json",
                        str(partial),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    creationflags=CREATE_NO_WINDOW,
                )
            except (OSError, subprocess.SubprocessError):
                continue
            if probe.returncode or not read_json_from_text(probe.stdout).get("streams"):
                continue
            try:
                partial.replace(final)
            except OSError:
                # A previous FFmpeg process may still be releasing the file
                # during crash recovery. Skip it for this startup instead of
                # killing the complete camera worker.
                continue
            started = datetime.fromtimestamp(
                final.stat().st_ctime,
                timezone.utc,
            ).astimezone().isoformat()
            finished = datetime.fromtimestamp(
                final.stat().st_mtime,
                timezone.utc,
            ).astimezone().isoformat()
            _atomic_json(
                final.with_suffix(final.suffix + ".job.json"),
                {
                    "version": 1,
                    "camera_key": self.name,
                    "camera_label": self.label,
                    "path": str(final),
                    "filename": final.name,
                    "started_at": started,
                    "finished_at": finished,
                    "status": "pending",
                    "stage": "waiting",
                    "attempts": 0,
                    "file_bytes": final.stat().st_size,
                    "updated_at": finished,
                    "last_error": "Segmento recuperado después de una interrupción.",
                },
            )

    @staticmethod
    def _read_log_tail(path: Path) -> str:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        return text.strip()[-1200:]

    def _safe_error(self, value: str) -> str:
        safe = str(value).replace(self.source, "<fuente de cámara>")
        try:
            parsed = urlsplit(self.source)
        except ValueError:
            return safe
        if parsed.username is None and parsed.password is None:
            return safe
        host = parsed.hostname or "cámara"
        port = f":{parsed.port}" if parsed.port else ""
        redacted = urlunsplit(
            (parsed.scheme, f"***@{host}{port}", parsed.path, parsed.query, parsed.fragment)
        )
        safe = safe.replace(self.source, redacted)
        if parsed.username:
            safe = safe.replace(parsed.username, "***")
        if parsed.password:
            safe = safe.replace(parsed.password, "***")
        return safe


def read_json_from_text(value: str) -> dict:
    try:
        payload = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}
