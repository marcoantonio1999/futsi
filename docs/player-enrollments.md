# Inscripciones de jugadores

## Sanciones

### Fotos en comisión y lista negra

Ambas tablas y sus detalles incluyen la foto del jugador mediante un endpoint autenticado. Las sanciones respetan el alcance de sede; las fotos de exclusiones globales son visibles para los mismos usuarios autorizados a consultar la lista negra. Solo se usa la selfie de inscripción o el archivo de foto del jugador: nunca identificaciones, firmas ni URLs remotas arbitrarias.

Las listas transmiten únicamente disponibilidad, no binarios ni rutas de Storage. Las miniaturas son JPEG de hasta 192 px, se cargan al entrar en pantalla y mantienen una caché limitada en el servidor para fotos inmutables. Las fotos ausentes o antiguas inaccesibles muestran un marcador y no impiden consultar el registro. No hay cron ni polling.

La migración 0067 agrega metadatos privados de conservación a lista negra y recupera referencias de registros existentes sin descargar archivos. Al incluir una exclusión se guarda una referencia independiente a la foto; si el documento antiguo estaba en binario, se conserva ese contenido privado. La eliminación del torneo y sus reintentos de limpieza respetan esas referencias, incluso si la exclusión fue retirada. Esto no recupera las imágenes del proyecto anterior.

### Comisión disciplinaria y lista negra

Comisión disciplinaria consolida las sanciones autorizadas y permite filtrar por
jugador, sede, torneo, equipo, estado y fecha de registro. Se pagina en servidor
(25 filas) y se consulta al entrar, cambiar filtros o actualizar manualmente;
no agrega cron ni consultas periódicas. Administración ve todas las sedes;
coordinadores consultan las sanciones de su sede.

Lista negra contiene decisiones explícitas de exclusión permanente de todas las
sedes. Solo administración/Emilio puede incluir y retirar entradas; requiere
confirmar identidad, nombre completo, nacimiento y motivo. Una recomendación del
tabulador o una sanción «sin término» no crea una exclusión global automáticamente.
La coincidencia para nuevas inscripciones es exacta por nombre completo y fecha
de nacimiento, normalizando acentos, mayúsculas y espacios, como pidió el usuario.
No se usan coincidencias difusas ni únicamente el nombre.

La comprobación ocurre antes de subir documentos y nuevamente dentro de la
transacción final, serializada por identidad en PostgreSQL. El mensaje público
no revela los motivos disciplinarios. Las hojas activas de Inscripciones excluyen
las identidades bloqueadas y la inscripción de origen; las fichas no se borran ni
se consideran una baja firmada. También se impide reasignar/reactivar y pasar
asistencia a un `Player` de plantilla vinculado explícitamente a una exclusión.
Los cupos históricos no se liberan automáticamente: la baja sigue siendo un
proceso independiente. Las altas manuales antiguas de `Player`, que no capturan
fecha de nacimiento, no permiten comparar nuevas identidades por nacimiento;
las nuevas inscripciones por enlace sí incluyen ese dato.

La exclusión global conserva instantáneas del origen y sobrevive a la eliminación
del torneo, equipo y sanción original. Retirarla conserva actor, fecha y motivo de
retiro. La migración 0066 agrega la tabla privada con RLS y restricciones, y un
índice de identidad en inscripciones con inicialización histórica por lotes.
Las migraciones Django 0065/0066 forman parte de la publicación de Inscripciones del 2026-10-14 en la base empresarial BpowerAcademy.

«Sanciones / Nueva sanción» permite elegir torneo, equipo y un integrante activo
de la inscripción por enlace o de la plantilla existente. El tabulador entregado
por el usuario incluye 8 grupos y sus incidentes específicos. Los periodos son
orientativos: nunca se usan para imponer un mínimo, máximo o baja automática.
El coordinador captura días, semanas, meses, años, fecha final o periodo sin
término, con fecha del incidente, inicio y explicación obligatoria. El último
día del periodo es inclusivo; meses/años usan el calendario, no 30/365 días fijos.
Se guardan nombre del jugador, motivo y recomendación como evidencia histórica,
el periodo efectivo, fecha de captura y usuario que decidió. La creación se
protege con UUID para no repetir una sanción por reintentos.

Pueden registrar administradores, dirección, desarrollo, Emilio y coordinadores
de sede (solo su cancha). No se concede acceso a cajeros o entrenadores por su
rol. Las sanciones se guardan en una tabla privada con RLS y sin permisos de
Data API para `anon` o `authenticated`. La migración Django 0065 está preparada;
se aplica mediante las migraciones de la API. No hay cron ni IA.
Registrar una sanción no borra inscripciones/documentos, no reasigna delegado,
no cambia partidos/pagos y no bloquea automáticamente la hoja de alineación.
La eliminación definitiva de un torneo muestra las sanciones en el detalle y
las elimina junto con su historial, conforme a la política ya existente.

