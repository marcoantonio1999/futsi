import pytest
from unittest.mock import patch
from django.utils import timezone
from core.models import AuditLog, WhatsAppConversation, WhatsAppMessage
from core.tests.factories import make_site, make_user

pytestmark = [pytest.mark.api, pytest.mark.django_db]

@pytest.fixture
def review_chat(settings):
    settings.META_WHATSAPP_DISPLAY_NUMBER = "+14155238886"
    site = make_site()
    conversation = WhatsAppConversation.objects.create(
        site=site, contact_phone="+525500000099", from_address="whatsapp:+525500000099",
        to_address="whatsapp:+14155238886", status="active", current_step="faq",
        context={"automation_paused_by_human": True, "kind": "faq"},
        follow_up_required=True, follow_up_notes="Confirmar asistencia mañana", last_message_at=timezone.now(),
    )
    message = WhatsAppMessage.objects.create(conversation=conversation, provider_sid="review-original", direction="inbound", body="Gracias")
    return conversation, message

def test_resolve_attention_is_audited_without_sending_or_changing_followup(auth_client, review_chat):
    conversation, message = review_chat
    client, _, user = auth_client(user=make_user(role="site_coordinator", primary_site=conversation.site))
    with patch("core.api.trials.send_text_for_channel") as sender:
        response = client.post(f"/api/whatsapp-conversations/{conversation.pk}/resolve-attention/", {"last_message_id": message.pk}, format="json")
    assert response.status_code == 200
    assert response.json()["attention_resolution"]["message_id"] == message.pk
    sender.assert_not_called()
    conversation.refresh_from_db()
    assert conversation.context["automation_paused_by_human"] is True
    assert conversation.context["attention_resolution"]["resolved_by_user_id"] == user.pk
    assert conversation.follow_up_required is True
    assert conversation.follow_up_notes == "Confirmar asistencia mañana"
    assert conversation.messages.count() == 1
    assert AuditLog.objects.filter(action="whatsapp_attention_resolved", record_id=str(conversation.pk), actor=user).count() == 1
    # The resolution remains tied to the reviewed message, never to future replies.
    WhatsAppMessage.objects.create(conversation=conversation, provider_sid="review-next", direction="inbound", body="Otra duda")
    refreshed = client.get(f"/api/whatsapp-conversations/{conversation.pk}/")
    assert refreshed.json()["attention_resolution"]["message_id"] == message.pk
    assert refreshed.json()["messages"][-1]["id"] != message.pk

def test_resolve_attention_rejects_stale_view(auth_client, review_chat):
    conversation, message = review_chat
    WhatsAppMessage.objects.create(conversation=conversation, provider_sid="review-newer", direction="inbound", body="Una duda más")
    client, _, _ = auth_client(user=make_user(role="admin"))
    response = client.post(f"/api/whatsapp-conversations/{conversation.pk}/resolve-attention/", {"last_message_id": message.pk}, format="json")
    assert response.status_code == 409
    conversation.refresh_from_db()
    assert "attention_resolution" not in conversation.context

@pytest.mark.parametrize("value", [None, "1", True, -1])
def test_resolve_attention_validates_message_reference(auth_client, review_chat, value):
    conversation, _ = review_chat
    client, _, _ = auth_client(user=make_user(role="admin"))
    response = client.post(f"/api/whatsapp-conversations/{conversation.pk}/resolve-attention/", {"last_message_id": value}, format="json")
    assert response.status_code == 400

def test_resolve_attention_respects_site_scope(auth_client, review_chat):
    conversation, message = review_chat
    client, _, _ = auth_client(user=make_user(role="site_coordinator", primary_site=make_site()))
    response = client.post(f"/api/whatsapp-conversations/{conversation.pk}/resolve-attention/", {"last_message_id": message.pk}, format="json")
    assert response.status_code == 404


@pytest.mark.parametrize("body", ["[reaction]", "[revoke]"])
def test_reaction_or_revocation_does_not_invalidate_reviewed_message(auth_client, review_chat, body):
    conversation, message = review_chat
    WhatsAppMessage.objects.create(conversation=conversation, provider_sid="review-reaction", direction="inbound", body=body)
    client, _, _ = auth_client(user=make_user(role="admin"))
    response = client.post(f"/api/whatsapp-conversations/{conversation.pk}/resolve-attention/", {"last_message_id": message.pk}, format="json")
    assert response.status_code == 200
