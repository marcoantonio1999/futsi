from __future__ import annotations

import os
import re
import shutil
import time as time_module
import zipfile
from pathlib import Path

from django.utils import timezone
from django.utils.text import get_valid_filename

from .automatic_attendance_state import VIDEO_EXTENSIONS, automatic_root, read_json, sidecar_path, write_json


def local_cache_dir() -> Path:
    return automatic_root() / "local_cache" / "videos"


def local_cache_retention_days() -> int:
    try:
        return max(1, int(os.getenv("AUTO_ATTENDANCE_LOCAL_CACHE_DAYS", "5")))
    except (TypeError, ValueError):
        return 5


def local_source_dirs() -> list[Path]:
    configured = os.getenv("AUTO_ATTENDANCE_LOCAL_VIDEO_SOURCE_DIRS", "").strip()
    if configured:
        return [Path(part).expanduser() for part in configured.split(";") if part.strip()]
    home = Path.home()
    return [home / "Downloads", home / "Descargas"]


def normalize_video_stem(value: str) -> str:
    stem = Path(value).stem.lower()
    stem = re.sub(r"_seekable$", "", stem)
    stem = re.sub(r"-\d{3,}$", "", stem)
    return re.sub(r"[^a-z0-9]+", "_", stem).strip("_")


def same_video_name(left: str, right: str) -> bool:
    return normalize_video_stem(left) == normalize_video_stem(right)


def link_or_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def cache_filename(clip_id: str, filename: str, source_kind: str) -> str:
    suffix = Path(filename).suffix.lower() or ".mp4"
    safe_stem = get_valid_filename(Path(filename).stem) or "video"
    return f"{clip_id[:8]}-{source_kind}-{safe_stem}{suffix}"


def is_stable_file(path: Path, expected_size: int = 0, min_size: int = 1) -> bool:
    try:
        first = path.stat().st_size
        if first < min_size:
            return False
        if expected_size and first < int(expected_size * 0.70):
            return False
        time_module.sleep(1)
        return path.exists() and path.stat().st_size == first
    except OSError:
        return False


def is_stable_video(path: Path, expected_size: int = 0) -> bool:
    return is_stable_file(path, expected_size=expected_size, min_size=100 * 1024 * 1024)


def cached_video_metadata(path: Path) -> dict:
    return read_json(sidecar_path(path), {})


def find_cached_video(clip_id: str, source_kind: str, filename: str = "") -> Path | None:
    root = local_cache_dir()
    if not clip_id or not root.exists():
        return None
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        metadata = cached_video_metadata(path)
        if str(metadata.get("video_clip_id") or "") == str(clip_id) and metadata.get("processing_video_source") == source_kind:
            return path
    if filename:
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS and same_video_name(path.name, filename):
                return path
    return None


def find_external_video(filename: str, expected_size: int = 0) -> Path | None:
    if not filename:
        return None
    for folder in local_source_dirs():
        if not folder.exists():
            continue
        for path in folder.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            if same_video_name(path.name, filename) and is_stable_video(path, expected_size):
                return path
    return None


def find_external_video_archive_entry(filename: str, expected_size: int = 0) -> tuple[Path, str] | None:
    if not filename:
        return None
    for folder in local_source_dirs():
        if not folder.exists():
            continue
        for archive_path in folder.rglob("*.zip"):
            if not archive_path.is_file() or not is_stable_file(archive_path, min_size=1024 * 1024):
                continue
            try:
                with zipfile.ZipFile(archive_path) as archive:
                    for info in archive.infolist():
                        entry_name = Path(info.filename).name
                        if not entry_name or Path(entry_name).suffix.lower() not in VIDEO_EXTENSIONS:
                            continue
                        if expected_size and info.file_size < int(expected_size * 0.70):
                            continue
                        if same_video_name(entry_name, filename):
                            return archive_path, info.filename
            except (OSError, zipfile.BadZipFile):
                continue
    return None


