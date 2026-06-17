from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from core.models import Charge, Discount, Expense, User
from core.serializers import charge_balance


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_demo_flow_crosses_attendance_billing_discounts_and_expenses(admin_client):
    students = admin_client.get("/api/students/").json()
    luis = next(student for student in students if student["full_name"] == "Luis Gomez")

    session_response = admin_client.post(
        "/api/attendance-sessions/",
        {
            "site": luis["site"],
            "session_type": "academy_class",
            "date": "2026-05-26",
            "starts_at": "17:00",
            "group_name": luis["group_name"],
        },
        format="json",
    )
    assert session_response.status_code == 201

    inside_window = timezone.make_aware(datetime(2026, 5, 26, 16, 30))
    with patch("core.domain_serializers.attendance.timezone.now", return_value=inside_window):
        attendance_response = admin_client.post(
            "/api/attendance-records/",
            {"session": session_response.json()["id"], "student": luis["id"], "status": "present"},
            format="json",
        )
    assert attendance_response.status_code == 201
    assert attendance_response.json()["had_debt_at_capture"] is True

    charge = Charge.objects.get(student_id=luis["id"], concept="Mensualidad")
    payment_response = admin_client.post(
        "/api/payments/",
        {"charge": charge.id, "method": "card", "amount": "500.00"},
        format="json",
    )
    assert payment_response.status_code == 201
    charge.refresh_from_db()
    assert charge.status == "partial"

    discount_response = admin_client.post(
        "/api/discounts/",
        {"charge": charge.id, "reason": "Autorizacion especial", "amount": "1000.00"},
        format="json",
    )
    assert discount_response.status_code == 201

    approve_discount_response = admin_client.post(f"/api/discounts/{discount_response.json()['id']}/approve/")
    assert approve_discount_response.status_code == 200
    charge.refresh_from_db()
    assert charge.status == "paid"

    expense_response = admin_client.post(
        "/api/expenses/",
        {
            "site": luis["site"],
            "category": "Arbitraje",
            "description": "Gasto de prueba",
            "amount": "300.00",
            "expense_date": "2026-05-26",
            "provider_name": "Proveedor test",
        },
        format="json",
    )
    assert expense_response.status_code == 201

    approve_expense_response = admin_client.post(f"/api/expenses/{expense_response.json()['id']}/approve/")
    assert approve_expense_response.status_code == 200
    assert Expense.objects.get(id=expense_response.json()["id"]).approved_by == User.objects.get(username="admin")


def test_cashier_can_process_own_site_payments_but_not_cross_site(login_client):
    client, _user = login_client("caja.roma", "demo12345")
    roma_charge = Charge.objects.get(student__full_name="Carlos Ruiz")

    payment_response = client.post(
        "/api/payments/",
        {
            "charge": roma_charge.id,
            "method": "card",
            "amount": "100.00",
            "reference": "terminal-demo",
        },
        format="json",
    )
    assert payment_response.status_code == 201
    assert payment_response.json()["received_by_username"] == "caja.roma"

    coyoacan_charge = Charge.objects.get(student__full_name="Luis Gomez")
    cross_site_response = client.post(
        "/api/payments/",
        {"charge": coyoacan_charge.id, "method": "cash", "amount": "100.00"},
        format="json",
    )
    assert cross_site_response.status_code == 400


def test_multiple_partial_card_payments_recalculate_balance(login_client):
    client, _user = login_client("caja.roma", "demo12345")
    charge = Charge.objects.get(student__full_name="Carlos Ruiz")
    original_amount = charge.amount

    first_payment = client.post(
        "/api/payments/",
        {"charge": charge.id, "method": "card", "amount": "100.00"},
        format="json",
    )
    assert first_payment.status_code == 201
    charge.refresh_from_db()
    assert charge.status == "partial"
    assert charge_balance(charge) == original_amount - Decimal("100.00")

    second_payment = client.post(
        "/api/payments/",
        {"charge": charge.id, "method": "card", "amount": "125.00"},
        format="json",
    )
    assert second_payment.status_code == 201
    charge.refresh_from_db()
    assert charge.status == "partial"
    assert charge_balance(charge) == original_amount - Decimal("225.00")

    overpay_response = client.post(
        "/api/payments/",
        {"charge": charge.id, "method": "card", "amount": str(charge_balance(charge) + Decimal("1.00"))},
        format="json",
    )
    assert overpay_response.status_code == 400

    history_response = client.get(f"/api/payments/?charge={charge.id}")
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 2
    assert [payment["amount"] for payment in history] == ["100.00", "125.00"]


def test_cashier_only_sees_primary_site_billing_data(login_client):
    client, _user = login_client("caja.roma", "demo12345")

    charges_response = client.get("/api/charges/")
    assert charges_response.status_code == 200
    charge_names = {charge["student_name"] for charge in charges_response.json() if charge.get("student_name")}
    assert "Carlos Ruiz" in charge_names
    assert "Luis Gomez" not in charge_names

    students_response = client.get("/api/students/")
    assert students_response.status_code == 200
    student_names = {student["full_name"] for student in students_response.json()}
    assert "Carlos Ruiz" in student_names
    assert "Luis Gomez" not in student_names

    discounts_response = client.get("/api/discounts/")
    assert discounts_response.status_code == 200
    assert all(discount["site_name"] == "Roma" for discount in discounts_response.json())


def test_cashier_can_request_discount_from_billing_flow(login_client):
    client, _user = login_client("caja.roma", "demo12345")
    roma_charge = Charge.objects.get(student__full_name="Carlos Ruiz")

    response = client.post(
        "/api/discounts/",
        {"charge": roma_charge.id, "reason": "Hermanos", "amount": "75.00"},
        format="json",
    )

    assert response.status_code == 201
    discount = Discount.objects.get(id=response.json()["id"])
    assert discount.status == "requested"
    assert discount.requested_by.username == "caja.roma"
    assert discount.site == roma_charge.site

    coyoacan_charge = Charge.objects.get(student__full_name="Luis Gomez")
    cross_site_response = client.post(
        "/api/discounts/",
        {"charge": coyoacan_charge.id, "reason": "Hermanos", "amount": "75.00"},
        format="json",
    )
    assert cross_site_response.status_code == 400


def test_payment_automation_simulation_flows(login_client):
    cashier, _user = login_client("caja.roma", "demo12345")
    roma_charge = Charge.objects.get(student__full_name="Carlos Ruiz")

    transfer_response = cashier.post(
        "/api/payments/",
        {"charge": roma_charge.id, "method": "transfer", "amount": "100.00"},
        format="json",
    )
    assert transfer_response.status_code == 201
    assert transfer_response.json()["status"] == "processing"
    roma_charge.refresh_from_db()
    assert roma_charge.status == "partial"

    webhook_response = cashier.post(f"/api/payments/{transfer_response.json()['id']}/simulate-webhook/")
    assert webhook_response.status_code == 200
    assert webhook_response.json()["status"] == "registered"

    cash_response = cashier.post(
        "/api/payments/",
        {"charge": roma_charge.id, "method": "cash", "amount": "50.00"},
        format="json",
    )
    assert cash_response.status_code == 201
    assert cash_response.json()["status"] == "awaiting_confirmation"

    guardian, _user = login_client("padre.daniela", "familia12345")
    confirm_response = guardian.post(f"/api/payments/{cash_response.json()['id']}/confirm-cash/")
    assert confirm_response.status_code == 200
    assert confirm_response.json()["status"] == "registered"
