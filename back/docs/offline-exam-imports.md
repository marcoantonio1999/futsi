# Entregas históricas en PDF

Una carga manual autorizada puede registrar respuestas y contactos de un PDF sin
almacenar su binario en el servidor ni iniciar un examen público ficticio. No hay
un importador automático, cron ni nuevo endpoint público.

La instantánea conserva `offline_import.source = pdf_manual`, fecha escrita
`completed_on`, hora real de carga `imported_at`, huellas SHA-256 del documento y
archivo de origen, actor administrativo, huella de la clave confirmada y marcas
ambiguas. Preguntas, orden de opciones y contactos se verifican antes de escribir.
No se deducen duración, hora inicial ni hora final a partir de metadatos del PDF.

Los campos indexados de inicio/entrega usan medianoche de Ciudad de México como
proyección **solo de la fecha**, no como horas reales. La lectura administrativa
devuelve inicio, duración y límite nulos, conserva la fecha explícita y muestra
«Carga manual de PDF» / «Sin tiempo registrado». Las estadísticas incluyen la
entrega en su fecha escrita, pero excluyen estas filas del tiempo promedio y de
los inicios medidos en plataforma. No se modifica el contador de los exámenes web.

Una marca doble se conserva en `ambiguous_answers`; no se elige una opción por el
candidato ni se le asigna cero. Su estado `review` y explicación requieren revisión
humana. El botón de calificación por lotes procesa solo `pending` y no puede
resolver ni recalificar estas ambigüedades silenciosamente.

Cada importación necesita respaldo privado previo, comprobación de duplicados
por identidad, clave de inicio determinista por examen/documento y comparación
de todos los registros conservados. Ante una importación ya existente, se
verifica su origen antes de repetir: no se sobrescriben respuestas ni notas.

Pruebas: `test_offline_exam_display.py`, suite de estadísticas y
`offline-exam-display.browser.mjs` con datos ficticios en 320/390/1440 px. No
ejecutan IA, no envían mensajes ni cargan archivos personales al servidor.
