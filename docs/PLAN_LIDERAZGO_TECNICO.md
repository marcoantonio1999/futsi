# Plan de liderazgo tecnico Futsi

Fecha de corte: 2026-07-02

## Objetivo

Organizar el trabajo de backend, arquitectura, QA/testing, frontend e innovacion para llevar Futsi Mini ERP a un piloto estable, medible y desplegable.

Este documento debe usarse como fuente operativa de coordinacion. Las decisiones tecnicas profundas deben registrarse tambien en `docs/obsidian-vault/01_Decisiones_Tecnicas/`.

## Estado actual del proyecto

| Area | Estado observado | Riesgo principal |
| --- | --- | --- |
| Backend | Django REST Framework con dominios de cobranza, asistencia, torneos, historico, facturacion y pase automatico | Crecimiento de endpoints y reglas sin contrato unico |
| Frontend | React/Vite/Capacitor con vistas operativas, dashboard, mobile y feature folder para pase automatico | Componentes grandes y flujos moviles con alto riesgo de regresion |
| QA | Pytest, Selenium, coverage, Sonar configurado y documentos de seguridad | Falta cerrar pruebas frontend unitarias y smoke Android formal |
| Arquitectura | Supabase/Postgres, Render para backend, GitHub Pages para frontend, Storage recomendado | Produccion depende de variables, migraciones y CORS bien cerrados |
| Innovacion | Pase automatico facial/video, desconocidos, clustering y evidencias | Rendimiento, precision, privacidad y costo de procesamiento |

## Roles y responsabilidades

### Lider tecnico

Responsable de coordinar prioridades, destrabar dependencias, cuidar calidad y decidir que entra o no entra a cada entrega.

Responsabilidades:

- Mantener este plan y el backlog tecnico actualizados.
- Definir criterios de aceptacion antes de iniciar desarrollo.
- Revisar que backend, frontend y QA trabajen contra el mismo contrato.
- Validar riesgos de seguridad, datos personales y despliegue.
- Exigir evidencia de pruebas antes de declarar una historia terminada.
- Cerrar decisiones con fecha, razon y archivos afectados.

### Arquitecto

Responsable de coherencia tecnica, datos, integraciones y despliegue.

Ownership principal:

- `back/futsi_api/settings.py`
- `back/core/models.py`
- `back/core/migrations/`
- `back/sql/schema.sql`
- `docs/DEPLOYMENT_SUPABASE.md`
- `docs/db_schema_erd.*`
- `docs/obsidian-vault/01_Decisiones_Tecnicas/`

Responsabilidades:

- Definir contratos de API y modelo de datos antes de implementar cambios grandes.
- Revisar migraciones, indices, constraints y compatibilidad con Supabase/Postgres.
- Mantener estrategia de ambientes: local, staging, produccion.
- Definir limites de seguridad: CORS, CSRF, secretos, Storage privado y permisos por rol.
- Aprobar decisiones sobre procesamiento facial, almacenamiento y costos.

### Backend

Responsable de APIs, reglas de negocio, permisos, jobs y persistencia.

Ownership principal:

- `back/core/api/`
- `back/core/domain_serializers/`
- `back/core/services/`
- `back/core/management/commands/`
- `back/core/permissions.py`
- `back/core/tests/`

Responsabilidades:

- Implementar reglas de negocio como servicios o dominio reusable, no solo logica dentro de views.
- Mantener endpoints consistentes en nombres, filtros, paginacion, errores y permisos.
- Cubrir cada flujo con pruebas de permisos, casos felices y errores operativos.
- Cuidar que jobs de pase automatico sean idempotentes y auditables.
- Coordinar con frontend cambios de payload antes de modificar respuestas existentes.

### Frontend

Responsable de experiencia web/mobile, integracion de API y estados de UI.

Ownership principal:

- `front/src/App.tsx`
- `front/src/api.ts`
- `front/src/appState.ts`
- `front/src/components/`
- `front/src/features/`
- `front/src/domainTypes/`
- `front/src/hooks/`
- `front/android/`

Responsabilidades:

- Mantener tipos alineados con payloads reales del backend.
- Dividir vistas grandes en componentes de dominio cuando crezcan o compartan estado.
- Validar flujos por rol: admin/dev, contador, cajero, coach y tutor.
- Cuidar mobile-first en rutas criticas: login, menu, cobranza, asistencia y camara.
- Ejecutar `npm.cmd run typecheck` y `npm.cmd run build` antes de entregar.

### Tester / QA

Responsable de estrategia de pruebas, regresion, evidencias y criterios de salida.

