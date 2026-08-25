#!/usr/bin/env bash
set -euo pipefail

DEVICE="${FUTSI_CAMERA_DEVICE:-/dev/video0}"
EXPOSURE="${FUTSI_CAMERA_EXPOSURE:-20}"
PROFILE="${FUTSI_CAMERA_PROFILE:-schedule}"
CURRENT_HOUR="${FUTSI_CAMERA_HOUR:-$(date +%H)}"
V4L2_CTL="${FUTSI_V4L2_CTL_BIN:-v4l2-ctl}"
LOGGER="${FUTSI_LOGGER_BIN:-logger}"

if [[ ! -e "${DEVICE}" ]]; then
  echo "No existe el dispositivo de camara: ${DEVICE}" >&2
  exit 1
fi

if [[ ! "${CURRENT_HOUR}" =~ ^([01]?[0-9]|2[0-3])$ ]]; then
  echo "Hora de exposicion no valida: ${CURRENT_HOUR}" >&2
  exit 1
fi

case "${PROFILE}" in
  schedule)
    hour=$((10#${CURRENT_HOUR}))
    if (( hour >= 8 && hour < 17 )); then
      PROFILE="manual"
    else
      PROFILE="auto"
    fi
    ;;
  manual|auto)
    ;;
  *)
    echo "FUTSI_CAMERA_PROFILE debe ser schedule, manual o auto" >&2
    exit 1
    ;;
esac

if [[ "${PROFILE}" == "manual" ]]; then
  "${V4L2_CTL}" -d "${DEVICE}" --set-ctrl=auto_exposure=1
  "${V4L2_CTL}" -d "${DEVICE}" --set-ctrl="exposure_time_absolute=${EXPOSURE}"
  detail="manual auto_exposure=1 exposure_time_absolute=${EXPOSURE}"
else
  "${V4L2_CTL}" -d "${DEVICE}" --set-ctrl=auto_exposure=3
  detail="automatica auto_exposure=3"
fi

message="Exposicion ${detail} aplicada a ${DEVICE}"
echo "${message}"
if command -v "${LOGGER}" >/dev/null 2>&1; then
  "${LOGGER}" -t faceguard-camera-exposure "${message}"
fi
