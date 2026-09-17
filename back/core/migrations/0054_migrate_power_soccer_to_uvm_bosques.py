from django.db import migrations


SOURCE_SITE_ID = 40
TARGET_SITE_ID = 41
UVM_BUSINESS_ADDRESS = "whatsapp:+525574858165"


def migrate_power_soccer_to_uvm_bosques(apps, schema_editor):
    Site = apps.get_model("core", "Site")
    source = Site.objects.filter(
        pk=SOURCE_SITE_ID,
        name="Power Soccer Academy",
        code="cuajimalpa",
    ).first()
    target = Site.objects.filter(
        pk=TARGET_SITE_ID,
        name="UVM",
        code__iexact="Bosques",
    ).first()
    if source is None or target is None:
        return

    Court = apps.get_model("core", "Court")
    TrialBooking = apps.get_model("core", "TrialBooking")
    TrialVisit = apps.get_model("core", "TrialVisit")
    TrialAvailabilityRule = apps.get_model("core", "TrialAvailabilityRule")
    WhatsAppConversation = apps.get_model("core", "WhatsAppConversation")
    WhatsAppAutomationSettings = apps.get_model("core", "WhatsAppAutomationSettings")
    AuditLog = apps.get_model("core", "AuditLog")

    counts = {
        "courts": Court.objects.filter(site_id=source.pk).update(site_id=target.pk),
        "trial_bookings": TrialBooking.objects.filter(site_id=source.pk).update(site_id=target.pk),
        "trial_visits": TrialVisit.objects.filter(site_id=source.pk).update(site_id=target.pk),
        "trial_availability_rules": TrialAvailabilityRule.objects.filter(site_id=source.pk).update(site_id=target.pk),
        "whatsapp_conversations": WhatsAppConversation.objects.filter(site_id=source.pk).update(site_id=target.pk),
        "whatsapp_settings": WhatsAppAutomationSettings.objects.filter(
            business_address=UVM_BUSINESS_ADDRESS,
        ).update(site_id=target.pk),
    }

    changed_fields = []
    if source.latitude is not None and target.latitude is None:
        target.latitude = source.latitude
        changed_fields.append("latitude")
    if source.longitude is not None and target.longitude is None:
        target.longitude = source.longitude
        changed_fields.append("longitude")
    if source.address and target.address.strip().casefold() == "club tecamachalco":
        target.address = f"Club Tecamachalco, {source.address}"
        changed_fields.append("address")
    if changed_fields:
        target.save(update_fields=[*changed_fields, "updated_at"])

    AuditLog.objects.create(
        actor_id=None,
        action="site_data_migrated",
        table_name="sites",
        record_id=str(target.pk),
        previous_values={
            "site_id": source.pk,
            "name": source.name,
            "code": source.code,
        },
        new_values={
            "site_id": target.pk,
            "name": target.name,
            "code": target.code,
            "address": target.address,
        },
        metadata={
            "reason": "Power Soccer Academy is the company name; the operating site is UVM Bosques at Club Tecamachalco.",
            "business_address": UVM_BUSINESS_ADDRESS,
            "migrated_counts": counts,
        },
    )
    source.delete()


class Migration(migrations.Migration):
    dependencies = [("core", "0051_retained_guardian_debts")]
    operations = [
        migrations.RunPython(
            migrate_power_soccer_to_uvm_bosques,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
