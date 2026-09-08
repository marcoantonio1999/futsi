# Configuración de WhatsApp por sede

## Alcance

Comunicaciones > Ajustes del asistente permite elegir un número, vincularlo a
una sede y guardar modelo, saludo, contexto confirmado, días, horario y espera.
Cada número tiene una fila independiente en whatsapp_automation_settings.
No se copian datos de otros números. Las credenciales no se editan ni se muestran.
El modelo se introduce por su identificador: se valida el formato, no la
disponibilidad de ese modelo en la cuenta OpenAI.

La API es exclusiva de admin/owner/dev. GET /whatsapp-automation-settings/
lista las configuraciones y canales observados. GET/PATCH
/whatsapp-automation-settings/current/?business_address=whatsapp%3A%2B52...
selecciona explícitamente un número. GET no crea filas. Los PATCH quedan auditados.
Una sede ya vinculada no se puede reasignar desde este formulario para evitar
mezclar historiales. Las sedes inactivas no pueden asignarse.

## Orden de despliegue

1. Aplicar la migración Django 0049_whatsapp_site_model_configuration desde futsi/back:
   python manage.py migrate
2. Desplegar el servicio WhatsApp con los campos compartidos y el lector de perfiles.
3. Publicar el frontend y configurar explícitamente sede, modelo y contexto del canal actual.
4. Verificar con un mensaje autorizado que el modelo y contexto guardados se usan.

La tabla conserva sus permisos y RLS existentes. La migración agrega columnas:
no borra ni reasigna datos, ni selecciona automáticamente una sede.
Si openai_model sigue vacío, se conserva OPENAI_WHATSAPP_MODEL del proceso que
atiende el número. El valor heredado mostrado por el backend administrativo puede
diferir del servicio WhatsApp si sus variables no coinciden; guardar un modelo
explícito elimina esa ambigüedad.

Para perfiles vinculados a una sede, el prompt usa exclusivamente el contexto
guardado. Si falla OpenAI no se reutilizan respuestas estáticas de otra sede.
La disponibilidad para reservas se consulta por la sede del número.
Perfiles antiguos sin vínculo conservan el comportamiento anterior hasta configurarlos.

## Conexión de números

Esta pantalla configura comportamiento, no registra ni autentica números.
El servicio de academia todavía autentica un canal Meta/Dualhook por proceso
(PHONE_NUMBER_ID, WABA, claves y webhook en entorno). Para otro número se configura
su conexión/instancia con el mismo código y su propia fila de configuración.
No se habilita un enrutador multicanal de credenciales en esta entrega.
Verónica mantiene su flujo manual separado y no adquiere un chatbot por crear
una configuración.

## Validación local

Pruebas API con SQLite aislado: guardar, recargar, permisos, validación, aislamiento.
Pruebas del servicio con OpenAI simulado: modelo y contexto por número,
reservas por sede, historial de 24 mensajes y regresiones de Verónica.
La vista /tests/site-settings-preview.html del servidor Vite usa datos ficticios
en sessionStorage y bloquea solicitudes a servicios reales; no reemplaza las
pruebas de persistencia del backend ni una prueba autorizada de WhatsApp.
