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
    assert api_client.get("/api/dashboard/summary/", {"site": other_site.id}).status_code == 404


def test_dashboard_filters_financial_period_but_preserves_current_balances(api_client):
    site = Site.objects.create(name="Periodos QA", code="qa-period", address="QA")
    other = Site.objects.create(name="Otra QA", code="qa-other-period", address="QA")
    admin = User.objects.create_user(username="period-admin", password="x", role="admin")
    student = _student(site)
    charge = Charge.objects.create(site=site, student=student, concept="Mensualidad", amount=1000,
                                   due_date=date(2026, 5, 1), created_by=admin)
    for month, amount in [(5, 100), (6, 200)]:
        Payment.objects.create(site=site, charge=charge, student=student, amount=amount,
                               method="cash", status="registered", paid_at=_aware(2026, month, 10),
                               confirmed_at=_aware(2026, month, 10), received_by=admin)
        Expense.objects.create(site=site, category="Renta", amount=20, status="approved",
                               expense_date=date(2026, month, 11), captured_by=admin)
    Payment.objects.create(site=other, amount=900, method="cash", status="registered",
                           paid_at=_aware(2026, 6, 10), received_by=admin)
    Payment.objects.create(site=site, charge=charge, amount=50, method="card", status="processing",
                           paid_at=_aware(2026, 5, 10), received_by=admin)
    Expense.objects.create(site=site, category="Renta", amount=40, status="pending",
                           expense_date=date(2026, 5, 11), captured_by=admin)
    api_client.force_authenticate(user=admin)
    response = api_client.get("/api/dashboard/summary/", {"site": site.id, "month": "2026-06"})
    assert response.status_code == 200
    body = response.json()
    assert body["context"]["month"] == "2026-06"
    assert body["context"]["available_months"] == ["2026-05", "2026-06"]
    assert body["context"]["generated_at"]
    assert [row["id"] for row in body["site_rows"]] == [site.id]
    assert body["metrics"]["total_income"] == 200
    assert body["metrics"]["approved_expenses"] == 20
    assert body["metrics"]["utility"] == 180
    assert body["metrics"]["open_balance"] == 700
    assert body["metrics"]["pending_payment_total"] == 50
    assert body["metrics"]["pending_expenses"] == 40
    assert body["metrics"]["ticket_average"]["amount"] == 200
    assert body["method_rows"][0]["value"] == 200
    assert {row["month"] for row in body["monthly_rows"]} == {"2026-06"}
    empty = api_client.get("/api/dashboard/summary/", {"site": site.id, "month": "2026-07"}).json()
    assert empty["metrics"]["total_income"] == 0
    assert empty["metrics"]["open_balance"] == 700
    assert empty["metrics"]["ticket_average"]["month_key"] == "2026-07"


@pytest.mark.parametrize("month", ["2026-13", "2026-6", "invalid", "2026-06-10"])
def test_dashboard_rejects_invalid_period(api_client, month):
    user = User.objects.create_user(username="invalid-period", password="x", role="admin")
    api_client.force_authenticate(user=user)
    assert api_client.get("/api/dashboard/summary/", {"month": month}).status_code == 400
