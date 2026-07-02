from __future__ import annotations

import base64
import hashlib
import os
import site
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable, Iterable
from urllib.request import urlretrieve

from django.conf import settings

try:
    import numpy as np
except ModuleNotFoundError as exc:
    np = None
    _FACE_IMPORT_ERROR = exc
else:
    _FACE_IMPORT_ERROR = None
from PIL import Image, ImageOps

from core.services.supabase_storage import download_private_file, parse_storage_uri


_DLL_DIRECTORY_HANDLES: list[object] = []
ReferenceProgressCallback = Callable[[int, int, str, bool], None]
_STUDENT_DATABASE_CACHE: dict[tuple[str, tuple[str, ...]], tuple[list[object], object, list[str]]] = {}


def ensure_face_dependencies() -> None:
    if _FACE_IMPORT_ERROR is not None:
        raise RuntimeError(
            "Faltan dependencias opcionales de reconocimiento facial. "
            "Instala back/requirements-face-cpu.txt o back/requirements-face-gpu.txt."
        ) from _FACE_IMPORT_ERROR


@dataclass(frozen=True)
class FaceEmbedding:
    embedding: np.ndarray
    bbox: tuple[int, int, int, int]
    det_score: float
    kps: np.ndarray | None = None
    landmark_2d_106: np.ndarray | None = None
    landmark_3d_68: np.ndarray | None = None
    pose: np.ndarray | None = None


@dataclass(frozen=True)
class FaceDetection:
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
    ensure_face_dependencies()
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
    ensure_face_dependencies()
    import cv2

    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"No se pudo leer imagen: {path}")
    return image


def data_url_to_bgr(image_data: str):
    ensure_face_dependencies()
    import cv2

    header, _, payload = image_data.partition(",")
    raw = base64.b64decode(payload or header)
    data = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("No se pudo decodificar la imagen capturada.")
    return image


def mirror_bgr(image_bgr):
    ensure_face_dependencies()
    import cv2

    return cv2.flip(image_bgr, 1)


def detect_embeddings(image_bgr, providers_key: str = "auto") -> list[FaceEmbedding]:
    ensure_face_dependencies()
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
                kps=_optional_array(getattr(face, "kps", None)),
                landmark_2d_106=_optional_array(getattr(face, "landmark_2d_106", None)),
                landmark_3d_68=_optional_array(getattr(face, "landmark_3d_68", None)),
                pose=_optional_array(getattr(face, "pose", None)),
            )
        )
    return detections


def _optional_array(value):
    if value is None:
        return None
    return np.asarray(value, dtype=np.float32)


def detect_face_boxes(image_bgr, providers_key: str = "auto") -> list[FaceDetection]:
    ensure_face_dependencies()
    app = get_face_app(providers_key=providers_key)
    detector = app.models.get("detection")
    if detector is None:
        return [
            FaceDetection(bbox=face.bbox, det_score=face.det_score)
            for face in detect_embeddings(image_bgr, providers_key=providers_key)
        ]
    detections, _keypoints = detector.detect(image_bgr)
    boxes: list[FaceDetection] = []
    for row in detections:
        x1, y1, x2, y2, score = row[:5]
        boxes.append(
            FaceDetection(
                bbox=(int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))),
                det_score=float(score),
            )
        )
    return boxes


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


def reference_cache_source(student) -> str | None:
    updated_at = getattr(student, "updated_at", None)
    updated_value = updated_at.isoformat() if updated_at else ""
    if getattr(student, "photo", None):
        try:
            if student.photo and student.photo.path:
                path = Path(student.photo.path)
                stat = path.stat()
                return f"{student.__class__.__name__}:{student.id}:photo:{student.photo.name}:{stat.st_mtime_ns}:{stat.st_size}:{updated_value}"
        except Exception:
            pass
    photo_url = getattr(student, "photo_url", "") or ""
    if photo_url:
        return f"{student.__class__.__name__}:{student.id}:url:{photo_url}:{updated_value}"
    return None


