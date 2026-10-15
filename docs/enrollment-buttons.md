# Botones de Inscripciones

Sistema visual unificado basado en las variantes Button de shadcn/ui, adaptado a los botones nativos y enlaces existentes para no alterar sus manejadores, referencias, tipos submit/button, permisos ni navegación.

Referencia: https://ui.shadcn.com/docs/components/base/button

- Principal: verde BPower, texto blanco; crear, guardar, confirmar, continuar.
- Outline/secundario: blanco, borde suave, hover discreto; copiar, consultar, volver y paginar.
- Destructive: rojo para borrar, bajas y exclusiones explícitas. No cambia los controles de confirmación.
- Ghost: navegación y acciones de texto, con selección y foco visibles.
- Iconos: centrados y con área táctil de al menos 44 px; se conservan sus nombres accesibles y el logo de WhatsApp.
- Disabled, hover, foco por teclado y movimiento reducido contemplados.

`enrollmentButtons.css` centraliza estos estilos. Se aplica únicamente en pantalla y dentro de Inscripciones; los diálogos renderizados en `document.body` solo se incluyen cuando existe `.enrollment-page`. No cambia el estilo de Torneos fuera del módulo, ni usa un observador, petición adicional, cron o consulta a base de datos.

Se excluyen tarjetas de jugadores, el fondo atenuado del menú y las reglas que muestran u ocultan la hamburguesa y el panel lateral. La impresión A4 conserva sus estilos previos. Los enlaces siguen siendo enlaces: no se les asigna un rol de botón ni se cambia su destino.

Validación: 320 y 390 px y escritorio, acciones de formulario y modal con datos ficticios, estados disabled, foco, colores y exclusión de las reglas bajo emulación de impresión. Pruebas de Inscripciones, TypeScript y build.
