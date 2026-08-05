from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import math
import os
import queue
import socket
import statistics
import sys
import tempfile
import threading
import time
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from face_station.app.recognition import FaceDetector  # noqa: E402


POSITIVE_CROPS = (
    r"F:\FaceGuardData\faces\2026-08-04\unknown\46fb22ca-927d-4910-b40e-7a4a05711744_1785901235093_01235093.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\76106705-ff64-403c-8a2a-a416b94d19ab_1785901248108_01248108.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\19592100-44c5-4e79-a3f1-6e23c80d1c51_1785901239495_01239495.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\853bbb83-a7fe-4f61-b92f-42ac5dd4480d_1785901222335_01222335.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\941b00c5-b422-49eb-8ca2-6c5b0b35238a_1785867461319_67461319.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\89bc6234-c409-43a6-8bb9-1e38696ae161_1785866422531_66422531.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\cc67856d-d37e-4af1-be29-34b71d18384c_1785873225895_73225895.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\ee6d752e-69c8-483c-995f-e55bb21ddd2b_1785873583190_73583190.jpg",
)

DIFFICULT_CROPS = (
    r"F:\FaceGuardData\faces\2026-08-04\unknown\46fb22ca-927d-4910-b40e-7a4a05711744_1785901237694_01237694.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\19592100-44c5-4e79-a3f1-6e23c80d1c51_1785901242519_01242519.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\7df09d1a-3e8c-491a-a7c0-f77fada735cd_1785901253834_01253834.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\known\collaborator_436_1785901082832_01082832.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\c3b5ecc1-c5a8-4fec-919e-e1b32bb58601_1785873596785_73596785.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\d0ed7533-c8ae-4f98-8987-b756fc0bcd20_1785873137301_73137301.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\941b00c5-b422-49eb-8ca2-6c5b0b35238a_1785871794124_71794124.jpg",
    r"F:\FaceGuardData\faces\2026-08-04\unknown\1b913f2c-53cd-4e5a-b319-ff53a293208c_1785866768435_66768435.jpg",
)


@dataclass
class DetectorConfig:
    processing_device: str = "gpu"
    model_name: str = "buffalo_l"
    detector_size: int = 640
    min_det_score: float = 0.65
    # The prototype decodes at 1/4 resolution. 18 px maps to 72 px in the
    # original frame, preserving the production threshold of roughly 70 px.
    min_face_size: int = 18


@dataclass
class SceneFrame:
    jpeg: bytes
    expected_faces: int
    phase: str


class FrameRing:
    def __init__(self) -> None:
        self._items: OrderedDict[int, bytes] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()
        self.high_watermark_frames = 0
        self.high_watermark_bytes = 0

    def put(self, frame_id: int, payload: bytes) -> None:
        with self._lock:
            self._items[frame_id] = payload
            self._bytes += len(payload)
            self.high_watermark_frames = max(self.high_watermark_frames, len(self._items))
            self.high_watermark_bytes = max(self.high_watermark_bytes, self._bytes)

    def get(self, frame_id: int) -> bytes | None:
        with self._lock:
            return self._items.get(frame_id)

    def discard(self, frame_id: int) -> None:
        with self._lock:
            payload = self._items.pop(frame_id, None)
            if payload is not None:
                self._bytes -= len(payload)


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(p * len(ordered)) - 1))
    return float(ordered[index])


def fetch_preview(url: str) -> np.ndarray | None:
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            payload = bytearray()
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and len(payload) < 8_000_000:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                payload.extend(chunk)
                start = payload.find(b"\xff\xd8")
                end = payload.find(b"\xff\xd9", max(0, start + 2))
                if start >= 0 and end > start:
                    encoded = np.frombuffer(payload[start : end + 2], dtype=np.uint8)
                    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    except Exception:
        return None
    return None


