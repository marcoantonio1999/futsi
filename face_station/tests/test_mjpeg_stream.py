from __future__ import annotations

import hashlib
import json
import threading
import time

import cv2
import numpy as np
import pytest

from face_station.app import camera as camera_module
from face_station.app.camera import CameraWorker, CapturedFrame
from face_station.app.mjpeg_stream import (
    MjpegHttpReader,
    MjpegStreamError,
    MultipartMjpegParser,
    OctetStreamJpegParser,
    OctetStreamMjpegParser,
    boundary_from_content_type,
)


def _jpeg(width: int = 320, height: int = 240, value: int = 130) -> tuple[np.ndarray, bytes]:
    image = np.full((height, width, 3), value, dtype=np.uint8)
    cv2.circle(image, (width // 2, height // 2), min(width, height) // 4, (30, 90, 210), -1)
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 94])
    assert ok
    return image, encoded.tobytes()


def _part(boundary: bytes, jpeg: bytes, *, content_length: bool = True) -> bytes:
    headers = b"Content-Type: image/jpeg\r\n"
    if content_length:
        headers += f"Content-Length: {len(jpeg)}\r\n".encode("ascii")
    return b"--" + boundary + b"\r\n" + headers + b"\r\n" + jpeg + b"\r\n"


def test_content_type_accepts_quoted_unquoted_and_prefixed_boundaries():
    assert boundary_from_content_type("multipart/x-mixed-replace; boundary=ffmpeg") == b"ffmpeg"
    assert boundary_from_content_type('Multipart/X-Mixed-Replace; boundary="frame-42"') == b"frame-42"
    assert boundary_from_content_type("multipart/x-mixed-replace;boundary=--camera") == b"camera"
    with pytest.raises(MjpegStreamError):
        boundary_from_content_type("image/jpeg")


def test_parser_preserves_exact_jpeg_under_one_byte_fragmentation_and_content_length():
    _, first = _jpeg(value=70)
    _, second = _jpeg(value=180)
    wire = _part(b"ffmpeg", first) + _part(b"ffmpeg", second) + b"--ffmpeg--\r\n"
    parser = MultipartMjpegParser(b"ffmpeg")
    parsed = []
    for value in wire:
        parsed.extend(parser.feed(bytes((value,))))
    parser.finish()

    assert parsed == [first, second]
    assert hashlib.sha256(parsed[0]).digest() == hashlib.sha256(first).digest()
    assert hashlib.sha256(parsed[1]).digest() == hashlib.sha256(second).digest()


def test_parser_without_content_length_ignores_non_delimiter_boundary_bytes_in_jpeg():
    jpeg = b"\xff\xd8prefix--frame\r\n--frame-not-a-delimiter-suffix\x00tail\xff\xd9"
    wire = _part(b"frame", jpeg, content_length=False) + b"--frame--\r\n"
    parser = MultipartMjpegParser(b"frame")

    parsed = []
    for offset in range(0, len(wire), 7):
        parsed.extend(parser.feed(wire[offset : offset + 7]))
    parser.finish()

    assert parsed == [jpeg]


def test_parser_rejects_conflicting_length_truncation_and_limits():
    _, jpeg = _jpeg(64, 48)
    conflicting = (
        b"--b\r\nContent-Type: image/jpeg\r\n"
        + f"Content-Length: {len(jpeg)}\r\n".encode()
        + f"Content-Length: {len(jpeg) + 1}\r\n\r\n".encode()
    )
    with pytest.raises(MjpegStreamError, match="contradictorias"):
        MultipartMjpegParser(b"b").feed(conflicting)

    parser = MultipartMjpegParser(b"b")
    parser.feed(_part(b"b", jpeg)[:-15])
    with pytest.raises(MjpegStreamError, match="incompleta"):
        parser.finish()

    too_many = b"--b\r\n" + b"X-A: b\r\n" * 65 + b"\r\n"
    with pytest.raises(MjpegStreamError, match="demasiadas"):
        MultipartMjpegParser(b"b").feed(too_many)

    oversized = MultipartMjpegParser(b"b", max_jpeg_bytes=32)
    with pytest.raises(MjpegStreamError, match="limite"):
        oversized.feed(
            b"--b\r\nContent-Type: image/jpeg\r\nContent-Length: 33\r\n\r\n"
        )


def _jpeg_with_comment(jpeg: bytes, payload: bytes) -> bytes:
    assert jpeg.startswith(b"\xff\xd8")
    length = len(payload) + 2
    assert length <= 0xFFFF
    return jpeg[:2] + b"\xff\xfe" + length.to_bytes(2, "big") + payload + jpeg[2:]


