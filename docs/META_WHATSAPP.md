# WhatsApp Cloud API de Meta

Esta integración es independiente de las llamadas. Twilio sigue atendiendo voz;
Meta recibe y envía los mensajes de WhatsApp. Ambos canales comparten la agenda,
las reservas y el dashboard de FUTSI.

## Qué queda disponible

- Webhook de Meta: `/api/whatsapp/meta/webhook/`
- Salud segura: `/health/whatsapp/meta/`
- Flujo interactivo de prueba gratuita: sede, primera visita, segunda visita,
  responsable, alumno, edad y confirmación.
- Menú inicial con acceso a `Agendar prueba` y `Hacer una pregunta`.
- Preguntas y respuestas con OpenAI Responses API, contexto breve, tono cálido,
  emojis moderados y seguimiento humano cuando el dato no está confirmado.
- Sólo se muestran sedes y horarios que permiten reservar las dos visitas.
- La reserva y toda la conversación aparecen en el dashboard actual.
- En `Adeudos`, el botón `WhatsApp` envía una plantilla real de recordatorio y
  guarda el envío en el historial del dashboard.

## Datos necesarios de Meta

Guárdalos únicamente en `back/.env`:

```env
META_WHATSAPP_ACCESS_TOKEN=token_de_usuario_del_sistema
META_WHATSAPP_PHONE_NUMBER_ID=id_numerico_del_numero
META_WHATSAPP_DISPLAY_NUMBER=+52XXXXXXXXXX
META_WHATSAPP_VERIFY_TOKEN=una_cadena_aleatoria_elegida_por_futsi
META_WHATSAPP_APP_SECRET=secreto_de_la_app_de_meta
META_WHATSAPP_GRAPH_VERSION=v23.0
META_WHATSAPP_INTERACTIVE=true
META_WHATSAPP_VALIDATE_SIGNATURES=true
META_WHATSAPP_PAYMENT_TEMPLATE=futsi_recordatorio_pago
META_WHATSAPP_TEMPLATE_LANGUAGE=es_MX
META_WHATSAPP_DEFAULT_SITE_CODE=cuajimalpa
META_WHATSAPP_LOCATION_NAME=Power Soccer Academy
META_WHATSAPP_LOCATION_ADDRESS=Antiguo Camino a Tecamachalco 686, Lomas de Vista Hermosa, Cuajimalpa de Morelos, 05100 Ciudad de México
META_WHATSAPP_CONTACT_PHONE=+52 55 7895 0758
META_WHATSAPP_LOCATION_LATITUDE=19.3824617
META_WHATSAPP_LOCATION_LONGITUDE=-99.2780863
OPENAI_WHATSAPP_MODEL=gpt-5.6-luna
OPENAI_WHATSAPP_FAQ_ENABLED=true
OPENAI_WHATSAPP_TIMEOUT_SECONDS=20
```

El access token temporal sirve para la prueba. Para producción se debe crear un
usuario del sistema y usar un token permanente con los permisos mínimos de
WhatsApp.

## Preguntas y respuestas con OpenAI

La misma `OPENAI_API_KEY` del backend puede usarse durante la demostración. El
modelo de texto se configura por separado con `OPENAI_WHATSAPP_MODEL`, por lo que
la voz y WhatsApp pueden evolucionar de forma independiente.

El catálogo provisional está en `back/core/whatsapp/faq_knowledge.py`. Antes de
producción reemplaza las respuestas de demostración con información aprobada por
FUTSI. El modelo no puede confirmar reservas, horarios, pagos ni saldos: esos datos
siempre deben proceder de la base de datos.

La conversación completa queda en el dashboard. Si el modelo no encuentra una
respuesta confirmada, marca automáticamente `Requiere seguimiento` para que una
persona continúe la atención.

## Configurar el webhook en Meta

El backend debe estar accesible mediante HTTPS. Si la URL pública es
`https://ejemplo.trycloudflare.com`, en Meta configura:

