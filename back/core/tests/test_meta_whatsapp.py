import hashlib
import hmac
import json
from datetime import time, timedelta
from unittest.mock import patch

import pytest
from django.test import override_settings
from django.utils import timezone

from core.models import (
    Court,
    TrialAvailabilityRule,
    TrialBooking,
    WhatsAppConversation,
    WhatsAppMessage,
    WhatsAppOutboundDispatch,
    WhatsAppOutboundDispatchStatus,
)
from core.tests.factories import make_charge, make_guardian, make_site, make_student
from core.whatsapp.ai_faq import FAQAnswer
from core.whatsapp.meta_api import (
    MetaWhatsAppError,
    _access_token,
    _base_payload,
    _messages_url,
    send_location,
)
from core.whatsapp.meta_webhooks import _bold_whatsapp_terms
from core.whatsapp.payment_reminders import send_charge_payment_reminder


pytestmark = [pytest.mark.api, pytest.mark.django_db]

WEBHOOK_PATH = "/api/whatsapp/meta/webhook/"
VERIFY_TOKEN = "verify-local-meta-token"
APP_SECRET = "meta-app-secret-for-tests"
PHONE_NUMBER_ID = "123456789012345"
WABA_ID = "987654321098765"
ACCESS_TOKEN = "EAATESTTOKEN"


def test_meta_formats_business_terms_in_native_whatsapp_bold():
    message = _bold_whatsapp_terms(
        "La Academia ofrece una prueba gratuita y también torneos. "
        "La *academia* ya estaba marcada. **Torneos:** también."
    )

    assert message == (
        "La *Academia* ofrece una *prueba gratuita* y también *torneos*. "
        "La *academia* ya estaba marcada. *Torneos:* también."
    )


def _make_weekly_availability():
    site = make_site(
        code="cuajimalpa",
        name="Power Soccer Academy",
        address="Antiguo Camino a Tecamachalco 686",
    )
    court = Court.objects.create(site=site, name="Cancha Meta")
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


def _payload(*, sequence=1, text="Hola", interactive_id=None):
    message = {
        "from": "525500000001",
        "id": f"wamid.HBgMNTI1NTAwMDAwMDAxFQIAERgS{sequence:032x}",
        "timestamp": "1710000000",
        "type": "text",
        "text": {"body": text},
    }
    if interactive_id:
        message.update(
            {
                "type": "interactive",
                "interactive": {
                    "type": "list_reply",
                    "list_reply": {"id": interactive_id, "title": text},
                },
            }
        )
        message.pop("text", None)
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": WABA_ID,
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "15550001111",
                                "phone_number_id": PHONE_NUMBER_ID,
                            },
                            "messages": [message],
                        },
                    }
                ],
            }
        ],
    }


def _signed_post(client, payload, *, signature=None):
    body = json.dumps(payload).encode("utf-8")
    if signature is None:
        signature = "sha256=" + hmac.new(
            APP_SECRET.encode("utf-8"), body, hashlib.sha256
        ).hexdigest()
    return client.post(
        WEBHOOK_PATH,
        data=body,
        content_type="application/json",
        HTTP_X_HUB_SIGNATURE_256=signature,
    )


META_SETTINGS = {
    "META_WHATSAPP_PROVIDER": "meta",
    "META_WHATSAPP_ACCESS_TOKEN": ACCESS_TOKEN,
    "META_WHATSAPP_PHONE_NUMBER_ID": PHONE_NUMBER_ID,
    "META_WHATSAPP_DISPLAY_NUMBER": "+15550001111",
    "META_WHATSAPP_VERIFY_TOKEN": VERIFY_TOKEN,
    "META_WHATSAPP_APP_SECRET": APP_SECRET,
    "META_WHATSAPP_VALIDATE_SIGNATURES": True,
    "META_WHATSAPP_INTERACTIVE": True,
    "META_WHATSAPP_DEFAULT_SITE_CODE": "cuajimalpa",
    "TRIAL_MIN_ADVANCE_HOURS": 0,
    "TRIAL_BOOKING_HORIZON_DAYS": 30,
    "TRIAL_MIN_DAYS_BETWEEN_VISITS": 1,
    "TRIAL_MAX_DAYS_BETWEEN_VISITS": 21,
}