def make_background(width: int, height: int) -> np.ndarray:
    preview = fetch_preview("http://127.0.0.1:8765/api/stream.mjpg?camera=primary")
    if preview is None:
        y = np.linspace(0, 1, height, dtype=np.float32)[:, None]
        x = np.linspace(0, 1, width, dtype=np.float32)[None, :]
        base = np.empty((height, width, 3), dtype=np.uint8)
        base[..., 0] = np.clip(35 + 25 * x + 12 * y, 0, 255)
        base[..., 1] = np.clip(55 + 20 * x + 18 * y, 0, 255)
        base[..., 2] = np.clip(42 + 18 * x + 10 * y, 0, 255)
    else:
        base = cv2.resize(preview, (width, height), interpolation=cv2.INTER_CUBIC)
        base = cv2.GaussianBlur(base, (5, 5), 0)

    # A fixed low-amplitude texture makes JPEG payloads closer to a camera
    # scene without changing the face corpus or introducing fake detections.
    rng = np.random.default_rng(20260805)
    noise_small = rng.normal(0, 2.2, (height // 4, width // 4, 1)).astype(np.float32)
    noise = cv2.resize(noise_small, (width, height), interpolation=cv2.INTER_LINEAR)
    if noise.ndim == 2:
        noise = noise[:, :, None]
    return np.clip(base.astype(np.float32) + noise, 0, 255).astype(np.uint8)


def load_crops(paths: tuple[str, ...]) -> list[np.ndarray]:
    crops: list[np.ndarray] = []
    missing: list[str] = []
    for raw_path in paths:
        path = Path(raw_path)
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            missing.append(str(path))
        else:
            crops.append(image)
    if missing:
        raise FileNotFoundError("No se pudieron leer recortes: " + ", ".join(missing))
    return crops


def paste_crop(frame: np.ndarray, crop: np.ndarray, center_x: int, top: int, target_width: int) -> None:
    height, width = frame.shape[:2]
    scale = target_width / max(crop.shape[1], 1)
    target_height = max(1, int(round(crop.shape[0] * scale)))
    resized = cv2.resize(crop, (target_width, target_height), interpolation=cv2.INTER_CUBIC)
    x1 = max(0, min(width - target_width, center_x - target_width // 2))
    y1 = max(0, min(height - target_height, top))
    x2, y2 = x1 + target_width, y1 + target_height

    border = max(6, min(target_width, target_height) // 28)
    alpha = np.ones((target_height, target_width), dtype=np.float32)
    ramp_x = np.minimum(np.arange(target_width), np.arange(target_width)[::-1]) / border
    ramp_y = np.minimum(np.arange(target_height), np.arange(target_height)[::-1]) / border
    alpha *= np.clip(ramp_x, 0, 1)[None, :]
    alpha *= np.clip(ramp_y, 0, 1)[:, None]
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=max(1.0, border / 3))[:, :, None]
    region = frame[y1:y2, x1:x2].astype(np.float32)
    frame[y1:y2, x1:x2] = np.clip(
        resized.astype(np.float32) * alpha + region * (1 - alpha), 0, 255
    ).astype(np.uint8)


def phase_for(second: float) -> tuple[str, int, bool]:
    if second < 10:
        return "vacio", 0, False
    if second < 20:
        return "una_cara", 1, False
    if second < 30:
        return "dos_caras", 2, False
    if second < 40:
        return "escala_posicion", 3, False
    if second < 50:
        return "casos_dificiles", 2, True
    return "mezcla", 4, False


def build_scenes(seconds: float, scene_fps: int, width: int, height: int) -> list[SceneFrame]:
    positive = load_crops(POSITIVE_CROPS)
    difficult = load_crops(DIFFICULT_CROPS)
    base = make_background(width, height)
    scenes: list[SceneFrame] = []
    total = max(1, int(math.ceil(seconds * scene_fps)))
    for index in range(total):
        second = index / scene_fps
        phase, count, use_difficult = phase_for(second)
        frame = base.copy()
        source = difficult if use_difficult else positive
        for face_index in range(count):
            crop = source[(index + face_index * 3) % len(source)]
            lane = (face_index + 1) / (count + 1)
            drift = math.sin(second * (0.7 + 0.11 * face_index) + face_index) * 170
            center_x = int(width * lane + drift)
            top = int(height * (0.19 + 0.055 * (face_index % 3)))
            if phase == "escala_posicion":
                target_width = int(300 + 250 * (0.5 + 0.5 * math.sin(second * 1.2 + face_index)))
            elif phase == "casos_dificiles":
                target_width = 430
            else:
                target_width = 440 + 25 * (face_index % 2)
            paste_crop(frame, crop, center_x, top, target_width)

        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise RuntimeError("OpenCV no pudo codificar una escena de prueba.")
        scenes.append(SceneFrame(encoded.tobytes(), count, phase))
    return scenes


def read_station_counters() -> dict:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8765/api/status", timeout=8) as response:
            status = json.load(response)
        return {
            name: {
                "frames_read": int(item.get("frames_read", 0)),
                "frames_dropped": int(item.get("frames_dropped", 0)),
            }
            for name, item in status.get("cameras", {}).items()
        }
    except Exception as exc:
        return {"error": str(exc)}


def station_counter_delta(before: dict, after: dict, elapsed: float) -> dict:
    result: dict[str, dict] = {}
    for name in ("primary", "secondary"):
        if name not in before or name not in after:
            continue
        read_delta = after[name]["frames_read"] - before[name]["frames_read"]
        drop_delta = after[name]["frames_dropped"] - before[name]["frames_dropped"]
        result[name] = {
            "frames_read": read_delta,
            "frames_dropped": drop_delta,
            "read_fps": round(read_delta / max(elapsed, 0.001), 2),
            "drop_fps": round(drop_delta / max(elapsed, 0.001), 2),
        }
    return result


def iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    return intersection / max(area_a + area_b - intersection, 1)


def scaled_bbox(bbox: tuple[int, int, int, int], sx: float, sy: float) -> tuple[int, int, int, int]:
    return (
        int(round(bbox[0] * sx)),
        int(round(bbox[1] * sy)),
        int(round(bbox[2] * sx)),
        int(round(bbox[3] * sy)),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark aislado del pipeline MJPEG de FaceGuard.")
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--scene-fps", type=int, default=3)
    parser.add_argument("--evidence-every", type=int, default=30)
    parser.add_argument("--output-dir", default="")
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else Path(
        tempfile.mkdtemp(prefix="faceguard-async-benchmark-")
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    evidence_dir = output_dir / "evidence"
    evidence_dir.mkdir(exist_ok=True)

    scenes = build_scenes(args.seconds, args.scene_fps, 3840, 2160)
    payload_sizes = [len(scene.jpeg) for scene in scenes]
    total_frames = int(round(args.seconds * args.fps))

    metrics: dict[str, object] = {
        "configuration": {
            "seconds": args.seconds,
            "source_fps": args.fps,
            "scene_fps": args.scene_fps,
            "resolution": [3840, 2160],
            "decode_mode": "OpenCV IMREAD_REDUCED_COLOR_4 (libjpeg-turbo)",
            "detector": "SCRFD buffalo_l 640 CUDA",
            "evidence_every_frames": args.evidence_every,
        },
        "corpus": {
            "positive_count": len(POSITIVE_CROPS),
            "difficult_count": len(DIFFICULT_CROPS),
            "scene_templates": len(scenes),
        },
        "jpeg_payload": {
            "average_bytes": round(statistics.mean(payload_sizes), 1),
            "p95_bytes": round(percentile([float(v) for v in payload_sizes], 0.95), 1),
        },
    }

    detector = FaceDetector(DetectorConfig())
    detector.load()
    metrics["provider"] = detector.provider_label

    compressed_queue: queue.Queue = queue.Queue(maxsize=max(total_frames, 1))
    decoded_queue: queue.Queue = queue.Queue(maxsize=max(total_frames, 1))
    persistence_queue: queue.Queue = queue.Queue(maxsize=max(total_frames * 4, 1))
    ring = FrameRing()
    receiver_done = threading.Event()
    decoder_done = threading.Event()
    detector_done = threading.Event()
    server_done = threading.Event()
    run_stats = {
        "sent": 0,
        "received": 0,
        "processed": 0,
        "hash_mismatches": 0,
        "corrupt_jpegs": 0,
        "detected_faces": 0,
        "frames_with_detections": 0,
        "expected_faces": 0,
        "evidence_enqueued": 0,
        "evidence_written": 0,
        "evidence_misses": 0,
        "persistence_failures": 0,
        "compressed_queue_high": 0,
        "decoded_queue_high": 0,
        "persistence_queue_high": 0,
        "bytes_received": 0,
        "server_late_ms_max": 0.0,
    }
    reduced_decode_ms: list[float] = []
    detect_ms: list[float] = []
    full_decode_ms: list[float] = []
    persist_ms: list[float] = []
    sample_payloads: dict[int, bytes] = {}
    evidence_paths: list[Path] = []
    stats_lock = threading.Lock()

    scene_index_for_frame = lambda frame_id: min(
        len(scenes) - 1,
        int(((frame_id - 1) / args.fps) * args.scene_fps),
    )

    class StreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format: str, *_args) -> None:
            return

        def do_GET(self) -> None:
            if self.path != "/stream":
                self.send_error(404)
                return
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self.send_response(200)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            started = time.perf_counter()
            for frame_id in range(1, total_frames + 1):
                deadline = started + ((frame_id - 1) / args.fps)
                remaining = deadline - time.perf_counter()
                if remaining > 0:
                    time.sleep(remaining)
                late_ms = max(0.0, (time.perf_counter() - deadline) * 1000)
                scene_index = scene_index_for_frame(frame_id)
                scene = scenes[scene_index]
                digest = hashlib.sha256(scene.jpeg).hexdigest()
                header = (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(scene.jpeg)}\r\n".encode()
                    + f"X-Frame-ID: {frame_id}\r\n".encode()
                    + f"X-Scene-Index: {scene_index}\r\n".encode()
                    + f"X-SHA256: {digest}\r\n\r\n".encode()
                )
                try:
                    self.wfile.write(header)
                    self.wfile.write(scene.jpeg)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
                with stats_lock:
                    run_stats["sent"] += 1
                    run_stats["server_late_ms_max"] = max(
                        float(run_stats["server_late_ms_max"]), late_ms
                    )
            server_done.set()

    server = ThreadingHTTPServer(("127.0.0.1", 0), StreamHandler)
    server_thread = threading.Thread(target=server.serve_forever, name="benchmark-http", daemon=True)
    server_thread.start()
    port = server.server_address[1]

    def receive() -> None:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        try:
            connection.request("GET", "/stream")
            response = connection.getresponse()
            if response.status != 200:
                raise RuntimeError(f"Servidor de prueba devolvio HTTP {response.status}.")
            while True:
                boundary = response.fp.readline()
                if not boundary:
                    break
                if not boundary.startswith(b"--frame"):
                    continue
                headers: dict[str, str] = {}
                while True:
                    line = response.fp.readline()
                    if line in (b"\r\n", b"\n", b""):
                        break
                    key, value = line.decode("ascii", "replace").split(":", 1)
                    headers[key.lower()] = value.strip()
                length = int(headers["content-length"])
                payload = response.fp.read(length)
                response.fp.read(2)
                frame_id = int(headers["x-frame-id"])
                scene_index = int(headers["x-scene-index"])
                expected_hash = headers["x-sha256"]
                actual_hash = hashlib.sha256(payload).hexdigest()
                if len(payload) != length:
                    raise RuntimeError(f"JPEG truncado en frame {frame_id}.")
                ring.put(frame_id, payload)
                compressed_queue.put_nowait((frame_id, scene_index, actual_hash, payload))
                if frame_id == 1 or frame_id % max(1, total_frames // 10) == 0:
                    sample_payloads[frame_id] = payload
                with stats_lock:
                    run_stats["received"] += 1
                    run_stats["bytes_received"] += len(payload)
                    run_stats["hash_mismatches"] += int(actual_hash != expected_hash)
                    run_stats["compressed_queue_high"] = max(
                        int(run_stats["compressed_queue_high"]), compressed_queue.qsize()
                    )
        finally:
            connection.close()
            receiver_done.set()

    def decode_frames() -> None:
        while not receiver_done.is_set() or not compressed_queue.empty():
            try:
                frame_id, scene_index, digest, payload = compressed_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            decode_started = time.perf_counter()
            reduced = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_REDUCED_COLOR_4)
            reduced_decode_ms.append((time.perf_counter() - decode_started) * 1000)
            if reduced is None:
                with stats_lock:
                    run_stats["corrupt_jpegs"] += 1
                ring.discard(frame_id)
                compressed_queue.task_done()
                continue
            decoded_queue.put_nowait((frame_id, scene_index, digest, reduced))
            with stats_lock:
                run_stats["decoded_queue_high"] = max(
                    int(run_stats["decoded_queue_high"]), decoded_queue.qsize()
                )
            compressed_queue.task_done()
        decoder_done.set()

    def detect_frames() -> None:
        while not decoder_done.is_set() or not decoded_queue.empty():
            try:
                frame_id, scene_index, digest, reduced = decoded_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            detection_started = time.perf_counter()
            detections = detector.detect(reduced)
            detect_ms.append((time.perf_counter() - detection_started) * 1000)
            scene = scenes[scene_index]
            with stats_lock:
                run_stats["processed"] += 1
                run_stats["detected_faces"] += len(detections)
                run_stats["frames_with_detections"] += int(bool(detections))
                run_stats["expected_faces"] += scene.expected_faces

            selected = bool(detections) and (
                frame_id == 1 or frame_id % max(1, args.evidence_every) == 0
            )
            if selected:
                original = ring.get(frame_id)
                if original is None or hashlib.sha256(original).hexdigest() != digest:
                    with stats_lock:
                        run_stats["evidence_misses"] += 1
                else:
                    persistence_queue.put_nowait(
                        (frame_id, scene.phase, original, reduced.shape[:2], detections)
                    )
                    with stats_lock:
                        run_stats["evidence_enqueued"] += len(detections)
                        run_stats["persistence_queue_high"] = max(
                            int(run_stats["persistence_queue_high"]), persistence_queue.qsize()
                        )
            ring.discard(frame_id)
            decoded_queue.task_done()
        detector_done.set()

    def persist_evidence() -> None:
        while not detector_done.is_set() or not persistence_queue.empty():
            try:
                frame_id, phase, payload, reduced_shape, detections = persistence_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            started = time.perf_counter()
            decode_started = time.perf_counter()
            full = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
            full_decode_ms.append((time.perf_counter() - decode_started) * 1000)
            if full is None:
                with stats_lock:
                    run_stats["persistence_failures"] += len(detections)
                persistence_queue.task_done()
                continue
            sy = full.shape[0] / reduced_shape[0]
            sx = full.shape[1] / reduced_shape[1]
            for index, detection in enumerate(detections):
                x1, y1, x2, y2 = scaled_bbox(detection.bbox, sx, sy)
                margin_x = int(round((x2 - x1) * 0.18))
                margin_y = int(round((y2 - y1) * 0.22))
                x1, y1 = max(0, x1 - margin_x), max(0, y1 - margin_y)
                x2, y2 = min(full.shape[1], x2 + margin_x), min(full.shape[0], y2 + margin_y)
                crop = full[y1:y2, x1:x2]
                ok, encoded = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
                if not ok or crop.size == 0:
                    with stats_lock:
                        run_stats["persistence_failures"] += 1
                    continue
                path = evidence_dir / f"frame_{frame_id:06d}_{phase}_{index:02d}.jpg"
                path.write_bytes(encoded.tobytes())
                evidence_paths.append(path)
                with stats_lock:
                    run_stats["evidence_written"] += 1
            persist_ms.append((time.perf_counter() - started) * 1000)
            persistence_queue.task_done()

    receiver_thread = threading.Thread(target=receive, name="benchmark-receiver", daemon=True)
    decoder_thread = threading.Thread(target=decode_frames, name="benchmark-decoder", daemon=True)
    detector_thread = threading.Thread(target=detect_frames, name="benchmark-detector", daemon=True)
    persistence_thread = threading.Thread(
        target=persist_evidence, name="benchmark-persistence", daemon=True
    )

    station_before = read_station_counters()
    benchmark_started = time.perf_counter()
    persistence_thread.start()
    detector_thread.start()
    decoder_thread.start()
    receiver_thread.start()
    receiver_thread.join(timeout=args.seconds + 45)
    source_finished = time.perf_counter()
    if receiver_thread.is_alive():
        raise TimeoutError("El receptor no termino dentro del margen esperado.")
    decoder_thread.join(timeout=max(120.0, args.seconds * 3))
    detector_thread.join(timeout=max(120.0, args.seconds * 3))
    persistence_thread.join(timeout=max(120.0, args.seconds * 3))
    processing_finished = time.perf_counter()
    station_after = read_station_counters()
    server.shutdown()
    server.server_close()

    if decoder_thread.is_alive() or detector_thread.is_alive() or persistence_thread.is_alive():
        raise TimeoutError("El pipeline no pudo vaciar sus colas.")

    source_elapsed = source_finished - benchmark_started
    total_elapsed = processing_finished - benchmark_started
    metrics["source"] = {
        "frames_planned": total_frames,
        "frames_sent": run_stats["sent"],
        "frames_received": run_stats["received"],
        "elapsed_seconds": round(source_elapsed, 3),
        "ingress_fps": round(int(run_stats["received"]) / max(source_elapsed, 0.001), 2),
        "throughput_mbps": round(
            int(run_stats["bytes_received"]) * 8 / max(source_elapsed, 0.001) / 1_000_000, 2
        ),
        "hash_mismatches": run_stats["hash_mismatches"],
        "server_max_schedule_lateness_ms": round(float(run_stats["server_late_ms_max"]), 2),
    }
    metrics["pipeline"] = {
        "processed_frames": run_stats["processed"],
        "total_elapsed_seconds": round(total_elapsed, 3),
        "effective_fps_including_catchup": round(
            int(run_stats["processed"]) / max(total_elapsed, 0.001), 2
        ),
        "catchup_seconds": round(max(0.0, total_elapsed - source_elapsed), 3),
        "compressed_queue_high_watermark": run_stats["compressed_queue_high"],
        "decoded_queue_high_watermark": run_stats["decoded_queue_high"],
        "ring_high_watermark_frames": ring.high_watermark_frames,
        "ring_high_watermark_mb": round(ring.high_watermark_bytes / 1024**2, 2),
        "corrupt_jpegs": run_stats["corrupt_jpegs"],
        "detected_faces": run_stats["detected_faces"],
        "expected_composited_faces": run_stats["expected_faces"],
        "frames_with_detections": run_stats["frames_with_detections"],
        "reduced_decode_ms_average": round(statistics.mean(reduced_decode_ms), 3),
        "reduced_decode_ms_p95": round(percentile(reduced_decode_ms, 0.95), 3),
        "scrfd_ms_average": round(statistics.mean(detect_ms), 3),
        "scrfd_ms_p95": round(percentile(detect_ms, 0.95), 3),
    }
    metrics["evidence"] = {
        "enqueued_crops": run_stats["evidence_enqueued"],
        "written_crops": run_stats["evidence_written"],
        "misses": run_stats["evidence_misses"],
        "failures": run_stats["persistence_failures"],
        "queue_high_watermark": run_stats["persistence_queue_high"],
        "full_decode_ms_average": round(statistics.mean(full_decode_ms), 3) if full_decode_ms else 0.0,
        "full_decode_ms_p95": round(percentile(full_decode_ms, 0.95), 3),
        "persist_task_ms_average": round(statistics.mean(persist_ms), 3) if persist_ms else 0.0,
        "persist_task_ms_p95": round(percentile(persist_ms, 0.95), 3),
    }
    metrics["live_station_during_test"] = station_counter_delta(
        station_before, station_after, source_elapsed
    )

    comparison_ious: list[float] = []
    full_counts = 0
    matched_counts = 0
    comparison_rows: list[dict] = []
    for frame_id, payload in sorted(sample_payloads.items()):
        full = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
        reduced = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_REDUCED_COLOR_4)
        if full is None or reduced is None:
            continue
        full_detections = [
            item for item in detector.detect(full) if min(item.bbox[2] - item.bbox[0], item.bbox[3] - item.bbox[1]) >= 70
        ]
        reduced_detections = detector.detect(reduced)
        sx, sy = full.shape[1] / reduced.shape[1], full.shape[0] / reduced.shape[0]
        scaled = [scaled_bbox(item.bbox, sx, sy) for item in reduced_detections]
        used: set[int] = set()
        frame_ious: list[float] = []
        for full_detection in full_detections:
            candidates = [
                (iou(full_detection.bbox, candidate), index)
                for index, candidate in enumerate(scaled)
                if index not in used
            ]
            if not candidates:
                continue
            score, index = max(candidates)
            if score >= 0.30:
                used.add(index)
                comparison_ious.append(score)
                frame_ious.append(score)
                matched_counts += 1
        full_counts += len(full_detections)
        comparison_rows.append(
            {
                "frame_id": frame_id,
                "full_count": len(full_detections),
                "reduced_count": len(reduced_detections),
                "matched": len(frame_ious),
                "mean_iou": round(statistics.mean(frame_ious), 4) if frame_ious else 0.0,
            }
        )
    metrics["full_vs_reduced_validation"] = {
        "sample_frames": len(comparison_rows),
        "full_detections": full_counts,
        "matched_detections": matched_counts,
        "recall_vs_full": round(matched_counts / max(full_counts, 1), 4),
        "mean_iou": round(statistics.mean(comparison_ious), 4) if comparison_ious else 0.0,
        "min_iou": round(min(comparison_ious), 4) if comparison_ious else 0.0,
        "frames": comparison_rows,
    }

    sample_scene = cv2.imdecode(
        np.frombuffer(scenes[min(len(scenes) - 1, int(55 * args.scene_fps))].jpeg, dtype=np.uint8),
        cv2.IMREAD_COLOR,
    )
    if sample_scene is not None:
        preview = cv2.resize(sample_scene, (1280, 720), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(output_dir / "synthetic_scene_preview.jpg"), preview)

    if evidence_paths:
        thumbnails = []
        for path in evidence_paths[:24]:
            image = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if image is None:
                continue
            canvas = np.full((180, 150, 3), 245, dtype=np.uint8)
            scale = min(146 / image.shape[1], 176 / image.shape[0])
            resized = cv2.resize(
                image,
                (max(1, int(image.shape[1] * scale)), max(1, int(image.shape[0] * scale))),
                interpolation=cv2.INTER_AREA,
            )
            y = (180 - resized.shape[0]) // 2
            x = (150 - resized.shape[1]) // 2
            canvas[y : y + resized.shape[0], x : x + resized.shape[1]] = resized
            thumbnails.append(canvas)
        if thumbnails:
            while len(thumbnails) % 6:
                thumbnails.append(np.full((180, 150, 3), 245, dtype=np.uint8))
            rows = [np.hstack(thumbnails[index : index + 6]) for index in range(0, len(thumbnails), 6)]
            cv2.imwrite(str(output_dir / "evidence_contact_sheet.jpg"), np.vstack(rows))

    metrics["success_criteria"] = {
        "all_frames_received": run_stats["received"] == total_frames,
        "all_frames_processed": run_stats["processed"] == total_frames,
        "no_hash_mismatch": run_stats["hash_mismatches"] == 0,
        "no_corrupt_jpeg": run_stats["corrupt_jpegs"] == 0,
        "no_evidence_loss": (
            run_stats["evidence_misses"] == 0
            and run_stats["persistence_failures"] == 0
            and run_stats["evidence_written"] == run_stats["evidence_enqueued"]
        ),
        "kept_up_with_30fps": total_elapsed <= args.seconds * 1.05,
        "reduced_recall_at_least_95pct": matched_counts / max(full_counts, 1) >= 0.95,
        "mean_bbox_iou_at_least_0_8": (
            statistics.mean(comparison_ious) >= 0.80 if comparison_ious else False
        ),
    }
    metrics["generated_at"] = datetime.now().astimezone().isoformat()
    metrics["output_dir"] = str(output_dir)

    result_path = output_dir / "result.json"
    result_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(metrics, indent=2, ensure_ascii=False))
    print(f"RESULT_PATH={result_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