## Reutilizar equipos en otro torneo

En Torneos / Equipos, «Agregar equipos existentes» permite elegir el destino,
filtrar por torneo de origen o nombre y seleccionar varios equipos (incluidos
torneos terminados). Se crean registros independientes con nombre y contacto del
delegado; no se mueven los originales ni se copian integrantes, inscripciones,
documentos, firmas, pagos, partidos o accesos `representative_user`. Cada torneo
requiere nuevas inscripciones y firmas. El lote es atómico y los nombres ya
existentes en destino se omiten sin sobrescribirlos. Dos fuentes seleccionadas
con el mismo nombre deben resolverse eligiendo solo una. No se crea un torneo
nuevo automáticamente ni se programa una tarea periódica.

## Baja múltiple por enlace

En administración, Bajas tiene dos subsecciones: Nueva baja para generar enlaces
y Histórico de bajas para consultar registros existentes. El histórico no tiene
límite de antigüedad predeterminado y pagina 25 filas en servidor, con filtros
automáticos por nombre, torneo, equipo y rango inclusivo de fechas. Los catálogos
de filtros provienen de las bajas autorizadas e incluyen equipos/torneos inactivos.
El detalle muestra fecha, jugador, equipo, torneo y la firma de baja a través del
endpoint autenticado de documentos, cargada solo al abrir el diálogo. Una firma
antigua no demuestra por sí sola el nombre de quien firmó: ese dato no se inventa.

El enlace de baja muestra los integrantes activos del equipo con su selfie y
casillas de selección. Puede confirmarse la baja de uno o varios integrantes con
una firma común y aceptación explícita del listado. Cambiar la selección limpia
la aceptación y la firma. La API recibe `enrollment_ids` repetidos en multipart
(o una lista en JSON); conserva `enrollment_id` para clientes anteriores.
La operación es atómica: todas las bajas y sus evidencias se guardan, o ninguna.
Cada jugador conserva una referencia a la firma común; el enlace se consume una
sola vez. No se borran las fichas ni se reasigna automáticamente al delegado.

Las fotos se sirven por `withdrawal/<token>/photos/<enrollment_id>/` únicamente
para selfies de integrantes activos del mismo equipo y enlaces de baja vigentes.
No se exponen rutas de Storage, claves, identificaciones ni firmas. El bucket
sigue privado y las respuestas llevan `no-store`. Una foto antigua no recuperable
se muestra como «Foto no disponible»; no se inventan ni recuperan fotos por este cambio.

## Nombre completo obligatorio

Las nuevas inscripciones públicas requieren tres campos separados: `given_names`
(nombre o nombres), `paternal_surname` (apellido paterno) y `maternal_surname`
(apellido materno). Pantalla y API rechazan campos vacíos, espacios, números o
símbolos; se permiten acentos y apellidos compuestos. El servidor compone y guarda
`name` en ese orden, con espacios normalizados y máximo 160 caracteres. Enviar
únicamente el antiguo campo `name` no satisface el requisito. No se dividen ni
modifican automáticamente los nombres de inscripciones históricas. Los nombres
abreviados del delegado en el equipo pueden completarse al inscribirse, manteniendo
las palabras del nombre previamente capturado en su orden original.

En Futsi, el botón **Inscripciones** de Administración abre el historial y permite crear un enlace por jugador. La cuenta independiente `emilio` entra directamente a esa pantalla, sin sede, correo ni acceso a otras áreas.

Cada enlace dura 30 días y admite una única inscripción. Antes de generarlo se elige un torneo existente y uno de sus equipos. El equipo se vincula al mismo registro `Team` de Administración, y el servidor verifica que pertenezca al torneo seleccionado. Las subsecciones Torneos activos, Crear torneo y Equipos montan el mismo `TournamentsPanel` / `TournamentWorkspace` que Administración. La creación de equipos se realiza desde Equipos del torneo, mediante su acción existente Crear equipo. No se montan formularios de creación separados en Inscripciones ni se crean catálogos paralelos. La cuenta de Emilio usa el modo limitado `setupOnly`, sin acceso a alumnos, finanzas, partidos, contactos privados de representantes ni eliminación de torneos.

El enlace puede compartirse por WhatsApp o copiarse. El formulario público conserva el formato de dos columnas y muestra equipo y torneo fijos, sin permitir cambiarlos. Requiere nombre, teléfono de contacto, teléfono de emergencia, nacimiento, foto frontal del jugador, aceptación y firma. No existe un campo de categoría en este flujo. El folio de pago es opcional.

La migración conserva inscripciones y documentos existentes, vinculando nombres anteriores solamente cuando hay una coincidencia única entre torneo y equipo. Los enlaces antiguos sin asignación inequívoca requieren uno nuevo; no se inventa un equipo ni se mezclan homónimos. La columna histórica de categoría permanece sin solicitarse ni exponerse, para no destruir datos anteriores.

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

## Acceso en Futsi

