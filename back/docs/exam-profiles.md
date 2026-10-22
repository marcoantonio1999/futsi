# Perfiles y filtros de evaluaciones - 22/10/2026

## Filtros

`GET /api/recruitment-exams/<id>/` acepta `ordering=score_desc|score_asc|newest|name`,
`q`, `status=graded|pending|unsubmitted`, `min_score`, `max_score`, `top=10` y `page`.
Filtra y ordena en servidor antes de paginar (50 filas). El mejor 10 % usa todas
las entregas calificadas del examen: ceil(N/10), incluye todos los empates en el
corte y no convierte los pendientes en ceros. Búsqueda y otros filtros no cambian
el universo sobre el que se calcula ese percentil.

## Perfiles privados

`#/examenes/perfiles` lista entregas existentes, incluso antes de capturar el CV.
Un perfil corresponde a una entrega/contexto de postulación. La misma persona
puede aparecer en distintos exámenes; no se fusionan puestos o notas automáticamente.

`GET /api/recruitment-profiles/` agrega `exam`, `position`, `keywords` (hasta 20
frases separadas por comas), `keyword_mode=all|any`, `form_q`, `has_cv=yes`, `has_form=yes`.
Para el top 10 % exige elegir examen y no comparar pruebas distintas.
Los términos se escapan y buscan con límites de palabra, sin distinguir acentos
ni mayúsculas: Excel no coincide con excelente. Es presencia literal del texto,
no certificación de competencias ni decisión de contratación; no utiliza IA.

`GET/POST /api/recruitment-profiles/<attempt-id>/` permite leer/editar puesto,
texto del CV, texto y campos del formato. Solo entregas completas. No cambia
identidad, preguntas, respuestas, tiempos ni notas. El resumen no selecciona CV,
texto del formato ni cuestionarios completos de la DB; se leen al abrir el detalle.

## Importación explícita

El navegador lee PDF/TXT (hasta 20 archivos de 8 MB; PDF hasta 10 páginas), usando
PDF.js fijado en package-lock y cargado solo al seleccionar un PDF. No retiene
los PDF ni los envía a Storage/servidor/proveedores. AcroForms utiliza valores
rellenados (no títulos de campos vacíos). Un archivo sin texto legible no genera
datos inventados y requiere transcripción; no se incluyó OCR ni IA.

`POST /api/recruitment-profiles/import/` previsualiza con `form_text`, `form_fields`
y `exam` opcional. Matching determinista de correo/teléfono del candidato (nunca
teléfonos de empleadores/referencias). Normaliza teléfonos mexicanos como el examen.
Identificadores contradictorios, varios exámenes o ausencia de contacto impiden
la asignación automática: Vero busca y elige la entrega correcta.

Solo `commit:true` guarda; `attempt_id` representa selección humana explícita.
Importar otra vez reemplaza el formato del perfil, conservando CV, puesto ya
capturado y calificaciones. Un error queda visible y el lote explícito continúa,
sin reintentos ni trabajos o consultas periódicas en segundo plano.

## Seguridad y validación

Mismos permisos que Exámenes: admin/owner/dev o colaborador veronica_only,
incluida su lista explícita de rutas. Ningún acceso por rutas públicas del examen.
Migración Django 0073 crea solo recruitment_profiles (OneToOne, PROTECT), habilita
RLS y revoca PUBLIC/anon/authenticated. No migra ni modifica participantes previos.

`test_exam_profiles.py`: filtros antes de paginación, decil/empates, notas nulas,
palabras/frases/símbolos, límites, permisos de Vero, protección de otras cuentas,
matching ambiguo/contradictorio, idempotencia, integridad de exámenes y selección
liviana sin consultas por persona. `exam-profiles.browser.mjs`: DB local y datos
ficticios, PDF de empleo rellenado para QA, flujo completo en 320/390/1440 px,
tarjetas móviles, filtros, preservación del CV y verificación de solicitudes JSON
sin subida binaria. Las pruebas no envían solicitudes a IA ni WhatsApp.
