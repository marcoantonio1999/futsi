# Documento Maestro de QA - Sprint 4

Fecha de corte: 2026-05-29

## Resumen ejecutivo

El Sprint 4 agrega una capa formal de QA automatizado sobre Futsi Mini ERP. La suite queda dividida en pruebas de API/backend con Pytest, pruebas end-to-end web con Selenium, build de frontend, evidencia automatica de fallos y analisis estatico con SonarQube/SonarCloud. El objetivo es detectar regresiones en permisos, cobranza, facturacion, carga historica, navegacion por roles y flujos moviles antes de desplegar.

## Resultados actuales

| Tipo | Herramienta | Resultado | Cobertura / evidencia |
|---|---|---|---|
| Backend/API | Pytest + pytest-django | 27 pruebas esperadas despues de agregar rol dev | Coverage minimo CI: 60%; ultima corrida previa: 83.72% |
| E2E Web | Selenium + Chrome headless | 6 pruebas pasan | Captura PNG/HTML ante fallo en qa/artifacts |
| Frontend | Vite build | Build exitoso | dist generado localmente |
| Seguridad basica | Pytest security inputs | Incluido en backend | Login SQL-like, montos negativos, permisos cruzados |
| Analisis estatico | SonarQube/SonarCloud | Configurado | sonar-project.properties + job CI condicionado a SONAR_TOKEN |

## Clasificacion de pruebas

### Pruebas backend/API

- Autenticacion y permisos: roles admin, dev, contador, cajero, coach y tutor.
- Cobranza: pagos, efectivo con confirmacion, transferencia simulada, restricciones por sede.
- Reporte contable: exportacion XLSX valida y permisos de contador.
- Facturacion simulada: generacion de PDF/XML/UUID para ingresos y egresos.
- Historico Excel: preview, commit, firma, password y bloqueo por rol no autorizado.
- Robustez y seguridad: payloads tipo SQL injection, textos raros, montos negativos, IDs invalidos.

### Pruebas end-to-end web

- Login invalido no accede al sistema.
- Admin/dev: dashboard, alumnos, historico, tema oscuro y menu movil.
- Contador: exportacion contable y facturas.
- Cajero: controles de pago sin acceso a panel admin.
- Coach: asistencia, camara y registro de horas.
- Tutor: alumnos vinculados, perfil y facturas.

### Pruebas de integracion y build

- Django migrations + seed demo reproducible.
- Vite build de React.
- Selenium levanta Django y Vite con base SQLite aislada.

## Estrategia SonarQube

Se agrego `sonar-project.properties` para centralizar fuentes, pruebas, exclusiones y reportes de cobertura. El job `sonarqube` en GitHub Actions corre Pytest con coverage y ejecuta `SonarSource/sonarqube-scan-action` cuando existe `SONAR_TOKEN`.

Configuracion requerida en GitHub:

- Secret: `SONAR_TOKEN`.
- Variable opcional: `SONAR_HOST_URL`.
- Para SonarCloud usar `https://sonarcloud.io`.
- Para SonarQube Server usar la URL interna/publica del servidor.

Politica recomendada:

- Quality Gate obligatorio antes de deploy productivo.
- Minimo inicial backend: 60% coverage.
- Sin nuevos bugs criticos ni vulnerabilidades criticas.
- Excluir generados: `front/android`, `dist`, migraciones, artifacts y docs binarios.
- Agregar coverage frontend con Vitest en un sprint posterior.

## Rol tecnico Dev App

Se agrega el rol `dev` y el usuario demo `dev/dev12345`. Tiene permisos equivalentes a admin para QA, soporte y diagnostico, pero debe tratarse como cuenta tecnica, no operativa.

Reglas:

- Puede ver usuarios, sedes, alumnos, historicos, reportes y flujos admin.
- Debe usarse para pruebas internas, debugging y validacion en ambientes no productivos.
- En produccion debe tener MFA, password fuerte, auditoria y acceso temporal.
- No debe compartirse entre personas; cada desarrollador deberia tener cuenta propia cuando haya identidad real.

## Matriz de aceptacion

| Area | Criterio | Estado |
|---|---|---|
| Backend pytest | Suite completa pasa | Implementado |
| Coverage | Minimo 60% | Implementado |
| Selenium | Roles principales cubiertos | Implementado |
| Artifacts | Screenshot/HTML ante fallo | Implementado |
| SonarQube | Config y CI preparado | Implementado |
| Dev App | Rol y usuario tecnico | Implementado |
| DeepFace | Fuera de CI; demo local | Decidido |
| Android nativo QA | Pendiente automatizar | Futuro |

## Riesgos y siguientes pasos

- SonarQube necesita `SONAR_TOKEN` real para escanear en CI.
- Falta agregar pruebas frontend unitarias con Vitest para generar `front/coverage/lcov.info`.
- Selenium cubre smoke e2e; aun falta ampliar casos destructivos de formularios y doble click.
- Android queda cubierto por responsive web y smoke manual; Appium puede entrar despues.
- El rol dev debe endurecerse antes de produccion: MFA, expiracion, audit log y principio de menor privilegio.
