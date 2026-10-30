# Reloj laboral de primera respuesta

El horario global del reporte se edita en Soccer WA → Histórico de primera respuesta → Horario laboral.
Inicial: todos los días, 09:00–20:00, America/Mexico_City. Los botones de días repiten cada semana.

- GET/PATCH `/api/whatsapp-conversations/response-schedule/`; lectura con permiso del histórico, escritura solo administradores sin restricciones de sección.
- PATCH exige días únicos 0–6 (lunes=0), al menos uno, y horas HH:MM con cierre posterior a apertura. No admite turnos nocturnos.
- Tabla singleton privada `whatsapp_response_schedule`; migración 0077 habilita RLS y revoca acceso público/anon/authenticated. Cambios auditados.
- Histórico, promedios por responsable y notificaciones comparten el cálculo laboral. Solicitudes fuera de horario siguen pendientes, pero acumulan cero tiempo hasta abrir.
- Se recalculan los periodos consultados con el horario vigente. No se reescriben eventos, mensajes, respuestas ni sus fechas; cambiar horario puede cambiar métricas históricas mostradas.
- No cambia `WhatsAppAutomationSettings` ni las respuestas del bot. No añade cron, IA ni sondeo. Cómputo por intervalo con semanas completas y hasta seis días restantes.

Pruebas: `test_whatsapp_response_schedule.py`, notificaciones, cortesías, reacciones y acceso por sede. Fixture local `communications-scope-preview.html?section=weekly-stats&history-phone` permite probar el modal sin datos reales.
