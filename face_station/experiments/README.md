# Experimentos de calidad facial

Este directorio no forma parte del pipeline operativo de FaceGuard. Los scripts
deben ser *read-only* respecto de SQLite y únicamente pueden escribir resultados
en `futsi-face-station-data/experiments`.

## `face_parsing_visibility.py`

Prueba aislada de visibilidad semántica de ojos y boca. Combina:

- BiSeNet ResNet18 ONNX de `yakhyo/face-parsing`.
- MediaPipe Face Landmarker ya instalado en la estación.
- Una regla conservadora, explícitamente experimental, que prioriza no aceptar
  recortes ocluidos aunque eso deje recortes válidos para una detección posterior.

El script no importa `LocalStore`, no abre `station.sqlite3` y no cambia estados.
Produce CSV, JSON, máscaras, overlays y una hoja de contacto.

Modelo experimental:

- Fuente: <https://github.com/yakhyo/face-parsing>
- Peso: <https://github.com/yakhyo/face-parsing/releases/download/weights/resnet18.onnx>
- SHA-256: `0D9BD318E46987C3BDBFACAE9E2C0F461CAE1C6AC6EA6D43BBE541A91727E33F`
- Código del repositorio: MIT.
- Advertencia: los pesos se entrenaron con CelebAMask-HQ, cuyo acuerdo del
  dataset restringe el uso a investigación no comercial. No integrar estos
  pesos en producción hasta aclarar su licencia o sustituirlos.