def test_octet_stream_parser_preserves_exact_jpegs_with_fragmentation_and_multiple_per_chunk():
    _, first = _jpeg(value=42)
    _, second = _jpeg(value=211)
    parser = OctetStreamJpegParser()

    parsed = []
    wire = b"\r\n" + first + second + b"\n"
    for value in wire:
        parsed.extend(parser.feed(bytes((value,))))
    parser.finish()

    assert parsed == [first, second]
    assert [hashlib.sha256(frame).digest() for frame in parsed] == [
        hashlib.sha256(first).digest(),
        hashlib.sha256(second).digest(),
    ]
    assert parser.frames_parsed == 2


def test_octet_stream_parser_does_not_split_on_soi_or_eoi_inside_length_delimited_segment():
    _, base = _jpeg(80, 60)
    payload = b"metadata-before\xff\xd9middle\xff\xd8metadata-after"
    framed = _jpeg_with_comment(base, payload)
    parser = OctetStreamJpegParser()

    parsed = []
    for offset in range(0, len(framed), 11):
        parsed.extend(parser.feed(framed[offset : offset + 11]))
    parser.finish()

    assert parsed == [framed]
    assert hashlib.sha256(parsed[0]).digest() == hashlib.sha256(framed).digest()


def test_octet_stream_parser_rejects_truncation_oversize_garbage_and_nested_soi():
    _, jpeg = _jpeg(64, 48)

    truncated = OctetStreamJpegParser()
    assert truncated.feed(jpeg[:-1]) == []
    with pytest.raises(MjpegStreamError, match="incompleta"):
        truncated.finish()

    oversized = OctetStreamJpegParser(max_jpeg_bytes=32)
    with pytest.raises(MjpegStreamError, match="excede"):
        oversized.feed(jpeg)

    with pytest.raises(MjpegStreamError, match="ambiguos"):
        OctetStreamJpegParser().feed(b"garbage\xff\xd8\xff\xd9")

    # A nested SOI outside a length-delimited segment cannot be safely used to
    # resynchronize: fail the connection instead of emitting a spliced frame.
    with pytest.raises(MjpegStreamError, match="inicio de imagen ambiguo"):
        OctetStreamJpegParser().feed(b"\xff\xd8\xff\xd8\xff\xd9")


def test_octet_stream_sniffer_delegates_boundary_body_byte_by_byte_without_http_boundary():
    _, first = _jpeg(96, 72, value=31)
    _, second = _jpeg(96, 72, value=219)
    wire = (
        b"\r\n\t"
        + _part(b"ffmpeg", first)
        + _part(b"ffmpeg", second)
        + b"--ffmpeg--\r\n"
    )
    parser = OctetStreamMjpegParser()

    parsed = []
    for value in wire:
        parsed.extend(parser.feed(bytes((value,))))
    parser.finish()

    assert parsed == [first, second]
    assert [hashlib.sha256(frame).digest() for frame in parsed] == [
        hashlib.sha256(first).digest(),
        hashlib.sha256(second).digest(),
    ]
    assert parser.frames_parsed == 2


def test_octet_stream_sniffer_rejects_unknown_invalid_and_ambiguous_prefixes():
    with pytest.raises(MjpegStreamError, match="prefijo desconocido"):
        OctetStreamMjpegParser().feed(b"not-an-mjpeg-stream")
    with pytest.raises(MjpegStreamError, match="multipart invalido"):
        OctetStreamMjpegParser().feed(b"-not-a-boundary")
    with pytest.raises(MjpegStreamError, match="no es valido"):
        OctetStreamMjpegParser().feed(b"--\r\n")
    with pytest.raises(MjpegStreamError, match="ASCII valido"):
        OctetStreamMjpegParser().feed(b"--bad boundary\r\n")
    with pytest.raises(MjpegStreamError, match="ASCII valido"):
        OctetStreamMjpegParser().feed(b"--nonascii-\xff\r\n")
    with pytest.raises(MjpegStreamError, match="excede"):
        OctetStreamMjpegParser().feed(b"--" + (b"a" * 202))

    empty = OctetStreamMjpegParser()
    empty.feed(b" \r\n")
    with pytest.raises(MjpegStreamError, match="antes de identificar"):
        empty.finish()
    partial = OctetStreamMjpegParser()
    partial.feed(b"--ffmpeg")
    with pytest.raises(MjpegStreamError, match="antes de identificar"):
        partial.finish()


