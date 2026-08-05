#!/usr/bin/env bash
set -euo pipefail

DEVICE="${1:-/dev/video0}"
PORT="${2:-8080}"
RESOLUTION="${FUTSI_CAMERA_RESOLUTION:-auto}"
FPS="${FUTSI_CAMERA_FPS:-15}"
SERVICE_USER="${SUDO_USER:-$USER}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta: sudo bash install-camera-stream.sh [device] [port]"
  exit 1
fi

if [[ ! -e "${DEVICE}" ]]; then
  echo "No existe ${DEVICE}. Revisa las camaras con: v4l2-ctl --list-devices"
  exit 1
fi

apt-get update
apt-get install -y v4l-utils ffmpeg curl ca-certificates
if ! apt-get install -y ustreamer; then
  apt-get install -y git build-essential libevent-dev libjpeg-dev libbsd-dev
  temp_dir="$(mktemp -d)"
  git clone --depth 1 https://github.com/pikvm/ustreamer.git "${temp_dir}/ustreamer"
  make -C "${temp_dir}/ustreamer"
  install -m 0755 "${temp_dir}/ustreamer/ustreamer" /usr/local/bin/ustreamer
  rm -rf "${temp_dir}"
fi

USTREAMER="$(command -v ustreamer)"
install -m 0755 "${SCRIPT_DIR}/camera-stream.sh" /usr/local/bin/futsi-camera-stream
usermod -aG video "${SERVICE_USER}"
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
ExecStart=/usr/local/bin/futsi-camera-stream ${DEVICE} ${PORT} ${FPS} ${RESOLUTION}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now futsi-camera.service
sleep 2
systemctl --no-pager --full status futsi-camera.service || true
IP_ADDRESS="$(hostname -I | awk '{print $1}')"
echo
echo "Camara lista: http://${IP_ADDRESS}:${PORT}/stream"
echo "Panel de diagnostico: http://${IP_ADDRESS}:${PORT}/"
