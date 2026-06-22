# Futsi Mini ERP

Proyecto base para un mini ERP operativo-financiero de academias y torneos de futbol.

## Estructura

- `back/`: API REST con Python, Django y Django REST Framework.
- `front/`: frontend React con Vite y Tailwind CSS.

## Sprint 1 / Dia 1

La primera entrega define el modelo de datos inicial para controlar:

- sedes y canchas;
- usuarios y roles;
- representantes, alumnos y equipos;
- torneos y jornadas;
- asistencia;
- cargos, pagos, descuentos y adeudos;
- gastos operativos;
- cierres diarios;
- auditoria de cambios.

El SQL inicial esta en `back/sql/schema.sql`. Los modelos Django equivalentes estan en `back/core/models.py`.

## Sprint 1 / Dia 2

La segunda entrega deja funcionando el flujo base:

- login por token;
- endpoint de usuario actual;
- roles basicos;
- CRUD API para sedes, usuarios, representantes y alumnos;
- panel React para capturar y consultar esos registros;
- datos demo reproducibles.

## Sprint 1 / Dia 3

La tercera entrega agrega el pase de lista operativo:

- crear sesiones de asistencia por sede, grupo, fecha y hora;
- consultar sesiones recientes;
- marcar alumnos como asistio, falto o falta justificada;
- detectar adeudo abierto al momento de marcar asistencia;
- registrar autorizacion basica cuando un alumno con adeudo asiste;
- cerrar una sesion para dejarla como registro operativo.

## Sprint 1 / Dia 4

La cuarta entrega agrega cobranza operativa:

- crear cargos por alumno;
- ver adeudos, pagos, descuentos y saldo;
- crear solicitudes de pago por efectivo, transferencia, tarjeta o cortesia;
- simular CLABE unica por representante y webhook SPEI;
- simular terminal fisica y link de pago con tarjeta;
- confirmar efectivo desde el portal familiar;
- portal de ventanilla para cajero, limitado a cobro por sede;
- solicitar descuentos con motivo;
- aprobar o rechazar descuentos;
- recalcular automaticamente el estado del cargo como pendiente, parcial o pagado.

## Sprint 1 / Dia 5

La quinta entrega agrega gastos operativos:

- capturar gastos por sede, categoria, fecha, proveedor y monto;
- registrar el usuario que captura cada gasto;
- mostrar gastos pendientes y aprobados;
- aprobar o rechazar gastos;
- ver gastos registrados en tabla operativa;
- alimentar la metrica de gastos pendientes.

## Sprint 1 / Dia 6

La sexta entrega agrega dashboard y reportes basicos:

- ingresos registrados;
- gastos aprobados y pendientes;
- utilidad operativa estimada;
- adeudo abierto;
- alumnos con adeudo;
- asistencias capturadas con adeudo;
- operacion por sede;
- ingresos por metodo de pago;
- alertas operativas para direccion/contador.

## Sprint 1 / Dia 7

La septima entrega cierra la demo:

- seed demo reiniciable con `--reset`;
- prueba automatizada del flujo central;
- guia de demo;
- validacion de backend, frontend y navegador;
- documentacion del alcance y pendientes.

## Backend local

```powershell
cd back
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py seed_demo --reset
.\.venv\Scripts\python.exe manage.py runserver
```

Credenciales demo:

- `admin` / `admin12345`
- `dev` / `dev12345` (usuario tecnico para QA y diagnostico)
- `contador` / `demo12345`
- `coordinador.roma` / `demo12345`
- `caja.roma` / `demo12345`
- `caja.coyoacan` / `demo12345`
- `padre.laura` / `familia12345`
- `padre.roberto` / `familia12345`
- `padre.daniela` / `familia12345`
- `padre.jorge` / `familia12345`

La configuracion local debe usar Supabase/Postgres. Si no existe `back/.env` con credenciales de Postgres, Django falla al arrancar para evitar trabajar accidentalmente sobre SQLite.

```powershell
Copy-Item .env.example .env
# Configurar back/.env con las credenciales reales de Supabase/Postgres.
cd back
.\.venv\Scripts\python.exe manage.py migrate
```

La opcion recomendada para local y produccion es definir variables separadas `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT` y `POSTGRES_SSLMODE=require`. Esto evita errores cuando el password contiene caracteres especiales. SQLite solo queda permitido para pruebas aisladas con `DB_ENGINE=sqlite` y `ALLOW_SQLITE=true`. El detalle actualizado de Render, GitHub Pages y Supabase esta en `docs/DEPLOYMENT_SUPABASE.md`.

