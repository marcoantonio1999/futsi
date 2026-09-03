from __future__ import annotations

import asyncio
import hashlib
from datetime import time, timedelta
from unittest.mock import patch
from xml.etree import ElementTree

import pytest
from django.test import override_settings
from django.utils import timezone
from twilio.request_validator import RequestValidator

from core.models import Court, TrialAvailabilityRule, VoiceCall
from core.tests.factories import make_site
from core.voice.prompt import build_voice_agent_instructions
from core.voice.realtime import _accumulate_realtime_usage, _websocket_signature_valid
from core.voice.scheduling import (
    SchedulingError,
    book_two_trial_visits,
    list_trial_availability,
)


pytestmark = [pytest.mark.api, pytest.mark.django_db]

ACCOUNT_SID = "AC" + ("1" * 32)
AUTH_TOKEN = "qa-twilio-auth-token"
PHONE_NUMBER = "+14014090000"
PUBLIC_BASE_URL = "https://voice.example.test"
STREAM_URL = "wss://voice.example.test/ws/voice/twilio/"


@pytest.mark.django_db(transaction=True)
def test_realtime_token_usage_is_accumulated_on_the_call():
    call = VoiceCall.objects.create(
        call_sid="CA" + ("9" * 32),
        from_number="+525500000099",
        to_number=PHONE_NUMBER,
    )

    asyncio.run(
        _accumulate_realtime_usage(
            call.id,
            {
                "total_tokens": 100,
                "input_tokens": 70,
                "output_tokens": 30,
                "input_token_details": {
                    "text_tokens": 20,
                    "audio_tokens": 50,
                    "cached_tokens": 10,
                },
                "output_token_details": {
                    "text_tokens": 5,
                    "audio_tokens": 25,
                },
            },
        )
    )
    asyncio.run(
        _accumulate_realtime_usage(
            call.id,
            {
                "total_tokens": 60,
                "input_tokens": 45,
                "output_tokens": 15,
                "input_token_details": {
                    "text_tokens": 15,
                    "audio_tokens": 30,
                    "cached_tokens": 8,
                },
                "output_token_details": {
                    "text_tokens": 3,
                    "audio_tokens": 12,
                },
            },
        )
    )

    call.refresh_from_db()
    assert call.extracted_data["openai_realtime_usage"] == {
        "response_count": 2,
        "total_tokens": 160,
        "input_tokens": 115,
        "output_tokens": 45,
        "input_text_tokens": 35,
        "input_audio_tokens": 80,
        "cached_tokens": 18,
        "output_text_tokens": 8,
        "output_audio_tokens": 37,
    }


def test_voice_prompt_pins_mexican_accent_and_rejects_background_noise():
    instructions = build_voice_agent_instructions()

    assert "acento mexicano natural" in instructions
    assert "No uses entonación de una persona angloparlante" in instructions
    assert "Ignora silencio, tos, golpes" in instructions
    assert "Nunca tomes un ruido" in instructions


def _signed_post(client, path, data, *, signature=""):
    url = f"{PUBLIC_BASE_URL}{path}"
    signature = signature or RequestValidator(AUTH_TOKEN).compute_signature(url, data)
    return client.post(
        path,
        data,
        HTTP_X_TWILIO_SIGNATURE=signature,
    )


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_PHONE_NUMBER=PHONE_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_STREAM_URL=STREAM_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    OPENAI_API_KEY="qa-openai-key",
)
def test_twilio_requires_signature_and_starts_stream_without_spoken_gate(api_client):
    call_sid = "CA" + ("2" * 32)
    payload = {
        "AccountSid": ACCOUNT_SID,
        "CallSid": call_sid,
        "From": "+525500000001",
        "To": PHONE_NUMBER,
        "CallStatus": "ringing",
    }

    rejected = _signed_post(
        api_client,
        "/api/voice/twilio/incoming/",
        payload,
        signature="invalid",
    )
    assert rejected.status_code == 403
    assert not VoiceCall.objects.exists()

    with patch(
        "core.voice.twilio_webhooks.secrets.token_urlsafe",
        return_value="one-time-stream-token",
    ) as token_factory:
        incoming = _signed_post(
            api_client,
            "/api/voice/twilio/incoming/",
            payload,
        )
    assert incoming.status_code == 200
    token_factory.assert_called_once_with(32)
    root = ElementTree.fromstring(incoming.content)
    assert root.find(".//Gather") is None
    assert root.find(".//Say") is None
    assert root.find(".//Hangup") is not None
    stream = root.find(".//Stream")
    assert stream is not None
    assert stream.attrib["url"] == STREAM_URL
    parameters = {
        parameter.attrib["name"]: parameter.attrib["value"]
        for parameter in root.findall(".//Parameter")
    }
    assert parameters == {
        "callSid": call_sid,
        "streamToken": "one-time-stream-token",
    }

    call = VoiceCall.objects.get(call_sid=call_sid)
    assert call.consent_granted is True
    assert call.consent_granted_at is not None
    assert "age_band" not in call.extracted_data
    assert (
        call.extracted_data["stream_token_hash"]
        == hashlib.sha256(b"one-time-stream-token").hexdigest()
    )
    assert parameters["streamToken"] not in str(call.extracted_data)
    assert api_client.post("/api/voice/twilio/age-band/").status_code == 404


