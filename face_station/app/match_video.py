from __future__ import annotations

import os
import subprocess
from datetime import datetime, time, timedelta
from pathlib import Path

import cv2
import numpy as np


CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
MATCH_EVIDENCE_START = time(15, 0)
MATCH_EVIDENCE_END = time(1, 0)
MATCH_EVIDENCE_RETENTION_DAYS = 7
MATCH_EVIDENCE_SIZE = 420


def segment_needs_evidence_candidate(started_at: datetime, ends_at: datetime) -> bool:
    """Return true when a segment touches the 15:00-01:00 audit window."""
    day = started_at.date() - timedelta(days=1)
    last_day = max(started_at.date(), ends_at.date())
    while day <= last_day:
        window_start = datetime.combine(day, MATCH_EVIDENCE_START, started_at.tzinfo)
        window_end = datetime.combine(
            day + timedelta(days=1),
            MATCH_EVIDENCE_END,
            started_at.tzinfo,
        )
        if started_at < window_end and ends_at > window_start:
            return True
        day += timedelta(days=1)
    return False


def square_evidence_frame(frame: np.ndarray, size: int = MATCH_EVIDENCE_SIZE) -> np.ndarray:
    height, width = frame.shape[:2]
    if width <= 0 or height <= 0:
        raise ValueError("El frame de evidencia no tiene dimensiones validas.")
    scale = min(size / width, size / height)
    target_width = max(2, int(round(width * scale)))
    target_height = max(2, int(round(height * scale)))
    resized = cv2.resize(
        frame,
        (target_width, target_height),
        interpolation=cv2.INTER_AREA,
    )
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    x = (size - target_width) // 2
    y = (size - target_height) // 2
    canvas[y : y + target_height, x : x + target_width] = resized
    return canvas


class MatchEvidenceWriter:
    """Encode the detector's sampled frames as a browser-compatible H.264 proxy."""

    def __init__(
        self,
        ffmpeg: Path,
        output_path: Path,
        *,
        fps: float,
        size: int = MATCH_EVIDENCE_SIZE,
    ) -> None:
        self.output_path = output_path
        self.temporary_path = output_path.with_name(
            f"{output_path.stem}.partial{output_path.suffix}"
        )
        self.size = int(size)
        self.fps = max(0.5, float(fps))
        self.frames = 0
        self._error = ""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self.temporary_path.unlink(missing_ok=True)
        command = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-video_size",
            f"{self.size}x{self.size}",
            "-framerate",
            f"{self.fps:g}",
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "34",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(self.temporary_path),
        ]
        self._process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=CREATE_NO_WINDOW,
        )

    def write(self, frame: np.ndarray) -> None:
        if self._error:
            return
        try:
            if self._process.stdin is None or self._process.poll() is not None:
                raise RuntimeError(
                    "El codificador de evidencia se detuvo antes de tiempo."
                )
            self._process.stdin.write(square_evidence_frame(frame, self.size).tobytes())
            self.frames += 1
        except (OSError, RuntimeError, ValueError) as exc:
            self._error = str(exc)

    def close(self, *, commit: bool = True) -> dict:
        process = self._process
        if process.stdin is not None:
            try:
                process.stdin.close()
            except OSError:
                pass
        stderr = b""
        if process.stderr is not None:
            stderr = process.stderr.read()
        return_code = process.wait(timeout=30)
        error = stderr.decode("utf-8", errors="replace")[-1200:]
        usable = bool(
            commit
            and not self._error
            and self.frames > 0
            and return_code == 0
            and self.temporary_path.is_file()
            and self.temporary_path.stat().st_size > 0
        )
        if usable:
            self.temporary_path.replace(self.output_path)
        else:
            self.temporary_path.unlink(missing_ok=True)
        return {
            "ok": usable,
            "frames": self.frames,
            "path": str(self.output_path) if usable else "",
            "file_bytes": self.output_path.stat().st_size if usable else 0,
            "error": (
                ""
                if usable
                else self._error or error or f"FFmpeg termino con codigo {return_code}."
            ),
        }
