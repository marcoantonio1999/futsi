from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from core.models import Court, TrialAvailabilityRule, VoiceCall
from core.tests.factories import make_site
from core.voice.scheduling import SchedulingError, book_two_trial_visits


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def _iso_at(day, hour=17):
    return datetime.combine(
        day,
        time(hour, 0),
        tzinfo=ZoneInfo(settings.TIME_ZONE),
    ).isoformat()


def _voice_call():
    return VoiceCall.objects.create(
        call_sid=f"CA{VoiceCall.objects.count() + 50:032d}",
        from_number="+525500000050",
        to_number="+14014090000",
        consent_granted=True,
        consent_granted_at=timezone.now(),
    )


def _booking_arguments(call, site, court, first_day):
    return {
        "voice_call_id": call.id,
        "tool_call_id": f"tool-{call.id}",
        "site_id": site.id,
        "responsible_name": "Responsable QA",
        "responsible_phone": "+525500000050",
        "child_first_name": "Alex",
        "child_age": 14,
        "visits": [
            {"starts_at": _iso_at(first_day), "court_id": court.id},
            {
                "starts_at": _iso_at(first_day + timedelta(days=7)),
                "court_id": court.id,
            },
        ],
    }


@override_settings(
    TRIAL_MIN_ADVANCE_HOURS=2,
    TRIAL_BOOKING_HORIZON_DAYS=30,
)
def test_booking_tool_rejects_past_slots_even_when_a_recurring_rule_matches():
    site = make_site()
    court = Court.objects.create(site=site, name="Cancha segura")
    past_day = timezone.localdate() - timedelta(days=7)
    TrialAvailabilityRule.objects.create(
        site=site,
        court=court,
        weekday=past_day.weekday(),
        starts_at=time(17, 0),
        ends_at=time(19, 0),
        slot_minutes=60,
        capacity=2,
    )

    with pytest.raises(SchedulingError, match="anticipación"):
        book_two_trial_visits(
            **_booking_arguments(_voice_call(), site, court, past_day)
        )


@override_settings(
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=30,
)
def test_booking_tool_rejects_slots_outside_the_booking_horizon():
    site = make_site()
    court = Court.objects.create(site=site, name="Cancha segura")
    distant_day = timezone.localdate() + timedelta(days=35)
    TrialAvailabilityRule.objects.create(
        site=site,
        court=court,
        weekday=distant_day.weekday(),
        starts_at=time(17, 0),
        ends_at=time(19, 0),
        slot_minutes=60,
        capacity=2,
    )

    with pytest.raises(SchedulingError, match="horizonte"):
        book_two_trial_visits(
            **_booking_arguments(_voice_call(), site, court, distant_day)
        )


@override_settings(
    TRIAL_MIN_ADVANCE_HOURS=0,
    TRIAL_BOOKING_HORIZON_DAYS=30,
)
def test_booking_accepts_a_child_younger_than_thirteen():
    site = make_site()
    court = Court.objects.create(site=site, name="Cancha privada")
    first_day = timezone.localdate() + timedelta(days=2)
    for day in (first_day, first_day + timedelta(days=7)):
        TrialAvailabilityRule.objects.create(
            site=site,
            court=court,
            weekday=day.weekday(),
            starts_at=time(17, 0),
            ends_at=time(19, 0),
            slot_minutes=60,
            capacity=2,
        )
    call = _voice_call()
    arguments = _booking_arguments(call, site, court, first_day)
    arguments["child_age"] = 8

    result = book_two_trial_visits(**arguments)

    assert result["ok"] is True
    call.refresh_from_db()
    assert call.booking.child_age == 8


@pytest.mark.parametrize("invalid_age", [2, 18])
def test_booking_keeps_the_business_age_range_between_three_and_seventeen(
    invalid_age,
):
    site = make_site()
    court = Court.objects.create(site=site, name="Cancha privada")
    first_day = timezone.localdate() + timedelta(days=2)
    arguments = _booking_arguments(_voice_call(), site, court, first_day)
    arguments["child_age"] = invalid_age

    with pytest.raises(SchedulingError, match="entre 3 y 17"):
        book_two_trial_visits(**arguments)
