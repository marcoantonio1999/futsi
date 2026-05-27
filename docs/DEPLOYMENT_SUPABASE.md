# Despliegue con GitHub Pages, Django y Supabase

## Arquitectura de produccion

- Frontend: React/Vite publicado en GitHub Pages.
- Backend: Django REST Framework en un servicio que ejecute Python. El repo queda preparado con `render.yaml`, `Dockerfile`, `Procfile` y workflow de deploy por hook.
- Base de datos: Supabase Postgres.
- Archivos: para Sprint 1 se mantienen locales al backend. En produccion real conviene usar disco persistente del proveedor o Supabase Storage.

GitHub Pages no ejecuta Django. Pages solo entrega HTML, CSS y JavaScript estatico. Por eso se necesita un host separado para el backend, por ejemplo Render, Railway, Fly.io, DigitalOcean App Platform, Azure App Service o un VPS.

## Variables del backend

Configurar estas variables en el proveedor donde corra Django:

```env
DJANGO_SECRET_KEY=valor-largo-y-secreto
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=api.tudominio.com,tu-backend.onrender.com
CORS_ALLOWED_ORIGINS=https://usuario.github.io,https://usuario.github.io/nombre-del-repo
CSRF_TRUSTED_ORIGINS=https://usuario.github.io,https://usuario.github.io/nombre-del-repo
SUPABASE_DATABASE_URL=postgresql://postgres.uqvjilgskrqehkdpkhvq:PASSWORD@HOST:6543/postgres?sslmode=require
POSTGRES_SSLMODE=require
DJANGO_SECURE_SSL_REDIRECT=true
DJANGO_SECURE_HSTS_SECONDS=31536000
```

La URL real se obtiene en Supabase: Project Settings > Database > Connection string. Para servicios con conexiones cortas conviene usar el pooler de Supabase. Nunca se debe subir la contrasena al repositorio.

## Comandos del backend

Build:

```bash
pip install -r back/requirements.txt
python back/manage.py collectstatic --noinput
python back/manage.py migrate
```

Start:

```bash
gunicorn futsi_api.wsgi:application --chdir back --log-file -
```

Primer seed demo, solo si se quiere cargar datos de prueba:

```bash
python back/manage.py seed_demo --reset
```

No ejecutar `seed_demo --reset` en produccion con datos reales.

## Opcion recomendada para publicar backend: Render

El archivo `render.yaml` deja configurado un servicio web llamado `futsi-api`.

Pasos:

1. En Render, crear un Blueprint desde este repositorio.
2. Render detectara `render.yaml`.
3. Configurar estas variables sensibles en Render:

```env
DJANGO_SECRET_KEY=valor-largo-y-secreto
DJANGO_ALLOWED_HOSTS=futsi-api.onrender.com,api.tudominio.com
CORS_ALLOWED_ORIGINS=https://usuario.github.io,https://usuario.github.io/futsi
CSRF_TRUSTED_ORIGINS=https://usuario.github.io,https://usuario.github.io/futsi
SUPABASE_DATABASE_URL=postgresql://postgres.uqvjilgskrqehkdpkhvq:PASSWORD@HOST:6543/postgres?sslmode=require
```

Render ejecutara:

- build: instala dependencias y corre `collectstatic`;
- pre deploy: corre `python manage.py migrate`;
- start: levanta `gunicorn`;
- healthcheck: revisa `/health/`.

Para disparar deploys desde GitHub Actions, crear en Render un Deploy Hook y guardarlo en GitHub como secret:

```env
RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/...
```

El workflow `.github/workflows/backend-render-deploy.yml` ya usa ese secret.

## Variables del frontend en GitHub Pages

Configurar en GitHub: Settings > Secrets and variables > Actions > Variables.

```env
VITE_API_URL=https://tu-backend.com/api
VITE_BASE_PATH=/nombre-del-repo/
```

Si se usa dominio personalizado o Pages de usuario en raiz, `VITE_BASE_PATH=/`.

## GitHub Actions incluidos

- `.github/workflows/ci.yml`: corre tests de Django y build de React.
- `.github/workflows/frontend-pages.yml`: publica `front/dist` en GitHub Pages.
- `.github/workflows/backend-release-check.yml`: valida configuracion de Django para release, collectstatic y checks de seguridad.
- `.github/workflows/backend-render-deploy.yml`: dispara deploy del backend usando `RENDER_DEPLOY_HOOK_URL`.

El despliegue automatico del backend queda listo para Render. Si se elige otro proveedor, se conserva Dockerfile/Procfile y solo cambia el ultimo paso de deploy.

## Supabase MCP en Codex

El MCP permite inspeccionar el proyecto Supabase desde Codex, pero la autenticacion se hace fuera del codigo. Ejecutar en la terminal local:

```bash
codex mcp add supabase --url https://mcp.supabase.com/mcp?project_ref=uqvjilgskrqehkdpkhvq
codex mcp login supabase
```

Despues revisar `/mcp` dentro de Codex. Si el comando falla por permisos de Windows, ejecutar desde una terminal normal o configurar el MCP desde la interfaz de Codex.

## Checklist para dejar produccion lista

- Crear contrasena fuerte de base de datos en Supabase.
- Configurar `SUPABASE_DATABASE_URL` en el host de Django.
- Configurar `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS`.
- Crear el backend en Render con `render.yaml` o equivalente.
- Ejecutar migraciones contra Supabase.
- Configurar `VITE_API_URL` en GitHub Actions.
- Publicar frontend en GitHub Pages.
- Validar login, dashboard, asistencia, caja, pagos simulados, gastos y exportacion de contador.
- Definir estrategia de archivos: disco persistente del host o Supabase Storage.

## Estado actual Supabase

El MCP ya esta autenticado y el proyecto `uqvjilgskrqehkdpkhvq` responde. Al momento de esta guia, Supabase no tiene tablas ni migraciones aplicadas; el esquema se crea cuando Django corre `python manage.py migrate` con `SUPABASE_DATABASE_URL`.
