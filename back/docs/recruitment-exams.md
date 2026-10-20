# Exámenes BPower

Portal en el dominio y los servicios existentes de Futsi; no requiere otro sitio, subdominio, worker ni cron. Las abiertas usan OpenAI al solicitarlo administración.

- Administración independiente: `https://futsi.bpoweracademy.mx/#/examenes`.
- Menú integrado: Comunicaciones → RRHH → Exámenes (también para la cuenta restringida de Verónica).
- Enlace público generado por examen: `#/examen/<token-aleatorio>`.
- Crear → usar plantilla Business Operations & AI (40 preguntas) o redactar preguntas abiertas/de opción múltiple → crear → copiar enlace.
- Al agregar una pregunta se elige «Pregunta abierta» u «Opción múltiple». Cada pregunta de opción múltiple admite de 2 a 26 opciones mediante Agregar/Quitar opción; no exige cuatro. Cambiar el tipo conserva el borrador de las opciones si se vuelve a opción múltiple.
- Ver respuestas muestra participantes, contacto, inicio, entrega, duración y respuestas individuales, con páginas de 50 participantes. Cerrar un enlace impide nuevos inicios, sin impedir la entrega de un intento ya iniciado.

## Tiempo y conservación

El inicio y la entrega los fija el servidor. El tiempo incluye interrupciones; recargar no lo reinicia. El tiempo configurado es de referencia: si se excede, se conserva la entrega y se marca fuera de tiempo para revisión. No se envía ni descarta automáticamente.

Cada intento tiene una copia de las preguntas/instrucciones. Las respuestas enviadas son inmutables, y la confirmación es idempotente ante doble clic o una respuesta de red perdida. El identificador de inicio evita duplicar el intento al repetir manualmente una solicitud fallida. No hay reintentos automáticos.

El reloj público muestra el tiempo restante en `mm:ss`, de la duración configurada a `00:00`, sin valores negativos. Recargar no reinicia el tiempo del servidor. Al llegar a cero se permite entregar y se conserva el tiempo real para revisión: no se agregó envío automático ni descarte automático.

## Un intento por contacto y examen

Se bloquea un nuevo inicio cuando coincide el correo **o** el teléfono dentro del mismo examen. Correo sin distinción de mayúsculas ni espacios exteriores; teléfono sin separadores y con equivalencia entre número mexicano local, +52 y prefijo móvil antiguo +521. No se eliminan puntos ni alias del correo. Esto detecta coincidencias de contacto, no verifica la identidad civil de una persona ni impide que use ambos datos distintos.

Una entrega previa devuelve HTTP 409 `exam_already_completed`: «Ya se realizó este examen con este correo o teléfono. No es posible realizarlo dos veces». Un intento pendiente devuelve `exam_already_started` e indica continuar en la pestaña original. El mismo identificador privado de inicio permite recuperar el intento original sin crear uno nuevo ni reiniciar el tiempo. Los mismos datos sí pueden participar en un examen diferente.

El bloqueo se comprueba en servidor con bloqueo transaccional de la fila del examen para serializar inicios simultáneos. Migración `0071_exam_identity_guard` agrega los campos normalizados e índices, sin eliminar intentos previos ni modificar correos, teléfonos, respuestas o tiempos originales. Los índices no son únicos porque debe conservarse cualquier duplicado histórico anterior a esta regla. La migración rellena las referencias existentes; una fila creada por una instancia anterior durante el despliegue se normaliza al siguiente intento de ese examen. Se conservan RLS y ausencia de permisos públicos.

El borrador y el token privado del intento se guardan en `sessionStorage` de la pestaña del candidato, no en un servidor intermedio; al enviar se eliminan. El borrador no se considera entrega. Cerrar definitivamente la pestaña puede perder un intento sin entregar. Si el almacenamiento no está disponible aparece una advertencia.

## Seguridad y límites

- Solo administración (`admin/owner/dev`) o `collaborator` con `veronica_only` administra exámenes. Inscripciones-only y coordinadores restringidos no obtienen acceso.
- Las rutas públicas nunca listan participantes, contactos ni intentos ajenos. El token de intento aleatorio de 256 bits viaja en `Authorization: Exam …`, no en la URL.
- Migración Django `0070_recruitment_exams`: dos tablas nuevas, RLS habilitado y revocación de privilegios PUBLIC/anon/authenticated en PostgreSQL. No modifica registros previos.
- Solicitudes públicas limitadas a 40/min/IP por el throttle local de DRF; no constituye protección distribuida contra abuso a gran escala.
- Validación de correo, teléfono, consentimiento, preguntas/opciones y respuestas en servidor. No hay clave de respuestas en las preguntas públicas.
- La clave oficial del PDF debe proporcionarla Vero: nunca se inventan respuestas correctas. La IA califica conocimientos para revisión humana, no toma decisiones de contratación.
- Las solicitudes ocurren al entrar/iniciar/entregar/actualizar. El reloj es local y no consulta la API periódicamente.

