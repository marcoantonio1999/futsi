# Reacciones del equipo como respuesta humana

Una reacción saliente de `human_whatsapp` o `human_dashboard` cuenta de inmediato
como respuesta humana. El historial semanal y las alertas usan el primer mensaje
humano real posterior a la solicitud, incluida esa reacción; las reacciones
entrantes y los mensajes revocados no responden por el equipo.

La reconstrucción de conversaciones manuales corrige también registros anteriores.
Los eventos persistidos se ajustan sólo en el modelo de lectura: no se cambian
mensajes, fechas originales ni filas de auditoría. Una consulta posterior comienza
otro turno. Los grupos siguen excluidos de las estadísticas individuales.

La IA programada puede retirar un acuse únicamente mediante la política
`human_reaction_v1`, estado `pending`, confianza >= 0.9 y una lista explícita de
`insufficient_reaction_ids` de ese chat con evidencias íntegras. El reporte ignora
ese acuse para buscar una respuesta posterior o presentar la solicitud pendiente,
sin borrar el hecho histórico de que existió una reacción. Evidencia antigua,
ambigua o editada no elimina el acuse provisional. Abrir pantallas no llama a IA.
