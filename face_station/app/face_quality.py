from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock

import cv2
import mediapipe as mp
import numpy as np


FACE_OVAL = (
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
)
REQUIRED_LANDMARKS = (10, 152, 234, 454, 33, 133, 362, 263, 1, 61, 291)
LEFT_EYE_EAR_LANDMARKS = (33, 160, 158, 133, 153, 144)
RIGHT_EYE_EAR_LANDMARKS = (362, 385, 387, 263, 373, 380)


@dataclass(frozen=True)
class FaceQualityThresholds:
    max_yaw: float = 15.0
    max_pitch: float = 18.0
    max_roll: float = 20.0
    min_face_width: int = 70
    min_face_height: int = 75
    min_interocular: int = 34
    min_sharpness: float = 40.0
    min_median_brightness: float = 20.0
    max_median_brightness: float = 220.0
    min_dynamic_range: float = 35.0
    max_dark_fraction: float = 0.30
    max_bright_fraction: float = 0.18
    landmark_margin_fraction: float = 0.02


@dataclass(frozen=True)
class FaceQualityResult:
    accepted: bool
    score: float
    reasons: tuple[str, ...]
    mesh_detected: bool = False
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    face_span: float = 0.0
    face_width: float = 0.0
    face_height: float = 0.0
    interocular: float = 0.0
    sharpness: float = 0.0
    brightness: float = 0.0
    contrast: float = 0.0
    clipped_fraction: float = 0.0
    dynamic_range: float = 0.0
    dark_fraction: float = 0.0
    bright_fraction: float = 0.0
    complete_face: bool = False
    left_ear: float = 0.0
    right_ear: float = 0.0
    minimum_ear: float = 0.0

    def as_dict(self) -> dict:
        payload = asdict(self)
        payload["reasons"] = list(self.reasons)
        return payload


