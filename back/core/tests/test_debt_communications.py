from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from core.models import WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppMessage
from core.tests.factories import make_charge, make_discount, make_payment, make_site, make_student

pytestmark = [pytest.mark.api, pytest.mark.django_db]
URL = "/api/charges/communications/"


@pytest.mark.parametrize("days,stage", [(-1, 0), (0, 0), (6, 0), (7, 7), (13, 7), (14, 14), (20, 14), (21, 21), (35, 21)])
def test_weekly_milestones_use_real_due_date_without_sending(auth_client, days, stage):
    client, _, _ = auth_client()
    charge = make_charge(due_date=timezone.localdate() - timedelta(days=days))
    with patch("core.api.billing.send_charge_payment_reminder") as send:
        result = client.get(URL).json()
    send.assert_not_called()
    assert result["automatic_sending_enabled"] is False
    row = result["rows"][0]
    assert row["stage"] == stage
    assert row["overdue_days"] == max(0, days)
    assert row["history"] == []
    assert row["milestones"][2]["date"] == (charge.due_date + timedelta(days=21)).isoformat()
    if stage == 21:
        assert "confirmar la baja" in row["blocker"]
    charge.student.refresh_from_db()
    assert charge.student.status != "dropped"


def test_billing_balance_and_pending_payments_are_authoritative(auth_client):
    client, _, _ = auth_client()
    paid = make_charge(amount=Decimal("100"))
    make_payment(charge=paid, amount=Decimal("100"))
    partial = make_charge(amount=Decimal("100"), due_date=timezone.localdate() - timedelta(days=14))
    make_payment(charge=partial, amount=Decimal("30"))
    make_discount(charge=partial, amount=Decimal("20"), status="approved")
    make_payment(charge=partial, amount=Decimal("50"), status="awaiting_confirmation")
    make_charge(status="canceled")
    missing = make_charge(due_date=None)
    rows = {row["id"]: row for row in client.get(URL).json()["rows"]}
    assert paid.pk not in rows
    assert Decimal(rows[partial.pk]["balance"]) == Decimal("50")
    assert "pago o descuento pendiente" in rows[partial.pk]["blocker"]
    assert rows[missing.pk]["overdue_days"] is None
    assert rows[missing.pk]["stage"] == 0
    make_payment(charge=partial, amount=Decimal("50"))
    assert partial.pk not in {row["id"] for row in client.get(URL).json()["rows"]}


def test_site_channel_and_role_scoping(auth_client, api_client):
    north, south = make_site(), make_site()
    a = make_charge(site=north, student=make_student(site=north))
    b = make_charge(site=south, student=make_student(site=south))
    address = "whatsapp:+525500000101"
    WhatsAppAutomationSettings.objects.create(business_address=address, site=north)
    client, _, _ = auth_client()
    assert {row["id"] for row in client.get(URL).json()["rows"]} == {a.pk, b.pk}
    assert [row["id"] for row in client.get(URL, {"business_address": address}).json()["rows"]] == [a.pk]
    assert client.get(URL, {"site": south.pk, "business_address": address}).json()["rows"] == []
    assert client.get(URL, {"site": "unassigned"}).json()["rows"] == []
    assert client.get(URL, {"business_address": "whatsapp:+525599999999"}).json()["rows"] == []
    assert client.get(URL, {"site": "bad"}).status_code == 400
    coordinator, _, _ = auth_client(role="site_coordinator", primary_site=north)
    assert [row["id"] for row in coordinator.get(URL).json()["rows"]] == [a.pk]
    assert coordinator.get(URL, {"site": south.pk}).json()["rows"] == []
    no_site, _, _ = auth_client(role="site_coordinator")
    assert no_site.get(URL).json()["rows"] == []
    guardian, _, _ = auth_client(role="guardian")
    assert guardian.get(URL).status_code == 403
    assert api_client.get(URL).status_code in (401, 403)


def test_history_is_real_and_is_not_assigned_to_an_unsent_stage(auth_client):
    client, _, _ = auth_client()
    charge = make_charge(due_date=timezone.localdate() - timedelta(days=21))
    chat = WhatsAppConversation.objects.create(site=charge.site, contact_phone="+525511110000",
        from_address="whatsapp:+525511110000", to_address="whatsapp:+525500000101",
        context={"kind": "payment_reminder", "charge_id": charge.pk})
    message = WhatsAppMessage.objects.create(conversation=chat, direction="outbound", body="Recordatorio", provider_sid="test-collection")
    WhatsAppMessage.objects.create(conversation=chat, direction="inbound", body="Ya pagué")
    row = client.get(URL).json()["rows"][0]
    assert len(row["history"]) == 1
    assert row["history"][0]["message_id"] == message.pk
    assert "entrega no verificada" in row["history"][0]["label"]
    assert row["student_dropped"] is False
    charge.student.status = "dropped"
    charge.student.save(update_fields=["status"])
    assert "Baja registrada" in client.get(URL).json()["rows"][0]["blocker"]