DUALHOOK_SETTINGS = {
    **META_SETTINGS,
    "META_WHATSAPP_PROVIDER": "dualhook",
    "META_WHATSAPP_ACCESS_TOKEN": "",
    "META_WHATSAPP_APP_SECRET": "",
    "DUALHOOK_API_KEY": "dh_live_test_key",
    "DUALHOOK_WABA_ID": WABA_ID,
    "DUALHOOK_API_BASE_URL": "https://api.dualhook.com",
    "META_WHATSAPP_GRAPH_VERSION": "v25.0",
}


def test_meta_normalizes_legacy_mexican_mobile_recipient():
    payload = _base_payload("+5215574879293")

    assert payload["to"] == "525574879293"


def test_meta_location_message_uses_native_whatsapp_payload():
    with patch(
        "core.whatsapp.meta_api._post_message",
        return_value="wamid.native-location",
    ) as post_message:
        message_id = send_location(
            to_phone="+525500000001",
            latitude="19.3824617",
            longitude="-99.2780863",
            name="Power Soccer Academy",
            address="Antiguo Camino a Tecamachalco 686",
        )

    payload = post_message.call_args.args[0]
    assert message_id == "wamid.native-location"
    assert payload["type"] == "location"
    assert payload["location"] == {
        "latitude": 19.3824617,
        "longitude": -99.2780863,
        "name": "Power Soccer Academy",
        "address": "Antiguo Camino a Tecamachalco 686",
    }


@override_settings(**DUALHOOK_SETTINGS)
def test_dualhook_runtime_uses_connection_key_and_compatible_messages_url():
    assert _access_token() == "dh_live_test_key"
    assert _messages_url() == (
        f"https://api.dualhook.com/v25.0/{PHONE_NUMBER_ID}/messages"
    )


@override_settings(**META_SETTINGS)
def test_meta_webhook_verification_uses_private_verify_token(api_client):
    accepted = api_client.get(
        WEBHOOK_PATH,
        {
            "hub.mode": "subscribe",
            "hub.verify_token": VERIFY_TOKEN,
            "hub.challenge": "987654321",
        },
    )
    rejected = api_client.get(
        WEBHOOK_PATH,
        {
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong",
            "hub.challenge": "987654321",
        },
    )

    assert accepted.status_code == 200
    assert accepted.content == b"987654321"
    assert rejected.status_code == 403


@override_settings(**META_SETTINGS)
def test_meta_webhook_rejects_bad_signature_and_replays_duplicate_once(api_client):
    _make_weekly_availability()
    payload = _payload()

    rejected = _signed_post(api_client, payload, signature="sha256=bad")
    assert rejected.status_code == 403

    with patch(
        "core.whatsapp.meta_webhooks.send_buttons",
        return_value="wamid.outbound-menu",
    ) as send_buttons:
        accepted = _signed_post(api_client, payload)
        repeated = _signed_post(api_client, payload)

    assert accepted.status_code == 200
    assert repeated.status_code == 200
    assert send_buttons.call_count == 1
    assert WhatsAppConversation.objects.count() == 1
    assert WhatsAppMessage.objects.count() == 2
    dispatch = WhatsAppOutboundDispatch.objects.get()
    assert dispatch.status == WhatsAppOutboundDispatchStatus.SENT
    assert dispatch.provider_sid == "wamid.outbound-menu"
    conversation = WhatsAppConversation.objects.get()
    assert conversation.current_step == "menu"
    assert conversation.context["kind"] == "menu"
    assert WhatsAppMessage.objects.filter(provider_sid="wamid.outbound-menu").exists()


