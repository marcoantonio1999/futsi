import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_list(name, default=""):
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def env_origin_list(name, default=""):
    origins = []
    for item in env_list(name, default):
        if item.startswith("capacitor://"):
            origins.append(item.rstrip("/"))
            continue
        parsed = urlparse(item)
        if parsed.scheme and parsed.netloc:
            origins.append(f"{parsed.scheme}://{parsed.netloc}")
        else:
            origins.append(item.rstrip("/"))
    return list(dict.fromkeys(origins))


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-only-change-me")
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() == "true"
FUTSI_ENV = os.getenv("FUTSI_ENV", "local" if DEBUG else "production").lower()
if not DEBUG and (
    not SECRET_KEY
    or SECRET_KEY in {"dev-only-change-me", "change-me", "change-this-to-a-long-random-secret"}
    or len(SECRET_KEY) < 50
    or len(set(SECRET_KEY)) < 5
):
    raise RuntimeError(
        "DJANGO_SECRET_KEY debe ser un secreto aleatorio y diverso de al menos "
        "50 caracteres en producción."
    )
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,10.0.2.2,testserver")
RENDER_EXTERNAL_HOSTNAME = os.getenv("RENDER_EXTERNAL_HOSTNAME")
IS_RENDER = bool(os.getenv("RENDER_SERVICE_ID") or RENDER_EXTERNAL_HOSTNAME)
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework.authtoken",
    "core",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "futsi_api.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "futsi_api.wsgi.application"
ASGI_APPLICATION = "futsi_api.asgi.application"

DB_ENGINE = os.getenv("DB_ENGINE", "postgres").lower()
DATABASE_URL = os.getenv("SUPABASE_DATABASE_URL") or os.getenv("DATABASE_URL")
ALLOW_SQLITE = os.getenv("ALLOW_SQLITE", "").lower() in {"1", "true", "yes", "si"}
IS_COLLECTSTATIC = "collectstatic" in sys.argv
HAS_POSTGRES_PARTS = any(
    os.getenv(name)
    for name in (
        "POSTGRES_HOST",
        "POSTGRES_PASSWORD",
        "SUPABASE_DB_HOST",
        "SUPABASE_DB_PASSWORD",
    )
)
DB_CONN_MAX_AGE = int(os.getenv("DB_CONN_MAX_AGE", "60"))
DB_CONN_HEALTH_CHECKS = os.getenv("DB_CONN_HEALTH_CHECKS", "true").lower() in {"1", "true", "yes", "si", "on"}


def postgres_config_from_url(database_url):
    parsed = urlparse(database_url)
    query = parse_qs(parsed.query)
    sslmode = query.get("sslmode", [os.getenv("POSTGRES_SSLMODE", "require")])[0]
    if not parsed.hostname:
        raise ValueError(
            "SUPABASE_DATABASE_URL no tiene host valido. Revisa que el password este URL-encoded "
            "si contiene caracteres como @, #, /, ?, &, %."
        )
    if IS_RENDER and parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError(
            "SUPABASE_DATABASE_URL apunta a localhost dentro de Render. Usa el host del pooler "
            "de Supabase, por ejemplo aws-1-us-west-2.pooler.supabase.com."
        )
    try:
        port = str(parsed.port or 5432)
    except ValueError as exc:
        raise ValueError(
            "SUPABASE_DATABASE_URL tiene un puerto invalido. Normalmente pasa cuando la contrasena "
            "contiene caracteres especiales y no esta URL-encoded. En Render es mas seguro eliminar "
            "SUPABASE_DATABASE_URL y usar POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, "
            "POSTGRES_DB y POSTGRES_PORT por separado."
        ) from exc

    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": (parsed.path or "/postgres").lstrip("/") or "postgres",
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "",
        "PORT": port,
        "OPTIONS": {"sslmode": sslmode},
        "CONN_MAX_AGE": DB_CONN_MAX_AGE,
        "CONN_HEALTH_CHECKS": DB_CONN_HEALTH_CHECKS,
    }


if (DB_ENGINE == "sqlite" and ALLOW_SQLITE and not IS_RENDER) or (
    IS_COLLECTSTATIC and not DATABASE_URL and not HAS_POSTGRES_PARTS
):
    # Render builds static assets before runtime secrets are available. collectstatic
    # does not need the application database, but Django requires a configured backend.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.getenv("SQLITE_DATABASE_PATH", BASE_DIR / "db.sqlite3"),
        }
    }
elif DATABASE_URL and not HAS_POSTGRES_PARTS:
    DATABASES = {"default": postgres_config_from_url(DATABASE_URL)}
