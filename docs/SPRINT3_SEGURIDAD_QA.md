# Sprint 3 - Seguridad, QA automatizado y hardening

## Objetivo

El Sprint 3 debe cerrar los riesgos principales antes de piloto productivo: pagos, datos de menores, fotos, datos medicos, facturas, historico financiero y permisos por rol.

## Seguridad

| Area | Prueba / control | Salida esperada |
| --- | --- | --- |
| SQL injection | Payloads maliciosos en login, filtros, reportes, importacion Excel y busquedas | ORM parametrizado, sin ejecucion SQL no esperada |
| Autorizacion | Acceso cruzado por rol: cajero, coach, tutor, contador, admin | 403/404 correcto para datos fuera de permiso |
| Archivos Excel | Extension, MIME, tamano, password, cifrado, hojas inesperadas, filas corruptas | Falla controlada y reporte de errores |
| Datos personales | Revisar fotos, responsivas, datos medicos y facturas | Exposicion minima por rol |
| Secretos | Revisar repo, workflows, Render y Supabase | Sin passwords ni tokens en git |
| CORS/CSRF/HTTPS | Origenes permitidos, headers seguros, HTTPS | Produccion sin comodines inseguros |
| Dependencias | npm audit, pip-audit, Dependabot | Vulnerabilidades altas resueltas o documentadas |

## QA automatizado

| Herramienta | Uso |
| --- | --- |
| SonarQube / SonarCloud | Quality Gate en GitHub Actions para bugs, smells, duplicacion, hotspots y cobertura |
| pytest + Django | Modelos, permisos, reportes, facturas, pagos, importacion historica y auditoria |
| Playwright Python | Login por rol, navegacion movil, pagos, asistencia, facturas, historico Excel y tema oscuro |
| Pruebas agresivas UI | Inputs largos, caracteres raros, fechas invalidas, montos negativos, doble click, reload y payloads SQL-like |
| OWASP ZAP baseline | Escaneo contra staging local/Render |
| Lighthouse | PWA, accesibilidad y performance movil |
| Android smoke | Instalar APK debug y probar login, menu, tema oscuro y camara |

## Definition of Done

- GitHub Actions ejecuta build web, check backend, tests y Sonar.
- Playwright cubre al menos admin, contador, cajero, coach y tutor.
- Pruebas de permisos evitan acceso horizontal/vertical.
- ZAP baseline sin hallazgos altos.
- Importacion historica usa staging, conciliacion y firma.
- APK probado en emulador y un celular fisico.
- Deploy Render + Supabase + Pages probado con smoke test documentado.
