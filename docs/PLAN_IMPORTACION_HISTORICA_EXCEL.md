# Plan Sprint 3: importacion historica de Excel

## Objetivo

El Sprint 3 debe contemplar la captura de todos los Excel anteriores para que el sistema pueda analizar informacion historica y no solo la operacion nueva. Esto permite mostrar ingresos, egresos, gastos, utilidad, desviaciones, posibles fugas de dinero y diferencias contra ventas esperadas por sede, mes, responsable y concepto.

Archivo ejemplo revisado:

`C:\Users\daniel\Documents\marco\mexprod\ARCHIVOS USADOS v2.xlsx`

## Hojas detectadas en el ejemplo

| Hoja | Contenido aparente | Uso esperado |
| --- | --- | --- |
| Estimacion Ventas | Ventas esperadas por sede y mes | Comparar venta esperada contra cobros reales/importados |
| ARCHIVO DE OPERACION | Operacion con dia, folio, clave, categoria, equipo, responsable, importe y nomina | Fuente primaria para transacciones historicas y posibles fugas |
| ARCHIVO FILIAL | Informacion amplia de filial/operacion | Requiere diccionario especial de columnas |
| ESTADO DE RDOS. | Estado de resultados mensual | Reconciliar ingresos, egresos y utilidad historica |
| INGRESOS SEDES | Ingresos por clave, concepto y sede | Normalizar historico de ingresos |
| GASTOS SEDES | Egresos por clave, concepto y sede | Normalizar gastos y detectar duplicados/inflados |
| Hoja6 | Resumen global por mes | Validacion cruzada contra ingresos/gastos normalizados |

## Enfoque tecnico recomendado

1. Subir Excel original y guardar archivo, hash, usuario, fecha y estado de carga.
2. Importar primero a tablas staging, no directo a pagos/gastos finales.
3. Normalizar sedes, claves, conceptos, fechas, responsables y montos.
4. Generar reporte de errores por hoja, fila, columna y motivo.
5. Conciliar totales contra `ESTADO DE RDOS.`, `INGRESOS SEDES`, `GASTOS SEDES` y `Hoja6`.
6. Aprobar importacion con contador antes de activar dashboards historicos.
7. Crear llaves naturales para evitar duplicados al reimportar.

## Datos que deben conservarse

- Periodo y fecha.
- Sede.
- Folio o identificador de origen.
- Clave/concepto.
- Categoria.
- Equipo/alumno cuando exista.
- Responsable/capturista cuando exista.
- Monto.
- Tipo: ingreso, egreso, gasto, nomina, venta esperada, ajuste.
- Hoja, fila y archivo origen.

## Reportes historicos esperados

- Ingresos historicos por sede y mes.
- Gastos historicos por sede, categoria y mes.
- Utilidad historica por sede.
- Venta esperada vs ingreso reportado.
- Posibles fugas por diferencia entre esperado, cobrado y reportado.
- Gastos duplicados por proveedor/concepto/monto/fecha.
- Responsables con mayor numero de ajustes o diferencias.

## Riesgos

- Archivos con formulas rotas o rangos extendidos hasta el limite de Excel.
- Conceptos y claves no estandarizados.
- Sedes escritas con variantes.
- Montos duplicados o asignados a sede incorrecta.
- Datos historicos sin folio unico.
- Diferencias entre estado de resultados y detalle operativo.

## Criterio de aceptacion Sprint 3

- El archivo historico se carga sin romper datos existentes.
- El sistema muestra total origen vs total importado por hoja, sede y mes.
- Las diferencias quedan documentadas y aprobadas por contador.
- Los dashboards pueden mostrar historico de ingresos, egresos, utilidad y posibles fugas.
- La carga puede repetirse sin duplicar registros.
