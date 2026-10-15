# Historial de Inscripciones

Inscripciones tiene su propio árbol de navegación, separado de AdminShell. La corrección del historial de Futsi/Soccer WA no cubría este portal: sus subsecciones y hojas se cambiaban únicamente con useState. El navegador no tenía entradas intermedias y volvía al menú o al sitio anterior.

`EnrollmentNavigation` registra subsecciones, sábanas/alineaciones y detalles de bajas/disciplina con entradas reales del historial. `App` reconoce todo el prefijo `#/admin/inscripciones/`, no solo la ruta raíz; por eso una subruta no monta por accidente el menú general. Atrás/Adelante restauran la entrada, y Volver de una hoja utiliza el mismo historial. Los enlaces directos tienen una salida a su lista sin depender de que exista una entrada previa en la app. No se intercepta la salida normal del navegador al llegar a la primera entrada.

Los filtros de Sábana/Herramientas, Equipos, Torneos, Histórico de bajas, Comisión y Lista negra, su paginación y los campos de impresión se conservan en cada entrada. Cambiar un filtro no agrega una parada por tecla. Solo se guardan filtros/identificadores/posiciones, no contraseñas, tokens de acceso, documentos, firmas ni borradores de altas/sanciones. El propietario de la entrada es el ID de usuario. Otro usuario no hereda los filtros guardados.

La posición vertical/horizontal de página y contenedores se restaura después de cargar la lista. El desplazamiento se captura por eventos, en memoria, sin escribir history.replaceState por cada frame (evita saturar el límite de Safari); se persiste al navegar/cambiar filtros/salir de página. Se descarta el hashchange duplicado que acompaña al mismo popstate. Cerrar un modal no puede ejecutar Atrás dos veces por sus eventos cancel/close.

No hay cambios en permisos, API, base de datos ni impresión A4. No se agregan consultas periódicas. Los componentes compartidos de torneos conservan estado local cuando no están dentro de Inscripciones.

## Regresión obligatoria

- Sábana con torneo/búsqueda -> hoja -> Atrás -> misma lista filtrada -> Adelante -> misma hoja.
- Repetir tres veces con la tabla desplazada; conservar exactamente la posición de la fila.
- Equipos con torneo seleccionado -> plantilla -> Atrás -> mismo torneo.
- Histórico de bajas, página 2 -> detalle -> Atrás -> página 2 -> Adelante -> mismo detalle. Cerrar detalle debe retroceder una sola entrada.
- Comisión/Lista negra -> detalle -> Atrás -> mismo consolidado.
- Recargar una subruta debe conservar sección y filtros de la entrada, sin ir al menú general.
- 320 px / 390 px: menú hamburguesa cerrado al navegar, sin desbordamiento de página; tablas/hojas pueden desplazar su propio contenido.

Las pruebas de navegador locales utilizan catálogo y registros sintéticos con toda escritura bloqueada. Las comprobaciones productivas se hacen sobre consultas existentes, sin crear bajas, sanciones ni inscripciones.
