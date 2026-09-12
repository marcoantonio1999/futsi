# Comunicaciones → Verónica

Implementación local: nueva sección solo para admin, owner y dev. No requiere
entrar en Dualhook desde el navegador ni expone su API key. Las cuentas de sede
no obtienen acceso al canal de reclutamiento por tener permisos de comunicaciones.

## Flujo

1. Elegir conversación (30 por página, búsqueda por teléfono/nombre registrado)
   o Nuevo destinatario. Usar código de país, por ejemplo +52 y 10 dígitos.
2. Plantillas → Consultar: catálogo de la WABA de Verónica, con estado e idioma.
   `reclutamiento_primer_mensaje`, `es`, se preselecciona si existe. Se comprueba
   otra vez la aprobación al enviar. Plantillas con variables o encabezados de
   medios se muestran, pero no se pueden enviar con este formulario simple.
3. Mensaje/PDF disponibles solo tras una entrada del contacto en las últimas
   24 horas. Enviar una plantilla no abre esa ventana por sí solo.
4. Elegir PDF de máximo 5 MB y descripción opcional. Al confirmar se sube a
   Dualhook con las credenciales de Verónica y se envía mediante media ID.
   No hay biblioteca permanente de PDF ni envío automático nuevo en esta UI.
5. Se muestra historial y se consultan estados cada 15 segundos con la pestaña
   visible. «Aceptado» no es «entregado». Error 131042: revisar pagos de Meta.

Los envíos inciertos mantienen el identificador de operación mientras no cambie
el borrador. No se reenvían automáticamente. Los intentos fallidos/inciertos
aparecen en el historial. Confirmar antes de iniciar un intento diferente.

## Servidores

- Backend Futsi: WHATSAPP_SERVICE_URL (HTTPS) y WHATSAPP_SERVICE_TOKEN.
- Servicio WhatsApp: FUTSI_SERVICE_TOKEN debe coincidir; VERONICA_ENABLED,
  PHONE_NUMBER_ID, WABA_ID, API_KEY, VERIFY_TOKEN y WEBHOOK_SECRET del canal.
- Rutas internas nuevas /api/internal/veronica/{inbox,history,templates,upload,send}/.
- Rutas del dashboard /api/veronica/{operación}/ con autenticación normal Futsi.
- Sin migraciones nuevas. Conserva reservas de envío y usa las tablas existentes.
- Desplegar servicio WhatsApp y backend Futsi antes del frontend cuando se autorice.
  No se ha desplegado como parte de esta implementación local.

El webhook guarda también nuevos mensajes sin campaña; siempre con control
humano, sin invocar IA. Los ecos del teléfono se registran si Meta entrega el
evento smb_message_echoes. El flujo PDF automático previo de campañas permanece
separado: enviar una plantilla manual desde esta UI no inscribe a una campaña.
No se recuperan automáticamente conversaciones históricas ni callbacks que ya
fueron descartados. Los eventos deben superar validación de secreto, WABA y Phone ID.

## Verificación aislada

- Servicio: manage.py test core.tests.test_veronica core.tests.test_veronica_console
  con DB_ENGINE=sqlite, SQLITE_DATABASE_PATH=:memory:.
- Futsi: pytest core/tests/test_veronica_console.py con DB_ENGINE=sqlite,
  ALLOW_SQLITE=true, FUTSI_ENV=test.
- Front: npm run typecheck, npm run build.
- UI: /tests/veronica-preview.html (solo desarrollo, fetch simulado; no envíos).

Antes de publicar, corregir la elegibilidad de facturación de la WABA real y
validar un envío real autorizado con callbacks entregado/leído. Las pruebas
locales no sustituyen esa validación con Meta.
