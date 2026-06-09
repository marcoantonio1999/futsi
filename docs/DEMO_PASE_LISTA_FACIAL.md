# Demo de pase de lista facial

## Estado Sprint 2

La demo local usa DeepFace cuando esta instalado en el entorno `.venv`. Si DeepFace no esta disponible, el sistema lo muestra en pantalla como `Demo/mock`.

## Funcionalidad implementada

- Camara desde el navegador.
- Video espejado para que se vea natural con camara frontal.
- Recuadro de rostro:
  - Azul: listo.
  - Azul con texto: reconociendo.
  - Verde: coincidencia confiable.
  - Rojo: sin coincidencia.
- Endpoint `GET /api/face-attendance/recognize/` para diagnosticar motor.
- Endpoint `POST /api/face-attendance/recognize/` para enviar captura.
- Bitacora en `face_recognition_attempts`.
- Comparacion de imagen normal y espejada.
- Sin fallback falso cuando DeepFace existe pero no reconoce.

## Alumno demo

Se agrego el alumno `Marco Antonio Demo` en `Roma / Equipo Sub-12 A` con foto local:

`back/media/students/photos/retrato_marco.jpeg`

La fuente original fue:

`C:\Users\daniel\Downloads\retrato_marco.jpeg`

## Comandos locales usados

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
.\.venv\Scripts\python.exe -m pip install -r back\requirements.txt deepface tf-keras
.\.venv\Scripts\python.exe back\manage.py runserver 127.0.0.1:8000 --noreload
```

## Validaciones

- `deepface True`
- `tf_keras True`
- `from deepface import DeepFace` correcto
- Foto de Marco contra si misma verificada con confianza 100% en prueba directa.

## Nota de produccion

DeepFace/TensorFlow no se dejan como dependencia obligatoria de Render Free por peso, memoria y tiempo de arranque. Para produccion real se recomienda servicio separado de reconocimiento, GPU o procesamiento asincrono, ademas de consentimiento y politicas de datos biometricos.
