#!/usr/bin/env bash
set -euo pipefail

DEVICE="${1:-/dev/video0}"
PORT="${2:-8080}"
FPS="${3:-15}"
REQUESTED_RESOLUTION="${4:-auto}"
USTREAMER="${FUTSI_USTREAMER_BIN:-$(command -v ustreamer)}"
FFMPEG="${FUTSI_FFMPEG_BIN:-$(command -v ffmpeg || true)}"
BACKEND="${FUTSI_CAMERA_BACKEND:-auto}"

select_largest_mjpeg_resolution() {
  v4l2-ctl -d "${DEVICE}" --list-formats-ext | awk '
    /^[[:space:]]*\[[0-9]+\]:/ {
      in_mjpeg = ($0 ~ /'\''MJPG'\''/)
    }
    in_mjpeg && /Size: Discrete/ {
      if (match($0, /[0-9]+x[0-9]+/)) {
        resolution = substr($0, RSTART, RLENGTH)
        split(resolution, dimensions, "x")
        pixels = dimensions[1] * dimensions[2]
        if (pixels > largest_pixels) {
          largest_pixels = pixels
          largest_resolution = resolution
        }
      }
    }
    END {
      print largest_resolution
    }
  '
}

select_backend() {
  case "${BACKEND}" in
    ustreamer|v4l2-ffmpeg)
      printf '%s\n' "${BACKEND}"
      ;;
    auto)
      local properties=""
      if command -v udevadm >/dev/null 2>&1; then
        properties="$(udevadm info --query=property --name="${DEVICE}" 2>/dev/null || true)"
      fi
      if grep -qx 'ID_VENDOR_ID=32e4' <<<"${properties}" \
        && grep -qx 'ID_MODEL_ID=6678' <<<"${properties}"; then
        printf '%s\n' 'v4l2-ffmpeg'
      else
        printf '%s\n' 'ustreamer'
      fi
      ;;
    *)
      echo "Backend de camara no valido: ${BACKEND}" >&2
      exit 2
      ;;
  esac
}

if [[ "${REQUESTED_RESOLUTION}" == "auto" ]]; then
  RESOLUTION="$(select_largest_mjpeg_resolution)"
  if [[ -z "${RESOLUTION}" ]]; then
    echo "No se encontro un modo MJPEG discreto en ${DEVICE}" >&2
    exit 1
  fi
else
  RESOLUTION="${REQUESTED_RESOLUTION}"
fi

SELECTED_BACKEND="$(select_backend)"
echo "Faceguard camera: ${DEVICE}, MJPEG ${RESOLUTION}, hasta ${FPS} FPS, backend ${SELECTED_BACKEND}"

if [[ "${SELECTED_BACKEND}" == "v4l2-ffmpeg" ]]; then
  if [[ -z "${FFMPEG}" ]]; then
    echo "El backend v4l2-ffmpeg requiere ffmpeg" >&2
    exit 1
  fi
  IFS=x read -r WIDTH HEIGHT <<<"${RESOLUTION}"
  RUNTIME_DIR="$(mktemp -d /tmp/futsi-camera.XXXXXX)"
  FRAME_PIPE="${RUNTIME_DIR}/camera.mjpg"
  CAPTURE_PID=""
  FFMPEG_PID=""

  cleanup_bridge() {
    trap - EXIT INT TERM
    if [[ -n "${FFMPEG_PID}" ]]; then
      kill "${FFMPEG_PID}" 2>/dev/null || true
    fi
    if [[ -n "${CAPTURE_PID}" ]]; then
      kill "${CAPTURE_PID}" 2>/dev/null || true
    fi
    wait "${FFMPEG_PID}" 2>/dev/null || true
    wait "${CAPTURE_PID}" 2>/dev/null || true
    rm -f -- "${FRAME_PIPE}"
    rmdir -- "${RUNTIME_DIR}" 2>/dev/null || true
  }

  trap cleanup_bridge EXIT
  trap 'exit 143' INT TERM
  mkfifo -- "${FRAME_PIPE}"

  v4l2-ctl \
    --device="${DEVICE}" \
    --set-fmt-video="width=${WIDTH},height=${HEIGHT},pixelformat=MJPG" \
    --set-parm="${FPS}" \
    --stream-mmap=3 \
    --stream-poll \
    --stream-to="${FRAME_PIPE}" &
  CAPTURE_PID="$!"

  "${FFMPEG}" \
    -hide_banner \
    -loglevel warning \
    -f mjpeg \
    -framerate "${FPS}" \
    -i "${FRAME_PIPE}" \
    -an \
    -c:v copy \
    -f mpjpeg \
    -listen 1 \
    "http://0.0.0.0:${PORT}/stream" &
  FFMPEG_PID="$!"
  wait "${FFMPEG_PID}"
else
  exec "${USTREAMER}" \
    --device="${DEVICE}" \
    --resolution="${RESOLUTION}" \
    --format=MJPEG \
    --encoder=HW \
    --desired-fps="${FPS}" \
    --buffers=3 \
    --workers=1 \
    --host=0.0.0.0 \
    --port="${PORT}" \
    --tcp-nodelay \
    --no-log-colors
fi
