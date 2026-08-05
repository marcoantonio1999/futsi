"""Isolated FaceGuard experiment for semantic eye/face visibility.

This script intentionally does not import the station store and never opens SQLite.
It reads existing crops, runs an ONNX face parser, and writes only experiment
artifacts (JSON, CSV, masks, overlays, and a contact sheet).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort


_DLL_DIRECTORY_HANDLES: list[object] = []


FACE_ROOT = Path(r"C:\Users\user\Documents\marco\futsi-face-station-data\faces")
EXPERIMENT_ROOT = Path(
    r"C:\Users\user\Documents\marco\futsi-face-station-data\experiments\face-parsing"
)
DEFAULT_MODEL = EXPERIMENT_ROOT / "models" / "resnet18.onnx"
DEFAULT_MEDIAPIPE_MODEL = Path(
    r"C:\Users\user\Documents\marco\futsi-face-station-data\models\face_landmarker.task"
)


# CelebAMask-HQ class indices used by the selected BiSeNet model.
CLASS_NAMES = [
    "background",
    "skin",
    "l_brow",
    "r_brow",
    "l_eye",
    "r_eye",
    "eye_g",
    "l_ear",
    "r_ear",
    "ear_r",
    "nose",
    "mouth",
    "u_lip",
    "l_lip",
    "neck",
    "neck_l",
    "cloth",
    "hair",
    "hat",
]

COLORS = np.asarray(
    [
        [0, 0, 0],
        [255, 85, 0],
        [255, 170, 0],
        [255, 0, 85],
        [255, 0, 170],
        [0, 255, 0],
        [85, 255, 0],
        [170, 255, 0],
        [0, 255, 85],
        [0, 255, 170],
        [0, 0, 255],
        [85, 0, 255],
        [170, 0, 255],
        [0, 85, 255],
        [0, 170, 255],
        [255, 255, 0],
        [255, 255, 85],
        [255, 255, 170],
        [255, 0, 255],
    ],
    dtype=np.uint8,
)


@dataclass(frozen=True)
class Sample:
    name: str
    relative_path: str
    eyes_visible: bool
    reference_acceptable: bool
    visual_reason: str


SAMPLES = [
    Sample("Desconocido 12442", r"2026-07-26\unknown\c57be931-59b1-45ac-9f9e-e67d897b8c85_1785090273906_90273906.jpg", True, True, "frontal limpio"),
    Sample("Desconocido 12424", r"2026-07-26\unknown\c82beeab-7773-4a6d-9f25-6185df78c307_1785088790431_88790431.jpg", True, True, "frontal limpio"),
    Sample("Desconocido 14456", r"2026-07-30\unknown\4068de73-7188-44ae-89bd-5f316efb02b7_1785455195730_55195730.jpg", True, True, "frontal limpio"),
    Sample("Desconocido 14324", r"2026-07-28\unknown\da7dcd37-33d6-45ee-aea3-d80b8d5b4685_1785266358119_66358119.jpg", True, True, "frontal aceptable"),
    Sample("Desconocido 14325", r"2026-07-28\unknown\203b776e-6975-4560-9617-36f6640bce98_1785266370552_66370552.jpg", True, True, "frontal aceptable"),
    Sample("Desconocido 12094", r"2026-07-25\unknown\459701b3-60b6-461b-9d56-1d2ff744bc29_1785031074676_31074676.jpg", False, False, "mirada baja; ojos no verificables con certeza"),
    Sample("Desconocido 12051", r"2026-07-25\unknown\2e78f8b0-dc27-4c46-abbf-a616a5989e54_1785028457354_28457354.jpg", False, False, "ojos casi cerrados"),
    Sample("Desconocido 11990", r"2026-07-25\unknown\70d87bd2-18d4-4d04-952d-e819b262d530_1785028336268_28336268.jpg", True, True, "frontal aceptable"),
    Sample("Desconocido 14254", r"2026-07-27\unknown\916b9992-4b51-4be1-ab62-b801ccb06f2f_1785194198996_94198996.jpg", False, False, "ojos cerrados por gesto"),
    Sample("Desconocido 12171", r"2026-07-25\unknown\c7c033d7-3858-460f-81bb-5196e28ef730_1785034012071_34012071.jpg", True, True, "frontal aceptable"),
    Sample("Desconocido 14393", r"2026-07-29\unknown\2fd61703-8c28-4196-8fe9-fda98711c5b9_1785350421476_50421476.jpg", False, False, "ojos ocultos y objeto en boca"),
    Sample("Desconocido 14398", r"2026-07-29\unknown\971b5306-8b73-4395-8574-0e34c2a4bf46_1785355606553_55606553.jpg", False, False, "visera cubre ambos ojos"),
    Sample("Desconocido 5D10", r"2026-07-30\unknown\0fc6295f-6cab-4884-8973-7a51d7a77cbb_1785433997693_33997693.jpg", False, False, "lentes completamente oscuros"),
    Sample("Desconocido 5792", r"2026-07-28\unknown\4f5bc658-0c3c-490d-9778-4b36f1bf3c17_1785268910884_68910884.jpg", False, False, "gorra y lentes opacos"),
    Sample("Desconocido 14455", r"2026-07-30\unknown\cb5a4fcd-996d-40bf-bef5-5e0e13b5a9aa_1785455100377_55100377.jpg", False, False, "lentes y otra persona invade recorte"),
    Sample("Desconocido 3A93", r"2026-07-24\unknown\4bd03171-3c7f-4f60-89f4-ce92b5f6a68b_1784956973712_56973712.jpg", False, False, "lentes oscuros y malla"),
    Sample("Desconocido 8E52", r"2026-07-28\unknown\a747cefa-18e5-4c1b-be82-633a2143ebda_1785254497854_54497854.jpg", False, False, "lentes completamente oscuros"),
    Sample("Desconocido 14308", r"2026-07-27\unknown\83c5f843-da23-4983-a914-d0ef1501449d_1785213694426_13694426.jpg", False, False, "lentes oscuros y gorra"),
    Sample("Desconocido 8327", r"2026-07-28\unknown\1b913f2c-53cd-4e5a-b319-ff53a293208c_1785272289271_72289271.jpg", False, False, "lentes ambar; iris no verificable"),
    Sample("Desconocido 7516", r"2026-07-24\unknown\173ac9f4-73fe-4b7c-aca4-c4e883c0f3b3_1784907992729_07992729.jpg", False, False, "ojos bajo sombra fuerte de gorra"),
    Sample("Desconocido 11665", r"2026-07-25\unknown\8188f08e-86d2-46fa-be47-42037163dbbd_1785004159376_04159376.jpg", False, False, "ambos ojos cerrados"),
    Sample("Desconocido 0075", r"2026-07-24\unknown\e1a4b2a5-97b8-4e7b-b265-47fbfca8050b_1784922942279_22942279.jpg", False, False, "media cara tapada por otra persona"),
    Sample("Desconocido 12499", r"2026-07-26\unknown\78085c4d-d395-4896-ab5f-ba4c25de3535_1785097681771_97681771.jpg", True, False, "ojos visibles; botella cubre boca"),
    # Holdout expansion: selected after the initial thresholds above were chosen.
    Sample("Desconocido 7951", r"2026-07-24\unknown\8fb741cf-46aa-40c6-ab6b-9465a1540ba2_1784919307758_19307758.jpg", True, True, "ambos ojos abiertos y nitidos"),
    Sample("Desconocido 1843", r"2026-07-24\unknown\1378ca4e-6729-418d-8845-5c8691865651_1784915784354_15784354.jpg", True, True, "ambos ojos abiertos; mirada lateral leve"),
    Sample("Desconocido 11657", r"2026-07-25\unknown\15dea58d-9346-406f-b3c8-f6de209bfe85_1785003814855_03814855.jpg", True, True, "positivo limpio con ambos ojos abiertos"),
    Sample("Desconocido 6F66", r"2026-07-24\unknown\4ddd1e6a-a619-4510-9584-753b5506f05a_1784933547888_33547888.jpg", True, True, "iris y parpados visibles"),
    Sample("Desconocido 2169", r"2026-07-24\unknown\46a59135-642c-41de-996e-1009884de5bd_1784923171180_23171180.jpg", True, True, "ambos ojos definidos bajo sombra leve"),
    Sample("Desconocido 12539", r"2026-07-26\unknown\05a39a54-505b-482c-8af4-5255368d175e_1785103092557_03092557.jpg", True, True, "ambos ojos abiertos; mirada levemente baja"),
    Sample("Desconocido 12271", r"2026-07-25\unknown\1fd2a63c-300b-4c81-9bc2-9f98b9197bb3_1785037181545_37181545.jpg", True, True, "pupilas visibles y region ocular despejada"),
    Sample("Desconocido 12364", r"2026-07-26\unknown\76606263-cc9b-4740-a896-f703556067c1_1785081855666_81855666.jpg", True, True, "ambos ojos abiertos sin objetos"),
    Sample("Desconocido 14153", r"2026-07-27\unknown\ffdac355-cb4f-49a9-a0aa-42ee9241e033_1785180471810_80471810.jpg", True, True, "frontal limpio y bien iluminado"),
    Sample("Desconocido Q5279CC", r"2026-07-21\unknown\2972279b-4c11-4f9f-a3ee-2bbe52afb7ff_1784682710621.jpg", True, True, "iris claros y parpados completos"),
    Sample("Desconocido 11924", r"2026-07-25\unknown\d74d0232-fbb0-41e3-bcee-8692d5d49bd7_1785025509703_25509703.jpg", True, True, "ambos ojos abiertos con apertura desigual"),
    Sample("Desconocido 11828", r"2026-07-25\unknown\bc0e6c9a-63bd-4cc1-9b38-a768c6072a0f_1785019284476_19284476.jpg", True, True, "ojos definidos; malla fuera de region ocular"),
    Sample("Desconocido 12457", r"2026-07-26\unknown\bd8688ed-861c-416c-a35f-3ecd25731568_1785093967938_93967938.jpg", False, False, "lentes deportivos oscuros"),
    Sample("Desconocido 14381", r"2026-07-29\unknown\4f853a42-bf7b-4e53-9e20-a21a7bd0f0ef_1785347113496_47113496.jpg", False, False, "visera cubre ambos ojos"),
    Sample("Desconocido 14389", r"2026-07-29\unknown\76b5649f-88d8-46e3-bb6e-603c8f1008af_1785348485764_48485764.jpg", False, False, "gorra tapa la region ocular"),
    Sample("Desconocido 14397", r"2026-07-29\unknown\7f8717b9-bb75-4249-a6f9-4dbd1215ddff_1785355606231_55606231.jpg", False, False, "ojos completamente bajo la visera"),
    Sample("Desconocido 14433", r"2026-07-30\unknown\938e2a91-24a4-463e-a6f2-34cee1fb4706_1785435022361_35022361.jpg", False, False, "ojos fuertemente cerrados por el sol"),
    Sample("Desconocido 11922", r"2026-07-25\unknown\4844f810-db64-40ad-868b-7e2241911c43_1785025500644_25500644.jpg", False, False, "ambos parpados cerrados"),
    Sample("Desconocido 14440", r"2026-07-30\unknown\ab2cf272-3dd2-49e2-a246-e35fe302336a_1785441306939_41306939.jpg", False, False, "cabello y mirada baja ocultan un ojo"),
    Sample("Desconocido 14358", r"2026-07-29\unknown\3345d1a4-aecf-4cf1-a84c-679c4f214f51_1785339956128_39956128.jpg", False, False, "reflejo en lentes oculta un iris"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--mediapipe-model", type=Path, default=DEFAULT_MEDIAPIPE_MODEL)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=0, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=0, keepdims=True)


def top_mean(values: np.ndarray, count: int = 256) -> float:
    flat = values.reshape(-1)
    count = min(count, flat.size)
    if count == 0:
        return 0.0
    partitioned = np.partition(flat, flat.size - count)
    return float(partitioned[-count:].mean())


def class_metrics(mask: np.ndarray, probabilities: np.ndarray, class_index: int) -> dict[str, float | int]:
    selected = mask == class_index
    pixel_count = int(selected.sum())
    probability = probabilities[class_index]
    return {
        "pixels": pixel_count,
        "area_ratio": pixel_count / float(mask.size),
        "mean_probability_on_mask": float(probability[selected].mean()) if pixel_count else 0.0,
        "top256_probability": top_mean(probability),
        "probability_mass": float(probability.mean()),
    }


def create_session(model: Path, provider: str) -> ort.InferenceSession:
    if provider == "cuda":
        # Match the station's Windows CUDA bootstrap without importing any
        # production runtime or store modules.
        nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
        bin_directories = [path for path in nvidia_root.glob("*/bin") if path.is_dir()]
        if bin_directories:
            os.environ["PATH"] = os.pathsep.join(
                [*(str(path) for path in bin_directories), os.environ.get("PATH", "")]
            )
            if hasattr(os, "add_dll_directory"):
                for path in bin_directories:
                    _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(path)))
        if hasattr(ort, "preload_dlls"):
            ort.preload_dlls(directory="")
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    else:
        providers = ["CPUExecutionProvider"]
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(str(model), sess_options=options, providers=providers)
    if provider == "cuda" and session.get_providers()[0] != "CUDAExecutionProvider":
        raise RuntimeError(
            "Se solicito CUDA, pero ONNX Runtime no activo CUDAExecutionProvider; "
            f"proveedores reales: {session.get_providers()}"
        )
    return session


def create_face_landmarker(model: Path):
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=False,
    )
    return mp.tasks.vision.FaceLandmarker.create_from_options(options)


def padded_canvas(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    side = max(height, width)
    canvas_side = max(192, int(round(side * 1.35)))
    edge_color = tuple(int(value) for value in np.median(image.reshape(-1, 3), axis=0))
    canvas = np.full((canvas_side, canvas_side, 3), edge_color, dtype=np.uint8)
    offset_x = (canvas_side - width) // 2
    offset_y = (canvas_side - height) // 2
    canvas[offset_y : offset_y + height, offset_x : offset_x + width] = image
    return canvas


def eye_aspect_ratio(points: np.ndarray, indices: tuple[int, int, int, int, int, int]) -> float:
    outer, upper_outer, upper_inner, inner, lower_inner, lower_outer = points[list(indices)]
    horizontal = float(np.linalg.norm(outer - inner))
    if horizontal <= 1e-6:
        return 0.0
    vertical = float(np.linalg.norm(upper_outer - lower_outer) + np.linalg.norm(upper_inner - lower_inner))
    return vertical / (2.0 * horizontal)


def analyze_mesh(landmarker, image: np.ndarray) -> dict[str, float | bool]:
    canvas = padded_canvas(image)
    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
    result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not result.face_landmarks:
        return {
            "mesh_detected": False,
            "left_ear": 0.0,
            "right_ear": 0.0,
            "eye_blink_left": 1.0,
            "eye_blink_right": 1.0,
            "eye_squint_left": 1.0,
            "eye_squint_right": 1.0,
        }
    points = np.asarray([(item.x, item.y) for item in result.face_landmarks[0]], dtype=np.float32)
    blendshapes = {
        item.category_name: float(item.score)
        for item in (result.face_blendshapes[0] if result.face_blendshapes else [])
    }
    return {
        "mesh_detected": True,
        "left_ear": eye_aspect_ratio(points, (33, 160, 158, 133, 153, 144)),
        "right_ear": eye_aspect_ratio(points, (362, 385, 387, 263, 373, 380)),
        "eye_blink_left": blendshapes.get("eyeBlinkLeft", 0.0),
        "eye_blink_right": blendshapes.get("eyeBlinkRight", 0.0),
        "eye_squint_left": blendshapes.get("eyeSquintLeft", 0.0),
        "eye_squint_right": blendshapes.get("eyeSquintRight", 0.0),
    }


def preprocess(image: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (512, 512), interpolation=cv2.INTER_LINEAR)
    tensor = resized.astype(np.float32) / 255.0
    tensor = (tensor - np.asarray([0.485, 0.456, 0.406], dtype=np.float32)) / np.asarray(
        [0.229, 0.224, 0.225], dtype=np.float32
    )
    return np.transpose(tensor, (2, 0, 1))[None].astype(np.float32)


def make_panel(image: np.ndarray, mask: np.ndarray, sample: Sample, metrics: dict) -> np.ndarray:
    size = 320
    original = cv2.resize(image, (size, size), interpolation=cv2.INTER_CUBIC)
    mask_resized = cv2.resize(mask, (size, size), interpolation=cv2.INTER_NEAREST)
    colored = COLORS[mask_resized]
    overlay = cv2.addWeighted(original, 0.62, colored, 0.38, 0)

    panel = np.full((size + 76, size * 2, 3), 250, dtype=np.uint8)
    panel[:size, :size] = original
    panel[:size, size:] = overlay
    expected = "VISIBLE" if sample.eyes_visible else "OCCLUDED"
    predicted = "VISIBLE" if metrics["strict_eyes_predicted"] else "REJECT"
    title = f"{sample.name} | expected {expected} | predicted {predicted}"
    detail = (
        f"eyes px {metrics['l_eye_pixels']}/{metrics['r_eye_pixels']}  "
        f"topP {metrics['l_eye_top256_probability']:.2f}/{metrics['r_eye_top256_probability']:.2f}"
    )
    detail2 = (
        f"semantic {metrics['semantic_both_eye_confidence']:.2f}  EAR {metrics['minimum_ear']:.2f}  "
        f"glasses {metrics['eye_g_area_ratio']:.3f}  hat {metrics['hat_area_ratio']:.3f}  oral {metrics['oral_area_ratio']:.3f}"
    )
    color = (15, 115, 45) if sample.eyes_visible == metrics["strict_eyes_predicted"] else (30, 30, 190)
    cv2.putText(panel, title, (10, size + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 1, cv2.LINE_AA)
    cv2.putText(panel, detail, (10, size + 45), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (35, 35, 35), 1, cv2.LINE_AA)
    cv2.putText(panel, detail2, (10, size + 66), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (35, 35, 35), 1, cv2.LINE_AA)
    return panel


def build_contact_sheet(panels: list[np.ndarray], columns: int = 3) -> np.ndarray:
    rows = math.ceil(len(panels) / columns)
    panel_h, panel_w = panels[0].shape[:2]
    sheet = np.full((rows * panel_h, columns * panel_w, 3), 235, dtype=np.uint8)
    for index, panel in enumerate(panels):
        row, column = divmod(index, columns)
        sheet[row * panel_h : (row + 1) * panel_h, column * panel_w : (column + 1) * panel_w] = panel
    return sheet


def main() -> int:
    args = parse_args()
    if not args.model.is_file():
        raise FileNotFoundError(args.model)
    if not args.mediapipe_model.is_file():
        raise FileNotFoundError(args.mediapipe_model)

    output = args.output or (
        EXPERIMENT_ROOT / "outputs" / datetime.now().strftime("run-%Y%m%d-%H%M%S")
    )
    masks_dir = output / "masks"
    overlays_dir = output / "overlays"
    masks_dir.mkdir(parents=True, exist_ok=False)
    overlays_dir.mkdir(parents=True, exist_ok=False)

    started = time.perf_counter()
    session = create_session(args.model, args.provider)
    load_ms = (time.perf_counter() - started) * 1000.0
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    landmarker = create_face_landmarker(args.mediapipe_model)

    records: list[dict] = []
    panels: list[np.ndarray] = []
    for index, sample in enumerate(SAMPLES):
        image_path = FACE_ROOT / sample.relative_path
        image = cv2.imread(str(image_path))
        if image is None:
            raise FileNotFoundError(image_path)

        tensor = preprocess(image)
        tick = time.perf_counter()
        logits = session.run([output_name], {input_name: tensor})[0][0]
        latency_ms = (time.perf_counter() - tick) * 1000.0
        probabilities = softmax(logits)
        mask_512 = logits.argmax(axis=0).astype(np.uint8)
        mask = cv2.resize(mask_512, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
        mesh_metrics = analyze_mesh(landmarker, image)

        per_class = {
            CLASS_NAMES[class_index]: class_metrics(mask_512, probabilities, class_index)
            for class_index in range(1, len(CLASS_NAMES))
        }
        oral_area_ratio = sum(per_class[name]["area_ratio"] for name in ("mouth", "u_lip", "l_lip"))
        semantic_both_eye_confidence = min(
            float(per_class["l_eye"]["top256_probability"]),
            float(per_class["r_eye"]["top256_probability"]),
        )
        minimum_ear = min(float(mesh_metrics["left_ear"]), float(mesh_metrics["right_ear"]))
        glasses_area_ratio = float(per_class["eye_g"]["area_ratio"])
        hat_area_ratio = float(per_class["hat"]["area_ratio"])

        # Conservative experimental rule: false acceptance is more damaging than
        # waiting for a later, cleaner crop. These values are calibration
        # candidates, not production thresholds.
        bare_eye_evidence = (
            glasses_area_ratio < 0.02
            and semantic_both_eye_confidence >= 0.30
            and minimum_ear >= 0.18
        )
        clear_glasses_evidence = (
            glasses_area_ratio >= 0.02
            and semantic_both_eye_confidence >= 0.10
            and minimum_ear >= 0.20
        )
        strict_eyes_predicted = bool(
            mesh_metrics["mesh_detected"]
            and hat_area_ratio < 0.15
            and (bare_eye_evidence or clear_glasses_evidence)
        )
        strict_reference_predicted = bool(strict_eyes_predicted and oral_area_ratio >= 0.002)
        record = {
            "index": index,
            **asdict(sample),
            "path": str(image_path),
            "width": int(image.shape[1]),
            "height": int(image.shape[0]),
            "provider": session.get_providers()[0],
            "latency_ms": latency_ms,
            "oral_area_ratio": oral_area_ratio,
            "semantic_both_eye_confidence": semantic_both_eye_confidence,
            "minimum_ear": minimum_ear,
            "bare_eye_evidence": bare_eye_evidence,
            "clear_glasses_evidence": clear_glasses_evidence,
            "strict_eyes_predicted": strict_eyes_predicted,
            "strict_reference_predicted": strict_reference_predicted,
            **mesh_metrics,
        }
        for class_name, values in per_class.items():
            for metric_name, value in values.items():
                record[f"{class_name}_{metric_name}"] = value
        records.append(record)

        safe_name = f"{index:02d}_{sample.name.replace(' ', '_')}"
        cv2.imwrite(str(masks_dir / f"{safe_name}.png"), mask)
        panel = make_panel(image, mask, sample, record)
        panels.append(panel)
        cv2.imwrite(str(overlays_dir / f"{safe_name}.jpg"), panel, [cv2.IMWRITE_JPEG_QUALITY, 94])

    with (output / "report.json").open("w", encoding="utf-8") as handle:
        json.dump(
            {
                "model": str(args.model),
                "requested_provider": args.provider,
                "actual_provider": session.get_providers()[0],
                "model_load_ms": load_ms,
                "sample_count": len(records),
                "records": records,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )

    with (output / "report.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(records[0].keys()))
        writer.writeheader()
        writer.writerows(records)

    sheet = build_contact_sheet(panels)
    cv2.imwrite(str(output / "contact-sheet.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 94])
    landmarker.close()

    latency = np.asarray([record["latency_ms"] for record in records], dtype=np.float64)
    eye_tp = sum(bool(item["eyes_visible"]) and bool(item["strict_eyes_predicted"]) for item in records)
    eye_tn = sum(not bool(item["eyes_visible"]) and not bool(item["strict_eyes_predicted"]) for item in records)
    eye_fp = sum(not bool(item["eyes_visible"]) and bool(item["strict_eyes_predicted"]) for item in records)
    eye_fn = sum(bool(item["eyes_visible"]) and not bool(item["strict_eyes_predicted"]) for item in records)
    reference_tp = sum(
        bool(item["reference_acceptable"]) and bool(item["strict_reference_predicted"])
        for item in records
    )
    reference_tn = sum(
        not bool(item["reference_acceptable"]) and not bool(item["strict_reference_predicted"])
        for item in records
    )
    reference_fp = sum(
        not bool(item["reference_acceptable"]) and bool(item["strict_reference_predicted"])
        for item in records
    )
    reference_fn = sum(
        bool(item["reference_acceptable"]) and not bool(item["strict_reference_predicted"])
        for item in records
    )
    summary = {
        "output": str(output),
        "provider": session.get_providers()[0],
        "model_load_ms": round(load_ms, 2),
        "samples": len(records),
        "latency_ms_median": round(float(np.median(latency)), 2),
        "latency_ms_p95": round(float(np.percentile(latency, 95)), 2),
        "eye_confusion": {"tp": eye_tp, "tn": eye_tn, "fp": eye_fp, "fn": eye_fn},
        "reference_confusion": {
            "tp": reference_tp,
            "tn": reference_tn,
            "fp": reference_fp,
            "fn": reference_fn,
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
