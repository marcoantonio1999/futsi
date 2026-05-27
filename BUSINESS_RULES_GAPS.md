# Reglas Operativas Nuevas

## Contexto confirmado

- Escala esperada: aproximadamente 400 equipos y 1000 alumnos de academia.
- El coordinador funciona como gerente de sede.
- El cajero / auxiliar administrativo captura pagos en ventanilla.
- Una jornada equivale a una semana de juegos; puede existir doble jornada.
- Los torneos duran 12 jornadas mas liguilla.
- No hay inscripcion inicial.
- Se cobra mensualidad, semanalidad de torneo y uniforme.
- El periodo de prueba normal dura 2 semanas / 2 clases; puede extenderse hasta 4 semanas.
- Se aceptan pagos parciales.
- Los pagos pueden ser efectivo, tarjeta o transferencia.
- Existen reembolsos.
- Hay una cuenta bancaria para la sede principal y otra cuenta para el resto.
- Cada sede puede tener costos/precios distintos.
- Los porcentajes de descuento son homogeneos: hermano 15% y referido por definir.
- Debe existir mora: pago mensual completo, 10 dias de gracia y posible penalizacion del 5%.
- En torneos, el cajero o coordinador puede autorizar que un equipo juegue con adeudo, pero debe existir un tope.
- Para alumnos con adeudo debe existir escalamiento de avisos: papas, alumno, bloqueo de partidos, bloqueo de entrenamientos.
- Los gastos de nomina y recurrentes los solicita el coordinador, los valida contador y los paga direccion.
- Los coaches cobran diferente y por horas.
- El contador necesita estado de resultados y reporte de quien pago / quien no pago.

## Ya cubierto en Sprint 1

- Rol separado de cajero.
- Login individual para evitar el problema de usuarios compartidos.
- Ventanilla limitada a pagos de la sede del cajero.
- Cajero no ve dashboard, gastos, usuarios ni datos de otras sedes.
- Registro de pagos parciales.
- Registro de pagos por efectivo, tarjeta, transferencia o cortesia.
- CLABE demo unica por representante.
- Flujo de transferencia en proceso con confirmacion SPEI simulada.
- Flujo de tarjeta por terminal simulada y link de pago simulado.
- Flujo de efectivo con aceptacion del representante.
- Adeudos abiertos por alumno.
- Cruce base de asistencia contra adeudo.
- Gastos con solicitud/aprobacion.
- Portal familiar basico para padres.

## Falta modelar antes de implementar completo

- Catalogo de precios por sede y por concepto.
- Catalogo formal de descuentos con porcentaje, vigencia y aprobadores.
- Regla automatica de mora: fecha limite, dias de gracia, porcentaje y cargo generado.
- Flujo de avisos por adeudo y bloqueo operativo.
- Tope de adeudo para equipos antes de no permitir jugar.
- Torneos con jornadas, doble jornadas, liguilla y pagos por semana.
- Cuentas bancarias reales por sede y reglas de conciliacion.
- Reembolsos, cancelaciones y transferencia de saldo.
- Trial extendido de 2 a 4 clases con autorizacion.
- Nomina de coaches por tarifa/hora y aprobacion.
- Estado de resultados exportable para contador.
- Resultados deportivos, tabla de posiciones y metricas de coaches para Sprint 2.

## Recomendacion

Mantener Sprint 1 enfocado en control operativo y trazabilidad. Las reglas anteriores deben entrar como catalogos y flujos configurables, no como valores fijos en codigo, porque los precios cambian por sede y la operacion todavia esta afinando criterios.
