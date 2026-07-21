from __future__ import annotations

from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from .recognition import DetectedFace


GREEN = (38, 174, 96)
BLUE = (235, 153, 40)
AMBER = (28, 170, 245)
WHITE = (250, 250, 250)


def resize_for_processing(frame, target_width: int):
    if frame.shape[1] <= target_width:
        return frame.copy()
    ratio = target_width / frame.shape[1]
    return cv2.resize(
        frame,
        (target_width, max(1, int(frame.shape[0] * ratio))),
        interpolation=cv2.INTER_AREA,
    )


def encode_preview(frame, target_width: int) -> bytes:
    if frame.shape[1] > target_width:
        ratio = target_width / frame.shape[1]
        frame = cv2.resize(
            frame,
            (target_width, max(1, int(frame.shape[0] * ratio))),
            interpolation=cv2.INTER_AREA,
        )
    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return encoded.tobytes() if ok else b""


def draw_face(frame, detected: DetectedFace, label: str, color: tuple[int, int, int]) -> None:
    x1, y1, x2, y2 = detected.bbox
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
    text = label[:42]
    (text_width, text_height), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.62, 2)
    text_top = max(0, y1 - text_height - 16)
    cv2.rectangle(frame, (x1, text_top), (min(frame.shape[1], x1 + text_width + 18), y1), color, -1)
    cv2.putText(frame, text, (x1 + 8, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.62, WHITE, 2, cv2.LINE_AA)


def draw_overlay(
    frame,
    face_count: int,
    observed_at: datetime,
    provider: str,
    processing_fps: float,
    online: bool,
) -> None:
    cv2.rectangle(frame, (0, 0), (frame.shape[1], 54), (17, 22, 20), -1)
    connection = "ONLINE" if online else "OFFLINE"
    text = f"FUTSI | {provider} | {processing_fps:.1f} FPS | Rostros {face_count} | {connection}"
    cv2.putText(frame, text, (18, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.64, WHITE, 2, cv2.LINE_AA)
    stamp = observed_at.strftime("%Y-%m-%d %H:%M:%S")
    cv2.putText(
        frame,
        stamp,
        (max(18, frame.shape[1] - 235), frame.shape[0] - 18),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        WHITE,
        2,
    )


def save_crop(
    faces_dir: Path,
    frame,
    detected: DetectedFace,
    kind: str,
    key: str,
    observed_at: datetime,
) -> str:
    x1, y1, x2, y2 = detected.bbox
    width, height = x2 - x1, y2 - y1
    margin_x, margin_y = int(width * 0.25), int(height * 0.32)
    left, top = max(0, x1 - margin_x), max(0, y1 - margin_y)
    right, bottom = min(frame.shape[1], x2 + margin_x), min(frame.shape[0], y2 + margin_y)
    crop = frame[top:bottom, left:right]
    if crop.size == 0:
        return ""
    safe_key = "".join(character if character.isalnum() or character in "-_" else "_" for character in key)
    folder = faces_dir / observed_at.date().isoformat() / kind / safe_key
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{int(observed_at.timestamp() * 1000)}.jpg"
    ok, encoded = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        return ""
    temp = target.with_suffix(".tmp")
    temp.write_bytes(encoded.tobytes())
    temp.replace(target)
    return str(target)


def placeholder_frame(title: str, detail: str = "") -> bytes:
    frame = np.full((540, 960, 3), (245, 247, 246), dtype=np.uint8)
    cv2.rectangle(frame, (0, 0), (960, 76), (7, 79, 42), -1)
    cv2.putText(frame, "FUTSI FACE STATION", (30, 49), cv2.FONT_HERSHEY_SIMPLEX, 0.85, WHITE, 2, cv2.LINE_AA)
    cv2.putText(frame, title[:70], (30, 250), cv2.FONT_HERSHEY_SIMPLEX, 0.82, (25, 35, 30), 2, cv2.LINE_AA)
    if detail:
        cv2.putText(frame, detail[:105], (30, 292), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (80, 88, 84), 1, cv2.LINE_AA)
    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return encoded.tobytes() if ok else b""
