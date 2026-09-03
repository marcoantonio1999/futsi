from datetime import time, timedelta
from unittest.mock import patch
from xml.etree import ElementTree

import pytest
from django.test import override_settings
from django.utils import timezone
from twilio.request_validator import RequestValidator

from core.models import (
    AuditLog,
    Court,
    TrialAvailabilityRule,
    TrialBooking,
    WhatsAppConversation,
    WhatsAppMessage,
)
from core.tests.factories import make_site, make_user
from core.voice.scheduling import list_trial_availability


pytestmark = [pytest.mark.api, pytest.mark.django_db]

ACCOUNT_SID = "AC" + ("1" * 32)
AUTH_TOKEN = "qa-twilio-whatsapp-token"
WHATSAPP_NUMBER = "+14155238886"
PUBLIC_BASE_URL = "https://whatsapp.example.test"
WEBHOOK_PATH = "/api/whatsapp/twilio/incoming/"


def _payload(
    *,
    sequence: int,
    body: str,
    from_number: str = "+525500000001",
    **extra,
):
    payload = {
        "AccountSid": ACCOUNT_SID,
        "MessageSid": f"SM{sequence:032x}",
        "From": f"whatsapp:{from_number}",
        "To": f"whatsapp:{WHATSAPP_NUMBER}",
        "Body": body,
        "NumMedia": "0",
    }
    payload.update(extra)
    return payload


@pytest.fixture(autouse=True)
def disable_interactive_messages(settings):
    settings.TWILIO_WHATSAPP_INTERACTIVE = False


def _signed_post(client, payload, *, signature=None):
    if signature is None:
        signature = RequestValidator(AUTH_TOKEN).compute_signature(
            f"{PUBLIC_BASE_URL}{WEBHOOK_PATH}",
            payload,
        )
    return client.post(
        WEBHOOK_PATH,
        payload,
        HTTP_X_TWILIO_SIGNATURE=signature,
    )


def _reply_text(response) -> str:
    root = ElementTree.fromstring(response.content)
    message = root.find(".//Message")
    return message.text if message is not None and message.text else ""


