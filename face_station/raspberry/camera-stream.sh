#!/usr/bin/env bash
set -euo pipefail

DEVICE="${1:-/dev/video0}"
PORT="${2:-8080}"
FPS="${3:-15}"
REQUESTED_RESOLUTION="${4:-auto}"
USTREAMER="${FUTSI_USTREAMER_BIN:-$(command -v ustreamer)}"
MJPEG_RELAY="${FUTSI_MJPEG_RELAY_BIN:-/usr/local/bin/faceguard-mjpeg-relay}"
MJPEG_RELAY_MAX_FPS="${FUTSI_MJPEG_RELAY_MAX_FPS:-0}"
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
    ustreamer)
      printf '%s\n' "${BACKEND}"
      ;;
    v4l2-relay|v4l2-ffmpeg)
      # v4l2-ffmpeg remains accepted for existing Raspberry installations.
      printf '%s\n' 'v4l2-relay'
      ;;
    auto)
      local properties=""
      if command -v udevadm >/dev/null 2>&1; then
        properties="$(udevadm info --query=property --name="${DEVICE}" 2>/dev/null || true)"
      fi
      if grep -qx 'ID_VENDOR_ID=32e4' <<<"${properties}" \
        && grep -qx 'ID_MODEL_ID=6678' <<<"${properties}"; then
        printf '%s\n' 'v4l2-relay'
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

if [[ "${SELECTED_BACKEND}" == "v4l2-relay" ]]; then
  if [[ ! -r "${MJPEG_RELAY}" ]]; then
    echo "El backend v4l2-relay requiere ${MJPEG_RELAY}" >&2
    exit 1
  fi
  IFS=x read -r WIDTH HEIGHT <<<"${RESOLUTION}"
  RUNTIME_DIR="$(mktemp -d /tmp/futsi-camera.XXXXXX)"
  FRAME_PIPE="${RUNTIME_DIR}/camera.mjpg"
  CAPTURE_PID=""
  RELAY_PID=""

  cleanup_bridge() {
    trap - EXIT INT TERM
    if [[ -n "${RELAY_PID}" ]]; then
      kill "${RELAY_PID}" 2>/dev/null || true
    fi
    if [[ -n "${CAPTURE_PID}" ]]; then
      kill "${CAPTURE_PID}" 2>/dev/null || true
    fi
    wait "${RELAY_PID}" 2>/dev/null || true
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

  python3 "${MJPEG_RELAY}" \
    --fifo "${FRAME_PIPE}" \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --max-fps "${MJPEG_RELAY_MAX_FPS}" &
  RELAY_PID="$!"
  # If either the camera capture or the HTTP relay exits, let systemd restart
  # the complete pair instead of leaving an apparently active, frozen stream.
  wait -n "${CAPTURE_PID}" "${RELAY_PID}"
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