## Frontend local

```powershell
cd front
npm.cmd install
npm.cmd run dev
```

## Pase de lista automatico local

El backend de produccion no procesa videos por defecto. El procesamiento local se habilita con `DJANGO_DEBUG=true` o `AUTOMATIC_ATTENDANCE_LOCAL_ENABLED=true` y corre desde la nueva seccion `Pase automatico`.

Instalacion en una PC sin GPU:

```powershell
cd back
.\.venv\Scripts\python.exe -m pip install -r requirements-face-cpu.txt
```

Instalacion en una PC con GPU NVIDIA:

```powershell
cd back
.\.venv\Scripts\python.exe -m pip install -r requirements-face-gpu.txt
.\.venv\Scripts\python.exe -c "import onnxruntime as ort; ort.preload_dlls(directory=''); print(ort.get_available_providers())"
```

Para que la carga manual desde la pantalla funcione, selecciona sede y sesion antes de arrastrar el video. Para colocar videos manualmente en carpeta, usa:

```text
back/media/automatic_attendance/pendientes/<id-de-sede>/video-20260620.mp4
```

El sistema revisa esa carpeta desde la pantalla cada 15 segundos. Si el video no trae sesion asignada, intenta inferir sede por subcarpeta y fecha por nombre del archivo o fecha de modificacion. Para partidos, usa los `Match` ya programados en torneo (`played_on`, `starts_at`, sede y equipos), crea o reutiliza sesiones `tournament_match` por equipo y marca asistencia de jugadores.

En videos largos, asume que el archivo inicia a medianoche del dia detectado y procesa una ventana alrededor de la hora de la sesion. Valores por defecto:

```text
AUTO_ATTENDANCE_SESSION_PRE_MINUTES=15
AUTO_ATTENDANCE_SESSION_DURATION_MINUTES=120
AUTO_ATTENDANCE_LONG_VIDEO_SECONDS=14400
```

## Validacion

```powershell
cd back
.\.venv\Scripts\python.exe manage.py test

cd ..\front
npm.cmd run build
```

El guion de presentacion esta en `DEMO.md`.

## Produccion

GitHub Pages puede publicar el frontend, pero Django necesita un host de backend separado. El detalle de variables, GitHub Actions, Supabase y pasos de despliegue esta en `docs/DEPLOYMENT_SUPABASE.md`.

## Sprint 2

La documentacion formal actualizada esta en `docs/`:

- especificacion de requerimientos;
- gobernanza, roadmap y despliegue;
- documentacion tecnica del codigo;
- documentacion de negocio;
- actualizacion Sprint 2;
- guia de despliegue Supabase/Render/Pages;
- demo de pase de lista facial;
- propuesta Android PWA gratis;
- APK Android con React + Capacitor;
- tema oscuro web/Android;
- importacion historica de Excel con preview, password, firma y auditoria;
- plan Sprint 3 de importacion historica ampliada para conservar informacion anterior de ingresos, egresos, gastos, utilidad y posibles fugas;
- plan Sprint 3 de seguridad y QA automatizado con Sonar, Django/pytest, Playwright Python, OWASP ZAP y smoke Android.

## Sprint 3 planeado

El siguiente sprint debe priorizar hardening antes de piloto productivo:

- pruebas de SQL injection y payloads maliciosos en login, filtros, reportes e importacion Excel;
- pruebas de autorizacion por rol para evitar acceso horizontal/vertical;
- validacion de archivos historicos en staging antes de afectar tablas finales;
- SonarQube/SonarCloud en GitHub Actions;
- pruebas backend con Django/pytest;
- pruebas e2e con Playwright Python usando elementos reales de la web;
- pruebas agresivas de UI para intentar romper formularios, tablas, menus, pagos, facturas y carga de Excel;
- OWASP ZAP baseline contra staging;
- smoke test de APK Android en emulador/dispositivo.

La guia esta en `docs/SPRINT3_SEGURIDAD_QA.md`.

## Android APK

La app Android conserva React/Vite y se empaqueta con Capacitor. El proyecto nativo esta en `front/android`.

```powershell
cd front
npm.cmd run cap:sync
npm.cmd run cap:open
```

Para compilar APK falta instalar Android Studio o configurar Java/Android SDK. La guia completa esta en `docs/APK_ANDROID_CAPACITOR.md`.
