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
    WhatsAppAutomationSettings,
    WhatsAppConversation,
    WhatsAppHumanResponseEvent,
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
    settings.META_WHATSAPP_DISPLAY_NUMBER = WHATSAPP_NUMBER


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
    TRIAL_BOOKING_HORIZON_DAYS=30,
)
def test_twilio_webhook_does_not_reuse_another_business_number(api_client):
    _make_weekly_availability()
    previous = WhatsAppConversation.objects.create(
        contact_phone="+525500000001",
        from_address="whatsapp:+525500000001",
        to_address="whatsapp:+15556677180",
        status="active",
        current_step="faq",
        context={"kind": "faq"},
        last_message_at=timezone.now(),
    )

    response = _signed_post(api_client, _payload(sequence=2, body="Hola"))

    assert response.status_code == 200
    assert WhatsAppConversation.objects.filter(
        contact_phone="+525500000001",
        status="active",
    ).count() == 2
    current = WhatsAppConversation.objects.exclude(pk=previous.pk).get()
    assert current.to_address == f"whatsapp:{WHATSAPP_NUMBER}"
    previous.refresh_from_db()
    assert previous.messages.count() == 0


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
    previous_business_account = WhatsAppConversation.objects.create(
        contact_phone="+525500000099",
        from_address="whatsapp:+525500000099",
        to_address="whatsapp:+15556677180",
        site=first_site,
        status="completed",
        current_step="finished",
        last_message_at=timezone.now(),
    )
    WhatsAppMessage.objects.create(
        conversation=visible,
        direction="inbound",
        body="Quiero una prueba.",
    )
    WhatsAppMessage.objects.create(
        conversation=visible,
        direction="outbound",
        body="[revoke]",
    )

    client, _payload_data, _user = auth_client(user=coordinator)
    response = client.get("/api/whatsapp-conversations/")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [visible.id]
    assert [message["body"] for message in response.json()[0]["messages"]] == [
        "Quiero una prueba.",
        "Mensaje eliminado",
    ]
    assert [message["event_type"] for message in response.json()[0]["messages"]] == [
        "message",
        "revoked",
    ]
    assert visible.messages.count() == 2
    assert hidden.id not in {item["id"] for item in response.json()}
    assert previous_business_account.id not in {
        item["id"] for item in response.json()
    }
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

    previous_account_forbidden = client.get(
        f"/api/whatsapp-conversations/{previous_business_account.id}/"
    )
    assert previous_account_forbidden.status_code == 404

    assignees = client.get("/api/whatsapp-conversations/assignees/")
    assert assignees.status_code == 200
    assert [item["id"] for item in assignees.json()] == [coordinator.id]

    delete = client.delete(f"/api/whatsapp-conversations/{visible.id}/")
    assert delete.status_code == 405


def test_active_conversations_are_unique_per_business_number():
    values = {
        "contact_phone": "+525500000088",
        "from_address": "whatsapp:+525500000088",
        "status": "active",
        "current_step": "faq",
    }
    first = WhatsAppConversation.objects.create(
        **values,
        to_address="whatsapp:+15556677180",
    )
    second = WhatsAppConversation.objects.create(
        **values,
        to_address=f"whatsapp:{WHATSAPP_NUMBER}",
    )

    assert first.pk != second.pk


def test_dashboard_uses_most_recent_business_inbox_when_provider_is_not_configured(
    auth_client,
    settings,
):
    site = make_site()
    older = WhatsAppConversation.objects.create(
        contact_phone="+525500000081",
        from_address="whatsapp:+525500000081",
        to_address="whatsapp:+15556677180",
        site=site,
        status="completed",
        current_step="finished",
        last_message_at=timezone.now() - timedelta(days=2),
    )
    current = WhatsAppConversation.objects.create(
        contact_phone="+525500000082",
        from_address="whatsapp:+525500000082",
        to_address="whatsapp:+525574858165",
        site=site,
        status="active",
        current_step="faq",
        last_message_at=timezone.now(),
    )
    settings.META_WHATSAPP_DISPLAY_NUMBER = ""
    settings.META_WHATSAPP_PHONE_NUMBER_ID = ""
    client, _payload_data, _user = auth_client(role="admin")

    response = client.get("/api/whatsapp-conversations/")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [current.id]
    assert client.get(f"/api/whatsapp-conversations/{older.id}/").status_code == 404


