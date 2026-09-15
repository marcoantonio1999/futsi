# Envíos masivos de plantillas

## Acceso
- Administrador: Comunicaciones → Verónica · envíos masivos / Canchas · envíos masivos.
- Usuario restringido de Verónica: pestaña Envío masivo de plantillas; el servidor rechaza todos los endpoints de canchas y otros módulos.
- Los canales provienen exclusivamente de las conexiones configuradas en el servicio. Nunca se aceptan claves del navegador.

## Flujo
1. Elegir canal y consultar sus plantillas aprobadas.
2. Escribir teléfonos separados por coma/salto de línea, o cargar/arrastrar XLSX, CSV o TXT (2 MB, 1,000 números).
3. Solo teléfonos mexicanos de diez dígitos. El prefijo se agrega exclusivamente en el servidor al enviar. Duplicados e inválidos se excluyen y se muestran antes de crear el lote.
4. Seleccionar columna si no es inequívoca. Excel se lee sin ejecutar fórmulas ni vínculos; XLS debe convertirse a XLSX.
5. Preparar el lote NO envía. Ver destinatarios, plantilla y estimación; confirmar consentimiento y costo para comenzar.
6. Se conserva historial de lotes con paginación, progreso, estados individuales y cancelación de pendientes.

Las variables de texto de una plantilla de cancha pueden completarse con valores comunes al lote. Multimedia, variables nombradas y botones dinámicos no compatibles quedan deshabilitados. No se dispara el asistente al crear un lote.

## Costos
Referencia oficial MX/USD verificada el 14-09-2026 en https://whatsappbusiness.com/products/platform-pricing/:
Marketing 0.0305 USD; Utility/Authentication 0.0085 USD por mensaje entregado.
La estimación supone todos entregados y no descuenta ventanas gratuitas/volúmenes. No incluye impuestos, conversión a MXN ni recargos de Dualhook. Nunca se presenta como costo real facturado.
La referencia vence el 30-09-2026; después se bloquean nuevos envíos hasta actualizar las tarifas verificadas en `bulk_catalog.quote`. No se reutilizan silenciosamente precios vencidos.

## Operación y seguridad
- Migración Futsi: `0051_whatsapp_bulk` (depende únicamente de `0050_whatsapp_bot_switch`). Tres tablas compartidas, RLS activado, sin acceso de anon/authenticated vía Data API. Futsi autentica mediante Django.
- Servicio: modelos compartidos no administrados en producción; hilo bulk independiente cuando `WHATSAPP_DELAY_WORKER_ENABLED=true`. No hay variables ni tokens nuevos.
- Desplegar migración/backend Futsi antes del servicio, luego frontend. No habilitar envíos reales antes de verificar los tres componentes.
- Reserva transaccional de campaña/destinatario y clave única de dispatch impiden doble clic/reinicio/doble worker. Un proceso interrumpido puede dejar resultado incierto: se pausa y nunca se reintenta automáticamente.
- Cancelar no retira un mensaje que ya inició su petición al proveedor.
- Estados de webhook se guardan por canal+message ID, incluidos eventos adelantados/fuera de orden. Aceptado por API NO confirma entrega. Fallos de facturación o límite pausan pendientes.
- La conexión de WhatsApp debe seguir entregando estados al webhook correcto para confirmar entregas.
- Ninguna prueba automatizada llama al proveedor ni envía mensajes reales.

## Pruebas
Backend Futsi: `pytest core/tests/test_bulk_templates.py core/tests/test_veronica_access.py` con DB_ENGINE=sqlite, ALLOW_SQLITE=true, FUTSI_ENV=test.
Servicio: `manage.py test core.tests.test_bulk core.tests.test_veronica core.tests.test_veronica_console core.tests.test_accounts` con DB_ENGINE=sqlite y worker desactivado.
Frontend: `npm run typecheck` y `npm run build`.
Los cambios locales de cobranza preexistentes no forman parte de esta funcionalidad.
# Nombres de contactos

Excel y CSV aceptan una columna opcional `Nombre` junto a `Teléfono` (10 dígitos).
El nombre se muestra al revisar el archivo y en los destinatarios del lote; se
guarda en la conversación del canal al procesar el envío. No cruza nombres entre
canales ni sobrescribe un nombre editado manualmente. TXT conserva el formato
de números separados por comas. Los nombres no reemplazan variables de plantilla.