@override_settings(**META_SETTINGS)
def test_meta_does_not_retry_an_uncertain_interactive_delivery(api_client):
    _make_weekly_availability()
    payload = _payload(sequence=81)

    with (
        patch(
            "core.whatsapp.meta_webhooks.send_buttons",
            side_effect=MetaWhatsAppError(
                "No fue posible confirmar la entrega.",
                delivery_uncertain=True,
            ),
        ) as send_buttons,
        patch("core.whatsapp.meta_webhooks.send_text") as send_text,
    ):
        accepted = _signed_post(api_client, payload)
        repeated = _signed_post(api_client, payload)

    assert accepted.status_code == 200
    assert repeated.status_code == 200
    send_buttons.assert_called_once()
    send_text.assert_not_called()
    dispatch = WhatsAppOutboundDispatch.objects.get()
    assert dispatch.status == WhatsAppOutboundDispatchStatus.UNCERTAIN
    assert WhatsAppMessage.objects.count() == 1
    conversation = WhatsAppConversation.objects.get()
    assert conversation.follow_up_required is True
    assert (
        conversation.context["outbound_delivery_attention"]["status"]
        == WhatsAppOutboundDispatchStatus.UNCERTAIN
    )


@override_settings(**META_SETTINGS)
def test_meta_uses_text_fallback_after_definite_interactive_rejection(api_client):
    _make_weekly_availability()

    with (
        patch(
            "core.whatsapp.meta_webhooks.send_buttons",
            side_effect=MetaWhatsAppError("El proveedor rechazó el mensaje (HTTP 400)."),
        ) as send_buttons,
        patch(
            "core.whatsapp.meta_webhooks.send_text",
            return_value="wamid.text-fallback",
        ) as send_text,
    ):
        response = _signed_post(api_client, _payload(sequence=82))

    assert response.status_code == 200
    send_buttons.assert_called_once()
    send_text.assert_called_once()
    dispatch = WhatsAppOutboundDispatch.objects.get()
    assert dispatch.status == WhatsAppOutboundDispatchStatus.SENT
    assert dispatch.provider_sid == "wamid.text-fallback"
    assert WhatsAppMessage.objects.count() == 2


@override_settings(**META_SETTINGS)
def test_meta_webhook_keeps_business_numbers_in_separate_conversations(api_client):
    site = _make_weekly_availability()
    previous = WhatsAppConversation.objects.create(
        contact_phone="+525500000001",
        from_address="whatsapp:+525500000001",
        to_address="whatsapp:+15556677180",
        status="active",
        current_step="faq",
        site=site,
        context={"kind": "faq"},
        last_message_at=timezone.now(),
    )

    with patch(
        "core.whatsapp.meta_webhooks.send_buttons",
        return_value="wamid.current-business-menu",
    ):
        response = _signed_post(api_client, _payload(sequence=77))

    assert response.status_code == 200
    assert WhatsAppConversation.objects.filter(
        contact_phone="+525500000001",
        status="active",
    ).count() == 2
    current = WhatsAppConversation.objects.exclude(pk=previous.pk).get()
    assert current.to_address == "whatsapp:+15550001111"
    assert current.current_step == "menu"
    previous.refresh_from_db()
    assert previous.current_step == "faq"
    assert previous.messages.count() == 0


@override_settings(**DUALHOOK_SETTINGS)
def test_dualhook_webhook_validates_waba_and_phone_instead_of_private_app_secret(
    api_client,
):
    _make_weekly_availability()
    payload = _payload()

    with patch(
        "core.whatsapp.meta_webhooks.send_buttons",
        return_value="wamid.dualhook-menu",
    ):
        accepted = _signed_post(api_client, payload, signature="sha256=unverifiable")

    wrong_waba = _payload(sequence=2)
    wrong_waba["entry"][0]["id"] = "another-waba"
    rejected_waba = _signed_post(
        api_client,
        wrong_waba,
        signature="sha256=unverifiable",
    )

    wrong_phone = _payload(sequence=3)
    wrong_phone["entry"][0]["changes"][0]["value"]["metadata"][
        "phone_number_id"
    ] = "111111111111111"
    rejected_phone = _signed_post(
        api_client,
        wrong_phone,
        signature="sha256=unverifiable",
    )

    assert accepted.status_code == 200
    assert rejected_waba.status_code == 403
    assert rejected_phone.status_code == 403


