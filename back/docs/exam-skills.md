# Estadísticas por habilidad

La sección Estadísticas incluye Resultados por habilidad con selector local de área, promedio,
mejor/menor nota y desglose por examen. Respeta las fechas de Ciudad de México y el examen
del reporte. Cambiar habilidad no hace solicitudes adicionales. La actividad y las notas
generales continúan mostrando el examen completo, indicado en pantalla.

Clasificación editorial `business-operations-v1` de las 40 preguntas originales:

| Área principal | Preguntas |
| --- | --- |
| Matemáticas y análisis numérico | 2, 9, 12, 16, 19, 26, 31 |
| Ventas y marketing | 5, 20, 29, 40 |
| Uso de IA | 1, 8, 15, 22, 28, 32 |
| Procesos y automatización | 3, 6, 11, 18, 23, 30, 35, 36, 39 |
| Gestión y prioridades | 4, 7, 10, 17, 21, 24, 27, 33, 38 |
| Análisis de información | 13, 14, 25, 34, 37 |

Cada pregunta tiene una sola área principal. Es una clasificación por contenido para
organizar resultados, no un instrumento validado de medición de competencias. Una
pregunta numérica puede tener contexto de ventas y se agrupa por la operación evaluada.

Se compara tipo, texto exacto y opciones en orden contra la plantilla. No se infiere por
título, cantidad de preguntas, palabras clave o número de pregunta. Usa las preguntas
conservadas en la instantánea de cada intento y sus IDs para leer los puntos guardados.
Los exámenes existentes que conservan la plantilla se incluyen sin migrar datos.
Si se cambia la plantilla, mantener el catálogo de esta versión antes de reemplazarla.
Preguntas personalizadas o modificadas no reciben categorías inventadas.

La nota por área es el promedio de sus preguntas reconocidas en cada evaluación; el
promedio mostrado es el promedio de esas notas por evaluación. Solo se incluye un área
cuando todas sus preguntas reconocidas tienen puntos numéricos válidos de 0 a 10 y el
intento está calificado. Los pendientes, errores y totales sin detalle se cuentan como
sin desglose, nunca como cero. Un cero válido sí participa. No redistribuir notas totales.
Los resultados sin fecha permanecen excluidos del período, como en el reporte general.

No escribe datos, cambia claves o calificaciones, envía respuestas a IA ni agrega cron.
La consulta solo lee fragmentos JSON de preguntas y puntos, sin contactos, respuestas,
CV o tokens. Mantiene los permisos del endpoint administrativo existente.

Validación: pruebas de API de estadísticas, importaciones externas y resultados sin
detalle; `front/tests/exam-skills.browser.mjs` contra Django/SQLite ficticios locales en
320, 390 y 1440 px, con filtro, promedio, ausencia de desbordamiento y controles de 44 px.