Ownership principal:

- `qa/selenium/`
- `back/core/tests/`
- `pytest.ini`
- `.github/workflows/ci.yml`
- `docs/Futsi_QA_Master_Sprint4.md`
- `docs/SPRINT3_SEGURIDAD_QA.md`

Responsabilidades:

- Convertir criterios de aceptacion en pruebas automatizadas o checklist manual.
- Mantener matriz de pruebas por rol, modulo y severidad.
- Bloquear release si fallan permisos, pagos, datos personales, facturas o asistencia.
- Generar evidencia de fallos: screenshot, HTML, logs y datos usados.
- Agregar smoke Android formal cuando se estabilice el APK debug.

### Innovacion

Responsable de exploracion aplicada: IA, video, automatizacion, metricas y mejoras de producto.

Ownership principal:

- `back/core/api/automatic_attendance_*`
- `back/core/services/face_insight.py`
- `front/src/features/automatic-attendance/`
- `docs/DEMO_PASE_LISTA_FACIAL.md`
- `docs/obsidian-vault/01_Decisiones_Tecnicas/`

Responsabilidades:

- Proponer mejoras con hipotesis, metrica esperada y costo tecnico.
- Separar prototipo de flujo productivo.
- Medir precision, falsos positivos, velocidad, tamano de video y costo de Storage/proceso.
- Documentar umbrales y cambios en la boveda tecnica.
- No introducir dependencias pesadas en CI ni produccion sin aprobacion de arquitectura.

## Matriz RACI resumida

| Trabajo | Lider tecnico | Arquitecto | Backend | Frontend | QA | Innovacion |
| --- | --- | --- | --- | --- | --- | --- |
| Contrato API nuevo | A | R | R | C | C | C |
| Migracion de datos | A | R | R | I | C | I |
| Pantalla nueva | A | C | C | R | C | I |
| Regla de negocio financiera | A | C | R | C | R | I |
| Pase automatico facial | A | C | R | C | C | R |
| Deploy productivo | A | R | C | C | R | I |
| Pruebas de regresion | A | C | C | C | R | I |
| Decision tecnica irreversible | A | R | C | C | C | C |

Leyenda: R = responsable de ejecutar, A = accountable/firma final, C = consultado, I = informado.

## Flujo de trabajo

1. Todo trabajo inicia con criterio de aceptacion visible.
2. Arquitectura define o valida contrato si toca datos, permisos, despliegue o integraciones.
3. Backend implementa API y pruebas de dominio/permisos.
4. Frontend integra usando tipos y estados explicitos.
5. QA valida con automatizacion o checklist con evidencia.
6. Lider tecnico decide si entra al release o se difiere.

## Definition of Ready

Una tarea esta lista para desarrollo cuando tiene:

- Objetivo de negocio claro.
- Usuario/rol afectado.
- Criterios de aceptacion.
- Impacto esperado en API, modelo, UI y pruebas.
- Datos demo o fixture para validar.
- Riesgos conocidos: seguridad, permisos, rendimiento, datos personales o migracion.

## Definition of Done

Una tarea esta terminada cuando:

- Backend y frontend compilan o pasan checks aplicables.
- Hay prueba automatizada o checklist manual con evidencia.
- Los permisos por rol fueron revisados si hay datos sensibles.
- No rompe seed demo, login ni flujos criticos.
- La documentacion se actualizo si cambio comportamiento, deploy, modelo o decision tecnica.
- QA confirma el resultado y el lider tecnico acepta el cierre.

## Backlog tecnico inmediato

### Prioridad P0: estabilizar piloto

| Tarea | Owner | Resultado esperado |
| --- | --- | --- |
| Cerrar variables reales de Render/Supabase y probar `/health/` | Arquitecto | Backend desplegable sin secretos en repo |
| Ejecutar suite backend completa con Postgres/Supabase compatible | Backend + QA | Confianza en migraciones y permisos |
| Validar build frontend y login contra API remota | Frontend + QA | Pages/Render integrados |
| Revisar CORS/CSRF/HTTPS y Storage privado | Arquitecto + Backend | Riesgo de exposicion reducido |
| Smoke por rol: admin/dev, contador, cajero, coach, tutor | QA | Matriz de release lista |

### Prioridad P1: calidad y regresion