- Callback URL: `https://ejemplo.trycloudflare.com/api/whatsapp/meta/webhook/`
- Verify token: el valor exacto de `META_WHATSAPP_VERIFY_TOKEN`
- Campo a suscribir: `messages`

Meta primero hará un `GET` de verificación. Después entregará mensajes y estados
por `POST`; el backend valida cada `POST` con `X-Hub-Signature-256` y el App
Secret. No desactives esa validación fuera de una prueba local controlada.

Las URLs de Quick Tunnel cambian cada vez que se reinicia. Por eso sirven para la
prueba local, pero en producción la Callback URL debe apuntar al dominio estable
del backend.

## Conexión administrada por Dualhook

Cuando el número se incorpora mediante Embedded Signup de Dualhook, Meta firma
los `POST` con el App Secret privado de Dualhook. Ese secreto no se comparte con
los clientes y, por lo tanto, no debe intentarse validar con
`META_WHATSAPP_APP_SECRET`. FUTSI admite este modo validando que el sobre de
WhatsApp pertenezca al WABA y al Phone Number ID esperados.

En `back/.env` configura:

```env
META_WHATSAPP_PROVIDER=dualhook
META_WHATSAPP_PHONE_NUMBER_ID=id_mostrado_en_dualhook
META_WHATSAPP_VERIFY_TOKEN=el_mismo_verify_token_configurado_en_dualhook
META_WHATSAPP_GRAPH_VERSION=v25.0
DUALHOOK_API_KEY=dh_live_llave_de_la_conexion
DUALHOOK_WABA_ID=id_del_waba_mostrado_en_dualhook
DUALHOOK_API_BASE_URL=https://api.dualhook.com
```

La llave `dh_live_...` se usa únicamente en el backend para responder mediante
el runtime de Dualhook. Nunca debe guardarse en el frontend, pegarse en un chat ni
subirse al repositorio. Después de cambiar estas variables hay que reiniciar el
servidor y comprobar que `/health/whatsapp/meta/` muestre `provider: dualhook`,
`validation_mode: dualhook_asset_ids` y `status: ready`.

## Plantilla de recordatorio de pago

Los recordatorios iniciados por FUTSI deben enviarse con una plantilla `Utility`
aprobada por Meta. Crea `futsi_recordatorio_pago` en español de México con cinco
variables posicionales, en este orden:

```text
Hola {{1}}, te recordamos que el pago de {{3}} para {{2}} tiene un saldo
pendiente de ${{4}}. Fecha límite: {{5}}. Si ya pagaste, ignora este mensaje.
```

Si Meta aprueba la plantilla con otro nombre o idioma, actualiza
`META_WHATSAPP_PAYMENT_TEMPLATE` y `META_WHATSAPP_TEMPLATE_LANGUAGE`.

Cuando el cliente pide la ubicación o pregunta cómo llegar, el webhook envía una
tarjeta de ubicación nativa de WhatsApp usando las variables
`META_WHATSAPP_LOCATION_*`. Si Meta no acepta la tarjeta, se envía la dirección
como texto para no dejar la consulta sin respuesta.

## Prueba rápida

1. Levanta el backend y un túnel HTTPS hacia el puerto 8000.
2. Abre `/health/whatsapp/meta/`; debe responder `status: ready`.
3. Registra la Callback URL y el Verify token en Meta, y suscribe `messages`.
4. Desde un destinatario permitido para el número de prueba, envía `Hola`.
5. Debe aparecer el menú `Agendar prueba` / `Hacer una pregunta`.
6. Prueba una pregunta como `¿Qué debemos llevar?`; debe responder con calidez y
   quedar registrada en el dashboard.
7. Escribe `AGENDAR`; debe mostrar las sedes con disponibilidad y avanzar con
   listas y botones hasta confirmar las dos visitas.
8. Para cobranza, abre `Adeudos` y usa el botón `WhatsApp` de un cargo cuyo
   responsable tenga teléfono internacional válido.