class _FakeResponse:
    def __init__(self, chunks=(), *, status=200, content_type="multipart/x-mixed-replace; boundary=cam"):
        self.status_code = status
        self.headers = {"Content-Type": content_type}
        self._chunks = tuple(chunks)
        self.closed = threading.Event()
        self.block = False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("HTTP failure")

    def iter_content(self, chunk_size):
        assert chunk_size > 0
        if self.block:
            self.closed.wait(5)
            return
        yield from self._chunks

    def close(self):
        self.closed.set()


class _FakeSession:
    def __init__(self, response):
        self.response = response
        self.called = threading.Event()
        self.kwargs = None

    def get(self, _source, **kwargs):
        self.kwargs = kwargs
        self.called.set()
        return self.response

    def close(self):
        return None


def test_http_reader_disables_redirects_identity_encoding_and_validates_mime():
    _, jpeg = _jpeg(64, 48)
    response = _FakeResponse([_part(b"cam", jpeg), b"--cam--\r\n"])
    session = _FakeSession(response)
    frames = list(MjpegHttpReader("http://user:secret@camera/stream", threading.Event(), session=session).iter_frames())

    assert frames == [jpeg]
    assert session.kwargs["allow_redirects"] is False
    assert session.kwargs["stream"] is True
    assert "application/octet-stream" in session.kwargs["headers"]["Accept"]
    assert session.kwargs["headers"]["Accept-Encoding"] == "identity"

    redirect = _FakeResponse(status=302)
    with pytest.raises(MjpegStreamError, match="redirigir"):
        list(MjpegHttpReader("http://camera/stream", threading.Event(), session=_FakeSession(redirect)).iter_frames())
    invalid_mime = _FakeResponse(content_type="text/html")
    with pytest.raises(MjpegStreamError, match="no es un stream"):
        list(MjpegHttpReader("http://camera/stream", threading.Event(), session=_FakeSession(invalid_mime)).iter_frames())


@pytest.mark.parametrize(
    "content_type",
    [
        "application/octet-stream",
        "Application/Octet-Stream; charset=binary",
    ],
)
def test_http_reader_accepts_raw_octet_stream_and_preserves_frame_hashes(content_type):
    _, first = _jpeg(96, 72, value=25)
    _, second = _jpeg(96, 72, value=225)
    response = _FakeResponse(
        [first[:1], first[1:37], first[37:] + second, b"\r\n"],
        content_type=content_type,
    )
    frames = list(
        MjpegHttpReader(
            "http://camera/stream",
            threading.Event(),
            session=_FakeSession(response),
        ).iter_frames()
    )

    assert frames == [first, second]
    assert [hashlib.sha256(frame).hexdigest() for frame in frames] == [
        hashlib.sha256(first).hexdigest(),
        hashlib.sha256(second).hexdigest(),
    ]


def test_http_reader_sniffs_multipart_body_when_octet_stream_omits_boundary_parameter():
    _, first = _jpeg(96, 72, value=48)
    _, second = _jpeg(96, 72, value=196)
    wire = _part(b"ffmpeg", first) + _part(b"ffmpeg", second) + b"--ffmpeg--\r\n"
    response = _FakeResponse(
        [bytes((value,)) for value in wire],
        content_type="application/octet-stream",
    )

    frames = list(
        MjpegHttpReader(
            "http://camera/stream",
            threading.Event(),
            session=_FakeSession(response),
        ).iter_frames()
    )

    assert frames == [first, second]
    assert [hashlib.sha256(frame).hexdigest() for frame in frames] == [
        hashlib.sha256(first).hexdigest(),
        hashlib.sha256(second).hexdigest(),
    ]


def test_http_reader_rejects_truncated_octet_stream_at_eof():
    _, jpeg = _jpeg(64, 48)
    response = _FakeResponse(
        [jpeg[:-2]],
        content_type="application/octet-stream",
    )
    with pytest.raises(MjpegStreamError, match="incompleta"):
        list(
            MjpegHttpReader(
                "http://camera/stream",
                threading.Event(),
                session=_FakeSession(response),
            ).iter_frames()
        )


def test_http_reader_close_unblocks_a_blocking_response():
    response = _FakeResponse()
    response.block = True
    session = _FakeSession(response)
    reader = MjpegHttpReader("http://camera/stream", threading.Event(), session=session)
    errors = []

    def consume():
        try:
            list(reader.iter_frames())
        except Exception as exc:  # pragma: no cover - diagnostic guard
            errors.append(exc)

    thread = threading.Thread(target=consume)
    thread.start()
    assert session.called.wait(1)
    reader.close()
    thread.join(1)

    assert not thread.is_alive()
    assert response.closed.is_set()
    assert errors == []


