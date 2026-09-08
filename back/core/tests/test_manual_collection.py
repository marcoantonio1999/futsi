from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from core.models import WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppMessage
from core.tests.factories import make_charge, make_site, make_payment
from core.whatsapp.meta_api import MetaWhatsAppError

pytestmark = [pytest.mark.api, pytest.mark.django_db]
ADDRESS = "whatsapp:+525500000101"
TEMPLATE = {"name": "recordatorio", "language": "es_MX", "status": "APPROVED", "components": [
    {"type": "BODY", "format": "", "text": "Hola {{1}}. Saldo {{2}}.", "buttons": []}]}


@pytest.fixture
def setup_send(auth_client):
    client, _, user = auth_client()
    charge = make_charge(due_date=timezone.localdate() - timedelta(days=14))
    WhatsAppAutomationSettings.objects.create(site=charge.site, business_address=ADDRESS)
    request = {"action": "preview", "business_address": ADDRESS, "stage": 7,
               "template_name": "recordatorio", "language": "es_MX", "values": {"body.1": "Responsable", "body.2": "1250"}}
    with patch("core.api.manual_collection.catalog_for_channel", return_value={"templates": [TEMPLATE], "next_cursor": ""}), \
         patch("core.api.manual_collection.send_template_payload", return_value="test-manual-id") as sender:
        yield client, user, charge, f"/api/charges/{charge.pk}/manual-whatsapp/", request, sender


def test_preview_does_not_send_then_confirm_and_block_duplicate(setup_send):
    client, user, charge, url, data, sender = setup_send
    preview = client.post(url, data, format="json")
    assert preview.status_code == 200, preview.content
    assert preview.json()["body"] == "Hola Responsable. Saldo 1250."
    sender.assert_not_called()
    assert not WhatsAppConversation.objects.exists()
    confirm = {"action": "send", "confirmation": preview.json()["confirmation"]}
    assert client.post(url, confirm, format="json").status_code == 200
    sender.assert_called_once()
    assert sender.call_args.args[0] == ADDRESS
    message = WhatsAppMessage.objects.get()
    assert message.sent_by == user
    assert message.body == "Hola Responsable. Saldo 1250."
    assert client.post(url, confirm, format="json").status_code == 400
    sender.assert_called_once()
    row = client.get("/api/charges/communications/").json()["rows"][0]
    assert row["attempts"][0]["state"] == "accepted"
    assert row["history"][0]["body"] == message.body


@pytest.mark.parametrize("change", ["paid", "pending", "too_soon", "not_dropped", "other_site", "missing_value", "bad_stage"])
def test_invalid_reminders_never_send(setup_send, change):
    client, _, charge, url, data, sender = setup_send
    if change == "paid":
        charge.status = "paid"; charge.save()
    if change == "pending":
        make_payment(charge=charge, status="awaiting_confirmation")
    if change == "too_soon":
        charge.due_date = timezone.localdate(); charge.save()
    if change == "not_dropped":
        charge.due_date = timezone.localdate() - timedelta(days=21); charge.save(); data["stage"] = 21
    if change == "other_site":
        WhatsAppAutomationSettings.objects.update(site=make_site())
    if change == "missing_value":
        data["values"] = {}
    if change == "bad_stage":
        data["stage"] = []
    assert client.post(url, data, format="json").status_code == 400
    sender.assert_not_called()


def test_changed_balance_tampered_preview_and_revoked_approval(setup_send):
    client, _, charge, url, data, sender = setup_send
    confirmation = client.post(url, data, format="json").json()["confirmation"]
    assert client.post(url, {"action": "send", "confirmation": "invalid"}, format="json").status_code == 400
    with patch("core.api.manual_collection.catalog_for_channel", return_value={"templates": [{**TEMPLATE, "status": "PAUSED"}]}):
        assert client.post(url, {"action": "send", "confirmation": confirmation}, format="json").status_code == 400
    charge.amount += 10; charge.save()
    assert client.post(url, {"action": "send", "confirmation": confirmation}, format="json").status_code == 400
    sender.assert_not_called()


def test_uncertain_network_result_cannot_be_retried(setup_send):
    client, _, _, url, data, sender = setup_send
    confirmation = client.post(url, data, format="json").json()["confirmation"]
    sender.side_effect = MetaWhatsAppError("Resultado incierto", delivery_uncertain=True)
    assert client.post(url, {"action": "send", "confirmation": confirmation}, format="json").status_code == 503
    assert WhatsAppConversation.objects.get().context["send_state"] == "uncertain"
    assert client.post(url, {"action": "send", "confirmation": confirmation}, format="json").status_code == 400
    sender.assert_called_once()


def test_roles_and_confirmation_owner(setup_send, auth_client, api_client):
    client, _, charge, url, data, sender = setup_send
    confirmation = client.post(url, data, format="json").json()["confirmation"]
    other, _, _ = auth_client()
    assert other.post(url, {"action": "send", "confirmation": confirmation}, format="json").status_code == 400
    coordinator, _, _ = auth_client(role="site_coordinator", primary_site=make_site())
    assert coordinator.post(url, data, format="json").status_code == 404
    guardian, _, _ = auth_client(role="guardian")
    assert guardian.post(url, data, format="json").status_code == 403
    assert api_client.post(url, data, format="json").status_code in (401, 403)
    sender.assert_not_called()


def test_baja_only_after_recorded_and_stage14_independent(setup_send):
    client, _, charge, url, data, sender = setup_send
    charge.student.status = "dropped"; charge.student.save()
    charge.due_date = timezone.localdate() - timedelta(days=21); charge.save()
    data["stage"] = 21
    preview = client.post(url, data, format="json")
    assert preview.status_code == 200
    assert client.post(url, {"action": "send", "confirmation": preview.json()["confirmation"]}, format="json").status_code == 200
    data["stage"] = 14
    assert client.post(url, data, format="json").status_code == 200


def test_rejected_or_media_template_is_not_allowed(setup_send):
    client, _, _, url, data, sender = setup_send
    with patch("core.api.manual_collection.catalog_for_channel", return_value={"templates": [{**TEMPLATE, "components": [{"type": "HEADER", "format": "DOCUMENT"}]}]}):
        assert client.post(url, data, format="json").status_code == 400
    sender.assert_not_called()
