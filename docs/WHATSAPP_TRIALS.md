# Reservas de pruebas gratuitas por WhatsApp

FUTSI incluye un flujo de WhatsApp con mensajes predeterminados. No usa OpenAI: consulta la disponibilidad real, permite elegir primero las dos visitas, reúne después los datos del responsable y del alumno, y crea la misma reserva que aparece en el dashboard. Sólo muestra sedes con dos horarios compatibles disponibles. Las sedes y los horarios se muestran como listas interactivas; la edad se elige primero por rango y luego por número exacto; la confirmación usa botones. El texto numerado queda como respaldo para clientes que no rendericen contenido enriquecido.

## Prueba local con Twilio Sandbox

1. En `back/.env` conserva el `TWILIO_ACCOUNT_SID` y el `TWILIO_AUTH_TOKEN` de la cuenta que usarás. Puedes agregar:

   ```env
   TWILIO_WHATSAPP_NUMBER=+14155238886
   TWILIO_WHATSAPP_INTERACTIVE=true
   ```

   Si omites esa línea, el iniciador local usa automáticamente el número compartido del Sandbox.

2. Inicia la demo habitual:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-voice-demo.ps1
   ```

3. Cuando aparezca `LISTO PARA LLAMAR Y PROBAR WHATSAPP`, copia la URL que muestra como `Webhook WhatsApp`.

4. Abre [Twilio WhatsApp Sandbox](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn), entra a la configuración del Sandbox y pega esa URL en **When a message comes in**, con método **POST**. Guarda los cambios.

5. Desde el WhatsApp que hará la prueba, envía la frase `join ...` que muestra Twilio al número `+1 415 523 8886`. Esta vinculación la exige el Sandbox para cada teléfono de prueba.

6. Envía `Hola`. El asistente contestará con el botón **Elegir sede** y una lista de opciones. Después solicitará los horarios de la primera y segunda visita antes de pedir los nombres. Para la edad mostrará los rangos **3 a 7**, **8 a 12** y **13 a 17 años**, seguidos de una lista con las edades exactas. También se puede escribir directamente un número del 3 al 17. Mantén abierta la ventana de PowerShell porque el túnel es temporal.

En cualquier momento el contacto puede escribir `AYUDA`, `REINICIAR` o `CANCELAR`.

Si Twilio registra el error `63038`, la cuenta de prueba agotó su límite de mensajes de las últimas 24 horas. El flujo conserva el avance, pero WhatsApp no entregará la respuesta hasta que vuelva a haber cupo o la cuenta se actualice.

## Qué se guarda

- La conversación completa, con mensajes entrantes y respuestas de FUTSI.
- El teléfono de WhatsApp y la sede elegida.
- El nombre del responsable y del alumno dentro de la reserva confirmada.
- Las dos visitas y su disponibilidad validada al confirmar.
- El origen `WhatsApp`, visible en la agenda y en la nueva pestaña de conversaciones del dashboard.
- El seguimiento operativo: indicador de pendiente, responsable asignado, notas y fecha de actualización. Estos cambios quedan registrados en la auditoría.

Las credenciales de Twilio permanecen sólo en el backend. No deben colocarse en archivos del frontend ni compartirse por chat.

## Paso a producción

El Sandbox sirve únicamente para pruebas. Para atender a cualquier familia desde un número oficial hay que registrar un remitente de WhatsApp en Twilio/Meta. Las respuestas libres son posibles durante la ventana de atención abierta por un mensaje del usuario; los mensajes iniciados por FUTSI fuera de esa ventana requieren plantillas aprobadas.

Referencias oficiales:

- [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
- [Webhooks entrantes de mensajería](https://www.twilio.com/docs/messaging/guides/webhook-request)
- [Plantillas de WhatsApp](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
- [Listas interactivas de Twilio](https://www.twilio.com/docs/content/twiliolist-picker)
