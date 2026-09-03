import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0038_alter_trialbooking_source_whatsappconversation_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="whatsappconversation",
            name="follow_up_assigned_to",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assigned_whatsapp_follow_ups",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="whatsappconversation",
            name="follow_up_notes",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="whatsappconversation",
            name="follow_up_required",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="whatsappconversation",
            name="follow_up_updated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="whatsappconversation",
            index=models.Index(
                fields=["follow_up_required", "follow_up_updated_at"],
                name="ix_wa_follow_up",
            ),
        ),
    ]