def test_internal_http_session_does_not_inherit_system_proxies():
    reader = MjpegHttpReader("http://camera/stream", threading.Event())
    try:
        assert reader._session.trust_env is False
    finally:
        reader.close()


def test_captured_frame_decodes_original_once(monkeypatch):
    original, encoded = _jpeg(400, 240)
    reduced = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_REDUCED_COLOR_4)
    packet = CapturedFrame(7, time.time(), reduced, 4, encoded_original=encoded)
    real_imdecode = cv2.imdecode
    calls = []

    def counted_imdecode(*args, **kwargs):
        calls.append(1)
        return real_imdecode(*args, **kwargs)

    monkeypatch.setattr(camera_module.cv2, "imdecode", counted_imdecode)
    decoded = packet.decode_original()

    assert packet.decode_original() is decoded
    assert decoded.shape == original.shape
    assert len(calls) == 1


def test_async_camera_uses_large_queue_reduced_decode_exact_original_and_pause(monkeypatch):
    original, encoded = _jpeg(400, 240)

    class FakeReader:
        def __init__(self, _source, stop_event):
            self.stop_event = stop_event
            self.closed = False

        def iter_frames(self):
            while not self.stop_event.wait(0.003):
                yield encoded

        def close(self):
            self.closed = True

    monkeypatch.setattr(camera_module, "MjpegHttpReader", FakeReader)
    worker = CameraWorker(
        "http://admin:do-not-expose@camera/stream",
        queue_size=3,
        async_mjpeg=True,
        mjpeg_decode_reduction=4,
    )
    assert worker._frames.maxlen >= 64
    worker.start()
    try:
        deadline = time.monotonic() + 2
        packet = None
        while time.monotonic() < deadline and packet is None:
            packet = worker.next_packet()
            if packet is None:
                worker.wait_for_frame(0.02)
        assert packet is not None
        assert packet.decode_reduction == 4
        assert packet.detection_frame.shape[:2] == (60, 100)
        assert packet.encoded_original == encoded
        assert packet.decode_original().shape == original.shape
        assert packet.decode_original().shape == original.shape
        decoded_metrics = worker.status_metrics
        assert decoded_metrics["detection_resolution"] == {"width": 100, "height": 60}
        assert decoded_metrics["receiver_alive"] is True
        assert decoded_metrics["decoder_alive"] is True
        assert "full_decodes" not in decoded_metrics
        assert "last_original_resolution" not in decoded_metrics

        worker.set_processing_enabled(False)
        before = worker.status_metrics["frames_drained_while_paused"]
        time.sleep(0.04)
        paused = worker.status_metrics
        assert worker.next_packet() is None
        assert paused["frames_drained_while_paused"] > before
        assert paused["compressed_queue_depth"] == 0
        assert paused["packet_queue_depth"] == 0
        assert paused["processing_enabled"] is False
        assert "http" not in json.dumps(paused).lower()
        assert "secret" not in json.dumps(paused).lower()

        worker.set_processing_enabled(True)
        assert worker.wait_for_frame(1)
        assert worker.next_packet() is not None
    finally:
        worker.stop()

    metrics = worker.status_metrics
    assert metrics["pipeline_mode"] == "async_mjpeg"
    assert metrics["decoded_frames"] > 0
    assert metrics["compressed_frames_dropped"] == 0
    assert metrics["packet_frames_dropped"] == 0
    assert metrics["receiver_alive"] is False
    assert metrics["decoder_alive"] is False


def test_non_http_sources_never_enable_async_mjpeg():
    rtsp = CameraWorker("rtsp://camera/live", async_mjpeg=True)
    local = CameraWorker("0", async_mjpeg=True)
    assert rtsp.async_mjpeg is False
    assert local.async_mjpeg is False
    assert rtsp.status_metrics["pipeline_mode"] == "opencv"


def test_async_camera_reconnects_after_malformed_multipart(monkeypatch):
    _, encoded = _jpeg(160, 120)
    attempts = []

    class FlakyReader:
        def __init__(self, _source, stop_event):
            self.stop_event = stop_event
            attempts.append(self)

        def iter_frames(self):
            if len(attempts) == 1:
                raise MjpegStreamError("JPEG truncado")
            while not self.stop_event.wait(0.01):
                yield encoded

        def close(self):
            return None

    monkeypatch.setattr(camera_module, "MjpegHttpReader", FlakyReader)
    worker = CameraWorker(
        "http://camera/stream",
        async_mjpeg=True,
        primary_recovery_frames=1,
    )
    worker.start()
    try:
        deadline = time.monotonic() + 2.5
        packet = None
        while time.monotonic() < deadline and packet is None:
            packet = worker.next_packet()
            if packet is None:
                worker.wait_for_frame(0.03)
        assert packet is not None
        assert len(attempts) >= 2
        assert worker.connected is True
        assert worker.status_metrics["jpeg_errors"] == 1
    finally:
        worker.stop()