def _make_weekly_availability():
    site = make_site()
    court = Court.objects.create(site=site, name="Cancha WhatsApp")
    first_day = timezone.localdate() + timedelta(days=2)
    TrialAvailabilityRule.objects.create(
        site=site,
        court=court,
        weekday=first_day.weekday(),
        starts_at=time(17, 0),
        ends_at=time(19, 0),
        slot_minutes=60,
        capacity=1,
    )
    return site


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER=WHATSAPP_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=30,
    TRIAL_MIN_DAYS_BETWEEN_VISITS=1,
    TRIAL_MAX_DAYS_BETWEEN_VISITS=21,
)
def test_whatsapp_requires_twilio_signature_and_replays_duplicate(api_client):
    _make_weekly_availability()
    payload = _payload(sequence=1, body="Hola")

    rejected = _signed_post(api_client, payload, signature="invalid")
    assert rejected.status_code == 403
    assert not WhatsAppConversation.objects.exists()

    first = _signed_post(api_client, payload)
    repeated = _signed_post(api_client, payload)

    assert first.status_code == 200
    assert _reply_text(first) == _reply_text(repeated)
    assert "Elige una sede" in _reply_text(first)
    assert WhatsAppConversation.objects.count() == 1
    assert WhatsAppMessage.objects.count() == 2


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER=WHATSAPP_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=3,
    TRIAL_MIN_DAYS_BETWEEN_VISITS=1,
    TRIAL_MAX_DAYS_BETWEEN_VISITS=21,
)
def test_whatsapp_hides_site_without_two_compatible_visits(api_client):
    site = _make_weekly_availability()

    response = _signed_post(api_client, _payload(sequence=10, body="Hola"))

    assert response.status_code == 200
    assert "no hay horarios" in _reply_text(response).lower()
    assert site.name not in _reply_text(response)
    conversation = WhatsAppConversation.objects.get()
    assert conversation.context["site_options"] == []


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER=WHATSAPP_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=30,
)
def test_whatsapp_sends_list_picker_and_accepts_button_payload(api_client, settings):
    site = _make_weekly_availability()
    settings.TWILIO_WHATSAPP_INTERACTIVE = True
    site_picker_sid = "SM" + ("e" * 32)
    visit_picker_sid = "SM" + ("f" * 32)

    with patch(
        "core.whatsapp.twilio_webhooks.send_list_picker",
        side_effect=[site_picker_sid, visit_picker_sid],
    ) as send_list:
        first_payload = _payload(sequence=1, body="Hola")
        first = _signed_post(api_client, first_payload)
        repeated = _signed_post(api_client, first_payload)

        assert first.status_code == 200
        assert _reply_text(first) == ""
        assert _reply_text(repeated) == ""
        assert send_list.call_count == 1
        sent_options = send_list.call_args_list[0].kwargs["options"]
        assert sent_options == [
            {
                "title": site.name,
                "description": "Sede FUTSI · prueba gratuita",
                "id": "choice:1",
            }
        ]

        choice = _signed_post(
            api_client,
            _payload(
                sequence=2,
                body=site.name,
                ButtonText=site.name,
                ButtonPayload="choice:1",
            ),
        )

    assert choice.status_code == 200
    assert _reply_text(choice) == ""
    assert send_list.call_count == 2
    assert send_list.call_args_list[1].kwargs["body"] == (
        "Elige el horario de la primera visita."
    )
    conversation = WhatsAppConversation.objects.get()
    assert conversation.site == site
    assert conversation.current_step == "choose_first_visit"
    assert WhatsAppMessage.objects.get(provider_sid=site_picker_sid).direction == "outbound"
    assert WhatsAppMessage.objects.get(provider_sid=visit_picker_sid).direction == "outbound"


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER=WHATSAPP_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=30,
)
def test_whatsapp_selects_child_age_with_range_and_exact_age(api_client, settings):
    site = _make_weekly_availability()
    settings.TWILIO_WHATSAPP_INTERACTIVE = True
    slots = list_trial_availability(site_id=site.id, limit=6)["slots"]
    conversation = WhatsAppConversation.objects.create(
        contact_phone="+525500000001",
        from_address="whatsapp:+525500000001",
        to_address=f"whatsapp:{WHATSAPP_NUMBER}",
        site=site,
        current_step="child_age",
        context={
            "responsible_name": "Andrea Pérez",
            "child_first_name": "Leo",
            "first_visit": slots[0],
            "second_visit": slots[2],
        },
        last_message_at=timezone.now(),
    )

    with (
        patch(
            "core.whatsapp.twilio_webhooks.send_age_range_buttons",
            return_value="SM" + ("a" * 32),
        ) as send_ranges,
        patch(
            "core.whatsapp.twilio_webhooks.send_list_picker",
            return_value="SM" + ("b" * 32),
        ) as send_list,
        patch(
            "core.whatsapp.twilio_webhooks.send_confirmation_buttons",
            return_value="SM" + ("c" * 32),
        ) as send_confirmation,
    ):
        prompt = _signed_post(api_client, _payload(sequence=20, body="AYUDA"))
        range_choice = _signed_post(
            api_client,
            _payload(
                sequence=21,
                body="8 a 12 años",
                ButtonText="8 a 12 años",
                ButtonPayload="age_range:8:12",
            ),
        )
        age_choice = _signed_post(
            api_client,
            _payload(
                sequence=22,
                body="9 años",
                ButtonText="9 años",
                ButtonPayload="age:9",
            ),
        )

    assert _reply_text(prompt) == ""
    assert _reply_text(range_choice) == ""
    assert _reply_text(age_choice) == ""
    send_ranges.assert_called_once()
    send_list.assert_called_once()
    age_options = send_list.call_args.kwargs["options"]
    assert [option["id"] for option in age_options] == [
        "age:8",
        "age:9",
        "age:10",
        "age:11",
        "age:12",
    ]
    conversation.refresh_from_db()
    assert conversation.context["child_age"] == 9
    assert "age_options" not in conversation.context
    assert conversation.current_step == "confirm"
    send_confirmation.assert_called_once()
    assert "Andrea Pérez" in send_confirmation.call_args.kwargs["body"]


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER=WHATSAPP_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=30,
    TRIAL_MIN_DAYS_BETWEEN_VISITS=1,
    TRIAL_MAX_DAYS_BETWEEN_VISITS=21,
)
def test_whatsapp_books_exactly_two_visits_with_predetermined_messages(api_client):
    site = _make_weekly_availability()
    messages = [
        "Hola",
        "1",
        "1",
        "1",
        "Andrea Pérez",
        "Leo",
        "9",
        "CONFIRMAR",
    ]

    replies = []
    for sequence, body in enumerate(messages, 1):
        response = _signed_post(api_client, _payload(sequence=sequence, body=body))
        assert response.status_code == 200
        replies.append(_reply_text(response))

    assert "Reserva #" in replies[-1]
    booking = TrialBooking.objects.get()
    conversation = WhatsAppConversation.objects.get()
    assert booking.source == "whatsapp"
    assert booking.site == site
    assert booking.responsible_name == "Andrea Pérez"
    assert booking.responsible_phone == "+525500000001"
    assert booking.child_first_name == "Leo"
    assert booking.child_age == 9
    assert booking.visits.count() == 2
    assert list(booking.visits.values_list("visit_number", flat=True)) == [1, 2]
    assert conversation.status == "completed"
    assert conversation.current_step == "finished"
    assert conversation.booking == booking
    assert conversation.messages.count() == len(messages) * 2

    next_message = _signed_post(api_client, _payload(sequence=99, body="Hola"))
    assert next_message.status_code == 200
    assert WhatsAppConversation.objects.count() == 2


