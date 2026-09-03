# Agente telefónico de pruebas gratuitas

El backend conecta llamadas entrantes de Twilio con OpenAI Realtime, consulta
disponibilidad real y reserva exactamente dos visitas. El Dashboard muestra
reservas, responsable, alumno, ambas visitas, llamadas, transcripciones y la
revisión comercial de cada llamada.

## Flujo real

1. Twilio envía la llamada a `POST /api/voice/twilio/incoming/`.
2. FUTSI valida firma, Account SID, número destino y formato del Call SID.
3. FUTSI abre directamente el Media Stream bidireccional
   `wss://<api>/ws/voice/twilio/` y el puente ASGI intercambia PCMU a 8 kHz con
   OpenAI Realtime.
4. El agente se identifica como asistente virtual y ofrece únicamente horarios
   devueltos por las reglas y cupos vigentes.
   Después de repetir todos los datos y recibir una confirmación explícita, crea
   las dos visitas en una transacción atómica e idempotente.
5. Se guardan segmentos de texto; FUTSI no graba ni almacena audio.
6. Si la persona pide detener o borrar la transcripción durante la conversación, la herramienta
   `withdraw_consent` elimina los segmentos locales y cierra el stream.
7. Una llamada es exitosa automáticamente solo cuando existe una reserva con dos
   visitas. Un administrador puede confirmar o corregir su resultado en Dashboard.

El puente espera la confirmación de configuración de Realtime antes de hablar,
impide herramientas después de colgar y usa `mark`/`clear` de Twilio para no guardar
como escuchadas respuestas interrumpidas.

## Credenciales: paso obligatorio

Toda clave pegada en un chat, ticket, commit o captura debe considerarse
comprometida. Antes de desplegar:

1. Revoca la API key expuesta y crea una nueva clave de OpenAI limitada al proyecto.
2. Rota el Auth Token de Twilio. Si usas el token secundario durante la rotación,
   promuévelo a primario antes de activar los webhooks, porque la validación usa el
   Auth Token vigente.
3. Introduce los valores nuevos directamente en **Render > Environment**. No los
   pongas en Git, `back/.env` compartido, variables `VITE_*`, el frontend ni otro chat.

