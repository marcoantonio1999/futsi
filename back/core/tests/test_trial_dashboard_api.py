from datetime import timedelta

import pytest
from django.utils import timezone

from core.models import (
    AuditLog,
    CallTranscriptSegment,
    Court,
    TrialBooking,
    VoiceCall,
)
from core.tests.factories import make_site, make_user


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def make_trial_booking(site, **overrides):
    values = {
        "site": site,
        "responsible_name": "Andrea Perez",
        "responsible_phone": "+525500000001",
        "responsible_email": "andrea@example.com",
        "child_first_name": "Leo",
        "child_age": 9,
        "source": "voice",
    }
    values.update(overrides)
    return TrialBooking.objects.create(**values)


def make_voice_call(booking=None, **overrides):
    values = {
        "call_sid": f"CA{VoiceCall.objects.count() + 1:032d}",
        "from_number": "+525500000001",
        "to_number": "+14014090000",
        "booking": booking,
        "technical_status": "completed",
    }
    values.update(overrides)
    return VoiceCall.objects.create(**values)


def test_trial_dashboard_requires_an_authorized_role(api_client, auth_client):
    site = make_site()
    make_trial_booking(site)

    anonymous_response = api_client.get("/api/trial-bookings/")
    assert anonymous_response.status_code == 401

    cashier_client, _payload, _user = auth_client(role="cashier", primary_site=site)
    cashier_response = cashier_client.get("/api/trial-bookings/")
    assert cashier_response.status_code == 403


@pytest.mark.parametrize("role", ["admin", "owner", "dev"])
def test_admin_roles_have_global_trial_dashboard_access(auth_client, role):
    first_site = make_site()
    second_site = make_site()
    bookings = [
        make_trial_booking(first_site),
        make_trial_booking(second_site, responsible_phone="+525500000002"),
    ]

    client, _payload, _user = auth_client(role=role)
    response = client.get("/api/trial-bookings/")

    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {
        booking.id for booking in bookings
    }


def test_site_coordinator_is_scoped_and_cannot_read_transcripts(auth_client):
    first_site = make_site()
    second_site = make_site()
    coordinator = make_user(role="site_coordinator", primary_site=first_site)
    visible_booking = make_trial_booking(first_site)
    hidden_booking = make_trial_booking(
        second_site,
        responsible_phone="+525500000002",
        child_first_name="Mia",
    )
    visible_call = make_voice_call(visible_booking)
    hidden_call = make_voice_call(hidden_booking)
    CallTranscriptSegment.objects.create(
        call=visible_call,
        sequence=1,
        speaker="caller",
        text="Quiero agendar una prueba.",
        item_id="item-1",
    )

    client, _payload, _user = auth_client(user=coordinator)

    bookings_response = client.get("/api/trial-bookings/")
    assert bookings_response.status_code == 200
    assert [item["id"] for item in bookings_response.json()] == [
        visible_booking.id
    ]

    calls_response = client.get("/api/voice-calls/")
    assert calls_response.status_code == 200
    assert [item["id"] for item in calls_response.json()] == [visible_call.id]
    assert calls_response.json()[0]["transcript_segments"] == []
    assert hidden_call.id not in {item["id"] for item in calls_response.json()}

    hidden_detail_response = client.get(
        f"/api/trial-bookings/{hidden_booking.id}/"
    )
    assert hidden_detail_response.status_code == 404

    foreign_create_response = client.post(
        "/api/trial-bookings/",
        {
            "site": second_site.id,
            "responsible_name": "Fuera de sede",
            "responsible_phone": "+525500000003",
            "child_first_name": "Alex",
            "child_age": 8,
            "source": "manual",
        },
        format="json",
    )
    assert foreign_create_response.status_code == 403

    unassigned_call_response = client.post(
        "/api/voice-calls/",
        {
            "call_sid": "CA-unassigned-coordinator",
            "from_number": "+525500000004",
            "to_number": "+14014090000",
        },
        format="json",
    )
    assert unassigned_call_response.status_code == 405


