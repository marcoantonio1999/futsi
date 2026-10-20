# Exámenes BPower

Portal en el dominio y los servicios existentes de Futsi; no requiere otro sitio, subdominio, worker, cron ni proveedor de IA.

- Administración independiente: `https://futsi.bpoweracademy.mx/#/examenes`.
- Menú integrado: Comunicaciones → RRHH → Exámenes (también para la cuenta restringida de Verónica).
- Enlace público generado por examen: `#/examen/<token-aleatorio>`.
- Crear → usar plantilla Business Operations & AI (40 preguntas) o redactar preguntas abiertas/de opción múltiple → crear → copiar enlace.
- Ver respuestas muestra participantes, contacto, inicio, entrega, duración y respuestas individuales, con páginas de 50 participantes. Cerrar un enlace impide nuevos inicios, sin impedir la entrega de un intento ya iniciado.

## Tiempo y conservación

El inicio y la entrega los fija el servidor. El tiempo incluye interrupciones; recargar no lo reinicia. El tiempo configurado es de referencia: si se excede, se conserva la entrega y se marca fuera de tiempo para revisión. No se envía ni descarta automáticamente.

Cada intento tiene una copia de las preguntas/instrucciones. Las respuestas enviadas son inmutables, y la confirmación es idempotente ante doble clic o una respuesta de red perdida. El identificador de inicio evita duplicar el intento al repetir manualmente una solicitud fallida. No hay reintentos automáticos.

El borrador y el token privado del intento se guardan en `sessionStorage` de la pestaña del candidato, no en un servidor intermedio; al enviar se eliminan. El borrador no se considera entrega. Cerrar definitivamente la pestaña puede perder un intento sin entregar. Si el almacenamiento no está disponible aparece una advertencia.

## Seguridad y límites

- Solo administración (`admin/owner/dev`) o `collaborator` con `veronica_only` administra exámenes. Inscripciones-only y coordinadores restringidos no obtienen acceso.
- Las rutas públicas nunca listan participantes, contactos ni intentos ajenos. El token de intento aleatorio de 256 bits viaja en `Authorization: Exam …`, no en la URL.
- Migración Django `0070_recruitment_exams`: dos tablas nuevas, RLS habilitado y revocación de privilegios PUBLIC/anon/authenticated en PostgreSQL. No modifica registros previos.
- Solicitudes públicas limitadas a 40/min/IP por el throttle local de DRF; no constituye protección distribuida contra abuso a gran escala.
- Validación de correo, teléfono, consentimiento, preguntas/opciones y respuestas en servidor. No hay clave de respuestas en las preguntas públicas.
- No se llama a IA ni se califica automáticamente; la evaluación de candidatos es humana. No se inventó una clave oficial del PDF.
- Las solicitudes ocurren al entrar/iniciar/entregar/actualizar. El reloj es local y no consulta la API periódicamente.

## Validación

`back/core/tests/test_recruitment_exams.py`: 24 pruebas de permisos, datos, privacidad, inicio idempotente, cierre del enlace, respuestas incompletas, inmutabilidad, tiempo del servidor y permisos de migración en PostgreSQL/Supabase.

`front/tests/exams.browser.mjs`: usa exclusivamente `127.0.0.1`, Django real y SQLite aislada, cuenta y participantes ficticios. Comprueba crear la plantilla de 40 preguntas, responder/recargar/enviar a 320/390/1440 px, ausencia de desbordamiento de página y ausencia de sondeo, tabla de Vero y detalle de las 40 respuestas. Nunca ejecutar contra producción.

Se ejecutaron typecheck, build y migraciones completas en SQLite local. Un test preexistente de estadísticas de Verónica no puede usar SQLite porque `whatsapp_quality_audits` solo se crea en PostgreSQL; no es una prueba de este módulo y no se modificó para ocultar ese resultado.
