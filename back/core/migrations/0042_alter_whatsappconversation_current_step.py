from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0041_alter_whatsappconversation_current_step"),
    ]

    operations = [
        migrations.AlterField(
            model_name="whatsappconversation",
            name="current_step",
            field=models.CharField(
                choices=[
                    ("menu", "Menú principal"),
                    ("faq", "Preguntas y respuestas"),
                    ("choose_site", "Elegir sede"),
                    ("responsible_name", "Nombre del responsable"),
                    ("child_name", "Nombre del alumno"),
                    ("contact_phone", "Teléfono de contacto"),
                    ("child_age", "Edad del alumno"),
                    ("choose_first_visit", "Elegir primera visita"),
                    ("choose_second_visit", "Elegir segunda visita"),
                    ("confirm", "Confirmar"),
                    ("finished", "Finalizada"),
                ],
                default="choose_site",
                max_length=32,
            ),
        ),
    ]
