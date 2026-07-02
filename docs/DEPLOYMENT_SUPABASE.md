# Despliegue con GitHub Pages, Render y Supabase

## Decision de arquitectura

- Frontend: React/Vite publicado en GitHub Pages.
- Backend: Django REST Framework en Render Web Service.
- Base de datos: Supabase Postgres.
- Archivos: para demo local se usan archivos del backend; para produccion real se recomienda Supabase Storage o volumen persistente.

GitHub Pages no ejecuta Django. Pages solo entrega HTML, CSS y JavaScript estatico. Por eso el backend necesita Render, Railway, Fly.io, DigitalOcean App Platform, Azure App Service o VPS.

## Estado actual

El frontend ya fue preparado para Pages con `VITE_BASE_PATH=/futsi/` y `VITE_API_URL=https://futsi.onrender.com/api`.

El backend quedo preparado para Render y Supabase, pero el despliegue final se pausa hasta cerrar Sprint 2 completo en local. La razon es que hoy se agregaron migraciones, facturacion simulada, reporte Excel y DeepFace local.

Local y produccion deben apuntar a Supabase/Postgres. El backend ya no cae a SQLite silenciosamente; si faltan credenciales, Django falla al arrancar. SQLite solo se permite para pruebas aisladas con `DB_ENGINE=sqlite` y `ALLOW_SQLITE=true`.

## Problemas encontrados y solucion

| Problema | Causa | Solucion |
| --- | --- | --- |
| Pages mostraba documentacion o una pagina estatica incorrecta | Pages estaba publicando otra salida/branch y no `front/dist` | Workflow de frontend publica build Vite en `gh-pages` |
| Login devolvia `Unexpected token '<'` | El frontend recibia HTML en vez de JSON del API | `VITE_API_URL` debe apuntar a `/api` del backend Render |
| Django no puede correr en Pages | Pages no ejecuta procesos Python/gunicorn | Django se despliega en Render como Web Service |
| Render fallaba con `Port could not be cast to integer value as 'H'` | `SUPABASE_DATABASE_URL` tenia password sin URL encoding y rompia el parseo | Usar variables `POSTGRES_*` separadas |

## Variables recomendadas en Render

```env
DJANGO_SECRET_KEY=valor-largo-y-secreto
DJANGO_DEBUG=false
FUTSI_ENV=production
DJANGO_ALLOWED_HOSTS=futsi.onrender.com,.onrender.com
CORS_ALLOWED_ORIGINS=https://marcoantonio1999.github.io
CSRF_TRUSTED_ORIGINS=https://marcoantonio1999.github.io
DB_ENGINE=postgres
POSTGRES_DB=postgres
POSTGRES_USER=postgres.uqvjilgskrqehkdpkhvq
POSTGRES_PASSWORD=PASSWORD_REAL_DE_DATABASE
POSTGRES_HOST=aws-1-us-west-2.pooler.supabase.com
POSTGRES_PORT=5432
POSTGRES_SSLMODE=require
DJANGO_SECURE_SSL_REDIRECT=true
DJANGO_SECURE_HSTS_SECONDS=31536000
API_TOKEN_TTL_MINUTES=720
```

No usar `SUPABASE_DATABASE_URL` si el password tiene caracteres especiales y no esta URL encoded. La configuracion actual de Django prioriza `POSTGRES_*` cuando existen.

`API_TOKEN_TTL_MINUTES` controla la duracion maxima de sesion de la API. El valor recomendado inicial es 720 minutos; al expirar, el token se borra en backend y el frontend obliga a iniciar sesion nuevamente.

## Render

Servicio recomendado: Web Service con Docker.

- Root Directory: vacio.
- Dockerfile Path: `./Dockerfile`.
- Branch: `main`.
- Instance: Free para demo, Starter si se requiere evitar spin down.
- Healthcheck: `/health/`.

El contenedor corre migraciones antes de levantar gunicorn. No ejecutar `seed_demo --reset` en produccion con datos reales.

## Separacion de entornos y seed demo

Futsi separa cinco entornos operativos:

| Entorno | Variable | Base de datos | Uso de `seed_demo` |
| --- | --- | --- | --- |
| Produccion | `FUTSI_ENV=production` | Supabase/Postgres real | Prohibido |
| Staging | `FUTSI_ENV=staging` | Supabase/Postgres separado o descartable | Permitido con control |
| Demo | `FUTSI_ENV=demo` | Supabase/Postgres separado o descartable | Permitido con control |
| Testing | `FUTSI_ENV=test` | Base aislada de pruebas | Temporal para compatibilidad |
| Local | `FUTSI_ENV=local` | Local o Supabase dev | Permitido con control |

`seed_demo --reset` es un comando destructivo. Siempre requiere `ALLOW_DESTRUCTIVE_SEED=true`.

Reglas obligatorias:

- Produccion nunca ejecuta `seed_demo`, con o sin `--reset`.
- Con `DJANGO_DEBUG=false`, `seed_demo` se bloquea salvo `FUTSI_ENV=demo` o `FUTSI_ENV=staging`.
- Render/Docker productivo solo debe correr migraciones controladas.
- Los datos demo nunca deben mezclarse con datos reales.
- Antes de una migracion productiva: backup, revision de migracion y smoke test.

La operacion diaria de demo/staging, credenciales demo, comando permitido y bitacora de regeneracion estan en `docs/OPERACION_DEMO_STAGING.md`.

## GitHub Pages

Variables en GitHub Actions:

```env
VITE_API_URL=https://futsi.onrender.com/api
VITE_BASE_PATH=/futsi/
```

Pages debe publicar desde `gh-pages` o desde el artifact generado por el workflow de frontend.

## CI backend

Los jobs `backend-pytest` y `sonarqube` de GitHub Actions levantan Postgres efimero (`postgres:16`) y ejecutan `pytest` con:

```env
DB_ENGINE=postgres
FUTSI_ENV=test
POSTGRES_DB=futsi_test
POSTGRES_USER=futsi
POSTGRES_PASSWORD=futsi
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_SSLMODE=disable
```

SQLite queda reservado para pruebas locales aisladas y Selenium/demo, no para validar el backend principal en CI.

## Checklist antes de reintentar produccion

- Confirmar password real de base de datos Supabase.
- Configurar secretos en Render.
- Ejecutar migraciones contra Supabase.
- Verificar `/health/` del backend.
- Verificar login desde Pages.
- Descargar Excel contable desde produccion.
- Generar factura simulada PDF/XML.
- Probar CORS entre Pages y Render.
- Decidir almacenamiento productivo para fotos/facturas.
- Perfilar e importar Excel historico `ARCHIVOS USADOS v2.xlsx` a tablas staging.
- Conciliar historico importado contra ingresos, gastos y estado de resultados antes del piloto.
- Ejecutar suite de seguridad Sprint 3: SQL injection, permisos por rol, carga maliciosa de archivos, secretos y dependencias.
- Ejecutar QA automatizado: Sonar, Django/pytest, Playwright Python, OWASP ZAP baseline y smoke Android.