@pytest.mark.parametrize("digits", ["", "2"])
@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_STREAM_URL=STREAM_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
)
def test_rejected_or_missing_consent_is_persisted_as_unsuccessful(
    api_client,
    digits,
):
    call_sid = "CA" + ("9" * 32)
    call = VoiceCall.objects.create(
        call_sid=call_sid,
        from_number="+525500000009",
        to_number=PHONE_NUMBER,
    )
    payload = {
        "AccountSid": ACCOUNT_SID,
        "CallSid": call_sid,
        "From": call.from_number,
        "To": PHONE_NUMBER,
        "Digits": digits,
    }

    with patch("core.voice.twilio_webhooks.secrets.token_urlsafe") as token_factory:
        response = _signed_post(
            api_client,
            "/api/voice/twilio/consent/",
            payload,
        )

    assert response.status_code == 200
    assert ElementTree.fromstring(response.content).find(".//Stream") is None
    token_factory.assert_not_called()
    call.refresh_from_db()
    assert call.consent_granted is False
    assert call.ai_outcome == "unsuccessful"
    assert "consentimiento" in call.failure_reason
    assert call.summary


@pytest.mark.parametrize(
    ("consent_granted", "reason_fragment"),
    [
        (False, "consentimiento"),
        (True, "reserva"),
    ],
)
@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
)
def test_terminal_call_without_booking_cannot_remain_pending(
    api_client,
    consent_granted,
    reason_fragment,
):
    call_sid = "CA" + ("a" * 32)
    call = VoiceCall.objects.create(
        call_sid=call_sid,
        from_number="+525500000010",
        to_number=PHONE_NUMBER,
        consent_granted=consent_granted,
        consent_granted_at=timezone.now() if consent_granted else None,
    )
    payload = {
        "AccountSid": ACCOUNT_SID,
        "CallSid": call_sid,
        "CallStatus": "completed",
        "CallDuration": "42",
    }

    response = _signed_post(
        api_client,
        "/api/voice/twilio/status/",
        payload,
    )

    assert response.status_code == 204
    call.refresh_from_db()
    assert call.technical_status == "completed"
    assert call.ended_at is not None
    assert call.duration_seconds == 42
    assert call.ai_outcome == "unsuccessful"
    assert reason_fragment in call.failure_reason
    assert call.summary


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_PHONE_NUMBER=PHONE_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_STREAM_URL=STREAM_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    OPENAI_API_KEY="qa-openai-key",
    VOICE_CALLS_PER_NUMBER_PER_HOUR=2,
)
def test_incoming_call_rate_limits_repeated_new_calls_from_one_number(api_client):
    caller = "+525500000099"
    for index in range(2):
        VoiceCall.objects.create(
            call_sid=f"CA{index + 20:032x}",
            from_number=caller,
            to_number=PHONE_NUMBER,
        )
    blocked_sid = "CA" + ("d" * 32)
    payload = {
        "AccountSid": ACCOUNT_SID,
        "CallSid": blocked_sid,
        "From": caller,
        "To": PHONE_NUMBER,
    }

    response = _signed_post(
        api_client,
        "/api/voice/twilio/incoming/",
        payload,
    )

    assert response.status_code == 200
    root = ElementTree.fromstring(response.content)
    assert root.find(".//Gather") is None
    assert root.find(".//Hangup") is not None
    assert "dentro de una hora" in response.content.decode("utf-8")
    assert not VoiceCall.objects.filter(call_sid=blocked_sid).exists()


