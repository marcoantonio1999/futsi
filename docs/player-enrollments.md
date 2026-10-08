# Inscripciones de jugadores

En Futsi, el botón **Inscripciones** de Administración abre el historial y permite crear un enlace por jugador. La cuenta independiente `emilio` entra directamente a esa pantalla, sin sede, correo ni acceso a otras áreas.

Cada enlace dura 30 días y admite una única inscripción. Puede compartirse por WhatsApp o copiarse. El formulario público, sin logotipo ni nombre de aplicación, reproduce la hoja de firma en dos columnas: documentación a la izquierda y foto, firmas y datos a la derecha. Requiere nombre, equipo, torneo, teléfono de contacto, teléfono de emergencia, nacimiento, foto frontal del jugador, aceptación de compromisos y firma dibujada del jugador. La categoría y el folio de pago son opcionales.

Adultos: INE frente y reverso, o pasaporte, o cartilla. Menores: credencial del menor, CURP, INE del tutor frente y reverso, nombre y firma del tutor. La fecha de nacimiento determina los requisitos tanto en la pantalla como en el servidor.

El historial muestra una cédula de dos columnas con fotos y nombres, agrupada por equipo y torneo. Permite buscar, paginar, elegir fecha y jornada de impresión y abrir la hoja firmada del jugador. La impresión incluye únicamente los registros de la página mostrada; no oculta esta limitación. El botón Imprimir / guardar PDF usa la impresión del navegador.

El PDF anterior queda como referencia histórica en `front/public/registro-supergol.pdf`. Los compromisos vigentes provienen de la nueva referencia proporcionada por el usuario y se muestran completos desde `core/enrollment_terms.py`. Su texto y versión se guardan en cada inscripción junto a la fecha de servidor. Si el formato cambia, debe cambiarse también `TERMS_VERSION`.

El registro conserva la evidencia de firma dibujada y aceptación; no es una firma electrónica certificada ni verifica la identidad contra una autoridad.

## Privacidad y acceso

Los documentos se conservan de manera duradera en una tabla privada de PostgreSQL, nunca en el disco efímero de Render ni en URL públicas. El historial pagina 25 registros y no carga los binarios. Cada adjunto se descarga con el token de sesión y verificación de permisos. Los operadores ven las inscripciones de sus propios enlaces; administradores, dirección y desarrollo ven el historial general. La cuenta de inscripción no puede consultar otras rutas autenticadas, incluso si escribe una URL manualmente.

La migración activa RLS y revoca el acceso a `anon` y `authenticated` de Supabase. Django debe conectar con su rol de backend privilegiado. No se conceden políticas públicas del Data API. Límites: 3 MB por lado del INE, 500 KB por firma, tipos reales PNG/JPG o PDF para el INE. Las firmas vacías se rechazan. La publicación está protegida con límite de solicitudes y enlace aleatorio. No se registran INE, firmas ni credenciales en logs.

## Cuenta

`python manage.py create_enrollment_operator --username emilio` pide una contraseña sin mostrarla. No sobrescribe una cuenta existente. El aprovisionamiento de producción puede realizarse con `tools/enrollment_account.py` usando el entorno existente de Futsi; la credencial generada debe entregarse por un canal privado y no guardarse en git.

## Verificación

`DB_ENGINE=sqlite ALLOW_SQLITE=true python manage.py test core.tests.test_player_enrollments --settings=futsi_api.enrollment_test_settings`

Pruebas: adulto sin tutor, menor con tutor obligatorio, rechazo de firma vacía, identificación y consentimiento obligatorios, expiración, protección de documentos, permisos de cuenta y cumpleaños número 18. El entorno de prueba usa una base independiente y no altera producción.
