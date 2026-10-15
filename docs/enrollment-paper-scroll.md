# Scroll sobre las hojas imprimibles

El contenedor compartido de Sábana y Alineación tenía `overscroll-behavior: contain` en ambos ejes. En Herramientas, la hoja podía medir 1082 px y tener exactamente 1082 px de scrollHeight/clientHeight: no tenía recorrido vertical propio. La regla impedía pasar la rueda a la página, aunque esta sí tuviera contenido fuera de pantalla. Se reprodujo en producción con la rueda sobre el papel: página y contenedor permanecieron en cero.

La corrección se limita a pantalla: contención horizontal, encadenamiento vertical automático y touch-action automático, sin interceptores JavaScript de wheel/touch. Las reglas de tamaño, márgenes y salto de página de impresión no cambian.

Comprobaciones locales con datos sintéticos y escrituras bloqueadas:

- Alineación en escritorio: rueda sobre el papel mueve la página 500 px.
- Sábana en escritorio con contenedor acotado: rueda mueve su scroll interno 400 px.
- 320 px: rueda sobre el papel mueve la página 350 px; no desbordamiento horizontal de página.
- 390 px: scroll horizontal mueve solo el contenedor de papel 250 px (scrollX de página cero); el vertical mueve la página hasta 600 px.
- Emulación de impresión: papel 190 x 267 mm de área útil y wrapper overflow visible, igual que antes.

La automatización disponible no expone gestos touch reales; las verificaciones móviles son de layout/rueda en Chromium emulado y de touch-action calculado, no una prueba física en iOS/Android.
