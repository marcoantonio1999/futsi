from __future__ import annotations

import csv
import json
import math
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Event


CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
MJPEG_INDEX_VERSION = 1


@dataclass(frozen=True)
class MjpegPacket:
    offset: float
    position: int
    size: int


def mjpeg_index_path(video_path: Path) -> Path:
    return video_path.with_suffix(video_path.suffix + ".fgidx.json")


def _source_signature(video_path: Path) -> dict[str, int]:
    stat = video_path.stat()
    return {
        "size": int(stat.st_size),
        "mtime_ns": int(stat.st_mtime_ns),
    }


def load_mjpeg_index(
    video_path: Path,
    index_path: Path | None = None,
) -> list[MjpegPacket]:
    target = index_path or mjpeg_index_path(video_path)
    if not video_path.is_file() or not target.is_file():
        return []
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
        if payload.get("version") != MJPEG_INDEX_VERSION:
            return []
        if payload.get("source") != _source_signature(video_path):
            return []
        packets = [
            MjpegPacket(
                offset=float(row[0]),
                position=int(row[1]),
                size=int(row[2]),
            )
            for row in payload.get("packets", [])
        ]
    except (OSError, TypeError, ValueError):
        return []
    return packets


def build_mjpeg_index(
    ffprobe: Path,
    video_path: Path,
    *,
    index_path: Path | None = None,
    stop_event: Event | None = None,
) -> tuple[list[MjpegPacket], float, bool]:
    """Create a compact PTS/file-offset index without decoding JPEG packets."""
    target = index_path or mjpeg_index_path(video_path)
    cached = load_mjpeg_index(video_path, target)
    if cached:
        return cached, 0.0, True

    started = time.perf_counter()
    process = subprocess.Popen(
        [
            str(ffprobe),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "packet=pts_time,pos,size",
            "-of",
            "csv=p=0",
            str(video_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    packets: list[MjpegPacket] = []
    origin: float | None = None
    try:
        for row in csv.reader(process.stdout):
            if stop_event is not None and stop_event.is_set():
                raise InterruptedError("La indexacion MJPEG fue interrumpida.")
            if len(row) < 3:
                continue
            try:
                # ffprobe emits its canonical packet order: pts_time,size,pos.
                pts = float(row[0])
                size = int(row[1])
                position = int(row[2])
            except (TypeError, ValueError):
                continue
            if not math.isfinite(pts) or position < 0 or size <= 0:
                continue
            if origin is None:
                origin = pts
            packets.append(
                MjpegPacket(
                    offset=max(0.0, pts - origin),
                    position=position,
                    size=size,
                )
            )
        stderr = process.stderr.read()
        return_code = process.wait(timeout=30)
        if return_code:
            raise RuntimeError(
                f"ffprobe termino con codigo {return_code}: {stderr[-1200:]}"
            )
    except Exception:
        if process.poll() is None:
            process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        raise
    finally:
        process.stdout.close()
        process.stderr.close()

    if not packets:
        raise RuntimeError("FFprobe no encontro paquetes MJPEG indexables.")
    signature = _source_signature(video_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        json.dumps(
            {
                "version": MJPEG_INDEX_VERSION,
                "video": str(video_path),
                "source": signature,
                "packets": [
                    [round(packet.offset, 6), packet.position, packet.size]
                    for packet in packets
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    # Do not publish an index for a file that changed while ffprobe read it.
    if signature != _source_signature(video_path):
        temporary.unlink(missing_ok=True)
        raise RuntimeError("El segmento cambio mientras se construia su indice.")
    temporary.replace(target)
    return packets, time.perf_counter() - started, False


class IndexedMjpegReader:
    """Read individual JPEG payloads directly from an indexed media file."""

    def __init__(self, video_path: Path) -> None:
        self._stream = video_path.open("rb", buffering=0)
        self.bytes_read = 0
        self.read_seconds = 0.0

    def read(self, packet: MjpegPacket) -> bytes:
        started = time.perf_counter()
        self._stream.seek(packet.position)
        # FFprobe points at the packet/chunk header in Matroska and AVI. A
        # short container header precedes the JPEG SOI in both formats.
        raw = self._stream.read(packet.size + 64)
        self.read_seconds += time.perf_counter() - started
        self.bytes_read += len(raw)
        soi = raw.find(b"\xff\xd8", 0, min(len(raw), 64))
        if soi < 0:
            raise RuntimeError(
                f"No se encontro JPEG SOI en el paquete de {packet.offset:.3f}s."
            )
        jpeg = raw[soi : soi + packet.size]
        if len(jpeg) != packet.size or not jpeg.endswith(b"\xff\xd9"):
            end = raw.find(b"\xff\xd9", soi + 2)
            if end < 0:
                raise RuntimeError(
                    f"Paquete JPEG incompleto en {packet.offset:.3f}s."
                )
            jpeg = raw[soi : end + 2]
        return jpeg

    def close(self) -> None:
        self._stream.close()

    def __enter__(self) -> "IndexedMjpegReader":
        return self

    def __exit__(self, *_args) -> None:
        self.close()


def select_mjpeg_scout_packets(
    packets: list[MjpegPacket],
    sample_fps: float,
) -> list[MjpegPacket]:
    selected: list[MjpegPacket] = []
    interval = 1.0 / max(float(sample_fps), 0.001)
    next_sample_at = 0.0
    for packet in packets:
        if packet.offset + 1e-6 < next_sample_at:
            continue
        selected.append(packet)
        while next_sample_at <= packet.offset + 1e-6:
            next_sample_at += interval
    return selected


def mjpeg_packets_in_windows(
    packets: list[MjpegPacket],
    windows: list[tuple[float, float]],
) -> list[MjpegPacket]:
    selected: list[MjpegPacket] = []
    window_index = 0
    for packet in packets:
        while (
            window_index < len(windows)
            and packet.offset > windows[window_index][1] + 1e-6
        ):
            window_index += 1
        if window_index >= len(windows):
            break
        start, end = windows[window_index]
        if start - 1e-6 <= packet.offset <= end + 1e-6:
            selected.append(packet)
    return selected
