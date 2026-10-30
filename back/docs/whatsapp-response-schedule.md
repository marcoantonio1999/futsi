# Reloj laboral de primera respuesta

Cada cancha tiene su horario independiente en Soccer WA → Configurar horario laboral. La cuenta de cancha puede editar exclusivamente su sede principal; administración elige una cancha concreta. También se conserva el acceso desde Histórico de primera respuesta → Horario laboral.
Inicial: todos los días, 09:00–20:00, America/Mexico_City. Los botones de días repiten cada semana.

- GET/PATCH `/api/whatsapp-conversations/response-schedule/?site=<id>`; la API valida la sede del usuario en lectura y escritura. En cuentas de cancha, omitir `site` usa su sede principal. Un ID de otra sede recibe 403, aunque se manipule la URL.
- PATCH exige días únicos 0–6 (lunes=0), al menos uno, y horas HH:MM con cierre posterior a apertura. No admite turnos nocturnos.
- Tabla privada `whatsapp_site_response_schedules`, una fila por sede. Migración 0078 habilita RLS y revoca acceso público/anon/authenticated. Cambios auditados con sede y autor. La tabla singleton 0077 se conserva intacta como legado y ya no participa en lecturas ni escrituras de la función.
- Histórico, promedios por responsable y notificaciones resuelven el horario de cada conversación según la sede del número empresarial; solo si no hay asociación usan la sede de la conversación. No se aplica un horario único a un reporte consolidado. Solicitudes fuera de horario siguen pendientes, pero acumulan cero tiempo hasta abrir.
- Se recalculan los periodos consultados con el horario vigente de cada sede. No se reescriben eventos, mensajes, respuestas ni sus fechas; cambiar horario puede cambiar métricas históricas mostradas solo de esa cancha. Sedes sin horario guardado usan 09:00–20:00 todos los días; no heredan ajustes de otras sedes.
- No cambia `WhatsAppAutomationSettings` ni las respuestas del bot. No añade cron, IA ni sondeo. Cómputo por intervalo con semanas completas y hasta seis días restantes.

Pruebas: `test_whatsapp_response_schedule.py`, notificaciones, cortesías, reacciones y acceso por sede. Fixture local `communications-scope-preview.html?section=weekly-stats&history-phone` permite probar el modal sin datos reales.
