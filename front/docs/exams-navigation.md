# Navegación de Exámenes BPower

Menú lateral permanente en escritorio: Crear examen, Mis exámenes y Ver evaluaciones. En celular se abre con hamburguesa a la izquierda, bloquea el fondo y se cierra al elegir sección, pulsar Escape o tocar el fondo atenuado. El diálogo nativo mantiene el foco dentro del panel y devuelve el foco al botón al cerrar.

Subsecciones del portal independiente: `#/examenes/crear`, `#/examenes/mis-examenes` y `#/examenes/evaluaciones`. Atrás/Adelante y recargar conservan la sección. El borrador de creación se mantiene al cambiar de sección dentro del portal; no se persiste al cerrar o recargar. Dentro del panel de Comunicaciones se usan las mismas vistas sin sustituir las rutas del menú principal de Futsi/Soccer WA.

Mis exámenes administra enlaces; Ver evaluaciones permite elegir un examen y consultar participantes, tiempos y respuestas. Los enlaces públicos de candidatos no incorporan el menú de administración.

`tests/exam-navigation.browser.mjs` usa exclusivamente la API Django local, SQLite aislada y la cuenta ficticia de QA. Verifica menú izquierdo, panel móvil modal, cierre al navegar/Escape/fondo, rutas, Atrás/Adelante, borrador y ausencia de desbordamiento a 320/390/1440 px. También se ejecutan las regresiones de preguntas abiertas/opciones variables y de los tres participantes ficticios que entregan las 40 preguntas. No se crean candidatos ni exámenes ficticios en producción.

Esta actualización solo modifica el frontend; no añade migraciones, tareas periódicas ni infraestructura.
