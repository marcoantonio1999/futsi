# Inscripciones de jugadores

En Futsi, el botón **Inscripciones** de Administración abre el historial y permite crear un enlace por jugador. La cuenta independiente `emilio` entra directamente a esa pantalla, sin sede, correo ni acceso a otras áreas.

Cada enlace dura 30 días y admite una única inscripción. Puede compartirse por WhatsApp o copiarse. El formulario público requiere nombre, equipo, categoría, teléfono, nacimiento, INE frente y reverso, aceptación del formato y firma dibujada del jugador. Para menores de 18 años también exige nombre y firma del tutor; el INE solicitado es el del tutor. El folio de pago y segundo teléfono son opcionales. La lista de documentación presentada reproduce los campos del formato y no afirma que se hayan validado esos documentos.

El formato de compromisos original está en `front/public/registro-supergol.pdf`, SHA-256 `1a6c8aea8f33065626e085fb0c9817263cab6e413d4f70e1b04014254c3f6a34`. La versión aceptada queda registrada con fecha de servidor. Si el formato cambia, debe cambiarse también `TERMS_VERSION` en el servidor.

El registro conserva la evidencia de firma dibujada y aceptación; no es una firma electrónica certificada ni verifica la identidad contra una autoridad.

## Privacidad y acceso

Los documentos se conservan de manera duradera en una tabla privada de PostgreSQL, nunca en el disco efímero de Render ni en URL públicas. El historial pagina 25 registros y no carga los binarios. Cada adjunto se descarga con el token de sesión y verificación de permisos. Los operadores ven las inscripciones de sus propios enlaces; administradores, dirección y desarrollo ven el historial general. La cuenta de inscripción no puede consultar otras rutas autenticadas, incluso si escribe una URL manualmente.

La migración activa RLS y revoca el acceso a `anon` y `authenticated` de Supabase. Django debe conectar con su rol de backend privilegiado. No se conceden políticas públicas del Data API. Límites: 3 MB por lado del INE, 500 KB por firma, tipos reales PNG/JPG o PDF para el INE. Las firmas vacías se rechazan. La publicación está protegida con límite de solicitudes y enlace aleatorio. No se registran INE, firmas ni credenciales en logs.

## Cuenta

`python manage.py create_enrollment_operator --username emilio` pide una contraseña sin mostrarla. No sobrescribe una cuenta existente. El aprovisionamiento de producción puede realizarse con `tools/enrollment_account.py` usando el entorno existente de Futsi; la credencial generada debe entregarse por un canal privado y no guardarse en git.

## Verificación

`DB_ENGINE=sqlite ALLOW_SQLITE=true python manage.py test core.tests.test_player_enrollments --settings=futsi_api.enrollment_test_settings`

Pruebas: adulto sin tutor, menor con tutor obligatorio, rechazo de firma vacía, identificación y consentimiento obligatorios, expiración, protección de documentos, permisos de cuenta y cumpleaños número 18. El entorno de prueba usa una base independiente y no altera producción.
