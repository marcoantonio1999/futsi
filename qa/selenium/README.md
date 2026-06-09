# QA Selenium E2E

Suite de pruebas end-to-end para Futsi Mini ERP usando Pytest + Selenium + Chrome.

## Que cubre

- Login correcto e incorrecto.
- Navegacion admin, tema oscuro y menu movil.
- Portal contador con exportacion contable y facturas.
- Portal cajero con controles de pago y sin acceso admin.
- Portal coach con asistencia, camara y registro de horas.
- Portal tutor con alumnos, perfil y facturas.

## Ejecucion local

Desde la raiz del repo:

```powershell
.\.venv\Scripts\python.exe -m pip install -r back\requirements.txt -r back\requirements-test.txt
.\.venv\Scripts\python.exe -m pytest qa\selenium -m e2e
```

La suite levanta automaticamente:

- Django en `http://127.0.0.1:8100`
- Vite en `http://127.0.0.1:5176`
- SQLite aislado en `qa/artifacts/e2e.sqlite3`

## Reusar servidores locales

Si ya tienes Django y Vite levantados:

```powershell
$env:FUTSI_E2E_REUSE_SERVERS="1"
$env:FUTSI_E2E_API_PORT="8000"
$env:FUTSI_E2E_WEB_PORT="5173"
.\.venv\Scripts\python.exe -m pytest qa\selenium -m e2e
```

## Evidencia de fallos

Cuando una prueba falla se guardan:

- `qa/artifacts/*.png`
- `qa/artifacts/*.html`
- `qa/artifacts/django-e2e.log`
- `qa/artifacts/vite-e2e.log`

DeepFace real queda fuera del CI porque depende de modelos pesados, camara y entorno local.
