from __future__ import annotations

import argparse
import logging
import mimetypes
import os
import sys
import time
import webbrowser
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from threading import Thread

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .config import ConfigManager
from .match_pricing import annotate_match_revenue
from .processor import StationRuntime


STATIC_DIR = Path(__file__).with_name("static-react")
ASSET_SOURCE_DIR = Path(__file__).with_name("static")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
config_manager = ConfigManager()
runtime = StationRuntime(config_manager)


def configure_logging() -> None:
    log_path = config_manager.data_dir / "logs" / "face-station.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(formatter)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler], force=True)


configure_logging()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if config_manager.config.auto_start_engine:
        runtime.start()
    runtime.store.start_match_analysis(force=False)
    yield
    runtime.stop()


app = FastAPI(
    title="Futsi Face Station",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "face-station" / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(ASSET_SOURCE_DIR / "favicon.png", media_type="image/png")


@app.get("/health")
async def health():
    status = runtime.health_status()
    return {
        "ok": status["state"] not in {"error"},
        "running": status["running"],
        "state": status["state"],
        "camera_connected": status["camera_connected"],
        "online": status["online"],
    }


@app.get("/api/status")
def get_status():
    return runtime.status()


@app.get("/api/config")
def get_config():
    return config_manager.config.public_dict()


@app.patch("/api/config")
async def update_config(request: Request):
    try:
        patch = await request.json()
        if not isinstance(patch, dict):
            raise ValueError("La configuracion debe ser un objeto JSON.")
        allowed = {
            "api_url", "reference_proxy_url", "station_token", "camera_url", "camera_fallback_url", "camera_id", "camera_label",
            "camera_async_mjpeg_enabled", "camera_mjpeg_decode_reduction",
            "camera_roi_left", "camera_roi_right",
            "secondary_camera_enabled", "secondary_camera_url", "secondary_camera_id",
            "secondary_camera_label", "secondary_camera_username", "secondary_camera_password",
            "secondary_camera_roi_left", "secondary_camera_roi_right",
            "tertiary_camera_enabled", "tertiary_camera_url", "tertiary_camera_fallback_url",
            "tertiary_camera_id", "tertiary_camera_label",
            "tertiary_camera_async_mjpeg_enabled", "tertiary_camera_mjpeg_decode_reduction",
            "tertiary_camera_roi_left", "tertiary_camera_roi_right",
            "processing_device",
            "detector_size", "processing_width", "preview_width", "preview_fps", "target_fps",
            "known_threshold", "min_margin", "unknown_threshold",
            "unknown_confirmation_threshold", "min_det_score", "min_face_size",
            "detection_debounce_seconds", "capture_priority_start_hour",
            "capture_priority_end_hour", "night_batch_start_time",
            "night_batch_atomic_commit_enabled",
            "night_embedding_batch_size",
            "batch_idle_seconds", "spool_jpeg_quality",
            "bootstrap_interval_seconds",
            "quality_filter_enabled", "quality_model_path", "quality_max_yaw", "quality_max_pitch",
            "quality_max_roll", "quality_min_face_width", "quality_min_face_height",
            "quality_min_interocular", "quality_min_sharpness",
            "semantic_reference_filter_enabled", "semantic_reference_model_path",
            "adaptive_known_min_similarity", "adaptive_known_min_margin",
            "adaptive_unknown_min_similarity", "daily_evidence_limit",
            "evidence_safety_days", "monthly_fee_amount", "match_fee_amount",
            "match_day_fee_amount", "match_evening_fee_amount",
            "candidate_ttl_minutes",
            "sync_interval_seconds", "retention_days", "auto_start_engine", "open_browser",
        }
        unexpected = sorted(set(patch) - allowed)
        if unexpected:
            raise ValueError(f"Campos no permitidos: {', '.join(unexpected)}")
        updated = config_manager.update(patch)
        restart_required = bool(
            set(patch) - {
                "monthly_fee_amount", "match_fee_amount",
                "match_day_fee_amount", "match_evening_fee_amount",
            }
        )
        should_restart = bool(runtime.running and restart_required)
        if should_restart:
            Thread(target=runtime.restart, name="futsi-restart", daemon=True).start()
        return {
            "saved": True,
            "config": updated.public_dict(),
            "restarting": should_restart,
        }
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/engine/start")
def start_engine():
    runtime.start()
    return {"started": True}


@app.post("/api/engine/stop")
def stop_engine():
    runtime.stop()
    return {"stopped": True}


@app.post("/api/engine/restart")
def restart_engine():
    Thread(target=runtime.restart, name="futsi-restart", daemon=True).start()
    return {"restarting": True}


@app.post("/api/engine/benchmark")
def benchmark_engine():
    try:
        runtime.request_benchmark()
        return {"queued": True}
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/batch/manual/start")
def start_manual_batch():
    try:
        return runtime.request_manual_batch()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/batch/manual/cancel")
def cancel_manual_batch():
    try:
        return runtime.cancel_manual_batch()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/dashboard")
def dashboard(date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$")):
    return runtime.dashboard(date)


@app.get("/api/attendance/monthly")
def monthly_attendance(
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    q: str = Query(default="", max_length=100),
    kind: str = Query(default="all", pattern=r"^(all|known|unknown)$"),
    revenue_only: bool = Query(default=False),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=100),
):
    try:
        config = config_manager.config
        return runtime.store.monthly_attendance(
            month,
            query=q,
            kind=kind,
            offset=offset,
            limit=limit,
            monthly_fee_amount=config.monthly_fee_amount,
            revenue_only=revenue_only,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/match-analysis")
def match_analysis(
    status: str = Query(
        default="all",
        pattern=(
            r"^(all|detected|scheduled|outside|clear|processing)$"
        ),
    ),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=31, ge=1, le=100),
):
    try:
        payload = runtime.store.match_history(
            status=status,
            offset=offset,
            limit=limit,
        )
        config = config_manager.config
        annotate_match_revenue(
            payload,
            day_fee_amount=config.match_day_fee_amount,
            evening_fee_amount=config.match_evening_fee_amount,
        )
        payload["revenue_policy"]["match_fee_amount"] = config.match_fee_amount
        return payload
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/match-schedule")
def match_schedule(
    start_date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    try:
        items = runtime.store.match_schedule(
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "items": items,
        "total": len(items),
        "start_date": start_date,
        "end_date": end_date,
    }


@app.post("/api/match-analysis/run")
def run_match_analysis(
    force: bool = Query(default=False),
):
    return runtime.store.start_match_analysis(force=force)


@app.get("/api/match-analysis/windows/{window_id}/participants")
def match_window_participants(window_id: int):
    result = runtime.store.match_window_participants(window_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Ventana no encontrada.")
    result["videos"] = runtime.match_window_videos(window_id) or []
    return result


@app.get("/api/match-analysis/windows/{window_id}/videos/{video_id}")
def match_window_video(window_id: int, video_id: str):
    path = runtime.match_window_video_path(window_id, video_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Video de evidencia no disponible.")
    media_type = "video/mp4" if path.suffix.lower() == ".mp4" else "video/x-matroska"
    return FileResponse(path, media_type=media_type)


@app.get("/api/match-analysis/evidence/{crop_id}")
def match_analysis_evidence(crop_id: int):
    path = runtime.store.crop_image_path(crop_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Evidencia no disponible.")
    return FileResponse(path)


@app.get("/api/recent")
def recent_detections(
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
):
    summary = runtime.store.detection_summary(date)
    return {
        "date": date,
        "items": runtime.store.recent_detections(date, limit=limit, offset=offset),
        "offset": offset,
        "limit": limit,
        "total_subjects": summary["subjects"],
        "total_detections": summary["detections"],
    }


@app.get("/api/crop-queue")
def crop_queue(
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: str = Query(default="active", pattern=r"^(active|pending|processing|error|all)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=100),
):
    return runtime.store.crop_queue(
        selected_date=date,
        status=status,
        offset=offset,
        limit=limit,
    )


@app.get("/api/crop-queue/{crop_id}/image")
def crop_queue_image(crop_id: int):
    path = runtime.store.crop_queue_image_path(crop_id)
    if not path:
        raise HTTPException(status_code=404, detail="Recorte pendiente no disponible.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=60"})


@app.get("/api/unassigned/{crop_id}/image")
def unassigned_crop_image(crop_id: int):
    path = runtime.store.unassigned_crop_image_path(crop_id)
    if not path:
        raise HTTPException(status_code=404, detail="Recorte sin asignar no disponible.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=60"})


@app.get("/api/identities")
def identities(
    q: str = Query(default="", max_length=100),
    status: str = Query(default="all", pattern=r"^(all|ready|missing|duplicates)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=100),
):
    return runtime.store.identity_catalog(query=q, status=status, offset=offset, limit=limit)


@app.get("/api/unknowns/catalog")
def unknown_catalog(
    q: str = Query(default="", max_length=100),
    status: str = Query(
        default="review",
        pattern=(
            r"^(all|review|candidate|consolidated|linked|ignored|"
            r"quarantined|archived)$"
        ),
    ),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=100),
    snapshot: int | None = Query(default=None, ge=1),
):
    return runtime.store.unknown_catalog(
        query=q,
        status=status,
        offset=offset,
        limit=limit,
        snapshot=snapshot,
    )


@app.get("/api/unknowns/catalog/{subject_id}/image")
def unknown_catalog_image(subject_id: str):
    path = runtime.store.unknown_catalog_image_path(subject_id)
    if not path:
        raise HTTPException(status_code=404, detail="Imagen desconocida no disponible.")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=60"},
    )


@app.get("/api/unknowns/ignored")
def ignored_unknowns(
    q: str = Query(default="", max_length=100),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=100),
):
    return runtime.store.ignored_unknowns(query=q, offset=offset, limit=limit)


@app.get("/api/unknowns/quarantined")
def quarantined_unknowns(
    q: str = Query(default="", max_length=100),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=100),
):
    return runtime.store.quarantined_unknowns(
        query=q,
        offset=offset,
        limit=limit,
    )


@app.post("/api/unknowns/ignore")
async def ignore_unknowns(request: Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("La solicitud de exclusión debe ser un objeto JSON.")
        subject_ids = payload.get("subject_ids", [])
        if not isinstance(subject_ids, list):
            raise ValueError("La lista de personas seleccionadas no es válida.")
        ignored = payload.get("ignored", True)
        if not isinstance(ignored, bool):
            raise ValueError("El estado de exclusión no es válido.")
        return runtime.set_unknowns_ignored(
            [str(subject_id) for subject_id in subject_ids],
            ignored,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="No se encontró uno de los rostros seleccionados.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/unknowns/{subject_id}/quarantine")
async def quarantine_unknown(subject_id: str, request: Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("La solicitud de cuarentena debe ser un objeto JSON.")
        reason = str(payload.get("reason", "")).strip()
        return await run_in_threadpool(
            runtime.quarantine_unknown,
            subject_id,
            reason,
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=404,
            detail="No se encontro el rostro desconocido.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/unknowns/{subject_id}/link")
async def link_unknown(subject_id: str, request: Request):
    try:
        payload = await request.json()
        person_key = str(payload.get("person_key", "")).strip()
        if not person_key:
            raise ValueError("Selecciona una persona para vincular.")
        return runtime.link_unknown(subject_id, person_key)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="No se encontro el rostro desconocido.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/unknowns/{subject_id}/registration-crops")
def unknown_registration_crops(subject_id: str):
    try:
        return runtime.store.unknown_registration_crops(subject_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="No se encontro el rostro desconocido.") from exc


@app.post("/api/unknowns/{subject_id}/students")
async def create_student_from_unknown(subject_id: str, request: Request):
    try:
        payload = await request.json()
        full_name = str(payload.get("full_name", ""))
        crop_id = int(payload.get("crop_id") or 0)
        if crop_id <= 0:
            raise ValueError("Selecciona el recorte que sera la foto del alumno.")
        return await run_in_threadpool(
            runtime.create_student_from_unknown,
            subject_id,
            full_name,
            crop_id,
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=404,
            detail="No se encontro el rostro o el recorte seleccionado.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo registrar el alumno en la academia: {exc}",
        ) from exc


@app.post("/api/unknowns/{subject_id}/collaborators")
async def create_collaborator_from_unknown(subject_id: str, request: Request):
    try:
        payload = await request.json()
        full_name = str(payload.get("full_name", ""))
        crop_id = int(payload.get("crop_id") or 0)
        if crop_id <= 0:
            raise ValueError("Selecciona el recorte que sera la foto del colaborador.")
        return await run_in_threadpool(
            runtime.create_collaborator_from_unknown,
            subject_id,
            full_name,
            crop_id,
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=404,
            detail="No se encontro el rostro o el recorte seleccionado.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo registrar el colaborador: {exc}",
        ) from exc


@app.post("/api/unknowns/merge")
async def merge_unknowns(request: Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("La solicitud de fusion debe ser un objeto JSON.")
        target_subject_id = str(payload.get("target_subject_id", "")).strip()
        source_subject_ids = payload.get("source_subject_ids", [])
        if not isinstance(source_subject_ids, list):
            raise ValueError("La lista de identidades secundarias no es valida.")
        return runtime.merge_unknowns(
            target_subject_id,
            [str(subject_id) for subject_id in source_subject_ids],
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="No se encontro uno de los rostros seleccionados.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/unknowns/reconcile")
def reconcile_unknowns_dry_run():
    """Return the explainable global plan without changing any identity."""
    return runtime.reconcile_unknowns(apply=False)


@app.post("/api/unknowns/reconcile")
async def reconcile_unknowns(request: Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError(
                "La solicitud de reconciliacion debe ser un objeto JSON."
            )
        apply_changes = bool(payload.get("apply", False))
        return await run_in_threadpool(
            lambda: runtime.reconcile_unknowns(apply=apply_changes)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/detections/{kind}/{identifier}")
def detection_detail(
    kind: str,
    identifier: str,
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=36, ge=1, le=100),
    include_all: bool = Query(default=False),
):
    try:
        return runtime.store.detection_detail(
            kind,
            identifier,
            date,
            selected_month=month,
            cursor=cursor,
            limit=limit,
            include_all_crops=include_all,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="No se encontro la deteccion.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/crops/{crop_id}/image")
def crop_image(crop_id: int):
    path = runtime.store.crop_image_path(crop_id)
    if not path:
        raise HTTPException(status_code=404, detail="Recorte no disponible.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/crops/{crop_id}/reject")
async def reject_unknown_crop(crop_id: int, request: Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("La solicitud de rechazo debe ser un objeto JSON.")
        reason = str(payload.get("reason", "")).strip()
        return await run_in_threadpool(
            runtime.reject_unknown_crop,
            crop_id,
            reason,
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=404,
            detail="No se encontro el recorte desconocido.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/images/{kind}/{identifier:path}")
def local_image(kind: str, identifier: str):
    path = runtime.store.image_path(kind, identifier)
    if not path:
        raise HTTPException(status_code=404, detail="Imagen no disponible.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/stream.mjpg")
def preview_stream(
    camera: str = Query(default="primary", pattern=r"^(primary|secondary|tertiary)$"),
):
    def frames():
        previous = b""
        while True:
            payload = runtime.latest_preview(camera)
            if payload and payload != previous:
                previous = payload
                yield b"--frame\r\nContent-Type: image/jpeg\r\nCache-Control: no-cache\r\n\r\n" + payload + b"\r\n"
            time.sleep(1 / max(config_manager.config.preview_fps, 1))

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.exception_handler(Exception)
async def unhandled_exception(_request: Request, exc: Exception):
    logging.getLogger("futsi.face_station").exception("Error no controlado", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Ocurrio un error interno en la estacion."})


def open_dashboard(url: str) -> None:
    time.sleep(1.5)
    webbrowser.open(url)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Futsi Face Station")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--synthetic", action="store_true", help="Usa una fuente de video sintetica para diagnostico.")
    return parser.parse_args()


def run() -> None:
    arguments = parse_arguments()
    patch = {}
    if arguments.synthetic:
        patch["camera_url"] = "synthetic://diagnostic"
    if patch:
        config_manager.update(patch)
    config = config_manager.config
    host = arguments.host or os.getenv("FUTSI_FACE_HOST") or config.host
    port = arguments.port or int(os.getenv("FUTSI_FACE_PORT", config.port))
    url = f"http://127.0.0.1:{port}"
    if config.open_browser and not arguments.no_browser and os.getenv("FUTSI_FACE_NO_BROWSER") != "1":
        Thread(target=open_dashboard, args=(url,), name="futsi-browser", daemon=True).start()
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)


if __name__ == "__main__":
    run()
