# Sprint 1 Checklist

## Validado

- Backend levanta con Django REST Framework.
- Frontend levanta con React, Vite y Tailwind.
- Login por token funciona.
- Seed demo reiniciable con `seed_demo --reset`.
- Dashboard carga con datos operativos.
- Alumnos, representantes, sedes y usuarios son consultables.
- Pase de lista crea sesiones y registros.
- Asistencia detecta adeudo al momento de marcar presente.
- Cobranza registra cargos, pagos y descuentos.
- Descuentos aprobados recalculan el cargo.
- Gastos se capturan, aprueban y rechazan.
- Dashboard cruza ingresos, gastos, adeudos y asistencia.
- Representante puede entrar al portal familiar.
- Representante solo ve sus alumnos, adeudos, pagos y asistencias.
- Representante no puede crear cargos internos.
- Cajero puede entrar a ventanilla y procesar pagos de su sede.
- Cajero no puede ver dashboard, gastos, usuarios ni datos de otras sedes.
- Cajero no puede crear alumnos ni cargos internos.
- Transferencia queda en proceso y se confirma por webhook SPEI simulado.
- Efectivo queda pendiente hasta que el representante lo acepta.
- Tarjeta por terminal se confirma automaticamente de forma simulada.
- Link de pago queda visible para el representante y se puede liquidar en demo.
- Pagos en proceso no reducen el adeudo hasta quedar registrados.

## Comandos ejecutados

```powershell
cd back
.\.venv\Scripts\python.exe manage.py test
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py seed_demo --reset

cd ..\front
npm.cmd run build
```

## Pendientes razonables para Sprint 2

- Auditoria automatica por cambios relevantes.
- Cierre diario por sede.
- Exportaciones Excel/PDF.
- Integracion bancaria real para SPEI/CLABE.
- Integracion real con terminales y links de pago.
- Mejoras de permisos por rol y sede.
- Reglas automaticas de mora, avisos y bloqueo por adeudo.
- Refunds/reembolsos y cancelaciones.
- Ciclo completo de torneos: 12 jornadas, doble jornada y liguilla.
- Tarifas por sede, reglas de prueba y descuentos como catalogos configurables.
- Adjuntos reales de comprobantes.
- Filtros avanzados de reportes.