Referencias: [seguridad de claves de OpenAI](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)
y [credenciales seguras de Twilio](https://www.twilio.com/docs/usage/secure-credentials).

## Demo local antes de Render con Cloudflare Quick Tunnel

Sí se puede probar una llamada real antes de desplegar. Twilio necesita una URL
pública, por lo que un
[Quick Tunnel de Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
expone temporalmente el backend local. Es solo para una demostración corta: el
hostname cambia cada vez, no tiene SLA y cualquiera que conozca la URL puede intentar
acceder al servidor. No compartas la URL y mantén abiertos los tres procesos durante
la llamada.

No uses las credenciales que ya aparecieron en un chat, aunque la prueba sea local.
Rótalas primero. Para no capturarlas en cada ejecución puedes guardarlas en
`back/.env`, que está excluido de Git; no las coloques en `front/.env*`, variables
`VITE_*`, Git ni este documento. Evita sincronizar o compartir ese archivo.
Antes de cambiar Twilio, anota o toma una captura de la URL, método, callback de
estado y eventos actuales para poder restaurarlos al terminar.

La receta siguiente parte de la raíz `futsi` y usa una base SQLite desechable
`back/.voice-demo.sqlite3`; así no altera Supabase ni una base real. El seed carga
solo datos ficticios, incluidas dos reglas activas en **Cancha Demo Voz**, una reserva
con dos visitas y dos llamadas de muestra para que el Dashboard no aparezca vacío.

### Opción recomendada: un solo script

Desde PowerShell, en la raíz `futsi`, primero comprueba dependencias, archivos y
puertos. Este modo no pide credenciales, no cambia datos y no usa la red:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\start-local-voice-demo.ps1 -CheckOnly
```

Cuando el chequeo termine correctamente, arranca la demostración:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\start-local-voice-demo.ps1
```

`-ExecutionPolicy Bypass` se aplica sólo a ese proceso de PowerShell; no cambia la
política del equipo.

Opcionalmente agrega estas cuatro líneas, con credenciales nuevas, al archivo
`back/.env`:

```dotenv
OPENAI_API_KEY=sk-...
TWILIO_AUTH_TOKEN=...
TWILIO_ACCOUNT_SID=AC...
TWILIO_PHONE_NUMBER=+1...
```

El launcher lee únicamente esas cuatro variables del archivo, valida su formato y
pregunta sólo las que falten o sean inválidas. Para usar otro archivo local ejecuta
el script con `-EnvFile ruta\al\archivo.env`.

El script:

1. migra y reinicia únicamente `back/.voice-demo.sqlite3`;
2. exige una contraseña segura para `admin` la primera vez; en arranques posteriores
   conserva esa contraseña y sólo revoca su token de sesión anterior;
3. crea el Quick Tunnel temporal;
4. carga las credenciales desde `back/.env` cuando están presentes y pide de forma
   interactiva únicamente las que falten;
5. valida con una consulta de solo lectura que la cuenta de Twilio autentica y que
   el número pertenece a ella, antes de aislar respaldos o modificar webhooks;
6. arranca Uvicorn y valida la salud local y pública;
7. abre una sesión WebSocket real con `gpt-realtime-2.1`, aplica la misma
   configuración PCMU de la llamada y exige una respuesta de audio mínima; una
   clave sin acceso, permisos o cuota aborta antes de modificar Twilio;
8. ejecuta `twilio_local_demo configure --base-url <url>` para guardar la
   configuración actual del número y apuntarlo temporalmente al túnel;
9. arranca Vite y muestra **LISTO PARA LLAMAR** únicamente después de que la salud
   pública responda `200 ready`, OpenAI sea accesible y Twilio confirme la
   configuración.

Si cambias de cuenta mientras existe un respaldo pendiente perteneciente a otra,
el launcher exige escribir `AISLAR` y mueve ese respaldo a
`back/.twilio-local-demo-backups/`. No restaura la cuenta anterior: nunca uses el
token de la cuenta nueva para intentar restaurar un respaldo de la cuenta vieja.

Mantén esa ventana abierta durante la llamada. Al terminar y cuando ya no haya una
llamada activa, presiona `Ctrl+C`: el bloque de limpieza ejecuta
`twilio_local_demo restore` antes de cerrar el túnel y detiene sólo los procesos
creados por el propio script. Si cierras PowerShell a la fuerza, apagas el equipo o
se pierde la red durante la restauración, restaura el número desde Twilio Console
con la configuración anterior antes de volver a usarlo.

Si el chequeo indica que los puertos `8000` o `5173` están ocupados, detén los
servidores locales anteriores de FUTSI y vuelve a ejecutar. El script no mata
procesos que no haya creado.

### Alternativa manual: tres terminales

Usa los pasos siguientes sólo como fallback si necesitas diagnosticar por separado
el túnel, backend o frontend. En este flujo tú eres responsable de guardar y
restaurar la configuración anterior del número.

#### 1. Terminal 1: abrir el túnel

`cloudflared` ya está instalado en la máquina. Desde la raíz:

```powershell
cloudflared tunnel --url http://127.0.0.1:8000 --no-autoupdate
```

Copia la URL `https://<palabras-aleatorias>.trycloudflare.com` que aparece en la
salida y deja esta terminal abierta. Es normal recibir `502` hasta que arranque el
backend. Si existe `%USERPROFILE%\.cloudflared\config.yml` o `config.yaml`, un Quick
Tunnel puede no iniciar; muévelo temporalmente fuera de esa carpeta y restáuralo
después de la demo.

#### 2. Terminal 2: configurar y arrancar el backend ASGI

Abre otra terminal desde la raíz y ejecuta lo siguiente. Sustituye únicamente la URL
de ejemplo por la que imprimió `cloudflared`, sin `/` final:

```powershell
cd back

$PUBLIC_BASE = "https://<palabras-aleatorias>.trycloudflare.com"
$PUBLIC_WSS = ($PUBLIC_BASE -replace "^https://", "wss://") + "/ws/voice/twilio/"
$tunnelHost = ([Uri]$PUBLIC_BASE).Host

$env:TWILIO_PUBLIC_BASE_URL = $PUBLIC_BASE
$env:TWILIO_STREAM_URL = $PUBLIC_WSS
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1,$tunnelHost"

$env:FUTSI_ENV = "demo"
$env:DJANGO_DEBUG = "false"
$env:DJANGO_SECURE_SSL_REDIRECT = "false"
$env:DJANGO_SECRET_KEY = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
$env:DB_ENGINE = "sqlite"
$env:ALLOW_SQLITE = "true"
$env:SQLITE_DATABASE_PATH = (Join-Path (Get-Location) ".voice-demo.sqlite3")

$env:OPENAI_REALTIME_MODEL = "gpt-realtime-2.1"
$env:OPENAI_TRANSCRIPTION_MODEL = "gpt-realtime-whisper"
$env:OPENAI_REALTIME_VOICE = "cedar"
$env:OPENAI_REALTIME_VAD_THRESHOLD = "0.75"
$env:OPENAI_REALTIME_VAD_PREFIX_PADDING_MS = "400"
$env:OPENAI_REALTIME_VAD_SILENCE_DURATION_MS = "700"
$env:TWILIO_VALIDATE_SIGNATURES = "true"

function Read-SecretToProcessEnv([string]$Name) {
    $secureValue = Read-Host "Introduce $Name" -AsSecureString
    $plainValue = [System.Net.NetworkCredential]::new("", $secureValue).Password
    [Environment]::SetEnvironmentVariable($Name, $plainValue, "Process")
    $plainValue = $null
}

Read-SecretToProcessEnv "OPENAI_API_KEY"
Read-SecretToProcessEnv "TWILIO_AUTH_TOKEN"
Remove-Item Function:\Read-SecretToProcessEnv

$env:TWILIO_ACCOUNT_SID = Read-Host "Introduce TWILIO_ACCOUNT_SID"
$env:TWILIO_PHONE_NUMBER = Read-Host "Introduce TWILIO_PHONE_NUMBER en formato E.164"

.\.venv\Scripts\python.exe manage.py migrate
$env:ALLOW_DESTRUCTIVE_SEED = "true"
.\.venv\Scripts\python.exe manage.py seed_demo --reset
Remove-Item Env:ALLOW_DESTRUCTIVE_SEED
.\.venv\Scripts\python.exe manage.py changepassword admin

.\.venv\Scripts\python.exe -m uvicorn futsi_api.asgi:application --host 127.0.0.1 --port 8000
```

El cambio de contraseña evita dejar la cuenta administrativa con la contraseña demo
conocida mientras el túnel está abierto. Usa Uvicorn, no `manage.py runserver`: esta
prueba necesita el endpoint WebSocket ASGI. Los valores públicos deben quedar
exactamente así:

```text
PUBLIC_BASE = https://<hostname>.trycloudflare.com
PUBLIC_WSS  = wss://<hostname>.trycloudflare.com/ws/voice/twilio/
```

#### 3. Terminal 3: arrancar el frontend local

```powershell
cd front
$env:VITE_API_URL = "http://127.0.0.1:8000/api"
npm.cmd install
npm.cmd run dev
```

Abre `http://127.0.0.1:5173`, entra con `admin` y la contraseña temporal definida en
el paso anterior. En **Dashboard > Disponibilidad**, verifica las dos reglas activas
de **Cancha Demo Voz**. Puedes editar sus días, horarios, duración y cupo para
adaptarlos a la demostración; conserva opciones suficientes dentro de los próximos
30 días para separar las dos visitas entre 1 y 21 días.

#### 4. Verificar salud y conectar temporalmente Twilio

Abre en el navegador:

```text
https://<hostname>.trycloudflare.com/health/voice/
```

Después del seed debe responder `200`, `"status": "ready"`,
`"configured": true`, `"secure_transport": true`,
`"signature_validation": true`, `"database": true` y al menos una regla activa.
Si responde `503`, revisa los campos booleanos y confirma que las reglas de
**Cancha Demo Voz** sigan activas. Este endpoint valida la configuración local, no
consume OpenAI ni reemplaza una llamada real.

En **Twilio Console > Phone Numbers > Manage > Active numbers > tu número > Voice
configuration**, configura temporalmente:

- **A call comes in**: `Webhook`
- URL: `https://<hostname>.trycloudflare.com/api/voice/twilio/incoming/`
- método: `HTTP POST`
- **Call status changes**:
  `https://<hostname>.trycloudflare.com/api/voice/twilio/status/`
- eventos: `initiated`, `ringing`, `answered`, `completed`
- método: `HTTP POST`

No configures manualmente las rutas de estado del stream:
el TwiML de FUTSI las genera desde `PUBLIC_BASE`. Twilio calcula
`X-Twilio-Signature` con la URL exacta, por eso un hostname viejo, una barra diferente
o un Auth Token que aún no sea el vigente produce `403`.

#### 5. Hacer la llamada de demostración

Con la computadora despierta, red estable y las tres terminales abiertas:

1. Llama al número de Twilio.
2. Espera el saludo directo de la asistente virtual.
3. Indica responsable, nombre del niño, edad, sede y preferencias de horario.
4. Confirma expresamente las dos visitas.
5. En el frontend revisa **Dashboard > Pruebas gratuitas** y
   **Dashboard > Llamadas y transcripciones**.

La llamada consume saldo de Twilio y uso de la API de OpenAI. La clave nueva debe
pertenecer a un proyecto con facturación/crédito y acceso a Realtime. Para aislar
fallas, primero confirma que `/health/voice/` esté listo y observa simultáneamente
los logs de `cloudflared` y Uvicorn.

#### 6. Restaurar Twilio y cerrar la demo

Primero restaura en Twilio la URL, método, callback de estado y eventos que tenía el
número antes de la prueba. Hazlo **antes** de cerrar el túnel: su URL deja de servir
en cuanto termina `cloudflared`.

Después, cuando no haya una llamada activa:

1. Presiona `Ctrl+C` en frontend, backend y finalmente `cloudflared`.
2. Cierra la Terminal 2 para destruir sus variables de sesión; o, si la conservarás,
   límpialas explícitamente:

```powershell
@(
    "OPENAI_API_KEY",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_PHONE_NUMBER",
    "TWILIO_PUBLIC_BASE_URL",
    "TWILIO_STREAM_URL",
    "DJANGO_SECRET_KEY"
) | ForEach-Object {
    Remove-Item "Env:$_" -ErrorAction SilentlyContinue
}
```

La base `.voice-demo.sqlite3` queda local e ignorada por Git para poder enseñar el
resultado otra vez. Cuando ya no necesites conservar citas o transcripciones de la
demo, elimínala de forma explícita con el backend detenido.

## Variables de Render

```dotenv
OPENAI_API_KEY=<clave-nueva>
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_TRANSCRIPTION_MODEL=gpt-realtime-whisper
OPENAI_REALTIME_VOICE=cedar
OPENAI_REALTIME_VAD_THRESHOLD=0.75
OPENAI_REALTIME_VAD_PREFIX_PADDING_MS=400
OPENAI_REALTIME_VAD_SILENCE_DURATION_MS=700

TWILIO_ACCOUNT_SID=<account-sid>
TWILIO_AUTH_TOKEN=<auth-token-nuevo>
TWILIO_PHONE_NUMBER=<numero-e164>
TWILIO_PUBLIC_BASE_URL=https://futsi.onrender.com
TWILIO_STREAM_URL=wss://futsi.onrender.com/ws/voice/twilio/
TWILIO_VALIDATE_SIGNATURES=true

TRIAL_MIN_ADVANCE_HOURS=2
TRIAL_BOOKING_HORIZON_DAYS=30
TRIAL_MIN_DAYS_BETWEEN_VISITS=1
TRIAL_MAX_DAYS_BETWEEN_VISITS=21
VOICE_MAX_CALL_SECONDS=900
VOICE_IDLE_TIMEOUT_SECONDS=90
VOICE_CALLS_PER_NUMBER_PER_HOUR=5
VOICE_MAX_CONCURRENT_STREAMS=5

VOICE_TRANSCRIPT_RETENTION_DAYS=90
VOICE_CALL_RETENTION_DAYS=365
TRIAL_PII_RETENTION_DAYS=365
VOICE_RETENTION_BATCH_SIZE=1000
```

`DJANGO_SECRET_KEY` también debe ser un valor aleatorio y diverso de al menos 50
caracteres; el backend falla al iniciar en producción si conserva un placeholder.
Puedes generarlo localmente con
`python -c "import secrets; print(secrets.token_urlsafe(50))"` y copiar el resultado
directamente a Render.

En producción, `TWILIO_PUBLIC_BASE_URL` debe ser un origen HTTPS sin ruta, query ni
credenciales. `TWILIO_STREAM_URL` debe usar WSS, el mismo hostname y exactamente la
ruta `/ws/voice/twilio/`. Cambia `futsi.onrender.com` si el hostname real es otro.

## Configuración del número en Twilio

En **Phone Numbers > Manage > Active numbers > Voice configuration**:

- **A call comes in**: `Webhook`
- URL: `https://<api-real>/api/voice/twilio/incoming/`
- Método: `HTTP POST`
- **Call status changes**: `https://<api-real>/api/voice/twilio/status/`
- Eventos: `initiated`, `ringing`, `answered`, `completed`
- Método: `HTTP POST`

Reemplaza la URL de demostración. No apuntes Twilio a GitHub Pages: el webhook y el
WebSocket viven en el backend ASGI de Render. FUTSI valida
`X-Twilio-Signature`; consulta la [guía de seguridad de webhooks de Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
y los [mensajes de Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages).

## Despliegue y disponibilidad

El `render.yaml` inicia Django con Uvicorn/ASGI, ejecuta migraciones antes del
despliegue y define un cron separado `futsi-voice-retention` a las `09:15 UTC`.
Los cron de Render son servicios aislados y pueden tener costo propio; revisa el
plan antes de sincronizar el Blueprint.

Después del despliegue:

```powershell
python manage.py check
python manage.py migrate
python manage.py purge_voice_data --dry-run
```

1. Verifica `GET https://<api>/health/` como liveness y
   `GET https://<api>/health/db/` como disponibilidad de base. Render usa la segunda.
2. En FUTSI entra a **Dashboard > Disponibilidad** y crea reglas por sede, día,
   horario, duración, cancha y cupo.
3. Verifica `GET https://<api>/health/voice/`. Debe responder `200` y
   `"status": "ready"`. Solo comprueba formato/configuración local y reglas activas;
   nunca devuelve credenciales ni sustituye una llamada real a los proveedores.
4. Configura el número de Twilio y realiza la prueba integral.

Sin una regla activa en una sede activa —y cancha activa cuando corresponda— el
agente no puede ofrecer citas y `/health/voice/` responde `503`.

## Prueba integral

Haz estas llamadas con credenciales ya rotadas:

- Debe conectarse inmediatamente con la asistente virtual, sin menús por teclado,
  y ofrecer únicamente horarios configurados.
- Agenda para un niño menor de 13 años: la edad no debe bloquear la llamada ni la
  reserva; el rango operativo de la academia sigue siendo de 3 a 17 años.
- Confirma solo una visita: no debe crear ninguna reserva.
- Confirma expresamente las dos: deben aparecer una reserva y exactamente dos
  visitas en **Dashboard > Pruebas gratuitas**.
- Di “ya no quiero que transcribas”: el stream debe cerrarse, el Dashboard debe
  mostrar consentimiento retirado y no debe conservar segmentos de esa llamada.
- Revisa **Dashboard > Llamadas y transcripciones**, marca el resultado comercial
  y confirma que un coordinador de sede no pueda leer transcripciones.

## Privacidad y retención

La [guía de OpenAI para menores de 18 años](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
requiere salvaguardas adicionales. El flujo telefónico ya no usa la edad como puerta:
parte del supuesto operativo de que quien llama es el padre, madre o tutor adulto y
limita los datos del alumno a su primer nombre y edad.

FUTSI debe aprobar con asesoría aplicable:

- el texto del aviso y consentimiento;
- si debe habilitar Zero Data Retention o evitar procesar datos personales de niños
  menores de 13 años antes de usar este flujo en producción;
- los plazos de transcripción, metadatos de llamada y datos de reservas concluidas.

Los valores de 90/365 días son defaults técnicos, no una determinación legal. El
cron elimina transcripciones vencidas, elimina llamadas vencidas y anonimiza datos
personales solo en reservas con visitas concluidas o reservas huérfanas sin
visitas una vez vencido el plazo, sin importar el estado que hubieran conservado.
También limpia copias en resultados internos, texto libre, notas y
bitácoras de revisión. Las reservas activas no se anonimizan.

Esta retención controla únicamente las copias de FUTSI. OpenAI documenta que los
controles de retención del proveedor son independientes de esta base local y que ZDR
requiere aprobación y configuración real del proyecto. El aviso de privacidad y el
flujo de retiro deben reflejar esa diferencia. Consulta
[controles y retención de datos de OpenAI](https://developers.openai.com/api/docs/guides/your-data).

Para ejecutar o inspeccionar la política manualmente:

```powershell
python manage.py purge_voice_data --dry-run
python manage.py purge_voice_data
```

## Límites operativos y gasto

Por defecto, FUTSI acepta hasta cinco llamadas nuevas por número cada hora y hasta
cinco Media Streams simultáneos. Los reclamos de capacidad se serializan en
PostgreSQL para que varios workers no excedan el tope. Ajusta
`VOICE_CALLS_PER_NUMBER_PER_HOUR`, `VOICE_MAX_CONCURRENT_STREAMS`, el máximo de 900
segundos y el timeout de inactividad según el personal y presupuesto disponibles.
Configura además límites de gasto y alertas directamente en OpenAI y Twilio.

## Acceso

- Administrador, propietario y desarrollo: citas, disponibilidad, llamadas y
  transcripciones.
- Coordinador de sede: citas y llamadas de su sede; no recibe transcripciones.
- Otros roles: sin acceso al módulo.

Las rutas públicas de Twilio validan firma, Account SID, número destino,
consentimiento y un token de Media Stream de un solo uso. La implementación de
Realtime sigue la [guía oficial de conversaciones Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations).