elif DB_ENGINE == "postgres" or HAS_POSTGRES_PARTS:
    missing_postgres_settings = [
        name
        for name in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT")
        if not os.getenv(name) and not os.getenv(name.replace("POSTGRES_", "SUPABASE_DB_"))
    ]
    if missing_postgres_settings:
        raise RuntimeError(
            "Faltan variables de conexion Postgres/Supabase: "
            + ", ".join(missing_postgres_settings)
            + ". Configura back/.env o las variables de entorno POSTGRES_* con los datos del pooler de Supabase."
        )
    postgres_host = os.getenv("POSTGRES_HOST", os.getenv("SUPABASE_DB_HOST", "localhost"))
    if IS_RENDER and postgres_host in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError(
            "POSTGRES_HOST no puede ser localhost en Render. Cambialo por el host del pooler "
            "de Supabase, por ejemplo aws-1-us-west-2.pooler.supabase.com."
        )
    postgres_options = {}
    postgres_options["sslmode"] = os.getenv("POSTGRES_SSLMODE", "require")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("POSTGRES_DB", os.getenv("SUPABASE_DB_NAME", "postgres")),
            "USER": os.getenv("POSTGRES_USER", os.getenv("SUPABASE_DB_USER", "postgres")),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD", os.getenv("SUPABASE_DB_PASSWORD", "")),
            "HOST": postgres_host,
            "PORT": os.getenv("POSTGRES_PORT", os.getenv("SUPABASE_DB_PORT", "5432")),
            "CONN_MAX_AGE": DB_CONN_MAX_AGE,
            "CONN_HEALTH_CHECKS": DB_CONN_HEALTH_CHECKS,
            **({"OPTIONS": postgres_options} if postgres_options else {}),
        }
    }
else:
    raise RuntimeError(
        "Futsi ya no usa SQLite por default. Configura Supabase/Postgres con SUPABASE_DATABASE_URL "
        "o con POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST y POSTGRES_PORT. "
        "Solo para pruebas aisladas puedes usar DB_ENGINE=sqlite y ALLOW_SQLITE=true."
    )

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

RUNNING_PYTEST = "pytest" in sys.modules or any(Path(arg).name.startswith("pytest") for arg in sys.argv)
if os.getenv("DJANGO_TEST_FAST_PASSWORD_HASHERS", "").lower() in {"1", "true", "yes", "si", "on"} or RUNNING_PYTEST:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

LANGUAGE_CODE = "es-mx"
TIME_ZONE = "America/Mexico_City"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "core.User"

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,"
    "http://127.0.0.1:5173,"
    "http://localhost,"
    "https://localhost,"
    "capacitor://localhost,"
    "https://marcoantonio1999.github.io"
)
DEFAULT_CSRF_ORIGINS = (
    "http://localhost:5173,"
    "http://127.0.0.1:5173,"
    "http://localhost,"
    "https://localhost,"
    "https://marcoantonio1999.github.io"
)

CORS_ALLOWED_ORIGINS = env_origin_list(
    "CORS_ALLOWED_ORIGINS",
    DEFAULT_CORS_ORIGINS,
)
CSRF_TRUSTED_ORIGINS = env_origin_list(
    "CSRF_TRUSTED_ORIGINS",
    DEFAULT_CSRF_ORIGINS,
)
for required_origin in ("https://marcoantonio1999.github.io",):
    if required_origin not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS.append(required_origin)
    if required_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(required_origin)
