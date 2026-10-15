# Validación visible del registro público

Al intentar continuar, se muestran todos los errores del paso: borde rojo, fondo tenue y explicación junto a cada campo. Se desplaza y enfoca el primero; no se borran los datos ni los archivos de otros campos. Los controles enlazan el mensaje con aria-describedby, y fecha/nombres/teléfonos/consentimiento indican aria-invalid.

Se validan consentimiento, fecha real/no futura, documentos según edad y tipo, selfie, tres componentes del nombre, teléfono de contacto y firmas. Para menores se requieren documentos, nombre y firma del tutor. El teléfono de emergencia sigue siendo opcional. Una pulsación sin trazos no se considera firma. La validación del servidor continúa siendo la autoridad final; los errores por campo se muestran en el paso correspondiente. Errores generales de red/Storage no se atribuyen a un campo sin evidencia.

La validación es bajo demanda (no se muestran campos rojos al abrir el registro), y cada aviso se retira al corregirlo. No hay nuevas consultas periódicas ni cambios en documentos impresos.

Verificación: pruebas unitarias de fechas/nombres/archivos; formulario público aislado local con respuestas simuladas y POST bloqueado, sin guardar inscripciones reales. Se probaron consentimiento, múltiples documentos faltantes de adulto y menor, eliminación individual del error al corregir fecha/adjuntar archivo y errores simultáneos del paso final. En 320/390 px se verificó ancho de documento igual al viewport y acciones dentro del viewport; escritorio conserva el calendario personalizado con borde rojo. Emulación Chromium, no dispositivo iOS físico.
