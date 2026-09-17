from django.db import migrations, models


FRANCO_SITE_ID = 27
FRANCO_CHANNELS = {
    "meta:105039749242267": "Franco Academia",
    "meta:1187630384444567": "Liga Franco",
}


def link_franco_channels(apps, schema_editor):
    Site = apps.get_model("core", "Site")
    WhatsAppConversation = apps.get_model("core", "WhatsAppConversation")
    WhatsAppAutomationSettings = apps.get_model("core", "WhatsAppAutomationSettings")
    AuditLog = apps.get_model("core", "AuditLog")

    site = Site.objects.filter(pk=FRANCO_SITE_ID, name="Colegio Franco").first()
    if site is None:
        return

    migrated = {}
    for business_address, label in FRANCO_CHANNELS.items():
        profile, _created = WhatsAppAutomationSettings.objects.get_or_create(
            business_address=business_address,
            defaults={"site_id": site.pk, "channel_label": label},
        )
        changed_fields = []
        if profile.site_id != site.pk:
            profile.site_id = site.pk
            changed_fields.append("site_id")
        if profile.channel_label != label:
            profile.channel_label = label
            changed_fields.append("channel_label")
        if changed_fields:
            profile.save(update_fields=[*changed_fields, "updated_at"])
        migrated[label] = WhatsAppConversation.objects.filter(
            to_address=business_address,
        ).update(site_id=site.pk)

    AuditLog.objects.create(
        actor_id=None,
        action="whatsapp_channels_linked_to_site",
        table_name="whatsapp_automation_settings",
        record_id=str(site.pk),
        previous_values={"site_id": None},
        new_values={"site_id": site.pk, "site_name": site.name},
        metadata={"channels": FRANCO_CHANNELS, "migrated_conversations": migrated},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0053_channel_documents"),
        ("core", "0054_migrate_power_soccer_to_uvm_bosques"),
    ]
    operations = [
        migrations.AddField(
            model_name="whatsappautomationsettings",
            name="channel_label",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.RunPython(link_franco_channels, migrations.RunPython.noop),
    ]
