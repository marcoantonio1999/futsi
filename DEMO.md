# Demo Sprint 1

## Objetivo

Mostrar una primera version util del mini ERP operativo-financiero:

- controlar alumnos, sedes y representantes;
- tomar asistencia desde una vista simple;
- detectar alumnos con adeudo al pasar lista;
- registrar cargos, pagos y descuentos;
- capturar y aprobar gastos;
- consultar un dashboard operativo por sede.

## Preparar demo

```powershell
cd back
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py seed_demo --reset
.\.venv\Scripts\python.exe manage.py runserver
```

En otra terminal:

```powershell
cd front
npm.cmd install
npm.cmd run dev
```

Abrir `http://127.0.0.1:5173`.

Credenciales:

- `admin` / `admin12345`
- `contador` / `demo12345`
- `coordinador.roma` / `demo12345`
- `caja.roma` / `demo12345`
- `caja.coyoacan` / `demo12345`
- `padre.laura` / `familia12345`
- `padre.jorge` / `familia12345`

## Guion sugerido

1. Entrar como `admin`.
2. Revisar `Dashboard`: adeudos, gastos, utilidad estimada y alertas.
3. Ir a `Asistencia`, crear sesion para Coyoacan y marcar a Luis Gomez como asistente.
4. Mostrar que Luis Gomez tiene adeudo y que queda registrada la autorizacion operativa.
5. Ir a `Cobranza`, registrar un pago parcial o solicitar descuento.
6. Aprobar un descuento y mostrar que el cargo cambia de estado.
7. Ir a `Gastos`, capturar un gasto y aprobarlo.
8. Volver a `Dashboard` para ver el impacto en metricas.
9. Cerrar sesion y entrar como `caja.roma` para mostrar ventanilla: buscar alumno, ver adeudo y procesar pago.
10. Crear una transferencia y simular llegada SPEI; crear efectivo y aceptar desde portal familiar.
11. Cerrar sesion y entrar como `padre.daniela` para mostrar CLABE, notificaciones y aceptacion de efectivo.

## Entregables construidos

- Backend Django REST con modelos operativos.
- Frontend React/Tailwind.
- Login por token.
- Roles basicos.
- CRUD base de sedes, usuarios, representantes y alumnos.
- Pase de lista.
- Cobranza manual.
- Portal de ventanilla para cajero.
- CLABE demo por representante.
- Simulacion de webhook SPEI.
- Simulacion de terminal y link de pago.
- Confirmacion de efectivo por el representante.
- Descuentos con aprobacion.
- Gastos con aprobacion.
- Dashboard operativo.
- Portal familiar para representantes.
- Seed demo reproducible.
- Prueba automatizada del flujo central.

## Fuera de Sprint 1

- Integracion fiscal/Contpaqi.
- Conciliacion SPEI automatica.
- CLABEs virtuales reales con banco/proveedor.
- Integracion real con terminal bancaria.
- WhatsApp bot/OCR.
- Kiosko de efectivo.
- Camaras/reconocimiento.
- App movil nativa.
- Modo offline completo.
