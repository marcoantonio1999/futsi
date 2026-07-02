# Deteccion facial: ONNX directo vs wrapper InsightFace

Fecha: 2026-06-30
Area: pase automatico / desconocidos / rendimiento GPU
Estado: decision activa

## Resumen

Para el pipeline rapido de video, la deteccion de caras debe usar la ruta directa ONNX sobre GPU cuando solo necesitamos saber si hay cara/persona candidata.

No debemos confundir esta ruta con `InsightFace FaceAnalysis.get()`.

La ruta directa usa el detector `det_10g.onnx` via `detector.session.run(...)` y postproceso propio. Esto evita ejecutar landmarks, alineacion, embedding, genero/edad y otros modulos que el wrapper completo puede activar.

## Medicion local

Medicion hecha en esta maquina con CUDA activo y modelos ya cargados:

| Ruta | FPS aprox | Uso correcto |
| --- | ---: | --- |
| ONNX directo detector `detect_face_boxes_fast_onnx` | 21.54 FPS | Probe rapido de frames/segundos candidatos |
| Detector via InsightFace `detector.detect` | 7.35 FPS | Fallback si falla ONNX directo |
| InsightFace completo `detect_embeddings` / `FaceAnalysis.get()` | 5.77 FPS | Solo cuando ya hay cara candidata y se necesita embedding/landmarks |

Conclusion: para buscar segundos o frames candidatos, ONNX directo fue aprox 3x mas rapido que pasar por el detector del wrapper y casi 4x mas rapido que el flujo completo.

## Archivos relevantes

- `back/core/api/automatic_attendance_detection.py`
  - `detect_face_boxes_fast_onnx(...)`
  - `detect_face_boxes_hybrid(...)`
- `back/core/services/face_insight.py`
  - `detect_embeddings(...)`
  - `detect_face_boxes(...)`

## Decision de pipeline

1. Usar ONNX directo para el probe rapido.
2. Usar menor resolucion para el probe cuando el objetivo es detectar caras grandes/cercanas.
3. Usar InsightFace completo solo en frames/crops candidatos.
4. No volver al wrapper completo para revisar todos los frames si solo buscamos presencia de cara.

## Resolucion

La prueba de menor resolucion dio mejor rendimiento y no perdio lo importante para nuestro caso de negocio:

- Las caras pequenas y lejanas casi nunca sirven para pase de lista.
- Las caras utiles suelen estar cerca de la camara.
- Bajar resolucion ayuda a descartar trabajo inutil y mantiene caras grandes detectables.

Regla practica:

- Probe rapido: resolucion reducida / max dimension controlada.
- Evidencia final y comparacion: usar crop/frame candidato con suficiente calidad.

## Riesgo

Si bajamos demasiado la resolucion, podemos perder caras medianas que si podrian servir. Por eso el probe debe seguir validandose con partidos reales cuando cambiemos `AUTO_ATTENDANCE_DETECT_MAX_DIMENSION`.

## Recordatorio importante

Cuando se pregunte "cuantos FPS procesa la GPU", especificar de que ruta hablamos:

- Solo detector ONNX directo: aprox 20-22 FPS.
- InsightFace completo con embedding/landmarks: aprox 5-7 FPS.
- Pipeline real de video: menor que esos valores porque incluye decodificacion, lectura, resize, ventanas, comparacion y guardado.
