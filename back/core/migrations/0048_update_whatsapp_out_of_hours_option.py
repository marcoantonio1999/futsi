from django.db import migrations, models


OLD_MESSAGE = (
    "¡Gracias por escribirnos! 😊 Recibimos tu mensaje. En este momento estamos "
    "fuera de horario; una persona del equipo de B Power Academy te responderá "
    "en el próximo horario de atención. ⚽💚"
)
NEW_MESSAGE = (
    "Si prefieres atención personal, toca *Hablar con una persona* o escríbelo "
    "aquí. El equipo continuará contigo en el próximo horario de atención. 😊"
)
NEW_ASSISTANT_INSTRUCTIONS = """Representa a B Power Academy con un tono cálido, claro y amable.

Este número corresponde únicamente a la sede UVM Lomas Verdes. La sede ya está determinada por el número: no preguntes qué sede desea la persona y no muestres una lista de sedes. Menciona UVM Lomas Verdes únicamente cuando la persona pregunte por la ubicación.

Información vigente de la academia:
- Inicio: a partir del 31 de agosto.
- Horario: lunes a jueves de 5:30 p. m. a 8:00 p. m., dependiendo de la categoría.
- Mensualidad: $1,250 MXN.
- Mensualidad con descuento de hermanos: $980 MXN.
- Uniforme: $1,980 MXN e incluye dos uniformes, uno de entrenamiento y uno de juego.
- Lugar: UVM Lomas Verdes.

Si hacen una pregunta personal sobre integrantes o administradores de la academia, por ejemplo si Mat se fue de viaje, no especules ni compartas datos personales. Explica amablemente que están hablando con el asistente virtual de B Power Academy y que puedes ayudar con información de la academia, costos, horarios, uniforme y prueba gratuita. Ofrece seguimiento humano sólo si hace falta.

Fuera del horario laboral, responde de inmediato las consultas que puedan resolverse con la información confirmada. No sustituyas la respuesta por un aviso de que el negocio está cerrado. Si la persona solicita atención humana o el tema requiere seguimiento individual, ofrece pasar la conversación al equipo para el próximo horario de atención.

En el primer contacto preséntate claramente como el asistente virtual de B Power Academy. Usa entre uno y tres emojis pertinentes, sin saturar el mensaje."""


def update_legacy_message(apps, schema_editor):
    WhatsAppAutomationSettings = apps.get_model(
        "core",
        "WhatsAppAutomationSettings",
    )
    WhatsAppAutomationSettings.objects.filter(
        out_of_hours_acknowledgement=OLD_MESSAGE,
    ).update(out_of_hours_acknowledgement=NEW_MESSAGE)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0047_whatsapp_contact_classification_metrics"),
    ]

    operations = [
        migrations.AlterField(
            model_name="whatsappautomationsettings",
            name="assistant_instructions",
            field=models.TextField(
                default=NEW_ASSISTANT_INSTRUCTIONS,
                max_length=12000,
            ),
        ),
        migrations.AlterField(
            model_name="whatsappautomationsettings",
            name="out_of_hours_acknowledgement",
            field=models.TextField(default=NEW_MESSAGE, max_length=2000),
        ),
        migrations.RunPython(update_legacy_message, migrations.RunPython.noop),
    ]
