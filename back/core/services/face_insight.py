from __future__ import annotations

import base64
import os
import site
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable
from urllib.request import urlretrieve

import numpy as np
from PIL import Image, ImageOps

from core.services.supabase_storage import download_private_file, parse_storage_uri


_DLL_DIRECTORY_HANDLES: list[object] = []


@dataclass(frozen=True)
class FaceEmbedding:
    embedding: np.ndarray
    bbox: tuple[int, int, int, int]
    det_score: float


@dataclass(frozen=True)
class FaceMatch:
    student: object | None
    similarity: float
    margin: float
    matched: bool


def add_nvidia_dll_directories() -> None:
    add_dll_directory = getattr(os, "add_dll_directory", None)
    if add_dll_directory is None:
        return

    site_paths = [Path(path) for path in site.getsitepackages()]
    user_site = site.getusersitepackages()
    if user_site:
        site_paths.append(Path(user_site))

    for site_path in site_paths:
        nvidia_dir = site_path / "nvidia"
        if not nvidia_dir.exists():
            continue
        for bin_dir in nvidia_dir.glob("*/bin"):
            if bin_dir.exists():
                _DLL_DIRECTORY_HANDLES.append(add_dll_directory(str(bin_dir)))


def preload_onnxruntime() -> None:
    import onnxruntime as ort

    preload_dlls = getattr(ort, "preload_dlls", None)
    if callable(preload_dlls):
        preload_dlls(directory="")
    add_nvidia_dll_directories()


def resolve_providers(providers: Iterable[str] | None = None) -> list[str]:
    import onnxruntime as ort

    requested = [provider.strip() for provider in (providers or ["auto"]) if provider.strip()]
    if not requested or [provider.lower() for provider in requested] == ["auto"]:
        available = set(ort.get_available_providers())
        if "CUDAExecutionProvider" in available:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]
        return ["CPUExecutionProvider"]
    return requested


@lru_cache(maxsize=4)
def get_face_app(model_name: str = "buffalo_l", providers_key: str = "auto"):
    preload_onnxruntime()
    from insightface.app import FaceAnalysis

    providers = resolve_providers(providers_key.split(","))
    app = FaceAnalysis(name=model_name, providers=providers)
    app.prepare(ctx_id=0)
    return app


def image_file_to_bgr(path: str | Path):
    import cv2

    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"No se pudo leer imagen: {path}")
    return image


def data_url_to_bgr(image_data: str):
    import cv2

    header, _, payload = image_data.partition(",")
    raw = base64.b64decode(payload or header)
    data = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("No se pudo decodificar la imagen capturada.")
    return image


def mirror_bgr(image_bgr):
    import cv2

    return cv2.flip(image_bgr, 1)


def detect_embeddings(image_bgr, providers_key: str = "auto") -> list[FaceEmbedding]:
    app = get_face_app(providers_key=providers_key)
    faces = app.get(image_bgr)
    detections: list[FaceEmbedding] = []
    for face in faces:
        embedding = getattr(face, "normed_embedding", None)
        if embedding is None:
            embedding = face.embedding / max(np.linalg.norm(face.embedding), 1e-12)
        x1, y1, x2, y2 = [int(round(value)) for value in face.bbox]
        detections.append(
            FaceEmbedding(
                embedding=np.asarray(embedding, dtype=np.float32),
                bbox=(x1, y1, x2, y2),
                det_score=float(getattr(face, "det_score", 0.0)),
            )
        )
    return detections


def student_reference_path(student) -> str | None:
    if getattr(student, "photo", None):
        try:
            if student.photo and student.photo.path:
                return student.photo.path
        except Exception:
            pass
    photo_url = getattr(student, "photo_url", "")
    if photo_url:
        parsed_storage_uri = parse_storage_uri(photo_url)
        if parsed_storage_uri:
            bucket, object_path = parsed_storage_uri
            return download_private_file(bucket, object_path, suffix=Path(object_path).suffix or ".jpg")
        ref_file = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        ref_file.close()
        urlretrieve(photo_url, ref_file.name)
        return ref_file.name
    return None


def build_student_database(students: Iterable[object], providers_key: str = "auto") -> tuple[list[object], np.ndarray, list[str]]:
    enrolled_students = []
    embeddings = []
    skipped = []
    for student in students:
        try:
            reference_path = student_reference_path(student)
            if not reference_path:
                skipped.append(f"{student.full_name}: sin foto")
                continue
            image = image_file_to_bgr(reference_path)
            detections = detect_embeddings(image, providers_key=providers_key)
            if len(detections) != 1:
                skipped.append(f"{student.full_name}: {len(detections)} caras en foto")
                continue
            enrolled_students.append(student)
            embeddings.append(detections[0].embedding)
        except Exception as exc:
            skipped.append(f"{student.full_name}: {exc}")

    if embeddings:
        matrix = np.vstack(embeddings).astype(np.float32)
        matrix = matrix / np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
    else:
        matrix = np.empty((0, 512), dtype=np.float32)
    return enrolled_students, matrix, skipped


def match_embedding(
    embedding: np.ndarray,
    students: list[object],
    matrix: np.ndarray,
    threshold: float = 0.45,
    min_margin: float = 0.03,
) -> FaceMatch:
    if matrix.size == 0:
        return FaceMatch(None, 0.0, 0.0, False)
    query = embedding.astype(np.float32)
    query = query / max(np.linalg.norm(query), 1e-12)
    similarities = matrix @ query
    best_idx = int(np.argmax(similarities))
    best = float(similarities[best_idx])
    if len(similarities) > 1:
        second = float(np.partition(similarities, -2)[-2])
    else:
        second = -1.0
    margin = best - second
    matched = best >= threshold and margin >= min_margin
    return FaceMatch(students[best_idx] if matched else None, best, margin, matched)


def save_debug_image(image_bgr, path: str | Path) -> None:
    import cv2

    cv2.imwrite(str(path), image_bgr)

