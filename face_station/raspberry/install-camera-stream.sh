#!/usr/bin/env bash
set -euo pipefail

DEVICE="${1:-/dev/video0}"
PORT="${2:-8080}"
RESOLUTION="${FUTSI_CAMERA_RESOLUTION:-auto}"
FPS="${FUTSI_CAMERA_FPS:-15}"
EXPOSURE_SCHEDULE="${FUTSI_CAMERA_EXPOSURE_SCHEDULE:-auto}"
EXPOSURE_VALUE="${FUTSI_CAMERA_EXPOSURE:-20}"
SERVICE_USER="${SUDO_USER:-$USER}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
temp_dir=""

cleanup_temp_dir() {
  local candidate="${temp_dir:-}"
  if [[ -n "${candidate}" && -d "${candidate}" && "${candidate}" == /tmp/futsi-ustreamer.* ]]; then
    rm -rf -- "${candidate}" || true
  fi
  temp_dir=""
}

trap cleanup_temp_dir EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

selected_backend() {
  local service_environment=""
  local properties=""

  service_environment="$(
    systemctl show futsi-camera.service --property=Environment --value 2>/dev/null \
      || true
  )"
  if [[ "${service_environment}" == *"FUTSI_CAMERA_BACKEND=v4l2-relay"* ]] \
    || [[ "${service_environment}" == *"FUTSI_CAMERA_BACKEND=v4l2-ffmpeg"* ]]; then
    printf '%s\n' 'v4l2-relay'
    return
  fi
  if [[ "${service_environment}" == *"FUTSI_CAMERA_BACKEND=ustreamer"* ]]; then
    printf '%s\n' 'ustreamer'
    return
  fi

  if command -v udevadm >/dev/null 2>&1; then
    properties="$(udevadm info --query=property --name="${DEVICE}" 2>/dev/null || true)"
  fi
  if grep -qx 'ID_VENDOR_ID=32e4' <<<"${properties}" \
    && grep -qx 'ID_MODEL_ID=6678' <<<"${properties}"; then
    printf '%s\n' 'v4l2-relay'
  else
    printf '%s\n' 'ustreamer'
  fi
}

exposure_schedule_enabled() {
  local properties=""

  case "${EXPOSURE_SCHEDULE,,}" in
    1|true|yes|on)
      return 0
      ;;
    0|false|no|off)
      return 1
      ;;
    auto)
      if [[ "${DEVICE}" == *"48MP_USB_Camera"* ]]; then
        return 0
      fi
      if command -v udevadm >/dev/null 2>&1; then
        properties="$(udevadm info --query=property --name="${DEVICE}" 2>/dev/null || true)"
      fi
      grep -Eq '^ID_MODEL(_ENC)?=48MP(_x20|_)USB(_x20|_)Camera$' <<<"${properties}"
      ;;
    *)
      echo "FUTSI_CAMERA_EXPOSURE_SCHEDULE debe ser auto, true o false" >&2
      return 2
      ;;
  esac
}

wait_for_camera_stream() {
  local backend="$1"
  local attempt=0
  local probe_result=""
  local http_code=""
  local downloaded_bytes="0"
  local state_payload=""

  for ((attempt = 1; attempt <= 20; attempt += 1)); do
    if ! systemctl is-active --quiet futsi-camera.service; then
      sleep 1
      continue
    fi

    probe_result="$(
      curl --silent --max-time 3 --output /dev/null \
        --write-out '%{http_code} %{size_download}' \
        "http://127.0.0.1:${PORT}/stream" 2>/dev/null
    )" || true
    http_code=""
    downloaded_bytes="0"
    read -r http_code downloaded_bytes <<<"${probe_result}" || true
    if [[ "${http_code}" != "200" || ! "${downloaded_bytes}" =~ ^[0-9]+$ ]] \
      || (( downloaded_bytes < 1024 )); then
      sleep 1
      continue
    fi

    if [[ "${backend}" == "ustreamer" ]]; then
      state_payload="$(
        curl --fail --silent --show-error --max-time 3 \
          "http://127.0.0.1:${PORT}/state" 2>/dev/null
      )" || true
      if ! grep -Eq '"source".*"online"[[:space:]]*:[[:space:]]*true[[:space:]]*,[[:space:]]*"desired_fps"' \
        <<<"${state_payload}"; then
        sleep 1
        continue
      fi
    fi
    return 0
  done
  return 1
}

