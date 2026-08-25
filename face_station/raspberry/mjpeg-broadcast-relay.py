#!/usr/bin/env python3
"""Broadcast an MJPEG byte stream to multiple HTTP clients without re-encoding."""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FrameStore:
    def __init__(self, max_fps: float = 0.0) -> None:
        self.condition = threading.Condition()
        self.frame = b""
        self.sequence = 0
        self.started_at = time.monotonic()
        self.captured_at = 0.0
        self.minimum_interval = 1.0 / max_fps if max_fps > 0 else 0.0
        self.next_publish_at = 0.0
        self.timestamps: deque[float] = deque(maxlen=120)

    def publish(self, frame: bytes) -> None:
        now = time.monotonic()
        with self.condition:
            if self.minimum_interval:
                if not self.next_publish_at:
                    self.next_publish_at = now
                if now < self.next_publish_at:
                    return
                while self.next_publish_at <= now:
                    self.next_publish_at += self.minimum_interval
            self.frame = frame
            self.sequence += 1
            self.captured_at = now
            self.timestamps.append(now)
            self.condition.notify_all()

    def wait_after(self, sequence: int, timeout: float = 5.0) -> tuple[int, bytes]:
        with self.condition:
            self.condition.wait_for(lambda: self.sequence > sequence, timeout=timeout)
            return self.sequence, self.frame

    def state(self) -> dict[str, float | int | bool]:
        with self.condition:
            timestamps = tuple(self.timestamps)
            fps = 0.0
            if len(timestamps) > 1:
                elapsed = timestamps[-1] - timestamps[0]
                if elapsed > 0:
                    fps = (len(timestamps) - 1) / elapsed
            return {
                "online": bool(self.frame) and time.monotonic() - self.captured_at < 3.0,
                "sequence": self.sequence,
                "frame_bytes": len(self.frame),
                "captured_fps": round(fps, 2),
                "uptime_seconds": round(time.monotonic() - self.started_at, 1),
            }


def read_jpegs(fifo_path: str, store: FrameStore) -> None:
    buffer = bytearray()
    while True:
        with open(fifo_path, "rb", buffering=0) as source:
            while True:
                chunk = os.read(source.fileno(), 1024 * 1024)
                if not chunk:
                    break
                buffer.extend(chunk)
                while True:
                    start = buffer.find(b"\xff\xd8")
                    if start < 0:
                        if len(buffer) > 1:
                            del buffer[:-1]
                        break
                    if start:
                        del buffer[:start]
                    end = buffer.find(b"\xff\xd9", 2)
                    if end < 0:
                        break
                    frame_end = end + 2
                    store.publish(bytes(buffer[:frame_end]))
                    del buffer[:frame_end]


def make_handler(store: FrameStore) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            if self.path in ("/", "/state"):
                payload = json.dumps(store.state()).encode()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)
                return

            if self.path == "/snapshot":
                _, frame = store.wait_after(-1)
                if not frame:
                    self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "No frame available")
                    return
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(frame)
                return

            if self.path != "/stream":
                self.send_error(HTTPStatus.NOT_FOUND)
                return

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            sequence = -1
            try:
                while True:
                    next_sequence, frame = store.wait_after(sequence)
                    if next_sequence == sequence or not frame:
                        continue
                    sequence = next_sequence
                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode())
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                return

        def log_message(self, format: str, *args: object) -> None:
            return

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fifo", required=True)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument(
        "--max-fps",
        type=float,
        default=0.0,
        help="Maximum FPS delivered to clients; zero keeps every captured frame.",
    )
    args = parser.parse_args()

    store = FrameStore(max_fps=max(0.0, args.max_fps))
    threading.Thread(target=read_jpegs, args=(args.fifo, store), daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(store))
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
