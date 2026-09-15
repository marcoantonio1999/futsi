import pytest
from core.models import AuditLog, WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppMessage, WhatsAppOutboundDispatch
from core.tests.test_whatsapp_site_settings import url

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_switch_persists_per_number_and_cancels_pending_without_erasing_human_control(auth_client):
    client, _, _ = auth_client()
    record = WhatsAppAutomationSettings.objects.create(business_address="whatsapp:+525500000101")
    other = WhatsAppAutomationSettings.objects.create(business_address="whatsapp:+525500000102")
    conversation = WhatsAppConversation.objects.create(contact_phone="+525511112222", from_address="whatsapp:+525511112222", to_address=record.business_address,
        context={"human_response_wait":{"messages":[]}, "automation_paused":True, "contact_name":"Prueba"})
    WhatsAppMessage.objects.create(conversation=conversation, direction="inbound", provider_sid="wamid.test", body="Hola")
    dispatch = WhatsAppOutboundDispatch.objects.create(conversation=conversation, in_reply_to_sid="wamid.test", body="Hola", delivery_kind="text", payload={})
    for enabled in (False, True, False):
        response=client.patch(url(record.business_address), {"bot_enabled":enabled}, format="json")
        assert response.status_code == 200, response.content
        assert client.get(url(record.business_address)).json()["bot_enabled"] is enabled
    conversation.refresh_from_db(); dispatch.refresh_from_db(); other.refresh_from_db()
    assert other.bot_enabled is True
    assert conversation.context == {"automation_paused":True, "contact_name":"Prueba"}
    assert conversation.messages.count() == 1
    assert dispatch.status == "failed"
    assert AuditLog.objects.filter(action="whatsapp_automation_settings_updated").count() == 3


def test_switch_requires_admin(auth_client, api_client):
    record=WhatsAppAutomationSettings.objects.create(business_address="whatsapp:+525500000101")
    coordinator, _, _ = auth_client(role="site_coordinator")
    for client in (coordinator, api_client):
        assert client.patch(url(record.business_address), {"bot_enabled":False}, format="json").status_code in (401,403)
    record.refresh_from_db()
    assert record.bot_enabled is True