def write_cache_sidecar(cache_path: Path, metadata: dict, source_path: Path, source_kind: str, archive_entry: str = "") -> None:
    payload = dict(metadata)
    payload.update(
        {
            "processing_video_source": source_kind,
            "local_cache": True,
            "local_cache_path": str(cache_path),
            "local_cache_source_path": str(source_path),
            "local_cache_cached_at": timezone.now().isoformat(),
        }
    )
    if archive_entry:
        payload["local_cache_archive_entry"] = archive_entry
    write_json(sidecar_path(cache_path), payload)


def import_external_video_to_cache(source_path: Path, clip_id: str, filename: str, source_kind: str, metadata: dict) -> Path:
    target = local_cache_dir() / str(metadata.get("site_id") or "sin-sede") / cache_filename(clip_id, filename or source_path.name, source_kind)
    link_or_copy(source_path, target)
    write_cache_sidecar(target, metadata, source_path, source_kind)
    return target


def import_archive_video_to_cache(archive_path: Path, entry_name: str, clip_id: str, filename: str, source_kind: str, metadata: dict) -> Path:
    target = local_cache_dir() / str(metadata.get("site_id") or "sin-sede") / cache_filename(clip_id, filename or Path(entry_name).name, source_kind)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with zipfile.ZipFile(archive_path) as archive:
            with archive.open(entry_name) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
    write_cache_sidecar(target, metadata, archive_path, source_kind, archive_entry=entry_name)
    return target


def find_or_import_cached_video(clip_id: str, filename: str, source_kind: str, metadata: dict, expected_size: int = 0) -> Path | None:
    cleanup_local_video_cache()
    cached = find_cached_video(clip_id, source_kind, filename)
    if cached:
        return cached
    external = find_external_video(filename, expected_size)
    if external:
        return import_external_video_to_cache(external, clip_id, filename, source_kind, metadata)
    archived = find_external_video_archive_entry(filename, expected_size)
    if not archived:
        return None
    archive_path, entry_name = archived
    return import_archive_video_to_cache(archive_path, entry_name, clip_id, filename, source_kind, metadata)


def copy_cached_video_to_target(cache_path: Path, target: Path, metadata: dict) -> None:
    link_or_copy(cache_path, target)
    payload = dict(cached_video_metadata(cache_path) or metadata)
    payload.update(metadata)
    payload["materialized_from_local_cache"] = True
    payload["local_cache_path"] = str(cache_path)
    write_json(sidecar_path(target), payload)


def store_materialized_video_in_cache(video_path: Path, metadata: dict, source_kind: str, filename: str) -> Path | None:
    clip_id = str(metadata.get("video_clip_id") or "").strip()
    if not clip_id or not video_path.exists():
        return None
    target = local_cache_dir() / str(metadata.get("site_id") or "sin-sede") / cache_filename(clip_id, filename or video_path.name, source_kind)
    if not target.exists():
        link_or_copy(video_path, target)
    write_cache_sidecar(target, metadata, video_path, source_kind)
    return target


def cleanup_local_video_cache() -> None:
    root = local_cache_dir()
    if not root.exists():
        return
    cutoff = time_module.time() - (local_cache_retention_days() * 86400)
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass
    for folder in sorted([item for item in root.rglob("*") if item.is_dir()], key=lambda item: len(item.parts), reverse=True):
        try:
            folder.rmdir()
        except OSError:
            pass


def local_cache_summary() -> dict:
    cleanup_local_video_cache()
    root = local_cache_dir()
    files = [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS] if root.exists() else []
    total_bytes = 0
    for path in files:
        try:
            total_bytes += path.stat().st_size
        except OSError:
            pass
    return {
        "path": str(root),
        "count": len(files),
        "bytes": total_bytes,
        "retention_days": local_cache_retention_days(),
        "source_dirs": [str(path) for path in local_source_dirs()],
    }
