# Apelaciones y cumplimiento de sanciones

Comisión disciplinaria es la primera subsección de Sanciones. El personal autorizado registra una apelación por sanción, motivos y foto de la carta escrita por el jugador. Tomar foto abre la cámara en vivo dentro del mismo diálogo, con permiso del navegador y preferencia por cámara trasera; Adjuntar permite seleccionar una imagen. Se conserva el texto al abrir/cerrar/capturar y se detiene la cámara al salir. El envío se deshabilita mientras está abierta o comprimiendo. La carta se comprime a máximo 3 MB y se guarda en el bucket privado existente, sin URLs públicas, cron ni consultas periódicas. Solo se descarga al pulsar Ver foto de la carta.

Solo administración (incluido Emilio) acepta/rechaza apelaciones y registra folios. Se conservan autor, fecha y motivos de ambas decisiones. No se puede sustituir una carta ni sobrescribir decisiones/folios ya registrados. Aceptar una apelación no cambia el periodo ni elimina la sanción.

Cada nueva sanción requiere periodo cumplido **y** folio de pago. La fecha final es inclusiva: se libera a partir del día siguiente si ya existe folio. Se permite registrar el pago anticipadamente, sin liberar antes de tiempo. Una sanción sin término sigue pendiente incluso con pago. El importe MXN puede anotarse al crear la sanción; nunca se inventa para registros anteriores ni genera cargos automáticos.

Al terminar el periodo sin folio, la Comisión muestra Pago pendiente y las hojas imprimibles mantienen SANCIONADO / Pago pendiente. Se conservan los bloqueos de bajas y cambios de equipo/inscripciones por identidad, y el pago de una sanción no modifica otras sanciones ni exclusiones globales. No se necesita cron: el estado se calcula con la fecha del servidor al consultar.

Migración 0068 aditiva: las sanciones que ya habían terminado al aplicar esta política conservan su cumplimiento histórico; las vigentes/programadas/indefinidas y nuevas requieren folio. No se reactivan sanciones históricas. La tabla existente conserva RLS y permisos privados. Las cartas se incluyen en la limpieza auditada del torneo cuando se confirma su eliminación.

Pruebas: backend aislado, permisos/alcance por sede, aceptación sin liberación, último día inclusivo, pago anticipado, vencimiento sin pago, duplicados, carta privada, estado en plantilla, limpieza de archivos; frontend SSR, tipos, compilación, escritorio y anchos 320/390.
