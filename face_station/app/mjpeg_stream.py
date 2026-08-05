from __future__ import annotations

from email.message import Message
from threading import Event, Lock
from typing import Iterator

import requests


MAX_HEADER_BYTES = 16 * 1024
MAX_JPEG_BYTES = 32 * 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024


class MjpegStreamError(RuntimeError):
    """Raised when an HTTP MJPEG stream is malformed or becomes unusable."""


def boundary_from_content_type(content_type: str) -> bytes:
    """Return the normalized multipart boundary from an HTTP Content-Type."""

    message = Message()
    message["content-type"] = str(content_type or "")
    if message.get_content_type().lower() != "multipart/x-mixed-replace":
        raise MjpegStreamError("La respuesta HTTP no es un stream MJPEG multipart.")
    boundary = message.get_param("boundary", header="content-type")
    if not boundary:
        raise MjpegStreamError("El stream MJPEG no declaro un boundary.")
    try:
        normalized = str(boundary).strip().encode("ascii")
    except UnicodeEncodeError as exc:
        raise MjpegStreamError("El boundary MJPEG no es ASCII.") from exc
    # A few camera servers incorrectly include the two MIME marker dashes in
    # the parameter. On the wire those dashes are always present exactly once.
    if normalized.startswith(b"--"):
        normalized = normalized[2:]
    if not normalized or len(normalized) > 200 or any(value in normalized for value in (b"\r", b"\n")):
        raise MjpegStreamError("El boundary MJPEG no es valido.")
    return normalized


