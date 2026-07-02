from datetime import date, datetime, time
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from core.models import AttendanceRecord, AttendanceSession, Charge, Discount, Expense, Guardian, Payment, Site, Student, User


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def _aware(year, month, day, hour=9, minute=0):
    return timezone.make_aware(datetime(year, month, day, hour, minute))


def _student(site, guardian_name="Tutor QA", student_name="Alumno QA"):
    guardian = Guardian.objects.create(full_name=guardian_name, phone=f"55{site.id:08d}", email=f"{site.code}@example.test")
    return Student.objects.create(
        site=site,
        guardian=guardian,
        full_name=student_name,
        category="Sub-12",
        group_name="QA",
        status="active",
        joined_at=date(2026, 1, 10),
    )


def test_dashboard_summary_rolls_up_finance_attendance_and_alerts(api_client):
    site = Site.objects.create(name="QA Dashboard", code="qa-dashboard", address="QA")
    admin = User.objects.create_user(username="qa-dashboard-admin", password="x", role="admin")
    student = _student(site, student_name="Alumno Dashboard")
    paid_at = _aware(2026, 6, 20)
    charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad QA",
        amount=Decimal("1000.00"),
        due_date=date(2026, 6, 10),
        created_by=admin,
    )
    Payment.objects.create(
        site=site,
        charge=charge,
        student=student,
        method="transfer",
        channel="transfer_clabe",
        status="registered",
        amount=Decimal("250.00"),
        paid_at=paid_at,
        confirmed_at=paid_at,
        received_by=admin,
    )
    Payment.objects.create(
        site=site,
        charge=charge,
        student=student,
        method="card",
        channel="card_link",
        status="processing",
        amount=Decimal("30.00"),
        paid_at=paid_at,
        received_by=admin,
    )
    Discount.objects.create(
        site=site,
        charge=charge,
        student=student,
        reason="Beca aprobada",
        amount=Decimal("100.00"),
        status="approved",
        requested_by=admin,
        approved_by=admin,
        approved_at=paid_at,
    )
    Discount.objects.create(
        site=site,
        charge=charge,
        student=student,
        reason="Beca pendiente",
        amount=Decimal("50.00"),
        status="requested",
        requested_by=admin,
    )
    Expense.objects.create(
        site=site,
        category="Arbitraje",
        description="Arbitro final QA",
        amount=Decimal("200.00"),
        expense_date=date(2026, 6, 21),
        status="approved",
        captured_by=admin,
        approved_by=admin,
        approved_at=paid_at,
    )
    Expense.objects.create(
        site=site,
        category="Material",
        description="Balones QA",
        amount=Decimal("40.00"),
        expense_date=date(2026, 6, 22),
        status="pending",
        captured_by=admin,
    )
    session = AttendanceSession.objects.create(
        site=site,
        session_type="academy_class",
        date=date(2026, 6, 21),
        starts_at=time(17, 0),
        group_name="QA",
        captured_by=admin,
    )
    AttendanceRecord.objects.create(
        session=session,
        student=student,
        status="present",
        had_debt_at_capture=True,
        override_reason="Autorizado por caja",
        captured_by=admin,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get("/api/dashboard/summary/")

    assert response.status_code == 200
    assert len(captured) <= 12
    body = response.json()
    site_row = next(row for row in body["site_rows"] if row["id"] == site.id)
    assert site_row["payments"] == 250.0
    assert site_row["expenses"] == 200.0
    assert site_row["balance"] == 650.0
    assert site_row["attendance"] == 1
    assert site_row["utility"] == 50.0

    monthly_row = next(row for row in body["monthly_rows"] if row["site_id"] == str(site.id) and row["month"] == "2026-06")
    assert monthly_row["ingresos"] == 250.0
    assert monthly_row["egresos"] == 200.0
    assert monthly_row["utilidad"] == 50.0

    assert body["metrics"]["pending_payment_total"] >= 30.0
    assert body["metrics"]["pending_expenses"] >= 40.0
    assert body["metrics"]["requested_discounts"] >= 1
    assert body["metrics"]["attendance_with_debt"] >= 1
    assert any(alert["id"] == f"debt-{student.id}" for alert in body["alerts"])
    assert any(alert["id"].startswith("discount-") and "Alumno Dashboard" in alert["title"] for alert in body["alerts"])
    assert any(alert["id"].startswith("attendance-") and "pago pendiente" in alert["title"] for alert in body["alerts"])


def test_dashboard_summary_limits_cashier_to_primary_site(api_client):
    primary_site = Site.objects.create(name="QA Caja Roma", code="qa-caja-roma", address="Roma")
    other_site = Site.objects.create(name="QA Caja Coyoacan", code="qa-caja-coyoacan", address="Coyoacan")
    cashier = User.objects.create_user(username="qa-cashier", password="x", role="cashier", primary_site=primary_site)
    primary_student = _student(primary_site, guardian_name="Tutor Roma QA", student_name="Alumno Roma QA")
    other_student = _student(other_site, guardian_name="Tutor Coyoacan QA", student_name="Alumno Coyoacan QA")
    Charge.objects.create(
        site=primary_site,
        student=primary_student,
        concept="Mensualidad",
        amount=Decimal("300.00"),
        due_date=date(2026, 6, 10),
        created_by=cashier,
    )
    Charge.objects.create(
        site=other_site,
        student=other_student,
        concept="Mensualidad",
        amount=Decimal("900.00"),
        due_date=date(2026, 6, 10),
        created_by=cashier,
    )

    api_client.force_authenticate(user=cashier)
    response = api_client.get("/api/dashboard/summary/")

    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body["site_rows"]] == [primary_site.id]
    assert body["metrics"]["active_sites"] == 1
    assert body["metrics"]["students"] == 1
    assert body["metrics"]["open_balance"] == 300.0
