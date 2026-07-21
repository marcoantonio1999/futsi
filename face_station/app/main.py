from __future__ import annotations

import argparse
import logging
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

from .config import ConfigManager
from .processor import StationRuntime


STATIC_DIR = Path(__file__).with_name("static")
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
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC_DIR / "favicon.png", media_type="image/png")


@app.get("/health")
def health():
    status = runtime.status()
    return {
        "ok": status["state"] not in {"error"},
        "running": status["running"],
        "state": status["state"],
        "camera_connected": status["camera"]["connected"],
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
            "api_url", "station_token", "camera_url", "camera_id", "processing_device",
            "detector_size", "processing_width", "preview_width", "preview_fps", "target_fps",
            "known_threshold", "min_margin", "unknown_threshold", "min_det_score", "min_face_size",
            "unknown_min_hits", "detection_debounce_seconds", "bootstrap_interval_seconds",
            "sync_interval_seconds", "retention_days", "auto_start_engine", "open_browser",
        }
        unexpected = sorted(set(patch) - allowed)
        if unexpected:
            raise ValueError(f"Campos no permitidos: {', '.join(unexpected)}")
        updated = config_manager.update(patch)
        if runtime.running:
            Thread(target=runtime.restart, name="futsi-restart", daemon=True).start()
        return {"saved": True, "config": updated.public_dict(), "restarting": runtime.running}
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


@app.get("/api/dashboard")
def dashboard(date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$")):
    return runtime.dashboard(date)


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


@app.get("/api/images/{kind}/{identifier:path}")
def local_image(kind: str, identifier: str):
    path = runtime.store.image_path(kind, identifier)
    if not path:
        raise HTTPException(status_code=404, detail="Imagen no disponible.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/stream.mjpg")
def preview_stream():
    def frames():
        previous = b""
        while True:
            payload = runtime.latest_preview()
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
