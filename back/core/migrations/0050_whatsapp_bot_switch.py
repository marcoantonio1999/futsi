from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0049_whatsapp_site_model_configuration")]
    operations = [
        migrations.AddField(
            model_name="whatsappautomationsettings",
            name="bot_enabled",
            field=models.BooleanField(default=True, db_default=True),
        ),
    ]