def test_admin_can_configure_whatsapp_human_first_schedule(auth_client):
    WhatsAppConversation.objects.create(
        contact_phone="+525500000083",
        from_address="whatsapp:+525500000083",
        to_address="whatsapp:+525574858165",
        status="active",
        current_step="faq",
        last_message_at=timezone.now(),
    )
    client, _payload_data, user = auth_client(role="admin")

    initial = client.get("/api/whatsapp-automation-settings/current/")

    assert initial.status_code == 200
    assert initial.json()["business_address"] == "whatsapp:+525574858165"
    assert initial.json()["business_days"] == [0, 1, 2, 3, 4]
    assert initial.json()["business_hours_start"] == "09:00"
    assert initial.json()["business_hours_end"] == "18:00"
    assert initial.json()["human_response_delay_seconds"] == 600
    assert initial.json()["contact_classification_enabled"] is True
    assert initial.json()["classification_confidence_threshold"] == 80
    assert "Recibimos tu mensaje" in initial.json()["out_of_hours_acknowledgement"]
    assert "B Power Academy" in initial.json()["welcome_message"]
    assert "UVM Lomas Verdes" in initial.json()["assistant_instructions"]

    updated = client.patch(
        "/api/whatsapp-automation-settings/current/",
        {
            "human_first_enabled": True,
            "business_days": [0, 1, 2, 3, 4, 5],
            "business_hours_start": "10:30",
            "business_hours_end": "19:15",
            "human_response_delay_seconds": 600,
            "welcome_message": "Hola, soy el asistente virtual de B Power Academy ⚽",
            "assistant_instructions": "Responde con calidez y usa sólo datos confirmados.",
            "contact_classification_enabled": True,
            "classification_confidence_threshold": 85,
            "out_of_hours_acknowledgement": "Recibimos tu mensaje; mañana te responde el equipo. ⚽",
        },
        format="json",
    )

    assert updated.status_code == 200
    assert updated.json()["business_days"] == [0, 1, 2, 3, 4, 5]
    assert updated.json()["business_hours_start"] == "10:30"
    assert updated.json()["business_hours_end"] == "19:15"
    assert updated.json()["human_response_delay_seconds"] == 600
    assert updated.json()["welcome_message"].startswith("Hola, soy el asistente")
    assert updated.json()["assistant_instructions"] == (
        "Responde con calidez y usa sólo datos confirmados."
    )
    assert updated.json()["classification_confidence_threshold"] == 85
    assert updated.json()["out_of_hours_acknowledgement"].startswith("Recibimos")
    record = WhatsAppAutomationSettings.objects.get(
        business_address="whatsapp:+525574858165",
    )
    assert record.business_hours_start == time(10, 30)
    assert record.business_hours_end == time(19, 15)
    assert record.welcome_message.startswith("Hola, soy el asistente")
    assert AuditLog.objects.filter(
        actor=user,
        action="whatsapp_automation_settings_updated",
        record_id=str(record.pk),
    ).exists()


