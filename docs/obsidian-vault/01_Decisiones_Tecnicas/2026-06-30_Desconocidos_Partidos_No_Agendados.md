# Desconocidos: deteccion de partidos no agendados

Fecha: 2026-06-30

## Contexto

El cron de desconocidos ahora graba 1 frame cada 5 segundos solo cuando detecta movimiento. Los frames se suben a Drive por la noche y el backend los procesa en la seccion de Desconocidos.

## Objetivo

Detectar si hubo actividad tipo partido aunque no exista un partido agendado en `matches`.

## Regla recomendada

No usar cantidad de frames como senal principal. Un solo jugador caminando puede generar muchos frames.

Usar ventanas deslizantes:

- Duracion de ventana: 60 minutos.
- Paso entre ventanas: 15 minutos.
- Agrupar por `site_id` y, para diagnostico, por `camera_id`.
- Contar personas unicas:
  - conocidos detectados desde metadata de `known_match`;
  - desconocidos consolidados desde `subject_id`;
  - solo capturas procesadas y con calidad suficiente.
- Marcar como posible partido no agendado si:
  - personas unicas >= 6;
  - capturas procesadas suficientes, por ejemplo >= 8;
  - rango activo real de capturas >= 20 minutos;
  - no existe partido de `matches` que se empalme con esa ventana usando tolerancia de 10-15 minutos antes/despues.

## Estados de UI

- Preliminar: muchas capturas por movimiento, pero aun no procesadas.
- Confirmado por rostros: >= 6 personas unicas procesadas en una hora.
- Empalmado con agenda: actividad alta, pero cae dentro de un partido registrado.
- Posible no agendado: actividad alta y sin partido registrado empalmado.

## Implementacion propuesta

Agregar al backend una consulta `activity_windows` para la seccion de desconocidos:

- `date`
- `site_id`
- `camera_id`
- `window_start`
- `window_end`
- `processed_captures`
- `motion_captures`
- `known_people`
- `unknown_people`
- `unique_people`
- `scheduled_match_id`
- `scheduled_match_label`
- `is_unscheduled_candidate`
- `confidence`
- `reason`

Primera version: calcular en SQL/backend sin crear tabla nueva.
Si se vuelve pesado, materializar despues en una tabla `unknown_attendance_activity_windows`.

## Hallazgo inicial

Consulta de prueba en Supabase con los ultimos 14 dias:

- Si hay ventanas de 1 hora con mas de 5 personas.
- Las ventanas revisadas se empalman con partidos agendados.
- No aparecio todavia una ventana procesada con >= 5 personas y sin empalme de agenda.

Conclusion: la estrategia es viable, pero debe cruzar contra `matches`; solo el umbral de 5 personas no basta.
