from datetime import date
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from core.models import CashMovement, CashMovementType, Expense, Site, StaffPaymentRequest, User


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_staff_payment_request_list_prefetched_related_fields_are_serialized(api_client):
    site = Site.objects.create(name="QA Staff List", code="qa-staff-list", address="QA")
    admin = User.objects.create_user(username="qa-staff-list-admin", password="x", role="admin")
    coach = User.objects.create_user(
        username="qa-staff-list-coach",
        password="x",
        role="coach",
        primary_site=site,
        first_name="Coach",
        last_name="Lista",
    )
    expense = Expense.objects.create(
        site=site,
        category="Nomina",
        description="Gasto staff list QA",
        amount=Decimal("900.00"),
        expense_date=date(2026, 7, 4),
        provider_name="Coach Lista",
        status="approved",
        captured_by=admin,
        approved_by=admin,
    )
    payment_request = StaffPaymentRequest.objects.create(
        site=site,
        recipient=coach,
        kind="coach_payroll",
        amount=Decimal("900.00"),
        requested_payment_date=date(2026, 7, 4),
        description="Solicitud staff list QA",
        payment_method="cash",
        status="accepted",
        requested_by=admin,
        expense=expense,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get(f"/api/staff-payment-requests/?site={site.id}")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == payment_request.id)
    assert payload["site_name"] == "QA Staff List"
    assert payload["recipient_username"] == "qa-staff-list-coach"
    assert payload["recipient_name"] == "Coach Lista"
    assert payload["requested_by_username"] == "qa-staff-list-admin"
    assert payload["expense_description"] == "Gasto staff list QA"
    assert len(captured) <= 1


def test_cash_movement_list_prefetched_related_fields_are_serialized(api_client):
    site = Site.objects.create(name="QA Cash List", code="qa-cash-list", address="QA")
    admin = User.objects.create_user(username="qa-cash-list-admin", password="x", role="admin")
    responsible = User.objects.create_user(
        username="qa-cash-list-responsible",
        password="x",
        role="coach",
        primary_site=site,
        first_name="Responsable",
        last_name="Caja",
    )
    payment_request = StaffPaymentRequest.objects.create(
        site=site,
        recipient=responsible,
        kind="coach_payroll",
        amount=Decimal("700.00"),
        requested_payment_date=date(2026, 7, 5),
        description="Solicitud caja list QA",
        payment_method="cash",
        requested_by=admin,
    )
    movement = CashMovement.objects.create(
        site=site,
        movement_type=CashMovementType.CASH_OUT,
        amount=Decimal("700.00"),
        movement_date=date(2026, 7, 5),
        reason="Movimiento caja list QA",
        responsible=responsible,
        created_by=admin,
        staff_payment_request=payment_request,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get(f"/api/cash-movements/?site={site.id}")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == movement.id)
    assert payload["site_name"] == "QA Cash List"
    assert payload["responsible_username"] == "qa-cash-list-responsible"
    assert payload["responsible_name"] == "Responsable Caja"
    assert payload["created_by_username"] == "qa-cash-list-admin"
    assert payload["staff_payment_request"] == payment_request.id
    assert len(captured) <= 1