@override_settings(**META_SETTINGS)
def test_meta_fast_flow_books_without_site_or_age_questions(api_client):
    site = _make_weekly_availability()
    with (
        patch(
            "core.whatsapp.meta_webhooks.send_buttons",
            side_effect=["wamid.schedule", "wamid.contact"],
        ) as send_buttons,
        patch(
            "core.whatsapp.meta_webhooks.send_text",
            side_effect=["wamid.parent", "wamid.child", "wamid.confirmed"],
        ),
    ):
        responses = [
            _signed_post(api_client, _payload(sequence=1, text="Quiero una prueba")),
            _signed_post(
                api_client,
                _payload(sequence=2, text="Sí, continuar", interactive_id="schedule:default"),
            ),
            _signed_post(api_client, _payload(sequence=3, text="Marco Ávila")),
            _signed_post(api_client, _payload(sequence=4, text="Santiago")),
            _signed_post(
                api_client,
                _payload(sequence=5, text="Usar este número", interactive_id="contact:same"),
            ),
        ]

    assert all(response.status_code == 200 for response in responses)
    conversation = WhatsAppConversation.objects.get()
    booking = TrialBooking.objects.get()
    assert conversation.site == site
    assert conversation.status == "completed"
    assert conversation.current_step == "finished"
    assert conversation.booking == booking
    assert booking.responsible_name == "Marco Ávila"
    assert booking.responsible_phone == "+525500000001"
    assert booking.child_first_name == "Santiago"
    assert booking.child_age is None
    assert booking.visits.count() == 2
    assert send_buttons.call_args_list[0].kwargs["buttons"] == [
        {"id": "schedule:default", "title": "Sí, continuar"},
        {"id": "schedule:other", "title": "Elegir otro"},
    ]


@override_settings(**META_SETTINGS)
def test_meta_fast_flow_can_show_alternative_schedule_packages(api_client):
    _make_weekly_availability()
    with (
        patch(
            "core.whatsapp.meta_webhooks.send_buttons",
            return_value="wamid.schedule-default",
        ),
        patch(
            "core.whatsapp.meta_webhooks.send_list",
            return_value="wamid.schedule-alternatives",
        ) as send_list,
    ):
        started = _signed_post(api_client, _payload(sequence=6, text="Sí quiero"))
        alternatives = _signed_post(
            api_client,
            _payload(sequence=7, text="Elegir otro", interactive_id="schedule:other"),
        )

    assert started.status_code == 200
    assert alternatives.status_code == 200
    conversation = WhatsAppConversation.objects.get()
    assert conversation.current_step == "choose_first_visit"
    assert conversation.context["show_schedule_options"] is True
    assert len(send_list.call_args.kwargs["options"]) >= 1
    assert send_list.call_args.kwargs["button"] == "Ver horarios"


@override_settings(**META_SETTINGS)
def test_meta_does_not_offer_booking_when_default_site_has_no_schedule(api_client):
    make_site(code="cuajimalpa", name="Power Soccer Academy")
    with (
        patch("core.whatsapp.meta_webhooks.send_buttons") as send_buttons,
        patch(
            "core.whatsapp.meta_webhooks.send_text",
            return_value="wamid.no-schedule",
        ) as send_text,
    ):
        response = _signed_post(api_client, _payload(sequence=8, text="Hola"))

    assert response.status_code == 200
    send_buttons.assert_not_called()
    assert "no tenemos horarios disponibles" in send_text.call_args.kwargs["body"]


@override_settings(**META_SETTINGS)
def test_meta_direct_question_uses_openai_faq_and_records_usage(api_client):
    answer = FAQAnswer(
        text="La prueba incluye dos visitas gratuitas ⚽💚",
        usage={"input_tokens": 80, "output_tokens": 15, "total_tokens": 95},
        model="gpt-5.6-luna-2026-08-01",
    )
    with (
        patch(
            "core.whatsapp.meta_webhooks.answer_faq",
            return_value=answer,
        ) as openai_answer,
        patch(
            "core.whatsapp.meta_webhooks.send_text",
            return_value="wamid.outbound-faq",
        ) as send_text,
    ):
        response = _signed_post(
            api_client,
            _payload(sequence=10, text="¿En qué consiste la prueba gratuita?"),
        )

    assert response.status_code == 200
    conversation = WhatsAppConversation.objects.get()
    assert conversation.current_step == "faq"
    assert conversation.context["kind"] == "faq"
    assert conversation.context["openai_usage"]["total_tokens"] == 95
    assert conversation.context["openai_model"] == "gpt-5.6-luna-2026-08-01"
    assert conversation.follow_up_required is False
    openai_answer.assert_called_once()
    assert openai_answer.call_args.kwargs["user_message"] == "¿En qué consiste la prueba gratuita?"
    send_text.assert_called_once_with(
        to_phone="+525500000001",
        body="La prueba incluye dos visitas gratuitas ⚽💚",
    )