def reference_embedding_cache_path(student) -> Path | None:
    source = reference_cache_source(student)
    if not source:
        return None
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    return Path(settings.MEDIA_ROOT) / "face_reference_cache" / f"{digest}.npy"


def load_reference_embedding_from_cache(student) -> np.ndarray | None:
    cache_path = reference_embedding_cache_path(student)
    if not cache_path or not cache_path.exists():
        return None
    try:
        embedding = np.load(str(cache_path), allow_pickle=False).astype(np.float32)
        if embedding.shape != (512,):
            return None
        return embedding / max(np.linalg.norm(embedding), 1e-12)
    except Exception:
        return None


def save_reference_embedding_to_cache(student, embedding: np.ndarray) -> None:
    cache_path = reference_embedding_cache_path(student)
    if not cache_path:
        return
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        normalized = embedding.astype(np.float32)
        normalized = normalized / max(np.linalg.norm(normalized), 1e-12)
        tmp_path = cache_path.with_name(f"{cache_path.name}.{os.getpid()}.tmp")
        with tmp_path.open("wb") as handle:
            np.save(handle, normalized, allow_pickle=False)
        tmp_path.replace(cache_path)
    except Exception:
        pass


def build_student_database(
    students: Iterable[object],
    providers_key: str = "auto",
    progress_callback: ReferenceProgressCallback | None = None,
) -> tuple[list[object], np.ndarray, list[str]]:
    ensure_face_dependencies()
    students = list(students)
    total = len(students)
    cache_key = (
        providers_key,
        tuple(
            reference_cache_source(student)
            or f"{student.__class__.__name__}:{getattr(student, 'id', index)}:{getattr(student, 'updated_at', '')}"
            for index, student in enumerate(students)
        ),
    )
    cached_database = _STUDENT_DATABASE_CACHE.get(cache_key)
    if cached_database is not None:
        enrolled_students, matrix, skipped = cached_database
        if progress_callback:
            progress_callback(total, total, "Referencias cacheadas en memoria", True)
        return enrolled_students, matrix, skipped

    enrolled_students = []
    embeddings = []
    skipped = []
    for index, student in enumerate(students, start=1):
        cached = False
        try:
            embedding = load_reference_embedding_from_cache(student)
            if embedding is not None:
                cached = True
            else:
                reference_path = student_reference_path(student)
                if not reference_path:
                    skipped.append(f"{student.full_name}: sin foto")
                    continue
                image = image_file_to_bgr(reference_path)
                detections = detect_embeddings(image, providers_key=providers_key)
                if len(detections) != 1:
                    skipped.append(f"{student.full_name}: {len(detections)} caras en foto")
                    continue
                embedding = detections[0].embedding
                save_reference_embedding_to_cache(student, embedding)
            enrolled_students.append(student)
            embeddings.append(embedding)
        except Exception as exc:
            skipped.append(f"{student.full_name}: {exc}")
        finally:
            if progress_callback:
                progress_callback(index, total, getattr(student, "full_name", str(student)), cached)

    if embeddings:
        matrix = np.vstack(embeddings).astype(np.float32)
        matrix = matrix / np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
    else:
        matrix = np.empty((0, 512), dtype=np.float32)
    if len(_STUDENT_DATABASE_CACHE) >= 4:
        _STUDENT_DATABASE_CACHE.pop(next(iter(_STUDENT_DATABASE_CACHE)))
    _STUDENT_DATABASE_CACHE[cache_key] = (enrolled_students, matrix, skipped)
    return enrolled_students, matrix, skipped


def match_embedding(
    embedding: np.ndarray,
    students: list[object],
    matrix: np.ndarray,
    threshold: float = 0.45,
    min_margin: float = 0.03,
) -> FaceMatch:
    ensure_face_dependencies()
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
    ensure_face_dependencies()
    import cv2

    cv2.imwrite(str(path), image_bgr)

