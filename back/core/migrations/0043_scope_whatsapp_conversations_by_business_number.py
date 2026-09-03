from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0042_alter_whatsappconversation_current_step"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="whatsappconversation",
            name="uq_whatsapp_active_contact",
        ),
        migrations.AddConstraint(
            model_name="whatsappconversation",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "active")),
                fields=("contact_phone", "to_address"),
                name="uq_whatsapp_active_contact_target",
            ),
        ),
        migrations.AddIndex(
            model_name="whatsappconversation",
            index=models.Index(
                fields=["to_address", "status", "last_message_at"],
                name="ix_wa_target_status_msg",
            ),
        ),
    ]