def test_whatsapp_schedule_configuration_is_admin_only_and_validated(auth_client):
    WhatsAppConversation.objects.create(
        contact_phone="+525500000084",
        from_address="whatsapp:+525500000084",
        to_address="whatsapp:+525574858165",
        status="active",
        current_step="faq",
        last_message_at=timezone.now(),
    )
    coordinator = make_user(role="site_coordinator", primary_site=make_site())
    coordinator_client, _payload_data, _user = auth_client(user=coordinator)
    assert (
        coordinator_client.get("/api/whatsapp-automation-settings/current/").status_code
        == 403
    )

    admin_client, _payload_data, _user = auth_client(role="admin")
    invalid = admin_client.patch(
        "/api/whatsapp-automation-settings/current/",
        {
            "business_days": [],
            "business_hours_start": "18:00",
            "business_hours_end": "09:00",
        },
        format="json",
    )
    assert invalid.status_code == 400
    assert "business_days" in invalid.json()

    invalid_hours = admin_client.patch(
        "/api/whatsapp-automation-settings/current/",
        {
            "business_days": [0, 1, 2, 3, 4],
            "business_hours_start": "18:00",
            "business_hours_end": "09:00",
        },
        format="json",
    )
    assert invalid_hours.status_code == 400
    assert "business_hours_end" in invalid_hours.json()

    invalid_messages = admin_client.patch(
        "/api/whatsapp-automation-settings/current/",
        {
            "welcome_message": "   ",
            "assistant_instructions": "",
            "classification_confidence_threshold": 49,
            "out_of_hours_acknowledgement": "",
        },
        format="json",
    )
    assert invalid_messages.status_code == 400
    assert "welcome_message" in invalid_messages.json()
    assert "assistant_instructions" in invalid_messages.json()
    assert "classification_confidence_threshold" in invalid_messages.json()
    assert "out_of_hours_acknowledgement" in invalid_messages.json()


def test_dashboard_reply_sends_message_and_pauses_automation(auth_client):
    site = make_site()
    coordinator = make_user(role="site_coordinator", primary_site=site)
    conversation = WhatsAppConversation.objects.create(
        contact_phone="+525500000013",
        from_address="whatsapp:+525500000013",
        to_address=f"whatsapp:{WHATSAPP_NUMBER}",
        site=site,
        status="active",
        current_step="faq",
        context={
            "kind": "faq",
            "contact_name": "Marco Ávila",
            "human_response_wait": {"due_at": timezone.now().isoformat()},
        },
        last_message_at=timezone.now(),
    )
    WhatsAppMessage.objects.create(
        # This open event is what the weekly SLA report measures and the
        # dashboard reply must close atomically.
        conversation=conversation,
        provider_sid="wamid.inbound-dashboard-reply",
        direction="inbound",
        body="¿Qué horarios tienen?",
    )
    inbound = conversation.messages.get(provider_sid="wamid.inbound-dashboard-reply")
    response_event = WhatsAppHumanResponseEvent.objects.create(
        conversation=conversation,
        first_inbound_message=inbound,
        contact_type="ambiguous",
        human_attention_expected=True,
        within_business_hours=True,
        first_inbound_at=inbound.created_at,
    )
    client, _payload_data, _user = auth_client(user=coordinator)

    with patch(
        "core.api.trials.send_text",
        return_value="wamid.manual-dashboard-reply",
    ) as send_mock:
        response = client.post(
            f"/api/whatsapp-conversations/{conversation.id}/send-message/",
            {"body": "¡Hola, Marco! Te comparto los horarios disponibles 😊"},
            format="json",
        )

    assert response.status_code == 201
    send_mock.assert_called_once_with(
        to_phone=conversation.contact_phone,
        body="¡Hola, Marco! Te comparto los horarios disponibles 😊",
    )
    conversation.refresh_from_db()
    assert "human_response_wait" not in conversation.context
    assert conversation.context["automation_paused_by_human"] is True
    assert conversation.context["last_reply_source"] == "human"
    assert conversation.context["human_last_reply_by_user_id"] == coordinator.id
    assert WhatsAppMessage.objects.filter(
        conversation=conversation,
        provider_sid="wamid.manual-dashboard-reply",
        direction="outbound",
        body="¡Hola, Marco! Te comparto los horarios disponibles 😊",
    ).exists()
    response_event.refresh_from_db()
    assert response_event.response_message.provider_sid == "wamid.manual-dashboard-reply"
    assert response_event.responder_user == coordinator
    assert response_event.response_channel == "dashboard"
    assert response_event.response_seconds is not None
    assert response.json()["contact_name"] == "Marco Ávila"
    assert response.json()["human_takeover_active"] is True
    assert response.json()["bot_response_pending"] is False
    assert response.json()["free_form_window_open"] is True
    assert AuditLog.objects.filter(
        action="whatsapp_manual_message_sent",
        record_id=str(conversation.id),
        actor=coordinator,
    ).exists()