class FaceQualityEvaluator:
    """Strict admission gate for reference-quality unknown face crops."""

    def __init__(self, model_path: Path, thresholds: FaceQualityThresholds | None = None):
        self.model_path = Path(model_path).resolve()
        if not self.model_path.is_file():
            raise FileNotFoundError(f"No se encontro el modelo MediaPipe: {self.model_path}")
        self.thresholds = thresholds or FaceQualityThresholds()
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.6,
            min_face_presence_confidence=0.6,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=True,
        )
        self._landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        self._lock = RLock()

    def close(self) -> None:
        with self._lock:
            if self._landmarker is not None:
                self._landmarker.close()
                self._landmarker = None

    def analyze(self, image: np.ndarray) -> FaceQualityResult:
        if image is None or image.size == 0:
            return FaceQualityResult(False, 0.0, ("imagen_vacia",))
        if image.ndim != 3 or image.shape[2] != 3:
            return FaceQualityResult(False, 0.0, ("formato_invalido",))

        canvas, offset_x, offset_y = self._padded_canvas(image)
        rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
        media_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        with self._lock:
            if self._landmarker is None:
                raise RuntimeError("El evaluador MediaPipe esta cerrado.")
            result = self._landmarker.detect(media_image)
        if not result.face_landmarks or not result.facial_transformation_matrixes:
            return FaceQualityResult(False, 0.0, ("malla_no_detectada",))

        canvas_height, canvas_width = canvas.shape[:2]
        points = np.asarray(
            [
                (landmark.x * canvas_width - offset_x, landmark.y * canvas_height - offset_y)
                for landmark in result.face_landmarks[0]
            ],
            dtype=np.float32,
        )
        rotation = self._nearest_rotation(
            np.asarray(result.facial_transformation_matrixes[0], dtype=np.float64)[:3, :3]
        )
        pitch = float(np.degrees(np.arctan2(rotation[2, 1], rotation[2, 2])))
        yaw = float(np.degrees(np.arctan2(-rotation[2, 0], np.hypot(rotation[2, 1], rotation[2, 2]))))
        roll = float(np.degrees(np.arctan2(rotation[1, 0], rotation[0, 0])))
        return self._measure(image, points, yaw=yaw, pitch=pitch, roll=roll)

    @staticmethod
    def _nearest_rotation(matrix: np.ndarray) -> np.ndarray:
        left, _singular, right = np.linalg.svd(matrix)
        rotation = left @ right
        if np.linalg.det(rotation) < 0:
            left[:, -1] *= -1
            rotation = left @ right
        return rotation

    @staticmethod
    def _padded_canvas(image: np.ndarray) -> tuple[np.ndarray, int, int]:
        height, width = image.shape[:2]
        side = max(height, width)
        canvas_side = max(192, int(round(side * 1.35)))
        edge_color = tuple(int(value) for value in np.median(image.reshape(-1, 3), axis=0))
        canvas = np.full((canvas_side, canvas_side, 3), edge_color, dtype=np.uint8)
        offset_x = (canvas_side - width) // 2
        offset_y = (canvas_side - height) // 2
        canvas[offset_y:offset_y + height, offset_x:offset_x + width] = image
        return canvas, offset_x, offset_y

    @staticmethod
    def _eye_aspect_ratio(points: np.ndarray, landmark_indices: tuple[int, ...]) -> float:
        outer, upper_outer, upper_inner, inner, lower_inner, lower_outer = points[
            list(landmark_indices)
        ]
        horizontal = float(np.linalg.norm(outer - inner))
        if not np.isfinite(horizontal) or horizontal <= np.finfo(np.float32).eps:
            return 0.0
        vertical_outer = float(np.linalg.norm(upper_outer - lower_outer))
        vertical_inner = float(np.linalg.norm(upper_inner - lower_inner))
        ear = (vertical_outer + vertical_inner) / (2.0 * horizontal)
        return float(ear) if np.isfinite(ear) else 0.0

    def _measure(
        self,
        image: np.ndarray,
        points: np.ndarray,
        *,
        yaw: float,
        pitch: float,
        roll: float,
    ) -> FaceQualityResult:
        thresholds = self.thresholds
        image_height, image_width = image.shape[:2]
        oval = points[list(FACE_OVAL)]
        min_x, min_y = np.min(oval, axis=0)
        max_x, max_y = np.max(oval, axis=0)
        face_width = float(max_x - min_x)
        face_height = float(max_y - min_y)
        face_span = float(min(face_width, face_height))
        interocular = float(np.linalg.norm(points[33] - points[263]))
        left_ear = self._eye_aspect_ratio(points, LEFT_EYE_EAR_LANDMARKS)
        right_ear = self._eye_aspect_ratio(points, RIGHT_EYE_EAR_LANDMARKS)
        minimum_ear = min(left_ear, right_ear)

        margin_x = max(1.0, image_width * thresholds.landmark_margin_fraction)
        margin_y = max(1.0, image_height * thresholds.landmark_margin_fraction)
        required = points[list(REQUIRED_LANDMARKS)]
        complete_face = bool(
            np.all(required[:, 0] >= margin_x)
            and np.all(required[:, 0] <= image_width - margin_x)
            and np.all(required[:, 1] >= margin_y)
            and np.all(required[:, 1] <= image_height - margin_y)
        )

        roi_x1 = max(0, int(np.floor(min_x)))
        roi_y1 = max(0, int(np.floor(min_y)))
        roi_x2 = min(image_width, int(np.ceil(max_x)))
        roi_y2 = min(image_height, int(np.ceil(max_y)))
        roi = image[roi_y1:roi_y2, roi_x1:roi_x2]
        if roi.size == 0:
            return FaceQualityResult(False, 0.0, ("region_facial_vacia",), mesh_detected=True)
        normalized = cv2.resize(roi, (160, 160), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)
        softened = cv2.GaussianBlur(gray, (3, 3), 0)
        sharpness = float(cv2.Laplacian(softened, cv2.CV_64F).var())
        brightness = float(np.mean(gray))
        median_brightness = float(np.median(gray))
        contrast = float(np.std(gray))
        dark_fraction = float(np.mean(gray <= 15))
        bright_fraction = float(np.mean(gray >= 240))
        clipped_fraction = dark_fraction + bright_fraction
        p10, p90 = np.percentile(gray, (10, 90))
        dynamic_range = float(p90 - p10)

        reasons: list[str] = []
        if abs(yaw) > thresholds.max_yaw:
            reasons.append("rostro_de_lado")
        if abs(pitch) > thresholds.max_pitch:
            reasons.append("rostro_inclinado_vertical")
        if abs(roll) > thresholds.max_roll:
            reasons.append("rostro_inclinado")
        if not complete_face:
            reasons.append("rostro_incompleto")
        if (
            face_width < thresholds.min_face_width
            or face_height < thresholds.min_face_height
            or interocular < thresholds.min_interocular
        ):
            reasons.append("rostro_pequeno")
        if sharpness < thresholds.min_sharpness:
            reasons.append("desenfoque")
        if not thresholds.min_median_brightness <= median_brightness <= thresholds.max_median_brightness:
            reasons.append("iluminacion_insuficiente")
        if dynamic_range < thresholds.min_dynamic_range:
            reasons.append("contraste_insuficiente")
        if dark_fraction > thresholds.max_dark_fraction or bright_fraction > thresholds.max_bright_fraction:
            reasons.append("exposicion_recortada")

        pose_score = max(0.0, 1.0 - abs(yaw) / 45.0)
        pose_score *= max(0.0, 1.0 - abs(pitch) / 35.0)
        pose_score *= max(0.0, 1.0 - abs(roll) / 35.0)
        sharpness_score = min(1.0, sharpness / 220.0)
        size_score = min(1.0, min(face_span / 150.0, interocular / 55.0))
        exposure_score = min(1.0, dynamic_range / 90.0)
        exposure_score *= max(0.0, 1.0 - dark_fraction)
        exposure_score *= max(0.0, 1.0 - bright_fraction)
        score = (
            0.30 * pose_score
            + 0.25 * sharpness_score
            + 0.20 * size_score
            + 0.15 * exposure_score
            + 0.10 * float(complete_face)
        )
        return FaceQualityResult(
            accepted=not reasons,
            score=round(float(np.clip(score, 0.0, 1.0)), 4),
            reasons=tuple(reasons),
            mesh_detected=True,
            yaw=round(yaw, 2),
            pitch=round(pitch, 2),
            roll=round(roll, 2),
            face_span=round(face_span, 2),
            face_width=round(face_width, 2),
            face_height=round(face_height, 2),
            interocular=round(interocular, 2),
            sharpness=round(sharpness, 2),
            brightness=round(brightness, 2),
            contrast=round(contrast, 2),
            clipped_fraction=round(clipped_fraction, 4),
            dynamic_range=round(dynamic_range, 2),
            dark_fraction=round(dark_fraction, 4),
            bright_fraction=round(bright_fraction, 4),
            complete_face=complete_face,
            left_ear=round(left_ear, 4),
            right_ear=round(right_ear, 4),
            minimum_ear=round(minimum_ear, 4),
        )

    def __enter__(self) -> "FaceQualityEvaluator":
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self.close()
