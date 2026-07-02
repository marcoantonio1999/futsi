from __future__ import annotations

import os
from pathlib import Path

from django.db import close_old_connections
from django.utils import timezone

from .automatic_attendance_clips import pending_video_matches_request, pending_videos
from .automatic_attendance_downloads import analysis_video_package, frame_proxy_package, materialize_remote_video
from .automatic_attendance_jobs import read_job, update_job
from .automatic_attendance_local_cache import local_cache_summary
from .automatic_attendance_state import read_json, sidecar_path


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "si", "on"}


def delete_materialized_video(video_path: Path) -> None:
    for path in [video_path, sidecar_path(video_path)]:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass


def cache_source_kinds(video_item: dict) -> list[str | None]:
    metadata = video_item.get("metadata") or {}
    kinds: list[str | None] = []
    if frame_proxy_package(metadata):
        kinds.append("frame_proxy_1fps")
    if analysis_video_package(metadata):
        kinds.append("analysis_video_mod8")
    kinds.append("full_video")
    return list(dict.fromkeys(kinds))


def cache_pending_videos_worker(job_id: str, target_path: str | None = None) -> None:
    close_old_connections()
    job = read_job(job_id)
    if not job:
        return
    try:
        videos = [item for item in pending_videos() if item.get("source") == "drive"]
        if target_path:
            videos = [item for item in videos if pending_video_matches_request(item, target_path)]
        total_sources = sum(len(cache_source_kinds(item)) for item in videos)
        update_job(
            job,
            status="processing",
            phase="local_cache",
            phase_label="Descargando pendientes a cache local",
            total=max(total_sources, 1),
            processed=0,
            percent=0,
            results=[],
        )

        processed_sources = 0
        results = []
        for video_item in videos:
            video_result = {"video": video_item["filename"], "cache_sources": []}
            for source_kind in cache_source_kinds(video_item):
                materialized_path = None
                try:
                    update_job(
                        job,
                        current_video=f"Cacheando {video_item['filename']}",
                        current_video_started_at=timezone.now().isoformat(),
                        phase="local_cache",
                        phase_label="Preparando video en cache local",
                    )
                    materialized_path = materialize_remote_video(video_item, job, source_kind=source_kind)
                    sidecar = read_json(sidecar_path(materialized_path), {})
                    video_result["cache_sources"].append(
                        {
                            "source_kind": source_kind or sidecar.get("processing_video_source") or "auto",
                            "materialized_video": materialized_path.name,
                            "local_cache_path": sidecar.get("local_cache_path"),
                            "from_local_cache": bool(sidecar.get("materialized_from_local_cache")),
                        }
                    )
                except Exception as exc:
                    video_result["cache_sources"].append(
                        {
                            "source_kind": source_kind or "auto",
                            "failed": True,
                            "detail": str(exc),
                        }
                    )
                finally:
                    if materialized_path:
                        delete_materialized_video(materialized_path)
                    processed_sources += 1
                    update_job(
                        job,
                        processed=processed_sources,
                        percent=round((processed_sources / max(total_sources, 1)) * 100, 1),
                        results=results + [video_result],
                    )
            results.append(video_result)

        update_job(
            job,
            status="done",
            phase="done",
            phase_label="Cache local listo",
            current_video=None,
            percent=100,
            completed_at=timezone.now().isoformat(),
            results=results,
            local_cache=local_cache_summary(),
        )
    except Exception as exc:
        update_job(job, status="error", phase="error", detail=str(exc), completed_at=timezone.now().isoformat())
    finally:
        close_old_connections()
