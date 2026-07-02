from __future__ import annotations

import mimetypes
import re
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}
VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/x-m4v",
    "application/octet-stream",
}
PDF_EXTENSIONS = {".pdf"}
XML_EXTENSIONS = {".xml"}
EXCEL_EXTENSIONS = {".xlsx"}
EXCEL_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
}


class FileSecurityError(Exception):
    def __init__(self, detail: str, status_code: int = status.HTTP_404_NOT_FOUND):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def setting_int(name: str, default: int) -> int:
    return int(getattr(settings, name, default))


def validate_job_id(value: str) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"[a-fA-F0-9]{32}", text):
        raise FileSecurityError("Identificador de trabajo invalido.")
    return text


def validate_storage_reference(bucket: str, object_path: str, allowed_extensions: set[str]) -> tuple[str, str]:
    clean_bucket = str(bucket or "").strip()
    clean_path = str(object_path or "").replace("\\", "/").lstrip("/")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,62}", clean_bucket):
        raise FileSecurityError("Bucket invalido.")
    path = Path(clean_path)
    if not clean_path or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise FileSecurityError("Ruta de objeto invalida.")
    if path.suffix.lower() not in allowed_extensions:
        raise FileSecurityError("Tipo de archivo no permitido.")
    return clean_bucket, clean_path


def resolve_child_path(base_dir: Path, relative_path: str | Path) -> Path:
    base = Path(base_dir).resolve()
    candidate = (base / relative_path).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise FileSecurityError("Ruta fuera del directorio permitido.") from exc
    return candidate


def validate_local_file(
    path: Path,
    *,
    allowed_extensions: set[str],
    max_bytes: int,
    retention_days: int | None = None,
) -> Path:
    target = Path(path).resolve()
    if not target.exists() or not target.is_file():
        raise FileSecurityError("Archivo no encontrado.")
    if target.suffix.lower() not in allowed_extensions:
        raise FileSecurityError("Tipo de archivo no permitido.")
    if max_bytes > 0 and target.stat().st_size > max_bytes:
        raise FileSecurityError("Archivo excede el tamano permitido.", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    if retention_days and retention_days > 0:
        modified_at = timezone.datetime.fromtimestamp(target.stat().st_mtime, tz=timezone.get_current_timezone())
        if modified_at < timezone.now() - timedelta(days=retention_days):
            raise FileSecurityError("Archivo fuera de periodo de retencion.")
    return target


def content_type_for(path: Path, fallback: str) -> str:
    return mimetypes.guess_type(path.name)[0] or fallback


def secure_file_response(
    path: Path,
    *,
    allowed_extensions: set[str],
    max_bytes: int,
    content_type: str,
    retention_days: int | None = None,
    as_attachment: bool = False,
    filename: str | None = None,
) -> FileResponse:
    target = validate_local_file(
        path,
        allowed_extensions=allowed_extensions,
        max_bytes=max_bytes,
        retention_days=retention_days,
    )
    return FileResponse(
        target.open("rb"),
        content_type=content_type_for(target, content_type),
        as_attachment=as_attachment,
        filename=filename,
    )


def validate_upload(
    upload,
    *,
    allowed_extensions: set[str],
    allowed_mime_types: set[str],
    max_bytes: int,
) -> str:
    suffix = Path(upload.name or "").suffix.lower()
    if suffix not in allowed_extensions:
        raise FileSecurityError("Formato de archivo no soportado.", status.HTTP_400_BAD_REQUEST)
    if max_bytes > 0 and getattr(upload, "size", 0) > max_bytes:
        raise FileSecurityError("Archivo excede el tamano permitido.", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    content_type = str(getattr(upload, "content_type", "") or "").lower()
    if content_type and content_type not in allowed_mime_types:
        raise FileSecurityError("Tipo MIME no permitido.", status.HTTP_400_BAD_REQUEST)
    return suffix
