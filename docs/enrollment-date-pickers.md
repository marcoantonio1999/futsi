# Calendarios de Inscripciones

Implementación basada en la composición Date Picker de shadcn/ui Base: Popover de Base UI + React DayPicker, con estilos encapsulados de BPower (sin regenerar el diseño global).

- Referencia: https://ui.shadcn.com/docs/components/base/date-picker#range-picker
- Nacimiento público: calendario en español con selección rápida de mes y año; no permite días futuros. Mantiene la validación previa y el cálculo menor/adulto.
- Nueva sanción: por defecto «Elegir periodo (inicio y fin)» en un único selector de rango. «Aplicar periodo» confirma ambos valores. «Reiniciar» permite elegir otro inicio. Escape/cerrar cancela cambios sin aplicar. Se permite un solo día. El último día es inclusivo.
- La fecha del incidente es independiente del periodo y no puede ser futura. Se conservan las duraciones por cantidad y la opción sin término; el tabulador sigue siendo orientativo.
- Se conservan los nombres de FormData/API `birth_date`, `incident_on`, `starts_on`, `ends_on` y `duration_unit`. No requiere migración ni cambia registros existentes.
- Fechas locales sin conversión UTC para evitar desplazamientos de un día. Cambiar una fecha renueva el identificador de solicitud de sanción.
- Popover fuera del contenedor desplazable, foco controlado, cierre por Escape, foco devuelto al disparador, navegación de calendario por teclado. Acciones de 44 px de alto y pie de rango visible; el calendario se desplaza dentro de su propio panel en alturas pequeñas.

Validación: TypeScript, 39 pruebas de Inscripciones y compilación. Interacción en 320/390 px y escritorio: selección mes/año/día, valores de FormData, límites de fecha, aplicación de rango y Escape sin guardar registros reales. Los calendarios no consultan la base ni agregan cron o sondeos.
