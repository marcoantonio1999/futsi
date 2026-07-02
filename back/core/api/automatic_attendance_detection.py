from __future__ import annotations

import math
import os

from core.services.face_insight import FaceDetection, FaceEmbedding, detect_embeddings, detect_face_boxes, get_face_app


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_flag(name: str, default: bool = True) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _clip_bbox(bbox: tuple[int, int, int, int], width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    return max(0, x1), max(0, y1), min(width, x2), min(height, y2)


def _padded_bbox(bbox: tuple[int, int, int, int], width: int, height: int, padding: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    return _clip_bbox((x1 - padding, y1 - padding, x2 + padding, y2 + padding), width, height)


def _scale_bbox_to_original(bbox: tuple[int, int, int, int], scale: float, width: int, height: int) -> tuple[int, int, int, int]:
    if scale <= 0:
        return _clip_bbox(bbox, width, height)
    x1, y1, x2, y2 = bbox
    mapped = (
        int(round(x1 / scale)),
        int(round(y1 / scale)),
        int(round(x2 / scale)),
        int(round(y2 / scale)),
    )
    return _clip_bbox(mapped, width, height)


def resize_for_face_detection(frame, max_dimension: int):
    import cv2

    if max_dimension <= 0:
        return frame, 1.0
    height, width = frame.shape[:2]
    largest = max(width, height)
    if largest <= max_dimension:
        return frame, 1.0
    scale = max_dimension / largest
    resized = cv2.resize(
        frame,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_AREA,
    )
    return resized, scale


def _pad_to_stride(frame, stride: int = 32):
    import numpy as np

    height, width = frame.shape[:2]
    padded_height = int(math.ceil(height / stride) * stride)
    padded_width = int(math.ceil(width / stride) * stride)
    if padded_height == height and padded_width == width:
        return frame, height, width
    padded = np.zeros((padded_height, padded_width, 3), dtype=frame.dtype)
    padded[:height, :width] = frame
    return padded, height, width


def detect_face_boxes_fast_onnx(frame, providers_key: str = "auto", max_dimension: int | None = None) -> list[FaceDetection]:
    import cv2
    import numpy as np
    from insightface.model_zoo.scrfd import distance2bbox

    max_dimension = _env_int("AUTO_ATTENDANCE_DETECT_MAX_DIMENSION", 1280) if max_dimension is None else max_dimension
    score_threshold = float(os.getenv("AUTO_ATTENDANCE_PROBE_MIN_DET_SCORE", os.getenv("AUTO_ATTENDANCE_MIN_DET_SCORE", "0.45")))
    scan_frame, scale = resize_for_face_detection(frame, max_dimension)
    scan_frame, real_height, real_width = _pad_to_stride(scan_frame, 32)

    app = get_face_app(providers_key=providers_key)
    detector = app.models.get("detection")
    if detector is None:
        return detect_face_boxes(frame, providers_key=providers_key)

    input_height, input_width = scan_frame.shape[:2]
    blob = cv2.dnn.blobFromImage(
        scan_frame,
        1.0 / detector.input_std,
        (input_width, input_height),
        (detector.input_mean, detector.input_mean, detector.input_mean),
        swapRB=True,
    )
    outputs = detector.session.run(detector.output_names, {detector.input_name: blob})
    scores_list = []
    boxes_list = []
    fmc = detector.fmc
    for index, stride in enumerate(detector._feat_stride_fpn):
        scores = outputs[index]
        box_predictions = outputs[index + fmc] * stride
        if getattr(detector, "batched", False):
            scores = scores[0]
            box_predictions = box_predictions[0]
        scores = scores.reshape(-1)

        feature_height = blob.shape[2] // stride
        feature_width = blob.shape[3] // stride
        cache_key = (feature_height, feature_width, stride)
        centers = detector.center_cache.get(cache_key)
        if centers is None:
            centers = np.stack(np.mgrid[:feature_height, :feature_width][::-1], axis=-1).astype(np.float32)
            centers = (centers * stride).reshape((-1, 2))
            if detector._num_anchors > 1:
                centers = np.stack([centers] * detector._num_anchors, axis=1).reshape((-1, 2))
            if len(detector.center_cache) < 100:
                detector.center_cache[cache_key] = centers

        positive_indices = np.where(scores >= score_threshold)[0]
        if positive_indices.size == 0:
            continue
        decoded_boxes = distance2bbox(centers, box_predictions)
        scores_list.append(scores[positive_indices])
        boxes_list.append(decoded_boxes[positive_indices])

    if not scores_list:
        return []

    scores = np.concatenate(scores_list).reshape(-1, 1)
    boxes = np.vstack(boxes_list)
    pre_nms = np.hstack((boxes, scores)).astype(np.float32, copy=False)
    pre_nms[:, 0] = np.clip(pre_nms[:, 0], 0, real_width)
    pre_nms[:, 2] = np.clip(pre_nms[:, 2], 0, real_width)
    pre_nms[:, 1] = np.clip(pre_nms[:, 1], 0, real_height)
    pre_nms[:, 3] = np.clip(pre_nms[:, 3], 0, real_height)
    valid = (pre_nms[:, 2] > pre_nms[:, 0]) & (pre_nms[:, 3] > pre_nms[:, 1])
    pre_nms = pre_nms[valid]
    if pre_nms.shape[0] == 0:
        return []

    pre_nms = pre_nms[pre_nms[:, 4].argsort()[::-1]]
    keep = detector.nms(pre_nms)
    detections = pre_nms[keep]
    frame_height, frame_width = frame.shape[:2]
    inverse_scale = 1.0 / max(scale, 1e-12)
    return [
        FaceDetection(
            bbox=_clip_bbox(
                (
                    int(round(x1 * inverse_scale)),
                    int(round(y1 * inverse_scale)),
                    int(round(x2 * inverse_scale)),
                    int(round(y2 * inverse_scale)),
                ),
                frame_width,
                frame_height,
            ),
            det_score=float(score),
        )
        for x1, y1, x2, y2, score in detections
    ]


def detect_faces_hybrid(frame, providers_key: str = "auto", max_dimension: int | None = None) -> list[FaceEmbedding]:
    max_dimension = _env_int("AUTO_ATTENDANCE_DETECT_MAX_DIMENSION", 1280) if max_dimension is None else max_dimension
    crop_padding = max(0, _env_int("AUTO_ATTENDANCE_DETECT_CROP_PADDING", 48))
    redetect_crops = _env_flag("AUTO_ATTENDANCE_REDETECT_ORIGINAL_CROPS", False)

    scan_frame, scale = resize_for_face_detection(frame, max_dimension)
    coarse_faces = detect_embeddings(scan_frame, providers_key=providers_key)
    if scale == 1.0 or not coarse_faces:
        return coarse_faces

    height, width = frame.shape[:2]
    detections: list[FaceEmbedding] = []
    for coarse_face in coarse_faces:
        original_bbox = _scale_bbox_to_original(coarse_face.bbox, scale, width, height)
        if not redetect_crops:
            detections.append(FaceEmbedding(coarse_face.embedding, original_bbox, coarse_face.det_score))
            continue

        crop_x1, crop_y1, crop_x2, crop_y2 = _padded_bbox(original_bbox, width, height, crop_padding)
        crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]
        if crop.size:
            crop_faces = detect_embeddings(crop, providers_key=providers_key)
            if crop_faces:
                best_crop_face = max(crop_faces, key=lambda item: item.det_score)
                x1, y1, x2, y2 = best_crop_face.bbox
                detections.append(
                    FaceEmbedding(
                        best_crop_face.embedding,
                        _clip_bbox((x1 + crop_x1, y1 + crop_y1, x2 + crop_x1, y2 + crop_y1), width, height),
                        best_crop_face.det_score,
                    )
                )
                continue

        detections.append(FaceEmbedding(coarse_face.embedding, original_bbox, coarse_face.det_score))
    return detections


def detect_face_boxes_hybrid(frame, providers_key: str = "auto", max_dimension: int | None = None) -> list[FaceDetection]:
    if _env_flag("AUTO_ATTENDANCE_FAST_ONNX_PROBE", True):
        try:
            return detect_face_boxes_fast_onnx(frame, providers_key=providers_key, max_dimension=max_dimension)
        except Exception:
            pass
    max_dimension = _env_int("AUTO_ATTENDANCE_DETECT_MAX_DIMENSION", 1280) if max_dimension is None else max_dimension
    scan_frame, scale = resize_for_face_detection(frame, max_dimension)
    coarse_faces = detect_face_boxes(scan_frame, providers_key=providers_key)
    if scale == 1.0 or not coarse_faces:
        return coarse_faces

    height, width = frame.shape[:2]
    detections: list[FaceDetection] = []
    for coarse_face in coarse_faces:
        detections.append(
            FaceDetection(
                bbox=_scale_bbox_to_original(coarse_face.bbox, scale, width, height),
                det_score=coarse_face.det_score,
            )
        )
    return detections
