from __future__ import annotations

import ctypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np


class NvJpegCudaError(RuntimeError):
    """Raised when the local nvJPEG/CUDA pipeline cannot decode a batch."""


class _NvJpegImage(ctypes.Structure):
    _fields_ = [
        ("channel", ctypes.c_void_p * 4),
        ("pitch", ctypes.c_size_t * 4),
    ]


class _NppiSize(ctypes.Structure):
    _fields_ = [("width", ctypes.c_int), ("height", ctypes.c_int)]


class _NppiRect(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
    ]


@dataclass(frozen=True)
class NvJpegImageInfo:
    width: int
    height: int
    components: int
    subsampling: int


class NvJpegCudaBatch:
    """Owns decoded source frames on CUDA until their evidence is extracted."""

    def __init__(
        self,
        decoder: "NvJpegCudaDecoder",
        resized_frames: Sequence[np.ndarray],
        source_devices: Sequence[ctypes.c_void_p],
        source_shapes: Sequence[tuple[int, int]],
    ) -> None:
        self._decoder = decoder
        self.resized_frames = tuple(resized_frames)
        self._source_devices = list(source_devices)
        self.source_shapes = tuple(source_shapes)
        self._closed = False

    def copy_original(self, index: int) -> np.ndarray:
        if self._closed:
            raise NvJpegCudaError("El lote nvJPEG ya fue liberado.")
        height, width = self.source_shapes[index]
        frame = np.empty((height, width, 3), dtype=np.uint8)
        self._decoder._cuda_check(
            self._decoder._cudart.cudaMemcpy(
                ctypes.c_void_p(frame.ctypes.data),
                self._source_devices[index],
                frame.nbytes,
                self._decoder.CUDA_MEMCPY_DEVICE_TO_HOST,
            ),
            "cudaMemcpy(frame original)",
        )
        return frame

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for pointer in self._source_devices:
            self._decoder._cudart.cudaFree(pointer)
        self._source_devices.clear()

    def __enter__(self) -> "NvJpegCudaBatch":
        return self

    def __exit__(self, *_args) -> None:
        self.close()