@override_settings(
    **META_SETTINGS,
    META_WHATSAPP_LOCATION_NAME="Power Soccer Academy",
    META_WHATSAPP_LOCATION_ADDRESS="Antiguo Camino a Tecamachalco 686",
    META_WHATSAPP_CONTACT_PHONE="+52 55 7895 0758",
    META_WHATSAPP_LOCATION_LATITUDE=19.3824617,
    META_WHATSAPP_LOCATION_LONGITUDE=-99.2780863,
)
def test_meta_location_question_sends_native_location_without_openai(api_client):
    with (
        patch("core.whatsapp.meta_webhooks.answer_faq") as openai_answer,
        patch(
            "core.whatsapp.meta_webhooks.send_location",
            return_value="wamid.outbound-location",
        ) as send_native_location,
    ):
        response = _signed_post(
            api_client,
            _payload(sequence=12, text="¿Me mandas la ubicación?"),
        )

    assert response.status_code == 200
    conversation = WhatsAppConversation.objects.get()
    assert conversation.current_step == "faq"
    assert conversation.context["kind"] == "faq"
    assert "_send_location" not in conversation.context
    openai_answer.assert_not_called()
    send_native_location.assert_called_once_with(
        to_phone="+525500000001",
        latitude=19.3824617,
        longitude=-99.2780863,
        name="Power Soccer Academy",
        address="Antiguo Camino a Tecamachalco 686\nTeléfono +52 55 7895 0758",
    )
    outbound = WhatsAppMessage.objects.get(direction="outbound")
    assert outbound.provider_sid == "wamid.outbound-location"
    assert "Power Soccer Academy" in outbound.body
    assert "Teléfono +52 55 7895 0758" in outbound.body


@override_settings(**META_SETTINGS)
def test_meta_unknown_faq_marks_conversation_for_human_follow_up(api_client):
    answer = FAQAnswer(
        text="No tengo ese dato confirmado; una persona puede ayudarte 😊",
        needs_human=True,
        usage={"input_tokens": 70, "output_tokens": 18, "total_tokens": 88},
        model="gpt-5.6-luna",
    )
    with (
        patch("core.whatsapp.meta_webhooks.answer_faq", return_value=answer),
        patch(
            "core.whatsapp.meta_webhooks.send_text",
            return_value="wamid.outbound-follow-up",
        ),
    ):
        response = _signed_post(
            api_client,
            _payload(sequence=11, text="¿Qué entrenador le tocará?"),
        )

    assert response.status_code == 200
    conversation = WhatsAppConversation.objects.get()
    assert conversation.current_step == "faq"
    assert conversation.follow_up_required is True
    assert conversation.follow_up_updated_at is not None


@override_settings(**META_SETTINGS)
def test_meta_menu_answers_a_typed_question(api_client):
    _make_weekly_availability()
    answer = FAQAnswer(text="Claro, te ayudamos 😊", model="gpt-5.6-luna")
    with (
        patch(
            "core.whatsapp.meta_webhooks.send_buttons",
            return_value="wamid.outbound-menu",
        ),
        patch("core.whatsapp.meta_webhooks.send_text", return_value="wamid.outbound-faq"),
        patch("core.whatsapp.meta_webhooks.answer_faq", return_value=answer) as openai_answer,
    ):
        greeting = _signed_post(api_client, _payload(sequence=20))
        selection = _signed_post(
            api_client,
            _payload(
                sequence=21,
                text="¿Qué deben llevar?",
            ),
        )

    assert greeting.status_code == 200
    assert selection.status_code == 200
    conversation = WhatsAppConversation.objects.get()
    assert conversation.current_step == "faq"
    assert conversation.context["kind"] == "faq"
    openai_answer.assert_called_once()


