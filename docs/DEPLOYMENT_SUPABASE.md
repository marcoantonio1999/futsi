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
```

No usar `SUPABASE_DATABASE_URL` si el password tiene caracteres especiales y no esta URL encoded. La configuracion actual de Django prioriza `POSTGRES_*` cuando existen.

## Render

Servicio recomendado: Web Service con Docker.

- Root Directory: vacio.
- Dockerfile Path: `./Dockerfile`.
- Branch: `main`.
- Instance: Free para demo, Starter si se requiere evitar spin down.
- Healthcheck: `/health/`.

El contenedor corre migraciones antes de levantar gunicorn. No ejecutar `seed_demo --reset` en produccion con datos reales.

## GitHub Pages

Variables en GitHub Actions:

```env
VITE_API_URL=https://futsi.onrender.com/api
VITE_BASE_PATH=/futsi/
```

Pages debe publicar desde `gh-pages` o desde el artifact generado por el workflow de frontend.

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