show_service_failure() {
  echo "El servicio futsi-camera no entrego video valido en http://127.0.0.1:${PORT}/stream" >&2
  systemctl --no-pager --full status futsi-camera.service >&2 || true
  journalctl --no-pager -u futsi-camera.service -n 50 >&2 || true
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta: sudo bash install-camera-stream.sh [device] [port]"
  exit 1
fi

if [[ ! -e "${DEVICE}" ]]; then
  echo "No existe ${DEVICE}. Revisa las camaras con: v4l2-ctl --list-devices"
  exit 1
fi

apt-get update
apt-get install -y v4l-utils ffmpeg curl ca-certificates python3
if ! apt-get install -y ustreamer; then
  apt-get install -y git build-essential libevent-dev libjpeg-dev libbsd-dev
  temp_dir="$(mktemp -d /tmp/futsi-ustreamer.XXXXXX)"
  git clone --depth 1 https://github.com/pikvm/ustreamer.git "${temp_dir}/ustreamer"
  make -C "${temp_dir}/ustreamer"
  install -m 0755 "${temp_dir}/ustreamer/ustreamer" /usr/local/bin/ustreamer
  cleanup_temp_dir
fi

USTREAMER="$(command -v ustreamer)"
install -m 0755 "${SCRIPT_DIR}/camera-stream.sh" /usr/local/bin/futsi-camera-stream
install -m 0755 "${SCRIPT_DIR}/mjpeg-broadcast-relay.py" /usr/local/bin/faceguard-mjpeg-relay
install -m 0755 "${SCRIPT_DIR}/camera-exposure-profile.sh" \
  /usr/local/sbin/faceguard-camera-exposure-profile
install -m 0644 "${SCRIPT_DIR}/faceguard-camera-exposure.service" \
  /etc/systemd/system/faceguard-camera-exposure.service
install -m 0644 "${SCRIPT_DIR}/faceguard-camera-exposure.timer" \
  /etc/systemd/system/faceguard-camera-exposure.timer
usermod -aG video "${SERVICE_USER}"

EXPOSURE_SERVICE_LINES=""
if exposure_schedule_enabled; then
  install -d -m 0755 /etc/default
  cat >/etc/default/faceguard-camera-exposure <<EOF
FUTSI_CAMERA_DEVICE=${DEVICE}
FUTSI_CAMERA_EXPOSURE=${EXPOSURE_VALUE}
FUTSI_CAMERA_PROFILE=schedule
EOF
  EXPOSURE_SERVICE_LINES="Environment=FUTSI_CAMERA_DEVICE=${DEVICE}
Environment=FUTSI_CAMERA_EXPOSURE=${EXPOSURE_VALUE}
Environment=FUTSI_CAMERA_PROFILE=schedule
ExecStartPost=/usr/local/sbin/faceguard-camera-exposure-profile"
  echo "Perfil de exposicion programada habilitado para ${DEVICE}"
else
  exposure_status="$?"
  if (( exposure_status == 2 )); then
    exit 1
  fi
fi

cat >/etc/systemd/system/futsi-camera.service <<EOF
[Unit]
Description=Futsi Raspberry camera stream
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
SupplementaryGroups=video
Environment=FUTSI_USTREAMER_BIN=${USTREAMER}
Environment=FUTSI_MJPEG_RELAY_BIN=/usr/local/bin/faceguard-mjpeg-relay
${EXPOSURE_SERVICE_LINES}
ExecStart=/usr/local/bin/futsi-camera-stream ${DEVICE} ${PORT} ${FPS} ${RESOLUTION}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable futsi-camera.service
if [[ -n "${EXPOSURE_SERVICE_LINES}" ]]; then
  systemctl enable --now faceguard-camera-exposure.timer
else
  systemctl disable --now faceguard-camera-exposure.timer 2>/dev/null || true
fi
systemctl restart futsi-camera.service

BACKEND="$(selected_backend)"
if ! wait_for_camera_stream "${BACKEND}"; then
  show_service_failure
  exit 1
fi

systemctl --no-pager --full status futsi-camera.service
IP_ADDRESS="$(hostname -I | awk '{print $1}')"
echo
echo "Camara lista: http://${IP_ADDRESS}:${PORT}/stream"
echo "Panel de diagnostico: http://${IP_ADDRESS}:${PORT}/"
