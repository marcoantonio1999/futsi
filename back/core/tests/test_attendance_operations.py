from datetime import date, time
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from core.models import AttendanceSession, CoachWorkLog, Site, User


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_attendance_session_close_is_idempotent(api_client):
    site = Site.objects.create(name="QA Asistencia", code="qa-asistencia", address="QA")
    cashier = User.objects.create_user(username="qa-attendance-cashier", password="x", role="cashier", primary_site=site)
    session = AttendanceSession.objects.create(
        site=site,
        session_type="academy_class",
        date=date(2026, 7, 1),
        starts_at=time(17, 0),
        group_name="QA",
        captured_by=cashier,
    )

    first_closed_at = timezone.make_aware(timezone.datetime(2026, 7, 1, 19, 0))
    second_closed_at = timezone.make_aware(timezone.datetime(2026, 7, 1, 20, 0))
    api_client.force_authenticate(user=cashier)
    with patch("core.api.attendance.timezone.now", return_value=first_closed_at):
        first_response = api_client.post(f"/api/attendance-sessions/{session.id}/close/")
    with patch("core.api.attendance.timezone.now", return_value=second_closed_at):
        second_response = api_client.post(f"/api/attendance-sessions/{session.id}/close/")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    session.refresh_from_db()
    assert session.closed_at == first_closed_at
    assert second_response.json()["closed_at"].startswith("2026-07-01T19:00:00")


def test_coach_work_log_uses_authenticated_coach_scope_and_rate(api_client):
    site = Site.objects.create(name="QA Coach", code="qa-coach", address="QA")
    other_site = Site.objects.create(name="QA Coach Otra", code="qa-coach-otra", address="QA")
    coach = User.objects.create_user(
        username="qa-coach",
        password="x",
        role="coach",
        primary_site=site,
        coach_group_name="Sub-10 QA",
        coach_hourly_rate=Decimal("275.50"),
    )

    api_client.force_authenticate(user=coach)
    response = api_client.post(
        "/api/coach-work-logs/",
        {
            "site": other_site.id,
            "coach": coach.id,
            "group_name": "No debe usarse",
            "hourly_rate_snapshot": "1.00",
            "work_date": "2026-07-02",
            "hours": "2.25",
            "activity": "Entrenamiento",
            "notes": "QA",
        },
        format="json",
    )

    assert response.status_code == 201
    work_log = CoachWorkLog.objects.get(id=response.json()["id"])
    assert work_log.coach == coach
    assert work_log.site == site
    assert work_log.group_name == "Sub-10 QA"
    assert work_log.hourly_rate_snapshot == Decimal("275.50")
    assert response.json()["total_amount"] == "619.8750"