| Tarea | Owner | Resultado esperado |
| --- | --- | --- |
| Agregar pruebas frontend unitarias con Vitest | Frontend + QA | Coverage inicial de componentes criticos |
| Formalizar smoke Android APK debug | QA + Frontend | Checklist reproducible en celular/emulador |
| Completar pruebas agresivas de formularios y doble click | QA | Menos errores operativos por captura repetida |
| Revisar query counts de endpoints criticos | Backend | Evitar degradacion con mas alumnos/equipos |
| Documentar contratos principales de API | Arquitecto + Backend | Menos friccion frontend/backend |

### Prioridad P2: innovacion controlada

| Tarea | Owner | Resultado esperado |
| --- | --- | --- |
| Medir precision del pase automatico con videos representativos | Innovacion + QA | Tabla de precision/falsos positivos |
| Perfilar tiempos de procesamiento CPU vs GPU | Innovacion | Recomendacion de hardware |
| Definir politica de retencion de evidencias y videos | Arquitecto + Innovacion | Privacidad y costos controlados |
| Mejorar manejo de desconocidos con flujo operativo | Innovacion + Frontend | Menos trabajo manual del coordinador |

## Cadencia de equipo

| Ritual | Duracion | Participantes | Salida |
| --- | --- | --- | --- |
| Daily tecnica | 15 min diaria | Todos | Bloqueos, cambios de prioridad, riesgos |
| Refinamiento | 45 min, 2 veces por semana | Lider, arquitecto, backend, frontend, QA | Tareas listas para desarrollo |
| Revision tecnica | 30 min por feature relevante | Lider, arquitecto, owners | Contrato, migracion, seguridad, pruebas |
| Bug triage | 30 min semanal | Lider, QA, owners | Severidad, owner y fecha objetivo |
| Demo/release review | 45 min semanal | Todos | Evidencia, pendientes y decision de release |

## Reglas de coordinacion

- Si cambia un payload de API, backend debe avisar a frontend y QA antes de merge.
- Si cambia un modelo o migracion, arquitectura revisa indices, constraints y datos existentes.
- Si toca pagos, facturas, datos de menores, fotos o permisos, QA debe agregar prueba o checklist explicito.
- Si es innovacion, debe tener metrica de exito antes de volverse parte del flujo principal.
- Ninguna tarea de release se cierra solo con "funciona en mi maquina"; debe tener comando, evidencia o captura.
- Las decisiones que afecten rendimiento, umbrales o arquitectura se documentan con fecha.

## Entregables por rol cada semana

| Rol | Entregable minimo |
| --- | --- |
| Lider tecnico | Backlog priorizado, riesgos, decision de release |
| Arquitecto | Decisiones registradas, contratos/migraciones revisadas |
| Backend | APIs con pruebas y notas de cambios |
| Frontend | UI integrada, typecheck/build y evidencias mobile |
| QA | Reporte de pruebas, bugs con severidad y evidencia |
| Innovacion | Experimentos medidos y recomendacion: adoptar, ajustar o descartar |

## Indicadores de salud

| Indicador | Meta inicial |
| --- | --- |
| Backend tests | 100% pasando antes de release |
| Coverage backend | Mantener minimo 60%, subir gradualmente |
| Frontend build | 100% pasando antes de release |
| Typecheck frontend | 100% pasando antes de release |
| Selenium smoke | Roles principales pasando |
| Bugs P0/P1 abiertos | 0 para piloto |
| Deploy smoke | Login, dashboard, cobranza, asistencia y reportes validados |
| Pase automatico | Precision y falsos positivos medidos antes de uso operativo |

## Riesgos activos

| Riesgo | Impacto | Mitigacion |
| --- | --- | --- |
| Cambios grandes sin contrato API | Rompe frontend y QA | Contrato obligatorio para tareas P0/P1 |
| Produccion con variables incompletas | Deploy falla o expone datos | Checklist Render/Supabase antes de release |
| Permisos incompletos por rol | Exposicion de datos financieros/personales | Pruebas de autorizacion por rol |
| Componentes frontend grandes | Regresiones y baja mantenibilidad | Extraer features y shared parts cuando crezcan |
| Procesamiento facial sin medicion | Falsos positivos o costos altos | Experimentos medidos y aprobacion de arquitectura |
| Evidencias/video sin politica | Riesgo de privacidad y almacenamiento | Retencion y Storage privado documentados |

## Orden recomendado para el siguiente ciclo

1. Congelar alcance P0 del piloto.
2. Correr backend tests y frontend build/typecheck local.
3. Resolver fallos bloqueantes.
4. Probar deploy Render/Supabase/Pages en staging o entorno controlado.
5. Ejecutar smoke por rol y documentar evidencia.
6. Solo despues retomar mejoras P1/P2.
