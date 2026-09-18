from datetime import date
from uuid import uuid4
from unittest.mock import patch

import pytest
from core.models import BillingPlan, Charge, Payment, Discount
from core.api.billing_recurrence import installment_dates
from core.api.billing_generators import generate_scheduled_charges_for_user
from core.tests.factories import make_student, make_user, make_student_tournament_registration, make_charge

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def payload(student, **extra):
    return {"request_key": str(uuid4()), "student": student.id, "concept": "Mensualidad", "amount": "1250.00", "discount_amount": "250.00", "reason": "Hermanos", "first_due_date": "2026-09-07", "day_of_month": 7, "installments": 6, **extra}


def test_finite_plan_replay_and_existing_payment_flow(api_client):
    student, user = make_student(), make_user()
    api_client.force_authenticate(user)
    body = payload(student)
    response = api_client.post("/api/charges/recurring/", body, format="json")
    assert response.status_code == 201, response.content
    charges = response.json()["charges"]
    assert len(charges) == 6
    assert charges[0]["due_date"] == "2026-09-07" and charges[-1]["due_date"] == "2027-02-07"
    assert all(float(c["balance"]) == 1000 and c["status"] == "partial" and float(c["paid_amount"]) == 0 for c in charges)
    assert Payment.objects.count() == 0 and Discount.objects.count() == 6
    assert api_client.post("/api/charges/recurring/", body, format="json").status_code == 200
    assert Charge.objects.count() == 6
    duplicate = api_client.post("/api/charges/recurring/", {**body, "request_key": str(uuid4())}, format="json")
    assert duplicate.status_code == 400 and Charge.objects.count() == 6
    assert not [c for c in generate_scheduled_charges_for_user(user, date(2027, 3, 1)) if c.student_id == student.id]
    paid = api_client.post("/api/payments/", {"charge": charges[0]["id"], "amount": "1000", "method": "cash", "channel": "cash_confirmation"}, format="json")
    assert paid.status_code == 201, paid.content
    assert Payment.objects.count() == 1


def test_tournament_fifteen_months_and_first_payment(api_client):
    reg = make_student_tournament_registration()
    user = make_user()
    api_client.force_authenticate(user)
    response = api_client.post("/api/charges/recurring/", payload(reg.student, installments=15, tournament_registration=reg.id, collect_first=True), format="json")
    assert response.status_code == 201, response.content
    assert Charge.objects.count() == 15 and Payment.objects.count() == 1
    assert Charge.objects.order_by("due_date").last().due_date == date(2027, 11, 7)
    assert Charge.objects.filter(status="paid").count() == 1
    from core.api.billing_generators import generate_student_tournament_charges_for_user
    assert generate_student_tournament_charges_for_user(user, date(2026, 10, 1)) == []


@pytest.mark.parametrize("extra", [{"day_of_month": 0}, {"day_of_month": 32}, {"installments": 0}, {"installments": 121}, {"interval_months": 0}, {"discount_amount": "1300"}, {"first_due_date": "2026-09-08"}, {"amount": "0"}])
def test_invalid_plan_creates_nothing(api_client, extra):
    api_client.force_authenticate(make_user())
    response = api_client.post("/api/charges/recurring/", payload(make_student(), **extra), format="json")
    assert response.status_code == 400
    assert not BillingPlan.objects.exists() and not Charge.objects.exists()


@pytest.mark.parametrize("role", ["cashier", "guardian", "coach", "site_coordinator"])
def test_forbidden_or_wrong_site(api_client, role):
    student = make_student()
    api_client.force_authenticate(make_user(role=role))
    response = api_client.post("/api/charges/recurring/", payload(student), format="json")
    assert response.status_code in (400, 403)
    assert not Charge.objects.exists()


def test_discount_failure_rolls_back_entire_plan(api_client):
    from rest_framework.exceptions import ValidationError
    api_client.force_authenticate(make_user())
    with patch("core.api.billing_recurrence.DiscountSerializer.save", side_effect=ValidationError("Prueba de error")):
        response = api_client.post("/api/charges/recurring/", payload(make_student()), format="json")
    assert response.status_code == 400
    assert not Charge.objects.exists() and not BillingPlan.objects.exists()


def test_pending_discount_cannot_charge_first(api_client):
    student = make_student()
    api_client.force_authenticate(make_user(role="site_coordinator", primary_site=student.site))
    response = api_client.post("/api/charges/recurring/", payload(student, collect_first=True), format="json")
    assert response.status_code == 400 and not Charge.objects.exists()
    response = api_client.post("/api/charges/recurring/", payload(student), format="json")
    assert response.status_code == 201
    assert Discount.objects.filter(status="requested").count() == 6
    assert not Payment.objects.exists()


def test_registration_mismatch_and_prior_charges(api_client):
    reg = make_student_tournament_registration()
    api_client.force_authenticate(make_user())
    assert api_client.post("/api/charges/recurring/", payload(make_student(), tournament_registration=reg.id), format="json").status_code == 400
    make_charge(student=reg.student, tournament_registration=reg)
    assert api_client.post("/api/charges/recurring/", payload(reg.student, tournament_registration=reg.id), format="json").status_code == 400
    assert not BillingPlan.objects.exists()


def test_month_end_and_interval():
    assert installment_dates(date(2028, 1, 31), 31, 3, 1) == [date(2028, 1, 31), date(2028, 2, 29), date(2028, 3, 31)]
    assert installment_dates(date(2026, 12, 7), 7, 3, 2) == [date(2026, 12, 7), date(2027, 2, 7), date(2027, 4, 7)]