## Validación

`back/core/tests/test_recruitment_exams.py`: 41 pruebas de permisos, datos, privacidad, inicio idempotente, cierre del enlace, respuestas incompletas, inmutabilidad, tiempo del servidor, opciones variables, duplicados por correo/teléfono, migración y permisos en PostgreSQL/Supabase. La prueba concurrente se ejecuta únicamente en PostgreSQL (se omite en SQLite).

`front/tests/exam-identity-countdown.browser.mjs`: verifica reloj 40:00 → 39:59 → 00:00, bloqueo de un segundo inicio y de una segunda entrega por correo o teléfono, logo y ausencia de desbordamiento en 320/390/1440 px. Usa datos ficticios y API local. `front/tests/exam-countdown.test.mjs` verifica los límites del reloj sin llamadas de red.

`front/tests/exam-editor.browser.mjs`: creación y entrega local de un examen mixto con preguntas de 2 y 5 opciones y una pregunta abierta en 320/390/1440 px, elección de tipo y conservación de opciones al cambiar de tipo.

`front/tests/exams.browser.mjs`: usa exclusivamente `127.0.0.1`, Django real y SQLite aislada, cuenta y participantes ficticios. Comprueba crear la plantilla de 40 preguntas, responder/recargar/enviar a 320/390/1440 px, ausencia de desbordamiento de página y ausencia de sondeo, tabla de Vero y detalle de las 40 respuestas. Nunca ejecutar contra producción.

Se ejecutaron typecheck, build y migraciones completas en SQLite local. Un test preexistente de estadísticas de Verónica no puede usar SQLite porque `whatsapp_quality_audits` solo se crea en PostgreSQL; no es una prueba de este módulo y no se modificó para ocultar ese resultado.

## Calificación (0072)

Crear exige una respuesta correcta por pregunta: índice numérico de opción (base cero en API) o respuesta esperada y criterios en texto para abiertas. La interfaz permite escribirlas o cargar JSON con claves `1`, `2`, etc.; acepta letras A–Z para opción múltiple. Ejemplo: `{"1":"B","2":"Explicación esperada y criterios"}`. La clave publicada es inmutable; para cambiar criterios se crea otro examen.

La clave se almacena en campos privados separados (`answer_key`, `grading_key`), nunca en preguntas públicas ni snapshot público. Se fija al iniciar el intento; la entrega no modifica respuestas previas. Exámenes anteriores sin clave permiten agregarla una sola vez, conservando datos/tiempos/respuestas; no reciben ceros ficticios.

Exámenes solo de opción múltiple se califican al entregar, sin IA. Cada pregunta tiene el mismo peso y vale 0–10; nota final = promedio. Los mixtos/abiertos quedan pendientes. «Calificar todos los exámenes» procesa las entregas pendientes del examen seleccionado, una por solicitud y únicamente mientras continúa la acción iniciada por Vero. Guarda cada resultado con desglose, justificación, revisión requerida, modelo, consumo, fecha y autor.

Luna `gpt-5.6-luna`, reasoning `low`, `store:false`, salida estructurada validada y límites de texto. Solo se envían preguntas abiertas, criterios y respuestas, no campos de nombre, correo, teléfono, PDF ni imágenes. Si la API principal no tiene clave local, utiliza su conexión HTTPS/Bearer existente con WhatsApp en `/api/internal/exam-grading/`; la clave de proveedor permanece en ese servidor. Puede cambiarse posteriormente configurando `OPENAI_API_KEY` en la API principal; nunca en frontend o Git.

El claim `processing` se confirma en DB antes de consultar IA, sin mantener locks durante el HTTP. Doble clic/concurrencia no duplica una misma evaluación. Resultados, fallos y claims interrumpidos no vuelven automáticamente a pendientes: se requiere revisión administrativa. No hay cron, polling ni reintentos del proveedor. Tras fallo de una entrega la acción explícita puede continuar con las demás. Una interrupción incierta nunca se convierte en un cero ni se reintenta sola.

`POST /api/recruitment-exams/test-grading/` es una prueba limitada a 6/h por usuario autorizado con texto ficticio fijo, sin crear participantes. No se llama al entrar a la página.

Pruebas: `test_exam_grading.py` cubre clave obligatoria/privacidad, calificación determinista/idempotente, notas abiertas, claims, errores, permisos y legado. `front/tests/exam-grading.browser.mjs` usa API/DB locales, importa JSON y realiza tres pequeñas consultas reales autorizadas con candidatos ficticios, comprobando notas y 320/390/1440 px; nunca ejecutar contra producción.