@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_PHONE_NUMBER=PHONE_NUMBER,
    TWILIO_PUBLIC_BASE_URL=PUBLIC_BASE_URL,
    TWILIO_STREAM_URL=STREAM_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
    OPENAI_API_KEY="qa-openai-key",
    VOICE_MAX_CONCURRENT_STREAMS=1,
)
def test_consent_routes_to_manual_follow_up_when_stream_capacity_is_full(
    api_client,
):
    VoiceCall.objects.create(
        call_sid="CA" + ("e" * 32),
        stream_sid="MZ-active",
        from_number="+525500000080",
        to_number=PHONE_NUMBER,
        consent_granted=True,
        consent_granted_at=timezone.now(),
        started_at=timezone.now(),
        extracted_data={"stream_token_used_at": timezone.now().isoformat()},
    )
    target = VoiceCall.objects.create(
        call_sid="CA" + ("f" * 32),
        from_number="+525500000081",
        to_number=PHONE_NUMBER,
        started_at=timezone.now(),
    )
    payload = {
        "AccountSid": ACCOUNT_SID,
        "CallSid": target.call_sid,
        "From": target.from_number,
        "To": PHONE_NUMBER,
        "Digits": "1",
    }

    response = _signed_post(
        api_client,
        "/api/voice/twilio/consent/",
        payload,
    )

    assert response.status_code == 200
    root = ElementTree.fromstring(response.content)
    assert root.find(".//Stream") is None
    assert root.find(".//Hangup") is not None
    assert "ocupadas" in response.content.decode("utf-8")
    target.refresh_from_db()
    assert target.consent_granted is True
    assert target.ai_outcome == "unsuccessful"
    assert target.extracted_data["requires_manual_follow_up"] is True
    assert "age_band" not in target.extracted_data
    assert "privacy_blocked" not in target.extracted_data


@override_settings(
    TWILIO_AUTH_TOKEN=AUTH_TOKEN,
    TWILIO_STREAM_URL=STREAM_URL,
    TWILIO_VALIDATE_SIGNATURES=True,
)
def test_websocket_upgrade_signature_is_validated():
    signature = RequestValidator(AUTH_TOKEN).compute_signature(STREAM_URL, {})
    scope = {
        "headers": [(b"x-twilio-signature", signature.encode("latin-1"))],
    }
    assert _websocket_signature_valid(scope) is True
    assert (
        _websocket_signature_valid(
            {"headers": [(b"x-twilio-signature", b"invalid")]}
        )
        is False
    )


@override_settings(
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=30,
    TRIAL_MIN_DAYS_BETWEEN_VISITS=1,
    TRIAL_MAX_DAYS_BETWEEN_VISITS=21,
)
def test_voice_booking_creates_exactly_two_visits_and_is_idempotent():
    site = make_site()
    court = Court.objects.create(site=site, name="Cancha de prueba")
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
    call = VoiceCall.objects.create(
        call_sid="CA" + ("3" * 32),
        from_number="+525500000002",
        to_number=PHONE_NUMBER,
        consent_granted=True,
        consent_granted_at=timezone.now(),
    )

    availability = list_trial_availability(
        site_id=site.id,
        start_date=first_day.isoformat(),
        end_date=(first_day + timedelta(days=8)).isoformat(),
        limit=20,
    )
    candidate_days = {}
    for slot in availability["slots"]:
        candidate_days.setdefault(slot["starts_at"][:10], slot)
    assert len(candidate_days) >= 2
    selected = list(candidate_days.values())[:2]
    selected_visits = [
        {
            "starts_at": slot["starts_at"],
            "court_id": court.id,
        }
        for slot in selected
    ]

    result = book_two_trial_visits(
        voice_call_id=call.id,
        tool_call_id="tool-book-1",
        site_id=site.id,
        responsible_name="Andrea Perez",
        responsible_phone="+525500000002",
        responsible_email="andrea@example.com",
        child_first_name="Leo",
        child_age=9,
        visits=selected_visits,
    )
    assert result["ok"] is True
    assert len(result["visits"]) == 2
    call.refresh_from_db()
    assert call.booking_id == result["booking_id"]
    assert call.booking.child_first_name == "Leo"
    assert call.booking.child_age == 9
    assert call.booking.visits.count() == 2
    assert call.ai_outcome == "successful"

    repeated = book_two_trial_visits(
        voice_call_id=call.id,
        tool_call_id="tool-book-1",
        site_id=site.id,
        responsible_name="Otro nombre",
        responsible_phone="+525500000099",
        child_first_name="Leo",
        child_age=13,
        visits=selected_visits,
    )
    assert repeated["booking_id"] == result["booking_id"]
    assert call.booking.__class__.objects.count() == 1

    competing_call = VoiceCall.objects.create(
        call_sid="CA" + ("4" * 32),
        from_number="+525500000004",
        to_number=PHONE_NUMBER,
        consent_granted=True,
        consent_granted_at=timezone.now(),
    )
    with pytest.raises(SchedulingError, match="llenarse"):
        book_two_trial_visits(
            voice_call_id=competing_call.id,
            tool_call_id="tool-book-2",
            site_id=site.id,
            responsible_name="Competidor",
            responsible_phone="+525500000004",
            child_first_name="Mia",
            child_age=13,
            visits=selected_visits,
        )