def test_admin_receives_nested_visits_and_transcript_segments(auth_client):
    site = make_site()
    court = Court.objects.create(site=site, name="Cancha pruebas")
    booking = make_trial_booking(site)
    starts_at = timezone.now() + timedelta(days=1)
    booking.visits.create(
        site=site,
        court=court,
        visit_number=1,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=1),
    )
    call = make_voice_call(booking)
    call.extracted_data = {
        "private": "not-exposed",
        "openai_realtime_usage": {
            "response_count": 3,
            "total_tokens": 425,
            "input_tokens": 300,
            "output_tokens": 125,
        },
    }
    call.save(update_fields=["extracted_data", "updated_at"])
    segment = CallTranscriptSegment.objects.create(
        call=call,
        sequence=1,
        speaker="assistant",
        text="Te propongo el martes a las cinco.",
        item_id="response-1",
    )

    client, _payload, _user = auth_client(role="admin")
    booking_response = client.get(f"/api/trial-bookings/{booking.id}/")
    call_response = client.get(f"/api/voice-calls/{call.id}/")

    assert booking_response.status_code == 200
    assert booking_response.json()["visits"][0]["visit_number"] == 1
    assert call_response.status_code == 200
    assert call_response.json()["transcript_segments"][0]["id"] == segment.id
    assert call_response.json()["token_usage"]["total_tokens"] == 425
    assert "extracted_data" not in call_response.json()