def test_expense_approve_uses_action_scoped_fields(api_client):
    site = Site.objects.create(name="QA Expense Action", code="qa-expense-action", address="QA address should not be selected")
    admin = User.objects.create_user(username="qa-expense-action-admin", password="x", role="admin")
    captured_by = User.objects.create_user(username="qa-expense-action-capture", password="x", role="site_coordinator")
    expense = Expense.objects.create(
        site=site,
        category="Material",
        description="Gasto action QA",
        amount=Decimal("300.00"),
        expense_date=date(2026, 7, 6),
        provider_name="Proveedor action",
        status="pending",
        captured_by=captured_by,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(f"/api/expenses/{expense.id}/approve/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["site_name"] == "QA Expense Action"
    assert payload["captured_by_username"] == "qa-expense-action-capture"
    assert payload["approved_by_username"] == "qa-expense-action-admin"
    expense_query = next(query["sql"] for query in captured if 'FROM "expenses"' in query["sql"])
    assert '"sites"."address"' not in expense_query
    assert '"core_user"."password"' not in expense_query
    assert len(captured) <= 2


def test_expense_create_uses_lightweight_site_lookup(api_client):
    site = Site.objects.create(
        name="QA Expense Create",
        code="qa-expense-create",
        address="QA address should not be selected",
    )
    admin = User.objects.create_user(username="qa-expense-create-admin", password="x", role="admin")

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/expenses/",
            {
                "site": site.id,
                "category": "Material",
                "description": "Gasto create QA",
                "amount": "450.00",
                "expense_date": "2026-07-07",
                "provider_name": "Proveedor create",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["site_name"] == "QA Expense Create"
    assert payload["captured_by_username"] == "qa-expense-create-admin"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert len(captured) <= 2


def test_staff_payment_create_uses_lightweight_related_lookups(api_client):
    site = Site.objects.create(
        name="QA Staff Create",
        code="qa-staff-create",
        address="QA address should not be selected",
    )
    admin = User.objects.create_user(username="qa-staff-create-admin", password="x", role="admin")
    coach = User.objects.create_user(
        username="qa-staff-create-coach",
        password="x",
        role="coach",
        primary_site=site,
        first_name="Coach",
        last_name="Create",
        section_permissions=["finance", "sports"],
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/staff-payment-requests/",
            {
                "site": site.id,
                "recipient": coach.id,
                "kind": "coach_payroll",
                "amount": "650.00",
                "requested_payment_date": "2026-07-07",
                "description": "Solicitud staff create QA",
                "payment_method": "cash",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["site_name"] == "QA Staff Create"
    assert payload["recipient_username"] == "qa-staff-create-coach"
    assert payload["recipient_name"] == "Coach Create"
    assert payload["requested_by_username"] == "qa-staff-create-admin"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"core_user"."password"' not in captured_sql
    assert '"core_user"."section_permissions"' not in captured_sql
    assert len(captured) <= 3


def test_accept_staff_payment_creates_expense_and_cash_movement_once(api_client):
    site = Site.objects.create(name="QA Finanzas", code="qa-finanzas", address="QA")
    admin = User.objects.create_user(username="qa-finance-admin", password="x", role="admin")
    coach = User.objects.create_user(username="qa-finance-coach", password="x", role="coach", primary_site=site)
    payment_request = StaffPaymentRequest.objects.create(
        site=site,
        recipient=coach,
        kind="coach_payroll",
        amount=Decimal("850.00"),
        requested_payment_date=date(2026, 7, 3),
        description="Nomina coach QA",
        payment_method="cash",
        requested_by=admin,
    )

    api_client.force_authenticate(user=coach)
    with CaptureQueriesContext(connection) as captured:
        first_response = api_client.post(
            f"/api/staff-payment-requests/{payment_request.id}/accept/",
            {"response_notes": "Recibido"},
            format="json",
        )
    second_response = api_client.post(
        f"/api/staff-payment-requests/{payment_request.id}/accept/",
        {"response_notes": "Recibido de nuevo"},
        format="json",
    )

    assert first_response.status_code == 200
    first_payload = first_response.json()
    assert first_payload["site_name"] == "QA Finanzas"
    assert first_payload["recipient_username"] == "qa-finance-coach"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"core_user"."password"' not in captured_sql
    assert len(captured) <= 5
    assert second_response.status_code == 200
    payment_request.refresh_from_db()
    assert payment_request.status == "accepted"
    assert payment_request.response_notes == "Recibido de nuevo"
    assert payment_request.expense is not None
    assert Expense.objects.filter(id=payment_request.expense_id, status="approved", approved_by=coach).count() == 1
    cash_movements = CashMovement.objects.filter(staff_payment_request=payment_request)
    assert cash_movements.count() == 1
    cash_movement = cash_movements.get()
    assert cash_movement.movement_type == CashMovementType.CASH_OUT
    assert cash_movement.amount == Decimal("850.00")
    assert cash_movement.responsible == coach
    assert cash_movement.created_by == admin


def test_cashier_cannot_create_cash_movement_outside_primary_site(api_client):
    primary_site = Site.objects.create(name="QA Caja", code="qa-caja", address="QA")
    other_site = Site.objects.create(name="QA Caja Otra", code="qa-caja-otra", address="QA")
    cashier = User.objects.create_user(username="qa-caja-user", password="x", role="cashier", primary_site=primary_site)

    api_client.force_authenticate(user=cashier)
    response = api_client.post(
        "/api/cash-movements/",
        {
            "site": other_site.id,
            "movement_type": "adjustment",
            "amount": "100.00",
            "movement_date": "2026-07-03",
            "reason": "Ajuste no permitido",
            "responsible": cashier.id,
        },
        format="json",
    )

    assert response.status_code == 400
    assert not CashMovement.objects.filter(site=other_site, reason="Ajuste no permitido").exists()
