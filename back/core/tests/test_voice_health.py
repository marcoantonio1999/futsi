from datetime import time

import pytest
from django.test import override_settings

from core.models import TrialAvailabilityRule
from core.tests.factories import make_site


pytestmark = [pytest.mark.api, pytest.mark.django_db]


VOICE_READY_SETTINGS = {
    "OPENAI_API_KEY": "sk-proj-" + ("a" * 32),
    "TWILIO_ACCOUNT_SID": "AC" + ("1" * 32),
    "TWILIO_AUTH_TOKEN": "2" * 32,
    "TWILIO_PHONE_NUMBER": "+14014090000",
    "TWILIO_PUBLIC_BASE_URL": "https://voice.example.test",
    "TWILIO_STREAM_URL": "wss://voice.example.test/ws/voice/twilio/",
    "TWILIO_VALIDATE_SIGNATURES": True,
}


@override_settings(**VOICE_READY_SETTINGS)
def test_voice_health_requires_active_availability_without_exposing_secrets(api_client):
    unavailable = api_client.get("/health/voice/")

    assert unavailable.status_code == 503
    assert unavailable.json() == {
        "status": "not_ready",
        "configured": True,
        "secure_transport": True,
        "signature_validation": True,
        "database": True,
        "active_availability_rules": 0,
    }
    serialized = unavailable.content.decode("utf-8")
    assert VOICE_READY_SETTINGS["OPENAI_API_KEY"] not in serialized
    assert VOICE_READY_SETTINGS["TWILIO_AUTH_TOKEN"] not in serialized

    site = make_site()
    TrialAvailabilityRule.objects.create(
        site=site,
        weekday=0,
        starts_at=time(17, 0),
        ends_at=time(19, 0),
        slot_minutes=60,
        capacity=1,
    )

    ready = api_client.get("/health/voice/")

    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["active_availability_rules"] == 1


@override_settings(
    **{
        **VOICE_READY_SETTINGS,
        "TWILIO_PUBLIC_BASE_URL": "http://voice.example.test/path",
        "TWILIO_STREAM_URL": "ws://other.example.test/ws/voice/twilio/",
    }
)
def test_voice_health_fails_closed_for_insecure_or_mismatched_urls(api_client):
    site = make_site()
    TrialAvailabilityRule.objects.create(
        site=site,
        weekday=0,
        starts_at=time(17, 0),
        ends_at=time(18, 0),
        slot_minutes=60,
        capacity=1,
    )

    response = api_client.get("/health/voice/")

    assert response.status_code == 503
    assert response.json()["secure_transport"] is False
    assert response.json()["status"] == "not_ready"


@override_settings(**VOICE_READY_SETTINGS)
def test_voice_health_ignores_rules_from_inactive_sites(api_client):
    site = make_site(is_active=False)
    TrialAvailabilityRule.objects.create(
        site=site,
        weekday=0,
        starts_at=time(17, 0),
        ends_at=time(18, 0),
        slot_minutes=60,
        capacity=1,
    )

    response = api_client.get("/health/voice/")

    assert response.status_code == 503
    assert response.json()["active_availability_rules"] == 0