class MultipartMjpegParser:
    """Incrementally parses multipart MJPEG without changing JPEG payloads.

    ``feed`` accepts arbitrary network fragmentation and returns the exact JPEG
    byte strings carried by completed MIME parts. Content-Length is preferred;
    streams without it are handled by scanning for the next MIME boundary.
    """

    def __init__(
        self,
        boundary: bytes | str,
        *,
        max_header_bytes: int = MAX_HEADER_BYTES,
        max_jpeg_bytes: int = MAX_JPEG_BYTES,
    ) -> None:
        if isinstance(boundary, str):
            try:
                boundary = boundary.encode("ascii")
            except UnicodeEncodeError as exc:
                raise MjpegStreamError("El boundary MJPEG no es ASCII.") from exc
        boundary = bytes(boundary).strip()
        if boundary.startswith(b"--"):
            boundary = boundary[2:]
        if not boundary or len(boundary) > 200 or b"\r" in boundary or b"\n" in boundary:
            raise MjpegStreamError("El boundary MJPEG no es valido.")
        self.boundary = boundary
        self.delimiter = b"--" + boundary
        self.max_header_bytes = max(256, int(max_header_bytes))
        self.max_jpeg_bytes = max(4, int(max_jpeg_bytes))
        self._buffer = bytearray()
        self._state = "boundary"
        self._content_length: int | None = None
        self._closed = False
        self._parts_started = 0
        self.frames_parsed = 0

    @property
    def pending_bytes(self) -> int:
        return len(self._buffer)

    def feed(self, chunk: bytes | bytearray | memoryview) -> list[bytes]:
        if self._closed:
            if chunk and bytes(chunk).strip(b"\r\n"):
                raise MjpegStreamError("El stream MJPEG envio datos despues del cierre multipart.")
            return []
        if chunk:
            self._buffer.extend(chunk)
        output: list[bytes] = []
        while True:
            if self._state == "boundary":
                if not self._consume_boundary():
                    break
            elif self._state == "headers":
                if not self._consume_headers():
                    break
            elif self._state == "body_length":
                frame = self._consume_length_body()
                if frame is None:
                    break
                output.append(frame)
            elif self._state == "body_scan":
                frame = self._consume_scanned_body()
                if frame is None:
                    break
                output.append(frame)
            else:  # pragma: no cover - defensive invariant
                raise AssertionError(f"Unknown MJPEG parser state: {self._state}")
        self.frames_parsed += len(output)
        return output

    def finish(self) -> None:
        """Validate EOF; incomplete parts must reconnect instead of leaking data."""

        if self._closed:
            return
        if self._state == "boundary" and not bytes(self._buffer).strip(b"\r\n"):
            return
        raise MjpegStreamError("El stream MJPEG termino con una imagen incompleta.")

    def _consume_boundary(self) -> bool:
        data = bytes(self._buffer)
        index = self._find_boundary_line(data)
        if index < 0:
            # Preamble is legal, but it is bounded so a broken endpoint cannot
            # make this parser retain unbounded data.
            keep = len(self.delimiter) + 4
            if len(self._buffer) > self.max_header_bytes:
                del self._buffer[:-keep]
            return False
        if index:
            if self._parts_started and bytes(self._buffer[:index]).strip(b"\r\n"):
                raise MjpegStreamError("Hay bytes ambiguos entre partes MJPEG.")
            del self._buffer[:index]
        required = len(self.delimiter) + 2
        if len(self._buffer) < required:
            return False
        suffix = bytes(self._buffer[len(self.delimiter) :])
        if suffix.startswith(b"--"):
            del self._buffer[: len(self.delimiter) + 2]
            self._closed = True
            return False
        if suffix.startswith(b"\r\n"):
            del self._buffer[: len(self.delimiter) + 2]
        elif suffix.startswith(b"\n"):
            del self._buffer[: len(self.delimiter) + 1]
        elif len(suffix) < 2:
            return False
        else:
            raise MjpegStreamError("El boundary MJPEG tiene un terminador invalido.")
        self._state = "headers"
        self._parts_started += 1
        return True

    def _consume_headers(self) -> bool:
        data = bytes(self._buffer)
        marker = b"\r\n\r\n"
        end = data.find(marker)
        marker_size = len(marker)
        if end < 0:
            marker = b"\n\n"
            end = data.find(marker)
            marker_size = len(marker)
        if end < 0:
            if len(self._buffer) > self.max_header_bytes:
                raise MjpegStreamError("Los headers de una parte MJPEG exceden 16 KiB.")
            return False
        if end > self.max_header_bytes:
            raise MjpegStreamError("Los headers de una parte MJPEG exceden 16 KiB.")
        header_block = bytes(self._buffer[:end])
        del self._buffer[: end + marker_size]
        headers: dict[str, list[str]] = {}
        header_lines = [
            raw_line
            for raw_line in header_block.replace(b"\r\n", b"\n").split(b"\n")
            if raw_line
        ]
        if len(header_lines) > 64:
            raise MjpegStreamError("La parte MJPEG tiene demasiadas cabeceras.")
        for raw_line in header_lines:
            if b":" not in raw_line:
                raise MjpegStreamError("Una cabecera MJPEG no es valida.")
            raw_name, raw_value = raw_line.split(b":", 1)
            try:
                name = raw_name.decode("ascii").strip().lower()
                value = raw_value.decode("iso-8859-1").strip()
            except UnicodeDecodeError as exc:
                raise MjpegStreamError("Una cabecera MJPEG no se pudo interpretar.") from exc
            if not name:
                raise MjpegStreamError("Una cabecera MJPEG no es valida.")
            headers.setdefault(name, []).append(value)

        content_types = headers.get("content-type", [])
        if content_types and any(not value.lower().startswith("image/jpeg") for value in content_types):
            raise MjpegStreamError("La parte multipart no contiene una imagen JPEG.")
        lengths = headers.get("content-length", [])
        if lengths:
            if len(set(lengths)) != 1:
                raise MjpegStreamError("La parte MJPEG declara longitudes contradictorias.")
            try:
                length = int(lengths[0], 10)
            except (TypeError, ValueError) as exc:
                raise MjpegStreamError("Content-Length MJPEG no es numerico.") from exc
            if length < 4 or length > self.max_jpeg_bytes:
                raise MjpegStreamError("Content-Length MJPEG esta fuera del limite permitido.")
            self._content_length = length
            self._state = "body_length"
        else:
            self._content_length = None
            self._state = "body_scan"
        return True

    def _consume_length_body(self) -> bytes | None:
        assert self._content_length is not None
        if len(self._buffer) < self._content_length:
            return None
        frame = bytes(self._buffer[: self._content_length])
        del self._buffer[: self._content_length]
        self._validate_jpeg(frame)
        self._content_length = None
        self._state = "boundary"
        return frame

    def _consume_scanned_body(self) -> bytes | None:
        data = bytes(self._buffer)
        search_at = 0
        while True:
            crlf_index = data.find(b"\r\n" + self.delimiter, search_at)
            lf_index = data.find(b"\n" + self.delimiter, search_at)
            candidates = [value for value in (crlf_index, lf_index) if value >= 0]
            if not candidates:
                if len(self._buffer) > self.max_jpeg_bytes + len(self.delimiter) + 4:
                    raise MjpegStreamError("Una imagen MJPEG excede 32 MiB.")
                return None
            index = min(candidates)
            prefix_size = 2 if data[index : index + 2] == b"\r\n" else 1
            boundary_start = index + prefix_size
            after_start = boundary_start + len(self.delimiter)
            if len(data) < after_start + 1:
                return None
            suffix = data[after_start:]
            if not (suffix.startswith(b"\r\n") or suffix.startswith(b"\n") or suffix.startswith(b"--")):
                search_at = boundary_start + len(self.delimiter)
                continue
            frame = data[:index]
            # A boundary-like byte sequence inside JPEG data is ambiguous and
            # violates multipart framing. Reconnect instead of returning a
            # potentially spliced image as evidence.
            self._validate_jpeg(frame)
            del self._buffer[:boundary_start]
            self._state = "boundary"
            return frame

    def _find_boundary_line(self, data: bytes) -> int:
        index = data.find(self.delimiter)
        while index >= 0:
            if index == 0 or data[index - 1 : index] == b"\n":
                return index
            index = data.find(self.delimiter, index + 1)
        return -1

    def _validate_jpeg(self, frame: bytes) -> None:
        if len(frame) < 4 or len(frame) > self.max_jpeg_bytes:
            raise MjpegStreamError("La imagen MJPEG esta fuera del limite permitido.")
        if not frame.startswith(b"\xff\xd8") or not frame.endswith(b"\xff\xd9"):
            raise MjpegStreamError("La parte MJPEG no contiene un JPEG completo.")


