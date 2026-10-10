from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo
import pytest
from core.api.whatsapp_notifications import working_seconds
from core.models import WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent
from core.tests.factories import make_site, make_user

pytestmark = [pytest.mark.api, pytest.mark.django_db]
NOW = datetime(2026, 10, 7, 14, tzinfo=ZoneInfo("America/Mexico_City"))
URL = "/api/whatsapp-conversations/attention-notifications/"


def chat(site, address="meta:123456789", age=3):
    WhatsAppAutomationSettings.objects.get_or_create(business_address=address, defaults={"site": site})
    conversation = WhatsAppConversation.objects.create(site=site, to_address=address, contact_phone="+525500000001", from_address="whatsapp:+525500000001")
    message = WhatsAppMessage.objects.create(conversation=conversation, direction="inbound", body="Información")
    WhatsAppMessage.objects.filter(pk=message.pk).update(created_at=NOW-timedelta(hours=age))
    return conversation, message


@pytest.mark.parametrize("start,end,seconds", [("2026-10-06T21:00", "2026-10-07T09:00", 7200), ("2026-10-06T23:00", "2026-10-07T10:01", 7260), ("2026-10-07T07:00", "2026-10-07T08:00", 0)])
def test_work_window(start, end, seconds):
    zone = ZoneInfo("America/Mexico_City")
    assert working_seconds(datetime.fromisoformat(start).replace(tzinfo=zone), datetime.fromisoformat(end).replace(tzinfo=zone)) == seconds


def test_pending_first_message_not_last_followup(auth_client):
    site = make_site()
    conversation, _ = chat(site)
    followup = WhatsAppMessage.objects.create(conversation=conversation, direction="inbound", body="¿Me responden?")
    WhatsAppMessage.objects.filter(pk=followup.pk).update(created_at=NOW-timedelta(minutes=5))
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        response = client.get(URL)
    assert response.status_code == 200, response.content
    assert response.json()["items"][0]["seconds"] == 10800
    assert response.json()["items"][0]["conversation_id"] == conversation.pk


@pytest.mark.parametrize("role", ["site_coordinator", "coach"])
def test_scope_only_own_site_and_channel_override(auth_client, role):
    own, other = make_site(), make_site()
    own_chat, _ = chat(own)
    other_chat, _ = chat(other, "meta:987654321")
    # An old conversation's site must not override the explicit channel association.
    WhatsAppConversation.objects.filter(pk=other_chat.pk).update(site=own)
    client, _, _ = auth_client(user=make_user(role=role, primary_site=own))
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        response = client.get(URL)
    assert response.status_code == 200, response.content
    assert [item["conversation_id"] for item in response.json()["items"]] == [own_chat.pk]
    assert client.get(f"/api/whatsapp-conversations/{other_chat.pk}/").status_code in (403, 404)


def test_answer_and_review_clear_pending(auth_client):
    site = make_site()
    conversation, original = chat(site)
    client, _, _ = auth_client(role="admin")
    conversation.context = {"attention_resolution": {"message_id": original.pk}}
    conversation.save()
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["total"] == 0
    conversation.context = {}; conversation.save()
    reply = WhatsAppMessage.objects.create(conversation=conversation, direction="outbound", body="Hola", response_source="human_whatsapp")
    WhatsAppMessage.objects.filter(pk=reply.pk).update(created_at=NOW-timedelta(minutes=1))
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert all(a["kind"] != "pending" for a in client.get(URL).json()["items"])


def test_strict_thresholds_and_average(auth_client):
    site = make_site()
    conversation, message = chat(site, age=2)
    event = WhatsAppHumanResponseEvent.objects.create(conversation=conversation, first_inbound_message=message, first_inbound_at=NOW-timedelta(hours=3), responded_at=NOW-timedelta(hours=2), response_seconds=3600)
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["total"] == 0
    event.response_seconds=3601; event.save()
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["items"][0]["kind"] == "average"


def test_no_pending_alerts_outside_hours_and_no_site_access(auth_client):
    chat(make_site())
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW.replace(hour=22)):
        assert client.get(URL).json()["total"] == 0
    client, _, _ = auth_client(role="coach")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["total"] == 0
    client, _, _ = auth_client(role="guardian")
    assert client.get(URL).status_code == 403


@pytest.mark.parametrize("body,expected", [("Gracias ⚽", False), ("👍", False), ("[sticker]", False), ("Gracias, ¿cuánto cuesta?", True)])
def test_closing_acknowledgements_are_not_overdue(auth_client, body, expected):
    conversation, message = chat(make_site())
    previous = WhatsAppMessage.objects.create(conversation=conversation, direction="outbound", body="Información", response_source="human_whatsapp")
    WhatsAppMessage.objects.filter(pk=previous.pk).update(created_at=NOW-timedelta(hours=4))
    WhatsAppMessage.objects.filter(pk=message.pk).update(body=body)
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        alerts = client.get(URL).json()["items"]
    assert any(a["kind"] == "pending" for a in alerts) is expected


def test_recorded_human_reply_prevents_false_alert_before_echo(auth_client):
    conversation, _ = chat(make_site())
    conversation.context={"human_last_reply_at": (NOW-timedelta(minutes=30)).isoformat()}
    conversation.save()
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["total"] == 0


def test_bot_acknowledgement_does_not_close_human_requested_chat(auth_client):
    conversation, message = chat(make_site())
    WhatsAppMessage.objects.filter(pk=message.pk).update(routing_decision="human_only")
    bot = WhatsAppMessage.objects.create(conversation=conversation, direction="outbound", body="Un asesor te atenderá", response_source="bot")
    WhatsAppMessage.objects.filter(pk=bot.pk).update(created_at=NOW-timedelta(hours=2))
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["items"][0]["kind"] == "pending"


@pytest.mark.parametrize("age,expected", [(167, True), (168, True), (169, False), (300, False)])
def test_pending_only_last_seven_days(auth_client, age, expected):
    conversation, _ = chat(make_site(), age=age)
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        data = client.get(URL).json()
    assert any(a.get("conversation_id") == conversation.pk for a in data["items"]) is expected
    assert data["window_days"] == 7


@pytest.mark.parametrize("human_required", [False, True])
def test_recent_followup_does_not_reopen_old_backlog(auth_client, human_required):
    conversation, message = chat(make_site(), age=300)
    if human_required:
        WhatsAppMessage.objects.filter(pk=message.pk).update(routing_decision="human_only")
    followup = WhatsAppMessage.objects.create(conversation=conversation, direction="inbound", body="¿Me pueden responder?", routing_decision="human_only" if human_required else "")
    WhatsAppMessage.objects.filter(pk=followup.pk).update(created_at=NOW-timedelta(hours=3))
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["total"] == 0


def test_average_uses_rolling_seven_days(auth_client):
    conversation, message = chat(make_site(), age=200)
    event = WhatsAppHumanResponseEvent.objects.create(conversation=conversation,
        first_inbound_message=message, first_inbound_at=NOW-timedelta(days=8),
        responded_at=NOW-timedelta(days=7), response_seconds=7200)
    client, _, _ = auth_client(role="admin")
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["total"] == 0
    # Last Thursday belongs to the rolling week although not to this Monday's week.
    event.first_inbound_at=NOW-timedelta(days=6); event.responded_at=NOW-timedelta(days=6, hours=-2); event.save()
    with patch("core.api.whatsapp_notifications.timezone.now", return_value=NOW):
        assert client.get(URL).json()["items"][0]["kind"] == "average"
