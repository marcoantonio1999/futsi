from importlib import import_module

import pytest
from django.apps import apps

from core.models import (
    AuditLog,
    Court,
    Site,
    TrialAvailabilityRule,
    TrialBooking,
    TrialVisit,
    WhatsAppAutomationSettings,
    WhatsAppConversation,
)


pytestmark = pytest.mark.django_db
migration = import_module("core.migrations.0054_migrate_power_soccer_to_uvm_bosques")


def test_migrates_uvm_channel_history_and_removes_company_as_site():
    source = Site.objects.create(
        id=40,
        name="Power Soccer Academy",
        code="cuajimalpa",
        address="Antiguo Camino a Tecamachalco 686",
        latitude="19.382462",
        longitude="-99.278086",
    )
    target = Site.objects.create(
        id=41,
        name="UVM",
        code="Bosques",
        address="Club Tecamachalco",
    )
    court = Court.objects.create(site=source, name="Cancha principal")
    booking = TrialBooking.objects.create(
        site=source,
        responsible_name="Tutor",
        responsible_phone="+525500000001",
        child_first_name="Alumno",
    )
    visit = TrialVisit.objects.create(
        booking=booking,
        site=source,
        court=court,
        visit_number=1,
        starts_at="2026-09-20T17:00:00Z",
        ends_at="2026-09-20T18:00:00Z",
    )
    rule = TrialAvailabilityRule.objects.create(
        site=source,
        court=court,
        weekday=0,
        starts_at="17:00",
        ends_at="19:00",
        slot_minutes=60,
    )
    conversation = WhatsAppConversation.objects.create(
        contact_phone="+525500000001",
        from_address="whatsapp:+525500000001",
        to_address=migration.UVM_BUSINESS_ADDRESS,
        site=source,
    )
    unassigned = WhatsAppConversation.objects.create(
        contact_phone="+525500000002",
        from_address="whatsapp:+525500000002",
        to_address=migration.UVM_BUSINESS_ADDRESS,
        site=None,
    )
    settings = WhatsAppAutomationSettings.objects.create(
        business_address=migration.UVM_BUSINESS_ADDRESS,
        site=None,
    )

    migration.migrate_power_soccer_to_uvm_bosques(apps, None)

    assert not Site.objects.filter(pk=source.pk).exists()
    target.refresh_from_db()
    assert target.address == "Club Tecamachalco, Antiguo Camino a Tecamachalco 686"
    assert str(target.latitude) == "19.382462"
    assert str(target.longitude) == "-99.278086"
    for row in (court, booking, visit, rule, conversation):
        row.refresh_from_db()
        assert row.site_id == target.pk
    unassigned.refresh_from_db()
    assert unassigned.site_id is None
    settings.refresh_from_db()
    assert settings.site_id == target.pk
    audit = AuditLog.objects.get(action="site_data_migrated", record_id=str(target.pk))
    assert audit.metadata["migrated_counts"] == {
        "courts": 1,
        "trial_bookings": 1,
        "trial_visits": 1,
        "trial_availability_rules": 1,
        "whatsapp_conversations": 1,
        "whatsapp_settings": 1,
    }