def test_decoder_survives_an_opencv_error_from_one_corrupt_frame(monkeypatch):
    _, encoded = _jpeg(160, 120)

    class FakeReader:
        def __init__(self, _source, stop_event):
            self.stop_event = stop_event

        def iter_frames(self):
            while not self.stop_event.wait(0.004):
                yield encoded

        def close(self):
            return None

    real_imdecode = cv2.imdecode
    calls = 0

    def fail_once(payload, mode):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise cv2.error("JPEG corrupto de prueba")
        return real_imdecode(payload, mode)

    monkeypatch.setattr(camera_module, "MjpegHttpReader", FakeReader)
    monkeypatch.setattr(camera_module.cv2, "imdecode", fail_once)
    worker = CameraWorker("http://camera/stream", async_mjpeg=True)
    worker.start()
    try:
        deadline = time.monotonic() + 2
        packet = None
        while time.monotonic() < deadline and packet is None:
            packet = worker.next_packet()
            if packet is None:
                worker.wait_for_frame(0.02)
        assert packet is not None
        metrics = worker.status_metrics
        assert metrics["decode_errors"] == 1
        assert metrics["decoded_frames"] >= 1
        assert metrics["decoder_alive"] is True
    finally:
        worker.stop()


def test_stop_during_connect_fails_closed_and_prevents_overlapping_restart(monkeypatch):
    connect_started = threading.Event()
    release_connect = threading.Event()

    class ConnectingReader:
        def __init__(self, _source, stop_event):
            self.stop_event = stop_event

        def iter_frames(self):
            connect_started.set()
            release_connect.wait(2)
            if False:  # Keep this a generator while simulating Session.get.
                yield b""

        def close(self):
            # requests.Session.close() cannot guarantee cancellation while
            # DNS/connect is still in progress.
            return None

    monkeypatch.setattr(camera_module, "MjpegHttpReader", ConnectingReader)
    worker = CameraWorker("http://camera/stream", async_mjpeg=True)
    worker.SHUTDOWN_TIMEOUT_SECONDS = 0.1
    worker.start()
    assert connect_started.wait(1)

    try:
        with pytest.raises(RuntimeError, match="receptor"):
            worker.stop()
        assert worker.status_metrics["receiver_alive"] is True
        with pytest.raises(RuntimeError, match="aun se esta deteniendo"):
            worker.start()
    finally:
        release_connect.set()
        if worker._thread:
            worker._thread.join(timeout=2)
        if worker._decoder_thread:
            worker._decoder_thread.join(timeout=2)
        worker.stop()

    assert worker.status_metrics["receiver_alive"] is False
    assert worker.status_metrics["decoder_alive"] is False


def test_opencv_stop_never_releases_capture_while_read_is_active(monkeypatch):
    read_started = threading.Event()
    release_read = threading.Event()

    class GuardedCapture:
        def __init__(self):
            self.in_read = False
            self.released = False
            self.concurrent_release = False

        def isOpened(self):
            return not self.released

        def set(self, *_args):
            return True

        def get(self, *_args):
            return 0

        def read(self):
            self.in_read = True
            read_started.set()
            release_read.wait(2)
            self.in_read = False
            return False, None

        def release(self):
            if self.in_read:
                self.concurrent_release = True
            self.released = True

    capture = GuardedCapture()
    worker = CameraWorker("rtsp://camera/live", failover_after=1)
    monkeypatch.setattr(worker, "_open", lambda _source=None: capture)
    worker.start()
    assert read_started.wait(1)
    stop_errors = []

    def stop_worker():
        try:
            worker.stop()
        except Exception as exc:  # pragma: no cover - asserted below
            stop_errors.append(exc)

    stopper = threading.Thread(target=stop_worker)
    stopper.start()
    time.sleep(0.05)

    assert stopper.is_alive()
    assert capture.released is False
    assert capture.concurrent_release is False

    release_read.set()
    stopper.join(2)

    assert not stopper.is_alive()
    assert stop_errors == []
    assert capture.released is True
    assert capture.concurrent_release is False
    assert worker.status_metrics["receiver_alive"] is False