def test_trial_visit_and_availability_validations(auth_client):
    first_site = make_site()
    second_site = make_site()
    foreign_court = Court.objects.create(site=second_site, name="Cancha ajena")
    booking = make_trial_booking(first_site)
    starts_at = timezone.now() + timedelta(days=2)
    client, _payload, _user = auth_client(role="admin")

    invalid_age_response = client.post(
        "/api/trial-bookings/",
        {
            "site": first_site.id,
            "responsible_name": "Responsable",
            "responsible_phone": "+525500000005",
            "child_first_name": "Noa",
            "child_age": 2,
        },
        format="json",
    )
    assert invalid_age_response.status_code == 400
    assert "child_age" in invalid_age_response.json()

    invalid_time_response = client.post(
        "/api/trial-visits/",
        {
            "booking": booking.id,
            "site": first_site.id,
            "visit_number": 1,
            "starts_at": starts_at.isoformat(),
            "ends_at": (starts_at - timedelta(minutes=1)).isoformat(),
        },
        format="json",
    )
    assert invalid_time_response.status_code == 400
    assert "ends_at" in invalid_time_response.json()

    foreign_court_response = client.post(
        "/api/trial-visits/",
        {
            "booking": booking.id,
            "site": first_site.id,
            "court": foreign_court.id,
            "visit_number": 1,
            "starts_at": starts_at.isoformat(),
            "ends_at": (starts_at + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )
    assert foreign_court_response.status_code == 400
    assert "court" in foreign_court_response.json()

    valid_visit_response = client.post(
        "/api/trial-visits/",
        {
            "booking": booking.id,
            "site": first_site.id,
            "visit_number": 1,
            "starts_at": starts_at.isoformat(),
            "ends_at": (starts_at + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )
    assert valid_visit_response.status_code == 201

    duplicate_visit_response = client.post(
        "/api/trial-visits/",
        {
            "booking": booking.id,
            "site": first_site.id,
            "visit_number": 1,
            "starts_at": (starts_at + timedelta(days=1)).isoformat(),
            "ends_at": (starts_at + timedelta(days=1, hours=1)).isoformat(),
        },
        format="json",
    )
    assert duplicate_visit_response.status_code == 400

    third_visit_response = client.post(
        "/api/trial-visits/",
        {
            "booking": booking.id,
            "site": first_site.id,
            "visit_number": 3,
            "starts_at": (starts_at + timedelta(days=2)).isoformat(),
            "ends_at": (starts_at + timedelta(days=2, hours=1)).isoformat(),
        },
        format="json",
    )
    assert third_visit_response.status_code == 400

    invalid_rule_response = client.post(
        "/api/trial-availability-rules/",
        {
            "site": first_site.id,
            "weekday": 2,
            "starts_at": "18:00:00",
            "ends_at": "17:00:00",
            "slot_minutes": 60,
            "capacity": 1,
        },
        format="json",
    )
    assert invalid_rule_response.status_code == 400
    assert "ends_at" in invalid_rule_response.json()

    foreign_rule_response = client.post(
        "/api/trial-availability-rules/",
        {
            "site": first_site.id,
            "court": foreign_court.id,
            "weekday": 2,
            "starts_at": "17:00:00",
            "ends_at": "19:00:00",
            "slot_minutes": 60,
            "capacity": 1,
        },
        format="json",
    )
    assert foreign_rule_response.status_code == 400
    assert "court" in foreign_rule_response.json()


def test_voice_call_review_is_validated_and_audited(auth_client):
    site = make_site()
    booking = make_trial_booking(site)
    call = make_voice_call(booking)
    client, _payload, reviewer = auth_client(role="admin")

    missing_reason_response = client.post(
        f"/api/voice-calls/{call.id}/review/",
        {"review_outcome": "unsuccessful"},
        format="json",
    )
    assert missing_reason_response.status_code == 400

    review_response = client.post(
        f"/api/voice-calls/{call.id}/review/",
        {
            "review_outcome": "unsuccessful",
            "failure_reason": "No habia un horario compatible.",
        },
        format="json",
    )
    assert review_response.status_code == 200

    call.refresh_from_db()
    assert call.review_outcome == "unsuccessful"
    assert call.failure_reason == "No habia un horario compatible."
    assert call.reviewed_by == reviewer
    assert call.reviewed_at is not None

    audit = AuditLog.objects.get(
        action="voice_call_reviewed",
        table_name="voice_calls",
        record_id=str(call.id),
    )
    assert audit.actor == reviewer
    assert audit.previous_values["review_outcome"] == "pending"
    assert audit.new_values["review_outcome"] == "unsuccessful"


def test_site_coordinator_cannot_review_another_sites_call(auth_client):
    first_site = make_site()
    second_site = make_site()
    call = make_voice_call(make_trial_booking(second_site))
    coordinator = make_user(role="site_coordinator", primary_site=first_site)
    client, _payload, _user = auth_client(user=coordinator)

    response = client.post(
        f"/api/voice-calls/{call.id}/review/",
        {"review_outcome": "successful"},
        format="json",
    )

    assert response.status_code == 404
    call.refresh_from_db()
    assert call.review_outcome == "pending"


def test_voice_call_sanitizes_errors_and_timestamps_consent(auth_client):
    client, _payload, _user = auth_client(role="admin")
    raw_secret = "sk-proj-this-must-not-be-persisted"
    raw_token = "top-secret-token-value"

    response = client.post(
        "/api/voice-calls/",
        {
            "call_sid": "CA-sanitized-error",
            "from_number": "+525500000010",
            "to_number": "+14014090000",
            "sanitized_error": (
                f"OpenAI {raw_secret}; token={raw_token}; "
                "Authorization: Bearer another-secret-value"
            ),
            "consent_granted": True,
            "extracted_data": {"requested_site": "Roma"},
        },
        format="json",
    )

    assert response.status_code == 405
    call = VoiceCall.objects.create(
        call_sid="CA-sanitized-error",
        from_number="+525500000010",
        to_number="+14014090000",
        sanitized_error=(
            f"OpenAI {raw_secret}; token={raw_token}; "
            "Authorization: Bearer another-secret-value"
        ),
        consent_granted=True,
        consent_granted_at=timezone.now(),
        extracted_data={"requested_site": "Roma"},
    )
    assert raw_secret not in call.sanitized_error
    assert raw_token not in call.sanitized_error
    assert "[REDACTED]" in call.sanitized_error
    assert call.consent_granted_at is not None
