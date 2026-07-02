# Tablero tecnico actual

Fecha de corte: 2026-07-02

Uso: actualizar este tablero en cada daily tecnica. El lider tecnico mueve prioridades, cada owner actualiza estado y QA valida cierre.

## Prioridad de release

Objetivo inmediato: estabilizar piloto web con backend Django, frontend React/Vite, Supabase/Postgres y smoke por rol.

## P0 - Bloqueantes de piloto

| Estado | Tarea | Owner | Criterio de cierre |
| --- | --- | --- | --- |
| Pendiente | Confirmar variables reales de Render/Supabase | Arquitecto | `/health/` responde en backend remoto y no hay secretos en repo |
| Pendiente | Ejecutar migraciones contra base objetivo | Arquitecto + Backend | Migraciones aplicadas sin errores y rollback plan documentado |
| Pendiente | Correr suite backend completa | Backend + QA | Tests pasan con reporte guardado |
| Pendiente | Correr typecheck/build frontend | Frontend | `npm.cmd run typecheck` y `npm.cmd run build` pasan |
| Pendiente | Validar login frontend contra API remota | Frontend + QA | Admin/dev puede entrar desde build publicado o preview |
| Pendiente | Smoke por roles principales | QA | Admin/dev, contador, cajero, coach y tutor validados |
| Pendiente | Revisar CORS/CSRF/HTTPS | Arquitecto + Backend | Origenes productivos cerrados y sin comodines inseguros |

## P1 - Calidad

| Estado | Tarea | Owner | Criterio de cierre |
| --- | --- | --- | --- |
| Pendiente | Crear matriz de regresion por modulo | QA | Cobranza, asistencia, historico, facturas y dashboard cubiertos |
| Pendiente | Definir primer set de pruebas frontend | Frontend + QA | Vitest configurado o decision documentada |
| Pendiente | Formalizar smoke Android | QA + Frontend | Checklist reproducible con APK debug |
| Pendiente | Revisar endpoints con mas riesgo de N+1 | Backend | Query counts o optimizaciones documentadas |
| Pendiente | Documentar contratos API criticos | Arquitecto + Backend | Payloads de cobranza/asistencia/historico claros para frontend |

## P2 - Innovacion

| Estado | Tarea | Owner | Criterio de cierre |
| --- | --- | --- | --- |
| Pendiente | Medir precision del pase automatico | Innovacion + QA | Tabla con videos, aciertos, falsos positivos y falsos negativos |
| Pendiente | Comparar CPU vs GPU | Innovacion | Tiempo promedio por video y recomendacion de hardware |
| Pendiente | Definir retencion de evidencias | Arquitecto + Innovacion | Politica documentada para fotos, recortes y videos |
| Pendiente | Mejorar flujo de desconocidos | Innovacion + Frontend | Coordinador puede resolver casos sin tocar datos sensibles innecesarios |

## Daily tecnica

Formato recomendado:

1. Que cambio desde ayer.
2. Que se entrega hoy.
3. Bloqueos.
4. Riesgo nuevo.
5. Evidencia o comando pendiente.

## Decision de release

El piloto no se libera si existe cualquiera de estos puntos:

- Tests backend fallando sin excepcion aprobada.
- Build frontend fallando.
- Login o navegacion principal rota.
- Permisos por rol con acceso indebido a datos financieros, familiares, fotos o facturas.
- Deploy sin HTTPS/CORS/CSRF revisado.
- Bugs P0/P1 abiertos en cobranza, asistencia, facturacion o historico.