class MjpegHttpReader:
    """Requests-based streaming reader whose active socket can be closed."""

    def __init__(
        self,
        source: str,
        stop_event: Event,
        *,
        timeout: tuple[float, float] = (5.0, 5.0),
        session: requests.Session | None = None,
    ) -> None:
        self._source = str(source)
        self._stop = stop_event
        self._timeout = timeout
        self._owns_session = session is None
        self._session = session or requests.Session()
        if self._owns_session:
            # Camera endpoints are LAN/Tailscale resources. Inheriting
            # HTTP_PROXY/HTTPS_PROXY could disclose an authenticated stream URL
            # to an unrelated system proxy and can also make local reconnects
            # depend on external network state.
            self._session.trust_env = False
        self._response = None
        self._lock = Lock()

    def close(self) -> None:
        with self._lock:
            response = self._response
            self._response = None
        if response is not None:
            response.close()
        if self._owns_session:
            self._session.close()

    def iter_frames(self) -> Iterator[bytes]:
        response = None
        try:
            response = self._session.get(
                self._source,
                stream=True,
                timeout=self._timeout,
                allow_redirects=False,
                headers={
                    "Accept": "multipart/x-mixed-replace,image/jpeg",
                    "Accept-Encoding": "identity",
                    "Cache-Control": "no-cache",
                },
            )
            with self._lock:
                self._response = response
            if 300 <= int(response.status_code) < 400:
                raise MjpegStreamError("El endpoint MJPEG intento redirigir la conexion.")
            response.raise_for_status()
            content_encoding = str(response.headers.get("Content-Encoding", "identity")).lower()
            if content_encoding not in ("", "identity"):
                raise MjpegStreamError("El endpoint MJPEG intento comprimir el multipart HTTP.")
            boundary = boundary_from_content_type(response.headers.get("Content-Type", ""))
            parser = MultipartMjpegParser(boundary)
            for chunk in response.iter_content(chunk_size=READ_CHUNK_BYTES):
                if self._stop.is_set():
                    return
                if not chunk:
                    continue
                yield from parser.feed(chunk)
            if not self._stop.is_set():
                parser.finish()
        finally:
            with self._lock:
                if self._response is response:
                    self._response = None
            if response is not None:
                response.close()
            if self._owns_session:
                self._session.close()
