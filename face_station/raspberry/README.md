# Stream de la Raspberry Pi 4

La Raspberry solo captura y transmite video. InsightFace corre en la PC con GPU o
CPU, por lo que la Pi no almacena padrones ni credenciales de Supabase.

## Instalacion

Con la camara conectada a la Raspberry:

```bash
v4l2-ctl --list-devices
sudo bash install-camera-stream.sh /dev/video0 8080
```

El servicio selecciona automaticamente la mayor resolucion MJPEG que anuncie
la camara. Para fijar una resolucion manual:

```bash
sudo FUTSI_CAMERA_RESOLUTION=1920x1080 bash install-camera-stream.sh /dev/video0 8080
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
lsusb -t
```

Una camara USB 3.0 debe aparecer a `5000M` en `lsusb -t`. Si aparece a `480M`,
revisa que este conectada a un puerto USB 3.0 y que el cable tambien sea USB
3.0; un cable USB-C de solo USB 2.0 limita los modos que el firmware anuncia.
