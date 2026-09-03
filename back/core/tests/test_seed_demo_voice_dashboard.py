from datetime import timedelta

import pytest
from django.utils import timezone

from core.management.commands.seed_demo import Command
from core.models import (
    CallOutcome,
    Court,
    Site,
    TrialAvailabilityRule,
    TrialBooking,
    TrialBookingSource,
    TrialVisit,
    User,
    VoiceCall,
)


pytestmark = pytest.mark.django_db


def test_voice_dashboard_seed_is_idempotent_and_fictional():
    site = Site.objects.create(name="Roma Demo Seed Test", code="roma-demo-seed-test")
    admin = User.objects.create_user(
        username="admin-demo-seed-test",
        password="test12345",
        role="admin",
        is_staff=True,
    )
    command = Command()

    command._seed_voice_dashboard(site=site, admin=admin)
    _assert_voice_dashboard_demo()

    # Run the voice portion of seed_demo a second time to prove that it updates
    # its stable DEMO records instead of duplicating them.
    command._seed_voice_dashboard(site=site, admin=admin)
    _assert_voice_dashboard_demo()


def _assert_voice_dashboard_demo():
    assert TrialBooking.objects.count() == 1
    assert TrialVisit.objects.count() == 2
    assert VoiceCall.objects.count() == 2
    assert TrialAvailabilityRule.objects.count() == 2

    booking = TrialBooking.objects.get(
        responsible_phone="+10000000001",
        child_first_name="Alex Demo",
        source=TrialBookingSource.VOICE,
    )
    assert booking.responsible_email.endswith(".invalid")
    assert booking.visits.count() == 2

    visits = list(booking.visits.order_by("visit_number"))
    assert [visit.visit_number for visit in visits] == [1, 2]
    assert [timezone.localtime(visit.starts_at).weekday() for visit in visits] == [0, 2]
    assert all(visit.ends_at - visit.starts_at == timedelta(hours=1) for visit in visits)

    court = Court.objects.get(site=booking.site, name="Cancha Demo Voz")
    rules = TrialAvailabilityRule.objects.filter(site=booking.site, court=court)
    assert rules.count() == 2
    assert set(rules.values_list("weekday", flat=True)) == {0, 2}
    assert set(rules.values_list("capacity", flat=True)) == {3}

    calls = VoiceCall.objects.filter(call_sid__startswith="CA_DEMO_VOICE_").order_by(
        "call_sid"
    )
    assert calls.count() == 2
    assert set(calls.values_list("ai_outcome", flat=True)) == {
        CallOutcome.SUCCESSFUL,
        CallOutcome.UNSUCCESSFUL,
    }
    assert set(calls.values_list("review_outcome", flat=True)) == {
        CallOutcome.SUCCESSFUL,
        CallOutcome.UNSUCCESSFUL,
    }
    assert set(calls.values_list("from_number", flat=True)) == {"+10000000001"}
    assert set(calls.values_list("to_number", flat=True)) == {"+10000000000"}
    assert calls.get(call_sid="CA_DEMO_VOICE_UNSUCCESSFUL").booking is None
    assert calls.get(call_sid="CA_DEMO_VOICE_SUCCESSFUL").booking == booking

    segment_counts = {
        call.call_sid: call.transcript_segments.count()
        for call in calls
    }
    assert segment_counts == {
        "CA_DEMO_VOICE_SUCCESSFUL": 5,
        "CA_DEMO_VOICE_UNSUCCESSFUL": 3,
    }