@override_settings(**META_SETTINGS)
def test_meta_answers_question_during_booking_without_losing_booking_step(api_client):
    _make_weekly_availability()
    answer = FAQAnswer(
        text="Para la prueba recomendamos ropa deportiva y agua 👟💧",
        usage={"input_tokens": 60, "output_tokens": 12, "total_tokens": 72},
        model="gpt-5.6-luna",
    )
    with (
        patch(
            "core.whatsapp.meta_webhooks.send_buttons",
            return_value="wamid.outbound-schedule",
        ),
        patch("core.whatsapp.meta_webhooks.answer_faq", return_value=answer),
        patch(
            "core.whatsapp.meta_webhooks.send_text",
            return_value="wamid.outbound-answer",
        ) as send_text,
    ):
        started = _signed_post(
            api_client,
            _payload(sequence=30, text="Quiero agendar una prueba"),
        )
        question = _signed_post(
            api_client,
            _payload(sequence=31, text="¿Qué debemos llevar?"),
        )

    assert started.status_code == 200
    assert question.status_code == 200
    conversation = WhatsAppConversation.objects.get()
    assert conversation.current_step == "choose_first_visit"
    assert conversation.context["kind"] == "trial_booking"
    assert conversation.context["openai_usage"]["total_tokens"] == 72
    assert "Para continuar con tu reserva" in send_text.call_args.kwargs["body"]


@override_settings(**META_SETTINGS)
def test_meta_health_reports_readiness_without_secrets(api_client):
    _make_weekly_availability()

    response = api_client.get("/health/whatsapp/meta/")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert response.json()["webhook_path"] == WEBHOOK_PATH
    assert ACCESS_TOKEN not in response.content.decode("utf-8")
    assert APP_SECRET not in response.content.decode("utf-8")


@override_settings(
    **META_SETTINGS,
    META_WHATSAPP_PAYMENT_TEMPLATE="futsi_recordatorio_pago",
    META_WHATSAPP_TEMPLATE_LANGUAGE="es_MX",
)
def test_charge_action_sends_real_meta_template_and_records_dashboard_history(auth_client):
    site = make_site()
    guardian = make_guardian(phone="+525500000099", full_name="Andrea Pérez")
    student = make_student(site=site, guardian=guardian, full_name="Leo Pérez")
    charge = make_charge(site=site, student=student, concept="Mensualidad agosto")
    client, _payload_data, _user = auth_client(role="admin", primary_site=site)
    outbound_id = "wamid." + ("x" * 120)

    with patch(
        "core.whatsapp.payment_reminders.send_payment_reminder",
        return_value=outbound_id,
    ) as send_reminder:
        response = client.post(f"/api/charges/{charge.id}/send-whatsapp-reminder/")

    assert response.status_code == 200
    send_reminder.assert_called_once()
    assert send_reminder.call_args.kwargs["to_phone"] == "+525500000099"
    assert send_reminder.call_args.kwargs["subject_name"] == "Leo Pérez"
    conversation = WhatsAppConversation.objects.get()
    assert conversation.status == "completed"
    assert conversation.context["kind"] == "payment_reminder"
    assert conversation.context["charge_id"] == charge.id
    assert conversation.messages.get().provider_sid == outbound_id


@override_settings(
    WHATSAPP_SERVICE_URL="https://futsi-whatsapp.example.test",
    WHATSAPP_SERVICE_TOKEN="shared-service-token",
    WHATSAPP_SERVICE_TIMEOUT_SECONDS=20,
)
def test_charge_reminder_can_delegate_to_independent_whatsapp_service():
    site = make_site()
    guardian = make_guardian(phone="+525500000099", full_name="Andrea Pérez")
    student = make_student(site=site, guardian=guardian, full_name="Leo Pérez")
    charge = make_charge(site=site, student=student, concept="Mensualidad agosto")

    with patch("core.whatsapp.payment_reminders.urlopen") as urlopen:
        urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(
            {
                "message_id": "wamid.remote-service",
                "conversation_id": 456,
                "contact_phone": "+525500000099",
            }
        ).encode("utf-8")
        result = send_charge_payment_reminder(charge)

    assert result["message_id"] == "wamid.remote-service"
    request = urlopen.call_args.args[0]
    assert request.full_url == (
        "https://futsi-whatsapp.example.test/api/internal/payment-reminders/"
    )
    assert request.headers["Authorization"] == "Bearer shared-service-token"
    assert WhatsAppConversation.objects.count() == 0