El acceso es `https://futsi.bpoweracademy.mx/#/admin/inscripciones`, dentro del
frontend existente de Render, con la misma API y base de datos de Futsi. La
sección muestra el nombre Inscripciones BPower. No requiere otro servicio,
subdominio ni cambios de DNS. Los permisos y documentos privados se conservan.

## Sanciones y bajas

Las sanciones pendientes, incluidas las programadas y las sin término, bloquean la baja y los cambios de equipo de jugadores identificados. La fecha final es inclusiva: la baja vuelve a permitirse al día siguiente si no hay otra sanción pendiente. Una selección múltiple con un sancionado se rechaza íntegramente antes de subir la firma y se vuelve a validar dentro de la transacción; si la sanción aparece durante la subida, se limpia el archivo sin registrar bajas ni consumir el enlace.

Las nuevas inscripciones por enlace comprueban también nombre completo normalizado y fecha de nacimiento contra las sanciones de inscripciones anteriores, sin importar la sede o el equipo. Los jugadores del módulo legado sin fecha de nacimiento se protegen por su ID para baja y cambio de equipo, no por homónimos.

Los sancionados siguen visibles en la plantilla, sábana y alineación, con marca textual SANCIONADO y fecha final o Sin término. Las sanciones programadas muestran la fecha de inicio. Las marcas se imprimen también en blanco y negro y desaparecen al vencer todas las sanciones. No se crea ningún cron: la vigencia se calcula al consultar.

## Baja local en ventanilla

En Bajas > Nueva baja, seleccionar torneo y equipo habilita Baja local junto a Crear enlace. Abre el mismo formulario firmado dentro de un diálogo, sin navegar fuera del panel. La invitación conserva purpose=withdraw y el servidor mantiene permisos de sede, sanciones y validación de integrantes. Reutiliza la carga directa a R2 cuando está habilitada.

Al confirmar se refrescan catálogo e histórico; cerrar antes de terminar pide confirmación y durante el envío permanece bloqueado. No cambia la baja pública por enlace ni el formato de impresión. Validación local: TypeScript, compilación, pruebas de bajas y flujo simulado de firma/error/guardado con y sin R2 en 320, 390 y 1440 px. No se ejecutaron bajas reales.

## Permisos firmados de 24 horas (implementación local)

Nueva sección Permisos > Permisos de 24 horas. Después de elegir torneo y equipo hay dos opciones: Permiso en línea crea un enlace de un solo uso válido por 7 días; Permiso local abre el mismo formulario en un diálogo dentro del panel. Ambos piden nombre, foto JPG/PNG, aceptación de condiciones y firma obligatoria. No piden INE ni CURP.

Las 24 horas comienzan al completar y firmar el formulario, no al crear el enlace. El servidor asigna folio P-000001, emisión y vencimiento exactos. El comprobante conserva el aviso bajo protesta y el texto de aceptación del formato, incluye foto y firma y se puede imprimir en A4 desde la página pública, ventanilla o historial. Horario de Ciudad de México.

API privada: GET/POST `/api/player-enrollments/permits/`, POST `/api/player-enrollments/permits/invitations/` y GET `/api/player-enrollments/permits/<id>/photo/` o `signature/`. Consulta protegida por sede/operador. El enlace público `#/permiso/<token>` usa GET/POST `/api/player-enrollments/permits/public/<token>/`. Un enlace usado no muestra datos personales ni vuelve a emitir otro permiso; un reintento con el mismo request_id devuelve el permiso original sin ampliar vigencia. Se verifican vigencia del enlace, equipo/torneo activos y permisos actuales de su creador.

Foto y firma se validan antes de subir cualquier archivo. La firma vacía se rechaza en servidor y se guardan ambos archivos privados con SHA256, texto/versión de condiciones, origen local/en línea y autor. Se reutiliza el almacenamiento privado configurado (R2 en producción). La lectura autorizada ofrece entrega temporal directa a R2 sin reenviar el token de la aplicación. La creación envía las dos imágenes a la API para validarlas; no emite URLs de subida públicas. El historial está paginado con filtro de vigentes/vencidos. No usa cron ni sondeo de red.

Los permisos no crean una inscripción, no cambian cupos ni cancelan sanciones/lista negra. No se implementa identificación por foto para comprobar sanciones. No se emitieron permisos reales durante las pruebas.

Requiere publicar API/frontend y aplicar `0076_player_temporary_permits`. Crea tablas privadas de invitaciones y permisos, con RLS y sin permisos PUBLIC/anon/authenticated en PostgreSQL. La migración se comprobó en SQLite aislado y no se aplicó en producción. Trece pruebas de API verifican autorización, alcance, firmas/aceptación obligatorias, enlace público sin sesión, uso único, vencimiento y reintentos. Flujos de navegador local/en línea en 320/390/1440 px verifican firma, error recuperable, cierre protegido, navegación móvil y comprobante impreso con firma.