def test_whatsapp_conversations_are_site_scoped_in_dashboard(auth_client):
    first_site = make_site()
    second_site = make_site()
    coordinator = make_user(role="site_coordinator", primary_site=first_site)
    visible = WhatsAppConversation.objects.create(
        contact_phone="+525500000011",
        from_address="whatsapp:+525500000011",
        to_address=f"whatsapp:{WHATSAPP_NUMBER}",
        site=first_site,
        status="completed",
        current_step="finished",
        last_message_at=timezone.now(),
    )
    hidden = WhatsAppConversation.objects.create(
        contact_phone="+525500000012",
        from_address="whatsapp:+525500000012",
        to_address=f"whatsapp:{WHATSAPP_NUMBER}",
        site=second_site,
        status="completed",
        current_step="finished",
        last_message_at=timezone.now(),
    )
    WhatsAppMessage.objects.create(
        conversation=visible,
        direction="inbound",
        body="Quiero una prueba.",
    )

    client, _payload_data, _user = auth_client(user=coordinator)
    response = client.get("/api/whatsapp-conversations/")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [visible.id]
    assert response.json()[0]["messages"][0]["body"] == "Quiero una prueba."
    assert hidden.id not in {item["id"] for item in response.json()}
    assert "context" not in response.json()[0]

    update = client.patch(
        f"/api/whatsapp-conversations/{visible.id}/",
        {
            "follow_up_required": True,
            "follow_up_assigned_to": coordinator.id,
            "follow_up_notes": "Llamar mañana para confirmar la segunda visita.",
            "status": "failed",
        },
        format="json",
    )

    assert update.status_code == 200
    assert update.json()["follow_up_required"] is True
    assert update.json()["follow_up_assigned_to"] == coordinator.id
    assert update.json()["follow_up_assigned_to_name"] == (
        coordinator.get_full_name() or coordinator.username
    )
    assert update.json()["follow_up_notes"] == (
        "Llamar mañana para confirmar la segunda visita."
    )
    assert update.json()["follow_up_updated_at"]
    visible.refresh_from_db()
    assert visible.status == "completed"
    assert AuditLog.objects.filter(
        action="whatsapp_follow_up_updated",
        record_id=str(visible.id),
        actor=coordinator,
    ).exists()

    forbidden = client.patch(
        f"/api/whatsapp-conversations/{hidden.id}/",
        {"follow_up_required": True},
        format="json",
    )
    assert forbidden.status_code == 404

    assignees = client.get("/api/whatsapp-conversations/assignees/")
    assert assignees.status_code == 200
    assert [item["id"] for item in assignees.json()] == [coordinator.id]

    delete = client.delete(f"/api/whatsapp-conversations/{visible.id}/")
    assert delete.status_code == 405


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN="a" * 32,
    TWILIO_WHATSAPP_NUMBER=WHATSAPP_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
)
def test_whatsapp_health_checks_configuration_and_availability(api_client):
    _make_weekly_availability()

    response = api_client.get("/health/whatsapp/")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "configured": True,
        "secure_transport": True,
        "signature_validation": True,
        "database": True,
        "active_availability_rules": 1,
        "webhook_path": "/api/whatsapp/twilio/incoming/",
    }
    assert "a" * 32 not in response.content.decode()
