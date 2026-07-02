from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from core.models import Charge, Guardian, Site, Student, StudentTournamentRegistration, Team, Tournament, User


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_generate_scheduled_charges_is_scoped_and_idempotent_for_cashier(api_client):
    site = Site.objects.create(name="QA Billing", code="qa-billing", address="QA")
    cashier = User.objects.create_user(username="qa-billing-cashier", password="x", role="cashier", primary_site=site)
    guardian = Guardian.objects.create(full_name="Tutor Billing QA", phone="5500000101", email="billing@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Billing QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        joined_at=date(2026, 1, 1),
    )
    tournament = Tournament.objects.create(
        site=site,
        name="Liga Billing QA",
        billing_type="weekly_match",
        starts_on=date(2026, 6, 1),
        expected_weeks=6,
    )
    team = Team.objects.create(
        tournament=tournament,
        name="Equipo Billing QA",
        representative_name="Representante Billing",
        representative_phone="5500000102",
    )
    registration = StudentTournamentRegistration.objects.create(
        tournament=tournament,
        student=student,
        team=team,
        billing_type="weekly_match",
        weekly_amount=Decimal("321.00"),
        full_amount=Decimal("1926.00"),
        billing_starts_on=date(2026, 6, 1),
        status="registered",
        registered_by=cashier,
    )

    api_client.force_authenticate(user=cashier)
    with patch("core.api.billing_generators.timezone.localdate", return_value=date(2026, 6, 10)):
        first_response = api_client.post("/api/charges/generate-scheduled/")
        second_response = api_client.post("/api/charges/generate-scheduled/")

    assert first_response.status_code == 200
    assert first_response.json()["created"] == 3
    assert second_response.status_code == 200
    assert second_response.json()["created"] == 0

    created = Charge.objects.filter(site=site).order_by("concept", "student_id", "team_id")
    assert created.count() == 3
    monthly = created.get(concept="Mensualidad")
    team_weekly = created.get(concept="Jornada torneo", team=team)
    student_weekly = created.get(concept="Jornada torneo alumno", tournament_registration=registration)

    assert monthly.student == student
    assert monthly.amount == Decimal("1500.00")
    assert monthly.due_date == date(2026, 6, 10)
    assert team_weekly.amount == Decimal("750.00")
    assert team_weekly.due_date == date(2026, 6, 12)
    assert student_weekly.student == student
    assert student_weekly.amount == Decimal("321.00")
    assert student_weekly.due_date == date(2026, 6, 12)
    assert student_weekly.jornada_number == 2


def test_generate_scheduled_due_soon_count_is_scoped_and_excludes_closed_charges(api_client):
    today = date(2026, 7, 1)
    site = Site.objects.create(name="QA Due Soon", code="qa-due-soon", address="QA")
    other_site = Site.objects.create(name="QA Due Soon Other", code="qa-due-soon-other", address="QA")
    cashier = User.objects.create_user(username="qa-due-soon-cashier", password="x", role="cashier", primary_site=site)
    guardian = Guardian.objects.create(full_name="Tutor Due Soon QA", phone="5500000201", email="due@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Due Soon QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        joined_at=date(2026, 1, 1),
    )
    other_student = Student.objects.create(
        site=other_site,
        guardian=guardian,
        full_name="Alumno Due Soon Other QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        joined_at=date(2026, 1, 1),
    )

    due_cases = [
        (site, student, today - timedelta(days=3), "pending"),
        (site, student, today + timedelta(days=2), "partial"),
        (site, student, today + timedelta(days=3), "pending"),
        (site, student, today, "paid"),
        (site, student, today, "canceled"),
        (other_site, other_student, today, "pending"),
    ]
    for index, (charge_site, charge_student, due_date, status) in enumerate(due_cases):
        Charge.objects.create(
            site=charge_site,
            student=charge_student,
            concept=f"Aviso QA {index}",
            amount=Decimal("100.00"),
            due_date=due_date,
            status=status,
            created_by=cashier,
        )
    Charge.objects.create(
        site=site,
        student=student,
        concept="Aviso sin fecha QA",
        amount=Decimal("100.00"),
        due_date=None,
        status="pending",
        created_by=cashier,
    )

    api_client.force_authenticate(user=cashier)
    with patch("core.api.billing.timezone.localdate", return_value=today), patch("core.api.billing_generators.timezone.localdate", return_value=today):
        response = api_client.post("/api/charges/generate-scheduled/")

    assert response.status_code == 200
    assert response.json()["due_soon"] == 2


def test_generate_scheduled_idempotent_run_keeps_query_count_bounded(api_client):
    site = Site.objects.create(name="QA Query Count Billing", code="qa-query-count-billing", address="QA")
    admin = User.objects.create_user(username="qa-query-count-admin", password="x", role="admin", primary_site=site)
    guardian = Guardian.objects.create(full_name="Tutor Query Count QA", phone="5500000301", email="query-count@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Query Count QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        joined_at=date(2026, 1, 1),
    )
    tournament = Tournament.objects.create(
        site=site,
        name="Liga Query Count QA",
        billing_type="weekly_match",
        starts_on=date(2026, 6, 1),
        expected_weeks=6,
    )
    team = Team.objects.create(
        tournament=tournament,
        name="Equipo Query Count QA",
        representative_name="Representante Query Count",
        representative_phone="5500000302",
    )
    StudentTournamentRegistration.objects.create(
        tournament=tournament,
        student=student,
        team=team,
        billing_type="weekly_match",
        weekly_amount=Decimal("321.00"),
        full_amount=Decimal("1926.00"),
        billing_starts_on=date(2026, 6, 1),
        status="registered",
        registered_by=admin,
    )
    api_client.force_authenticate(user=admin)

    with patch("core.api.billing.timezone.localdate", return_value=date(2026, 6, 10)), patch("core.api.billing_generators.timezone.localdate", return_value=date(2026, 6, 10)):
        first_response = api_client.post("/api/charges/generate-scheduled/")
        with CaptureQueriesContext(connection) as captured:
            second_response = api_client.post("/api/charges/generate-scheduled/")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["created"] == 0
    assert len(captured) <= 15