def test_dashboard_reply_requires_an_open_customer_service_window(auth_client):
    conversation = WhatsAppConversation.objects.create(
        contact_phone="+525500000014",
        from_address="whatsapp:+525500000014",
        to_address=f"whatsapp:{WHATSAPP_NUMBER}",
        status="active",
        current_step="faq",
        last_message_at=timezone.now() - timedelta(days=2),
    )
    inbound = WhatsAppMessage.objects.create(
        conversation=conversation,
        provider_sid="wamid.expired-dashboard-reply",
        direction="inbound",
        body="Hola",
    )
    WhatsAppMessage.objects.filter(pk=inbound.pk).update(
        created_at=timezone.now() - timedelta(hours=25),
    )
    client, _payload_data, _user = auth_client(role="admin")

    with patch("core.api.trials.send_text") as send_mock:
        response = client.post(
            f"/api/whatsapp-conversations/{conversation.id}/send-message/",
            {"body": "Respuesta fuera de ventana"},
            format="json",
        )

    assert response.status_code == 409
    assert "plantilla aprobada" in response.json()["detail"]
    send_mock.assert_not_called()


def test_weekly_whatsapp_stats_measure_human_response_sla(auth_client):
    responder = make_user(role="admin", first_name="Ana", last_name="Cancha")
    now = timezone.now()
    durations = [120, 480, 1200, None]
    contact_types = ["current_client", "ambiguous", "current_client", "ambiguous"]
    within_hours = [True, True, False, False]

    for index, duration in enumerate(durations):
        conversation = WhatsAppConversation.objects.create(
            contact_phone=f"+5255000001{index:02d}",
            from_address=f"whatsapp:+5255000001{index:02d}",
            to_address=f"whatsapp:{WHATSAPP_NUMBER}",
            status="active",
            current_step="faq",
            context={"contact_name": f"Contacto {index}"},
            last_message_at=now,
        )
        inbound = WhatsAppMessage.objects.create(
            conversation=conversation,
            provider_sid=f"wamid.stats-inbound-{index}",
            direction="inbound",
            body="Mensaje de seguimiento",
            contact_type=contact_types[index],
            classification_confidence=95,
            routing_decision="human_only",
            within_business_hours=within_hours[index],
        )
        first_inbound_at = now - timedelta(hours=index + 1)
        WhatsAppHumanResponseEvent.objects.create(
            conversation=conversation,
            first_inbound_message=inbound,
            contact_type=contact_types[index],
            human_attention_expected=True,
            within_business_hours=within_hours[index],
            first_inbound_at=first_inbound_at,
            responder_user=responder if duration is not None else None,
            response_channel="dashboard" if duration is not None else "none",
            responded_at=(
                first_inbound_at + timedelta(seconds=duration)
                if duration is not None
                else None
            ),
            response_seconds=duration,
        )

    client, _payload_data, _user = auth_client(role="admin")
    response = client.get("/api/whatsapp-conversations/weekly-stats/")

    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["total"] == 4
    assert data["summary"]["answered"] == 3
    assert data["summary"]["unanswered"] == 1
    assert data["summary"]["average_response_seconds"] == 600
    assert data["summary"]["median_response_seconds"] == 480
    assert data["summary"]["within_5_minutes_percent"] == 25.0
    assert data["summary"]["within_10_minutes_percent"] == 50.0
    assert data["business_hours"]["total"] == 2
    assert data["outside_business_hours"]["total"] == 2
    assert data["classifications"] == {
        "prospect": 0,
        "current_client": 2,
        "ambiguous": 2,
    }
    assert data["by_responder"][0]["name"] == "Ana Cancha"
    assert data["by_responder"][0]["answered"] == 3
    assert len(data["longest_waits"]) == 4
    assert data["longest_waits"][0]["responded_at"] is None


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
