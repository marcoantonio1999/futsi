# Planes de cobro recurrente

En Cobranza, selecciona al alumno y entra en Nuevo cobro → Cobro recurrente.
Elige importe por cuota, descuento por cuota, primer mes, día (1–31), intervalo
en meses y número de cuotas. Cada mes durante 15 meses equivale a 15 cuotas.
La fecha final aparece antes de guardar. Los días inexistentes se ajustan al
último día del mes, sin cambiar el día preferido de las siguientes cuotas.

Puede vincularse una inscripción activa del mismo alumno y sede. La duración
se elige expresamente: el catálogo actual de torneos tiene semanas estimadas,
no una duración exacta en meses. No se convierten semanas a meses en silencio.
No permite crear otro plan sobre una inscripción con cargos existentes:
deben revisarse, no duplicarse ni borrarse automáticamente.

Todas las cuotas se guardan como cargos, en una transacción. No se registran
pagos futuros. La casilla de primera cuota permite registrar únicamente el
pago ya recibido, en la misma operación. Los descuentos conservan la aprobación
por rol; si requieren autorización, hay que guardar sin cobrar la primera cuota.
Los planes mensuales sustituyen la generación genérica de mensualidades para
ese alumno; al terminar no se reanudan automáticamente. Una inscripción con plan
tampoco genera paralelamente cargos semanales o de torneo completo.

Cada cuota se muestra en Por cobrar con fecha y número de cuota (seis por página).
Se cobra con el flujo existente de pagos. Los cargos futuros no se cancelan
automáticamente al retirar una inscripción: revisar las obligaciones pendientes
según la política del torneo. Este cambio no añade cancelación/edición masiva de planes.

## Activación

Requiere desplegar backend y aplicar la migración Django `0050_billing_plan`
antes de publicar el frontend actualizado. La migración crea `billing_plans`
y la relación opcional en `charges`; preserva cargos/pagos existentes. En
Postgres habilita RLS y retira acceso directo de anon/authenticated al plan;
el acceso es mediante Django, autenticado y limitado por sede.

La migración se ha probado solo sobre SQLite aislado. No se ha aplicado a la
base compartida de Supabase durante el desarrollo local. No reiniciar el backend
local contra la base compartida con este código hasta coordinar la migración.

## Validación local

- `front/tests/billing-flow-preview.html`: simulación sin peticiones reales.
- `front/tests/billing-recurrence.test.mjs`: fechas, límites y años bisiestos.
- `back/core/tests/test_billing_recurrence.py`: API, descuentos, primera cuota,
  duplicados/reintentos, rollback, permisos y vínculos de torneo.
- Tests Django con `DB_ENGINE=sqlite`, `ALLOW_SQLITE=true`,
  `SQLITE_DATABASE_PATH=:memory:`, `WHATSAPP_DELAY_WORKER_ENABLED=false`.

Nunca ejecutar pruebas financieras ni sembrar datos en la base compartida.
