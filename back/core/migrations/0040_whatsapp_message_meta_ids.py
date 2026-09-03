from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [("core", "0037_whatsapp_message_meta_ids")]

    dependencies = [
        ("core", "0039_whatsapp_follow_up"),
    ]

    operations = [
        migrations.AlterField(
            model_name="whatsappmessage",
            name="provider_sid",
            field=models.CharField(blank=True, max_length=255, null=True, unique=True),
        ),
        migrations.AlterField(
            model_name="whatsappmessage",
            name="in_reply_to_sid",
            field=models.CharField(blank=True, max_length=255, null=True, unique=True),
        ),
    ]
