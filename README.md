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
- `contador` / `demo12345`
- `coordinador.roma` / `demo12345`
- `caja.roma` / `demo12345`
- `caja.coyoacan` / `demo12345`
- `padre.laura` / `familia12345`
- `padre.roberto` / `familia12345`
- `padre.daniela` / `familia12345`
- `padre.jorge` / `familia12345`

La configuracion local usa SQLite si no existe `.env`. Para usar PostgreSQL:

```powershell
Copy-Item .env.example .env
# Cambiar DB_ENGINE=postgres en back/.env
docker compose up -d postgres
cd back
.\.venv\Scripts\python.exe manage.py migrate
```

Para usar Supabase Postgres en produccion, definir `SUPABASE_DATABASE_URL` con la cadena de conexion del proyecto Supabase. Si esa variable existe, Django la usa antes que `DB_ENGINE`.

## Frontend local

```powershell
cd front
npm.cmd install
npm.cmd run dev
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
