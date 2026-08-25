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

Las ELP `32e4:6678` usan el backend `v4l2-relay`: la Raspberry captura una
sola vez los JPEG originales y los distribuye a varios clientes sin volver a
codificarlos. Esto conserva la resolucion completa y evita que una vista previa
o una reconexion detenga la grabacion principal.

Para el modo 8 MP probado en la ELP 1, solicita el modo nativo de 60 FPS. La
camara entrega tantos frames como permite el enlace y el contenido de la escena:

```bash
sudo FUTSI_CAMERA_RESOLUTION=3840x2160 FUTSI_CAMERA_FPS=60 \
  bash install-camera-stream.sh /dev/video0 8080
```

El estado del relay, incluidos los FPS capturados, esta disponible en:

```text
http://IP_LOCAL_DE_LA_RASPBERRY:8080/state
```

Si el almacenamiento no sostiene todos los frames, se puede limitar solamente
la salida sin sacar a la ELP de su modo de captura estable:

```ini
Environment=FUTSI_MJPEG_RELAY_MAX_FPS=30
```

La resolucion y la calidad JPEG permanecen intactas; solo se omiten frames antes
de enviarlos por red y escribirlos en la PC.

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

## Exposicion programada para ELP 2

La camara ELP 2 usa exposicion manual `20` de 08:00 a 16:59 y exposicion
automatica desde las 17:00 hasta las 07:59. El perfil se aplica al arrancar la
Raspberry, a las 08:00, a las 17:00 y cada vez que reinicia el servicio de la
camara.

El instalador habilita el horario automaticamente para dispositivos cuyo
modelo UVC es `48MP USB Camera`. Tambien puede forzarse para otro dispositivo:

```bash
sudo FUTSI_CAMERA_EXPOSURE_SCHEDULE=true FUTSI_CAMERA_EXPOSURE=20 \
  bash install-camera-stream.sh /dev/video0 8080
```

Para deshabilitarlo explicitamente:

```bash
sudo FUTSI_CAMERA_EXPOSURE_SCHEDULE=false \
  bash install-camera-stream.sh /dev/video0 8080
```

Archivos instalados:

- `/usr/local/sbin/faceguard-camera-exposure-profile`
- `/etc/systemd/system/faceguard-camera-exposure.service`
- `/etc/systemd/system/faceguard-camera-exposure.timer`
- `/etc/default/faceguard-camera-exposure`
