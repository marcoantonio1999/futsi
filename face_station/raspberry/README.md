# Stream de la Raspberry Pi 4

La Raspberry solo captura y transmite video. InsightFace corre en la PC con GPU o
CPU, por lo que la Pi no almacena padrones ni credenciales de Supabase.

## Instalacion

Con la camara conectada a la Raspberry:

```bash
v4l2-ctl --list-devices
sudo bash install-camera-stream.sh /dev/video0 8080
```

La URL que se configura en Face Station es:

```text
http://IP_LOCAL_DE_LA_RASPBERRY:8080/stream
```

Para reducir retraso conviene usar el enlace Ethernet local en vez de pasar el
video por internet. Tailscale sirve para administracion remota, pero no es
necesario para el flujo dentro de la cancha.

Comandos de soporte:

```bash
sudo systemctl status futsi-camera
sudo journalctl -u futsi-camera -f
v4l2-ctl -d /dev/video0 --list-formats-ext
```
