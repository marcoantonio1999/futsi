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
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,10.0.2.2,testserver")
RENDER_EXTERNAL_HOSTNAME = os.getenv("RENDER_EXTERNAL_HOSTNAME")
IS_RENDER = bool(os.getenv("RENDER_SERVICE_ID") or RENDER_EXTERNAL_HOSTNAME)
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)
if not DEBUG and ".onrender.com" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(".onrender.com")

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

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ],
}