CORS_ALLOW_CREDENTIALS = True

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_SSL_REDIRECT = (not DEBUG) and os.getenv("DJANGO_SECURE_SSL_REDIRECT", "true").lower() == "true"
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "31536000" if not DEBUG else "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
X_FRAME_OPTIONS = "DENY"
API_TOKEN_TTL_MINUTES = int(os.getenv("API_TOKEN_TTL_MINUTES", "720"))
FACE_STATION_SESSION_GRACE_MINUTES = int(os.getenv("FACE_STATION_SESSION_GRACE_MINUTES", "60"))
FILE_UPLOAD_MAX_VIDEO_BYTES = int(os.getenv("FILE_UPLOAD_MAX_VIDEO_BYTES", str(750 * 1024 * 1024)))
FILE_EVIDENCE_MAX_IMAGE_BYTES = int(os.getenv("FILE_EVIDENCE_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
FILE_INVOICE_MAX_PDF_BYTES = int(os.getenv("FILE_INVOICE_MAX_PDF_BYTES", str(15 * 1024 * 1024)))
FILE_INVOICE_MAX_XML_BYTES = int(os.getenv("FILE_INVOICE_MAX_XML_BYTES", str(2 * 1024 * 1024)))
FILE_UPLOAD_MAX_EXCEL_BYTES = int(os.getenv("FILE_UPLOAD_MAX_EXCEL_BYTES", str(25 * 1024 * 1024)))
FILE_EXPORT_MAX_EXCEL_BYTES = int(os.getenv("FILE_EXPORT_MAX_EXCEL_BYTES", str(25 * 1024 * 1024)))
FILE_EVIDENCE_RETENTION_DAYS = int(os.getenv("FILE_EVIDENCE_RETENTION_DAYS", "30"))

# Voice agent. Provider credentials are server-side only and must be injected by
# the deployment secret manager; they must never be exposed through Vite.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_WHATSAPP_MODEL = os.getenv("OPENAI_WHATSAPP_MODEL", "gpt-5.6-luna").strip()
OPENAI_WHATSAPP_FAQ_ENABLED = os.getenv(
    "OPENAI_WHATSAPP_FAQ_ENABLED",
    "true",
).lower() in {"1", "true", "yes", "si", "on"}
OPENAI_WHATSAPP_TIMEOUT_SECONDS = int(
    os.getenv("OPENAI_WHATSAPP_TIMEOUT_SECONDS", "20")
)
if not 5 <= OPENAI_WHATSAPP_TIMEOUT_SECONDS <= 60:
    raise RuntimeError("OPENAI_WHATSAPP_TIMEOUT_SECONDS debe estar entre 5 y 60.")

# Cuando está configurado, Futsi delega los mensajes salientes de WhatsApp al
# microservicio siempre activo. El dashboard conserva la misma base Supabase.
WHATSAPP_SERVICE_URL = os.getenv("WHATSAPP_SERVICE_URL", "").strip().rstrip("/")
WHATSAPP_SERVICE_TOKEN = os.getenv("WHATSAPP_SERVICE_TOKEN", "").strip()
WHATSAPP_SERVICE_TIMEOUT_SECONDS = int(
    os.getenv("WHATSAPP_SERVICE_TIMEOUT_SECONDS", "20")
)
OPENAI_REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
OPENAI_TRANSCRIPTION_MODEL = os.getenv(
    "OPENAI_TRANSCRIPTION_MODEL",
    "gpt-realtime-whisper",
)
OPENAI_REALTIME_VOICE = os.getenv("OPENAI_REALTIME_VOICE", "cedar")
OPENAI_REALTIME_VAD_THRESHOLD = float(
    os.getenv("OPENAI_REALTIME_VAD_THRESHOLD", "0.75")
)
OPENAI_REALTIME_VAD_PREFIX_PADDING_MS = int(
    os.getenv("OPENAI_REALTIME_VAD_PREFIX_PADDING_MS", "400")
)
OPENAI_REALTIME_VAD_SILENCE_DURATION_MS = int(
    os.getenv("OPENAI_REALTIME_VAD_SILENCE_DURATION_MS", "700")
)
if not 0 < OPENAI_REALTIME_VAD_THRESHOLD <= 1:
    raise RuntimeError("OPENAI_REALTIME_VAD_THRESHOLD debe estar entre 0 y 1.")
if not 0 <= OPENAI_REALTIME_VAD_PREFIX_PADDING_MS <= 5000:
    raise RuntimeError(
        "OPENAI_REALTIME_VAD_PREFIX_PADDING_MS debe estar entre 0 y 5000."
    )
if not 100 <= OPENAI_REALTIME_VAD_SILENCE_DURATION_MS <= 5000:
    raise RuntimeError(
        "OPENAI_REALTIME_VAD_SILENCE_DURATION_MS debe estar entre 100 y 5000."
    )

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
TWILIO_WHATSAPP_NUMBER = os.getenv("TWILIO_WHATSAPP_NUMBER", "").strip()
if TWILIO_WHATSAPP_NUMBER.lower().startswith("whatsapp:"):
    TWILIO_WHATSAPP_NUMBER = TWILIO_WHATSAPP_NUMBER[len("whatsapp:") :]
TWILIO_WHATSAPP_INTERACTIVE = os.getenv(
    "TWILIO_WHATSAPP_INTERACTIVE",
    "true",
).lower() in {"1", "true", "yes", "si", "on"}

# WhatsApp Cloud API (Meta). This is intentionally independent from Twilio:
# Twilio continues to handle phone calls while Meta owns WhatsApp messaging.
META_WHATSAPP_PROVIDER = os.getenv("META_WHATSAPP_PROVIDER", "meta").strip().lower()
META_WHATSAPP_ACCESS_TOKEN = os.getenv("META_WHATSAPP_ACCESS_TOKEN", "").strip()
META_WHATSAPP_PHONE_NUMBER_ID = os.getenv("META_WHATSAPP_PHONE_NUMBER_ID", "").strip()
META_WHATSAPP_DISPLAY_NUMBER = os.getenv("META_WHATSAPP_DISPLAY_NUMBER", "").strip()
META_WHATSAPP_VERIFY_TOKEN = os.getenv("META_WHATSAPP_VERIFY_TOKEN", "").strip()
META_WHATSAPP_APP_SECRET = os.getenv("META_WHATSAPP_APP_SECRET", "").strip()
DUALHOOK_API_KEY = os.getenv("DUALHOOK_API_KEY", "").strip()
DUALHOOK_WABA_ID = os.getenv("DUALHOOK_WABA_ID", "").strip()
DUALHOOK_API_BASE_URL = os.getenv(
    "DUALHOOK_API_BASE_URL",
    "https://api.dualhook.com",
).strip().rstrip("/")
META_WHATSAPP_GRAPH_VERSION = os.getenv(
    "META_WHATSAPP_GRAPH_VERSION",
    "v23.0",
).strip()
META_WHATSAPP_INTERACTIVE = os.getenv(
    "META_WHATSAPP_INTERACTIVE",
    "true",
).lower() in {"1", "true", "yes", "si", "on"}
META_WHATSAPP_VALIDATE_SIGNATURES = os.getenv(
    "META_WHATSAPP_VALIDATE_SIGNATURES",
    "true",
).lower() in {"1", "true", "yes", "si", "on"}
META_WHATSAPP_PAYMENT_TEMPLATE = os.getenv(
    "META_WHATSAPP_PAYMENT_TEMPLATE",
    "futsi_recordatorio_pago",
).strip()
META_WHATSAPP_TEMPLATE_LANGUAGE = os.getenv(
    "META_WHATSAPP_TEMPLATE_LANGUAGE",
    "es_MX",
).strip()
META_WHATSAPP_DEFAULT_SITE_CODE = os.getenv(
    "META_WHATSAPP_DEFAULT_SITE_CODE",
    "cuajimalpa",
).strip()
META_WHATSAPP_LOCATION_NAME = os.getenv(
    "META_WHATSAPP_LOCATION_NAME",
    "B Power Academy · UVM Lomas Verdes",
).strip()
META_WHATSAPP_LOCATION_ADDRESS = os.getenv(
    "META_WHATSAPP_LOCATION_ADDRESS",
    (
        "Paseo de las Aves 1, San Mateo Nopala, Naucalpan de Juárez, "
        "Estado de México, C.P. 53220"
    ),
).strip()
META_WHATSAPP_CONTACT_PHONE = os.getenv(
    "META_WHATSAPP_CONTACT_PHONE",
    "+52 55 7485 8165",
).strip()
META_WHATSAPP_LOCATION_LATITUDE = float(
    os.getenv("META_WHATSAPP_LOCATION_LATITUDE", "19.507465")
)
META_WHATSAPP_LOCATION_LONGITUDE = float(
    os.getenv("META_WHATSAPP_LOCATION_LONGITUDE", "-99.262555")
)
if not -90 <= META_WHATSAPP_LOCATION_LATITUDE <= 90:
    raise RuntimeError("META_WHATSAPP_LOCATION_LATITUDE no es válida.")
if not -180 <= META_WHATSAPP_LOCATION_LONGITUDE <= 180:
    raise RuntimeError("META_WHATSAPP_LOCATION_LONGITUDE no es válida.")
TWILIO_PUBLIC_BASE_URL = os.getenv(
    "TWILIO_PUBLIC_BASE_URL",
    f"https://{RENDER_EXTERNAL_HOSTNAME}" if RENDER_EXTERNAL_HOSTNAME else "",
).rstrip("/")
TWILIO_STREAM_URL = os.getenv("TWILIO_STREAM_URL", "").strip()
if not TWILIO_STREAM_URL and TWILIO_PUBLIC_BASE_URL:
    TWILIO_STREAM_URL = (
        TWILIO_PUBLIC_BASE_URL.replace("https://", "wss://", 1)
        .replace("http://", "ws://", 1)
        .rstrip("/")
        + "/ws/voice/twilio/"
    )
if not DEBUG:
    if TWILIO_PUBLIC_BASE_URL:
        public_voice_url = urlparse(TWILIO_PUBLIC_BASE_URL)
        if (
            public_voice_url.scheme != "https"
            or not public_voice_url.netloc
            or public_voice_url.path not in {"", "/"}
            or public_voice_url.params
            or public_voice_url.query
            or public_voice_url.fragment
            or public_voice_url.username
        ):
            raise RuntimeError(
                "TWILIO_PUBLIC_BASE_URL debe ser un origen HTTPS sin ruta, query ni credenciales."
            )
    if TWILIO_STREAM_URL:
        stream_voice_url = urlparse(TWILIO_STREAM_URL)
        if (
            stream_voice_url.scheme != "wss"
            or not stream_voice_url.netloc
            or stream_voice_url.path != "/ws/voice/twilio/"
            or stream_voice_url.params
            or stream_voice_url.query
            or stream_voice_url.fragment
            or stream_voice_url.username
        ):
            raise RuntimeError(
                "TWILIO_STREAM_URL debe ser WSS y terminar exactamente en /ws/voice/twilio/."
            )
        if (
            TWILIO_PUBLIC_BASE_URL
            and stream_voice_url.hostname
            != urlparse(TWILIO_PUBLIC_BASE_URL).hostname
        ):
            raise RuntimeError(
                "TWILIO_PUBLIC_BASE_URL y TWILIO_STREAM_URL deben usar el mismo hostname."
            )
TWILIO_VALIDATE_SIGNATURES = os.getenv(
    "TWILIO_VALIDATE_SIGNATURES",
    "true",
).lower() in {"1", "true", "yes", "si", "on"}
if not DEBUG:
    TWILIO_VALIDATE_SIGNATURES = True

if TWILIO_WHATSAPP_NUMBER and not (
    TWILIO_WHATSAPP_NUMBER.startswith("+")
    and TWILIO_WHATSAPP_NUMBER[1:].isdigit()
    and 8 <= len(TWILIO_WHATSAPP_NUMBER[1:]) <= 15
):
    raise RuntimeError(
        "TWILIO_WHATSAPP_NUMBER debe estar en formato E.164, por ejemplo +14155238886."
    )

TRIAL_MIN_ADVANCE_HOURS = max(0, int(os.getenv("TRIAL_MIN_ADVANCE_HOURS", "2")))
TRIAL_BOOKING_HORIZON_DAYS = max(
    1,
    min(int(os.getenv("TRIAL_BOOKING_HORIZON_DAYS", "30")), 180),
)
TRIAL_MIN_DAYS_BETWEEN_VISITS = max(
    0,
    int(os.getenv("TRIAL_MIN_DAYS_BETWEEN_VISITS", "1")),
)
TRIAL_MAX_DAYS_BETWEEN_VISITS = max(
    TRIAL_MIN_DAYS_BETWEEN_VISITS,
    int(os.getenv("TRIAL_MAX_DAYS_BETWEEN_VISITS", "21")),
)
VOICE_MAX_CALL_SECONDS = max(
    60,
    min(int(os.getenv("VOICE_MAX_CALL_SECONDS", "900")), 3540),
)
VOICE_IDLE_TIMEOUT_SECONDS = max(
    20,
    min(int(os.getenv("VOICE_IDLE_TIMEOUT_SECONDS", "90")), 300),
)
VOICE_CALLS_PER_NUMBER_PER_HOUR = max(
    1,
    min(int(os.getenv("VOICE_CALLS_PER_NUMBER_PER_HOUR", "5")), 100),
)
VOICE_MAX_CONCURRENT_STREAMS = max(
    1,
    min(int(os.getenv("VOICE_MAX_CONCURRENT_STREAMS", "5")), 100),
)
VOICE_TRANSCRIPT_RETENTION_DAYS = max(
    1,
    min(int(os.getenv("VOICE_TRANSCRIPT_RETENTION_DAYS", "90")), 3650),
)
VOICE_CALL_RETENTION_DAYS = max(
    1,
    min(int(os.getenv("VOICE_CALL_RETENTION_DAYS", "365")), 3650),
)
TRIAL_PII_RETENTION_DAYS = max(
    1,
    min(int(os.getenv("TRIAL_PII_RETENTION_DAYS", "365")), 3650),
)
VOICE_RETENTION_BATCH_SIZE = max(
    1,
    min(int(os.getenv("VOICE_RETENTION_BATCH_SIZE", "1000")), 10000),
)

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.authentication.ExpiringTokenAuthentication",
    ],
}
