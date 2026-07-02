# Operacion demo y staging

Este documento define como operar datos demo sin mezclarlos con produccion.

## Principio

`seed_demo --reset` solo puede ejecutarse contra bases descartables o regenerables. Nunca se ejecuta contra `FUTSI_ENV=production`.

## Entornos permitidos

| Entorno | Variable | Base esperada | Uso |
| --- | --- | --- | --- |
| Demo | `FUTSI_ENV=demo` | Base separada, descartable o SQLite aislado de Selenium | Demos, QA visual y recorridos E2E |
| Staging | `FUTSI_ENV=staging` | Supabase/Postgres separado de produccion | Validacion previa a piloto o release |
| Production | `FUTSI_ENV=production` | Supabase/Postgres real | Sin seed demo |

## Requisitos antes de regenerar demo

- Confirmar que `POSTGRES_HOST`, `POSTGRES_DB` y proyecto Supabase no son produccion.
- Confirmar que no existen datos reales de clientes en la base objetivo.
- Confirmar que `DJANGO_DEBUG=false` solo se usa con `FUTSI_ENV=demo` o `FUTSI_ENV=staging`.
- Definir `ALLOW_DESTRUCTIVE_SEED=true` solo durante la ejecucion del comando.
- Registrar la regeneracion en la bitacora de este documento.

## Comando permitido

Desde `back/`:

```powershell
$env:FUTSI_ENV="demo"
$env:ALLOW_DESTRUCTIVE_SEED="true"
.\.venv\Scripts\python.exe manage.py seed_demo --reset
Remove-Item Env:\ALLOW_DESTRUCTIVE_SEED
```

Para staging, cambiar solo:

```powershell
$env:FUTSI_ENV="staging"
```

## Credenciales demo

Estas cuentas son datos de demostracion. No deben existir en produccion con estas contrasenas.

| Rol | Usuario | Password |
| --- | --- | --- |
| Admin | `admin` | `admin12345` |
| Dev QA | `dev` | `dev12345` |
| Contador | `contador` | `demo12345` |
| Coordinador Roma | `coordinador.roma` | `demo12345` |
| Caja Roma | `caja.roma` | `demo12345` |
| Caja Coyoacan | `caja.coyoacan` | `demo12345` |
| Tutor | `padre.laura` | `familia12345` |
| Tutor | `padre.roberto` | `familia12345` |
| Tutor | `padre.daniela` | `familia12345` |
| Tutor | `padre.jorge` | `familia12345` |

## Bitacora de regeneracion

Actualizar esta tabla cada vez que se regenere una base compartida de demo o staging. Selenium local no requiere registro porque usa `qa/artifacts/e2e.sqlite3` descartable.

| Fecha | Responsable | Entorno | Base/proyecto | Commit | Comando | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

## Criterio de cierre

Una regeneracion queda cerrada cuando:

- `seed_demo --reset` termina sin error.
- Login demo funciona para admin, contador, caja y tutor.
- `/health/` responde correctamente.
- La bitacora queda actualizada con fecha, responsable, base y commit.