class NvJpegCudaDecoder:
    """Decode independent MJPEG packets with nvJPEG and resize with CUDA NPP.

    Turing NVDEC only exposes MJPEG 4:2:0 through FFmpeg. nvJPEG's CUDA
    backend also accepts the 4:2:2 JPEGs produced by the ELP camera, so the
    compressed packets can be sampled before any decode work is performed.
    """

    NVJPEG_OUTPUT_BGRI = 6
    NVJPEG_BACKEND_GPU_HYBRID = 2
    NPPI_INTER_LINEAR = 2
    CUDA_MEMCPY_DEVICE_TO_HOST = 2

    def __init__(self, cuda_bin: str | Path | None = None) -> None:
        if os.name != "nt":
            raise NvJpegCudaError("La integracion nvJPEG local requiere Windows.")
        self.cuda_bin = self._find_cuda_bin(cuda_bin)
        self._dll_directory = os.add_dll_directory(str(self.cuda_bin))
        self._nvjpeg = ctypes.WinDLL(str(self._find_dll("nvjpeg64_*.dll")))
        self._cudart = ctypes.WinDLL(str(self._find_dll("cudart64_*.dll")))
        self._npp = ctypes.WinDLL(str(self._find_dll("nppig64_*.dll")))
        self._bind()
        self._handle = ctypes.c_void_p()
        self._state = ctypes.c_void_p()
        self._nvjpeg_check(
            self._nvjpeg.nvjpegCreateEx(
                self.NVJPEG_BACKEND_GPU_HYBRID,
                None,
                None,
                0,
                ctypes.byref(self._handle),
            ),
            "nvjpegCreateEx",
        )
        try:
            self._nvjpeg_check(
                self._nvjpeg.nvjpegJpegStateCreate(
                    self._handle,
                    ctypes.byref(self._state),
                ),
                "nvjpegJpegStateCreate",
            )
        except Exception:
            self._nvjpeg.nvjpegDestroy(self._handle)
            raise
        self._closed = False

    @staticmethod
    def _find_cuda_bin(configured: str | Path | None) -> Path:
        candidates: list[Path] = []
        if configured:
            candidates.append(Path(configured))
        cuda_path = os.environ.get("CUDA_PATH", "").strip()
        if cuda_path:
            candidates.append(Path(cuda_path) / "bin")
        toolkit_root = Path(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA")
        if toolkit_root.is_dir():
            candidates.extend(
                path / "bin"
                for path in sorted(toolkit_root.glob("v*"), reverse=True)
            )
        for candidate in candidates:
            if candidate.is_dir() and any(candidate.glob("nvjpeg64_*.dll")):
                return candidate.resolve()
        raise NvJpegCudaError("No se encontro nvJPEG en la instalacion CUDA local.")

    def _find_dll(self, pattern: str) -> Path:
        matches = sorted(self.cuda_bin.glob(pattern), reverse=True)
        if not matches:
            raise NvJpegCudaError(f"No se encontro {pattern} en {self.cuda_bin}.")
        return matches[0]

    def _bind(self) -> None:
        self._nvjpeg.nvjpegCreateEx.argtypes = [
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_uint,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        self._nvjpeg.nvjpegCreateEx.restype = ctypes.c_int
        self._nvjpeg.nvjpegDestroy.argtypes = [ctypes.c_void_p]
        self._nvjpeg.nvjpegDestroy.restype = ctypes.c_int
        self._nvjpeg.nvjpegJpegStateCreate.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        self._nvjpeg.nvjpegJpegStateCreate.restype = ctypes.c_int
        self._nvjpeg.nvjpegJpegStateDestroy.argtypes = [ctypes.c_void_p]
        self._nvjpeg.nvjpegJpegStateDestroy.restype = ctypes.c_int
        self._nvjpeg.nvjpegGetImageInfo.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_int),
        ]
        self._nvjpeg.nvjpegGetImageInfo.restype = ctypes.c_int
        self._nvjpeg.nvjpegDecodeBatchedInitialize.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
        ]
        self._nvjpeg.nvjpegDecodeBatchedInitialize.restype = ctypes.c_int
        self._nvjpeg.nvjpegDecodeBatched.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.c_size_t),
            ctypes.POINTER(_NvJpegImage),
            ctypes.c_void_p,
        ]
        self._nvjpeg.nvjpegDecodeBatched.restype = ctypes.c_int
        self._cudart.cudaMalloc.argtypes = [
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.c_size_t,
        ]
        self._cudart.cudaMalloc.restype = ctypes.c_int
        self._cudart.cudaFree.argtypes = [ctypes.c_void_p]
        self._cudart.cudaFree.restype = ctypes.c_int
        self._cudart.cudaMemcpy.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.c_int,
        ]
        self._cudart.cudaMemcpy.restype = ctypes.c_int
        self._cudart.cudaDeviceSynchronize.argtypes = []
        self._cudart.cudaDeviceSynchronize.restype = ctypes.c_int
        self._cudart.cudaMemGetInfo.argtypes = [
            ctypes.POINTER(ctypes.c_size_t),
            ctypes.POINTER(ctypes.c_size_t),
        ]
        self._cudart.cudaMemGetInfo.restype = ctypes.c_int
        self._npp.nppiResize_8u_C3R.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            _NppiSize,
            _NppiRect,
            ctypes.c_void_p,
            ctypes.c_int,
            _NppiSize,
            _NppiRect,
            ctypes.c_int,
        ]
        self._npp.nppiResize_8u_C3R.restype = ctypes.c_int

    def image_info(self, jpeg: bytes) -> NvJpegImageInfo:
        payload = ctypes.create_string_buffer(jpeg)
        components = ctypes.c_int()
        subsampling = ctypes.c_int()
        widths = (ctypes.c_int * 4)()
        heights = (ctypes.c_int * 4)()
        self._nvjpeg_check(
            self._nvjpeg.nvjpegGetImageInfo(
                self._handle,
                payload,
                len(jpeg),
                ctypes.byref(components),
                ctypes.byref(subsampling),
                widths,
                heights,
            ),
            "nvjpegGetImageInfo",
        )
        if widths[0] <= 0 or heights[0] <= 0:
            raise NvJpegCudaError("nvJPEG devolvio dimensiones invalidas.")
        return NvJpegImageInfo(
            width=int(widths[0]),
            height=int(heights[0]),
            components=int(components.value),
            subsampling=int(subsampling.value),
        )

    def recommended_batch_size(
        self,
        info: NvJpegImageInfo,
        target_width: int,
        target_height: int,
        requested: int = 64,
    ) -> int:
        free_bytes = ctypes.c_size_t()
        total_bytes = ctypes.c_size_t()
        self._cuda_check(
            self._cudart.cudaMemGetInfo(
                ctypes.byref(free_bytes),
                ctypes.byref(total_bytes),
            ),
            "cudaMemGetInfo",
        )
        bytes_per_frame = (
            info.width * info.height * 3 + target_width * target_height * 3
        )
        memory_budget = int(free_bytes.value * 0.40)
        by_memory = max(1, memory_budget // max(bytes_per_frame, 1))
        return max(1, min(int(requested), int(by_memory)))

    def decode_resize_batch(
        self,
        payloads: Sequence[bytes],
        target_width: int,
        target_height: int,
    ) -> NvJpegCudaBatch:
        if self._closed:
            raise NvJpegCudaError("El decodificador nvJPEG esta cerrado.")
        if not payloads:
            raise NvJpegCudaError("No hay JPEG para decodificar.")
        target_width = int(target_width)
        target_height = int(target_height)
        if target_width <= 0 or target_height <= 0:
            raise NvJpegCudaError("El tamano de salida nvJPEG es invalido.")

        buffers = [ctypes.create_string_buffer(payload) for payload in payloads]
        pointers = (ctypes.c_void_p * len(buffers))(
            *(ctypes.cast(buffer, ctypes.c_void_p) for buffer in buffers)
        )
        lengths = (ctypes.c_size_t * len(buffers))(
            *(len(payload) for payload in payloads)
        )
        infos = [self.image_info(payload) for payload in payloads]
        source_devices: list[ctypes.c_void_p] = []
        resized_devices: list[ctypes.c_void_p] = []
        destinations = (_NvJpegImage * len(payloads))()
        resized_frames: list[np.ndarray] = []
        try:
            for index, info in enumerate(infos):
                source = ctypes.c_void_p()
                resized = ctypes.c_void_p()
                self._cuda_check(
                    self._cudart.cudaMalloc(
                        ctypes.byref(source),
                        info.width * info.height * 3,
                    ),
                    "cudaMalloc(frame nvJPEG)",
                )
                source_devices.append(source)
                self._cuda_check(
                    self._cudart.cudaMalloc(
                        ctypes.byref(resized),
                        target_width * target_height * 3,
                    ),
                    "cudaMalloc(frame reducido)",
                )
                resized_devices.append(resized)
                destinations[index].channel[0] = source
                destinations[index].pitch[0] = info.width * 3

            self._nvjpeg_check(
                self._nvjpeg.nvjpegDecodeBatchedInitialize(
                    self._handle,
                    self._state,
                    len(payloads),
                    min(4, len(payloads)),
                    self.NVJPEG_OUTPUT_BGRI,
                ),
                "nvjpegDecodeBatchedInitialize",
            )
            self._nvjpeg_check(
                self._nvjpeg.nvjpegDecodeBatched(
                    self._handle,
                    self._state,
                    pointers,
                    lengths,
                    destinations,
                    None,
                ),
                "nvjpegDecodeBatched",
            )
            for source, resized, info in zip(
                source_devices,
                resized_devices,
                infos,
                strict=True,
            ):
                self._npp_check(
                    self._npp.nppiResize_8u_C3R(
                        source,
                        info.width * 3,
                        _NppiSize(info.width, info.height),
                        _NppiRect(0, 0, info.width, info.height),
                        resized,
                        target_width * 3,
                        _NppiSize(target_width, target_height),
                        _NppiRect(0, 0, target_width, target_height),
                        self.NPPI_INTER_LINEAR,
                    ),
                    "nppiResize_8u_C3R",
                )
            self._cuda_check(
                self._cudart.cudaDeviceSynchronize(),
                "cudaDeviceSynchronize(nvJPEG)",
            )
            for resized in resized_devices:
                frame = np.empty((target_height, target_width, 3), dtype=np.uint8)
                self._cuda_check(
                    self._cudart.cudaMemcpy(
                        ctypes.c_void_p(frame.ctypes.data),
                        resized,
                        frame.nbytes,
                        self.CUDA_MEMCPY_DEVICE_TO_HOST,
                    ),
                    "cudaMemcpy(frame reducido)",
                )
                resized_frames.append(frame)
        except Exception:
            for pointer in source_devices:
                self._cudart.cudaFree(pointer)
            raise
        finally:
            for pointer in resized_devices:
                self._cudart.cudaFree(pointer)

        return NvJpegCudaBatch(
            self,
            resized_frames,
            source_devices,
            [(info.height, info.width) for info in infos],
        )

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._state:
            self._nvjpeg.nvjpegJpegStateDestroy(self._state)
            self._state = ctypes.c_void_p()
        if self._handle:
            self._nvjpeg.nvjpegDestroy(self._handle)
            self._handle = ctypes.c_void_p()
        self._dll_directory.close()

    def __enter__(self) -> "NvJpegCudaDecoder":
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    @staticmethod
    def _nvjpeg_check(status: int, operation: str) -> None:
        if int(status) != 0:
            raise NvJpegCudaError(f"{operation} fallo con codigo nvJPEG {status}.")

    @staticmethod
    def _cuda_check(status: int, operation: str) -> None:
        if int(status) != 0:
            raise NvJpegCudaError(f"{operation} fallo con codigo CUDA {status}.")

    @staticmethod
    def _npp_check(status: int, operation: str) -> None:
        if int(status) != 0:
            raise NvJpegCudaError(f"{operation} fallo con codigo NPP {status}.")
