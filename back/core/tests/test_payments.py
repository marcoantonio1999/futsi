from datetime import date, datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from core.models import Charge, Discount, Expense, Guardian, Payment, Site, Student, StudentTournamentRegistration, Team, Tournament, User
from core.serializers import charge_balance
from core.tests.factories import make_charge, make_guardian, make_site, make_student, make_user


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def _student_with_charge(site, full_name, amount="1500.00", guardian_user=None):
    guardian = make_guardian(user=guardian_user, full_name=f"Tutor {full_name}")
    student = make_student(site=site, guardian=guardian, full_name=full_name)
    charge = make_charge(student=student, amount=Decimal(amount), status="pending")
    return student, charge, guardian


def test_demo_flow_crosses_attendance_billing_discounts_and_expenses(auth_client):
    site = make_site(code="qa-demo-flow")
    admin_user = make_user(role="admin", primary_site=site)
    luis, charge, _guardian = _student_with_charge(site, "Luis Gomez")
    admin_api, _payload, admin = auth_client(user=admin_user)

    session_response = admin_api.post(
        "/api/attendance-sessions/",
        {
            "site": site.id,
            "session_type": "academy_class",
            "date": "2026-05-26",
            "starts_at": "17:00",
            "group_name": luis.group_name,
        },
        format="json",
    )
    assert session_response.status_code == 201

    inside_window = timezone.make_aware(datetime(2026, 5, 26, 16, 30))
    with patch("core.domain_serializers.attendance.timezone.now", return_value=inside_window):
        attendance_response = admin_api.post(
            "/api/attendance-records/",
            {"session": session_response.json()["id"], "student": luis.id, "status": "present"},
            format="json",
        )
    assert attendance_response.status_code == 201
    assert attendance_response.json()["had_debt_at_capture"] is True

    payment_response = admin_api.post(
        "/api/payments/",
        {"charge": charge.id, "method": "card", "amount": "500.00"},
        format="json",
    )
    assert payment_response.status_code == 201
    charge.refresh_from_db()
    assert charge.status == "partial"

    discount_response = admin_api.post(
        "/api/discounts/",
        {"charge": charge.id, "reason": "Autorizacion especial", "amount": "1000.00"},
        format="json",
    )
    assert discount_response.status_code == 201

    approve_discount_response = admin_api.post(f"/api/discounts/{discount_response.json()['id']}/approve/")
    assert approve_discount_response.status_code == 200
    charge.refresh_from_db()
    assert charge.status == "paid"

    expense_response = admin_api.post(
        "/api/expenses/",
        {
            "site": site.id,
            "category": "Arbitraje",
            "description": "Gasto de prueba",
            "amount": "300.00",
            "expense_date": "2026-05-26",
            "provider_name": "Proveedor test",
        },
        format="json",
    )
    assert expense_response.status_code == 201

    approve_expense_response = admin_api.post(f"/api/expenses/{expense_response.json()['id']}/approve/")
    assert approve_expense_response.status_code == 200
    assert Expense.objects.get(id=expense_response.json()["id"]).approved_by == admin


def test_cashier_can_process_own_site_payments_but_not_cross_site(auth_client):
    roma = make_site(name="QA Payment Roma", code="qa-payment-roma")
    coyoacan = make_site(name="QA Payment Coyoacan", code="qa-payment-coyoacan")
    cashier = make_user(role="cashier", primary_site=roma)
    _carlos, roma_charge, _guardian = _student_with_charge(roma, "Carlos Ruiz")
    _luis, coyoacan_charge, _guardian = _student_with_charge(coyoacan, "Luis Gomez")
    client, _payload, _user = auth_client(user=cashier)

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
    assert payment_response.json()["received_by_username"] == cashier.username

    cross_site_response = client.post(
        "/api/payments/",
        {"charge": coyoacan_charge.id, "method": "cash", "amount": "100.00"},
        format="json",
    )
    assert cross_site_response.status_code == 400


def test_multiple_partial_card_payments_recalculate_balance(auth_client):
    site = make_site(name="QA Partial Payments", code="qa-partial-payments")
    cashier = make_user(role="cashier", primary_site=site)
    _student, charge, _guardian = _student_with_charge(site, "Carlos Ruiz", amount="1000.00")
    client, _payload, _user = auth_client(user=cashier)
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
    assert all(payment["charge_concept"] == charge.concept for payment in history)
    assert all(payment["student_name"] == charge.student.full_name for payment in history)
    assert all(payment["site_name"] == site.name for payment in history)
    assert all(payment["received_by_username"] == cashier.username for payment in history)

    admin = make_user(role="admin", username="qa-partial-admin", primary_site=site)
    Discount.objects.create(
        site=charge.site,
        student=charge.student,
        charge=charge,
        reason="Ajuste QA",
        amount=Decimal("25.00"),
        status="approved",
        requested_by=admin,
        approved_by=admin,
    )
    charges_response = client.get(f"/api/charges/?student={charge.student_id}")
    assert charges_response.status_code == 200
    charge_payload = next(item for item in charges_response.json() if item["id"] == charge.id)
    assert charge_payload["paid_amount"] == "225.00"
    assert charge_payload["discount_amount"] == "25.00"
    assert charge_payload["balance"] == str(original_amount - Decimal("250.00"))


def test_student_list_prefetched_finance_fields_match_charge_totals(api_client):
    site = Site.objects.create(name="QA Student Finance", code="qa-student-finance", address="QA")
    admin = User.objects.create_user(username="qa-student-finance-admin", password="x", role="admin")
    guardian = Guardian.objects.create(full_name="Tutor Student Finance QA", phone="5500000301", email="student-finance@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Student Finance QA",
        category="Sub-12",
        group_name="QA",
        status="active",
    )
    open_charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad QA",
        amount=Decimal("1000.00"),
        status="partial",
        created_by=admin,
    )
    Charge.objects.create(
        site=site,
        student=student,
        concept="Cargo cerrado QA",
        amount=Decimal("500.00"),
        status="paid",
        created_by=admin,
    )
    Payment.objects.create(
        site=site,
        student=student,
        charge=open_charge,
        method="card",
        channel="card_terminal",
        status="registered",
        amount=Decimal("125.00"),
        received_by=admin,
    )
    Payment.objects.create(
        site=site,
        student=student,
        charge=open_charge,
        method="transfer",
        channel="transfer_clabe",
        status="processing",
        amount=Decimal("50.00"),
        received_by=admin,
    )
    Discount.objects.create(
        site=site,
        student=student,
        charge=open_charge,
        reason="Descuento cargo QA",
        amount=Decimal("75.00"),
        status="approved",
        requested_by=admin,
        approved_by=admin,
        approved_at=timezone.now(),
    )
    Discount.objects.create(
        site=site,
        student=student,
        charge=open_charge,
        reason="Pendiente QA",
        amount=Decimal("25.00"),
        status="requested",
        requested_by=admin,
    )
    Discount.objects.create(
        site=site,
        student=student,
        reason="Beca alumno QA",
        amount=Decimal("15.00"),
        status="approved",
        requested_by=admin,
        approved_by=admin,
        approved_at=timezone.now(),
    )

    api_client.force_authenticate(user=admin)
    response = api_client.get("/api/students/")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == student.id)
    assert payload["open_charge_count"] == 1
    assert payload["balance_due"] == "800.00"
    assert any(
        discount["reason"] == "Descuento cargo QA"
        and discount["amount"] == "75.00"
        and discount["charge"] == open_charge.id
        for discount in payload["active_discounts"]
    )
    assert any(
        discount["reason"] == "Beca alumno QA" and discount["amount"] == "15.00"
        for discount in payload["active_discounts"]
    )
    assert all(discount["reason"] != "Pendiente QA" for discount in payload["active_discounts"])


def test_student_charge_create_reuses_student_guardian_and_registration(api_client):
    site = Site.objects.create(name="QA Charge Create", code="qa-charge-create", address="QA address is still validated normally")
    admin = User.objects.create_user(username="qa-charge-create-admin", password="x", role="admin")
    guardian = Guardian.objects.create(
        full_name="Tutor Charge Create QA",
        phone="5500000615",
        email="charge-create@example.test",
        notes="Guardian notes should not be selected",
    )
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Charge Create QA",
        category="Sub-9",
        group_name="Cargo",
        status="active",
        medical_notes="Student medical notes should not be selected",
    )
    tournament = Tournament.objects.create(
        site=site,
        name="Torneo Charge Create QA",
        billing_type="weekly_match",
        starts_on=date(2026, 8, 1),
        expected_weeks=10,
    )
    team = Team.objects.create(
        tournament=tournament,
        name="Equipo Charge Create QA",
        representative_name="Representante",
        representative_phone="5500000616",
    )
    registration = StudentTournamentRegistration.objects.create(
        tournament=tournament,
        student=student,
        team=team,
        weekly_amount=Decimal("650.00"),
        full_amount=Decimal("6500.00"),
        registered_by=admin,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/charges/",
            {
                "site": site.id,
                "student": student.id,
                "team": None,
                "tournament_registration": registration.id,
                "jornada_number": 1,
                "concept": "Mensualidad Charge Create QA",
                "description": "Cargo alumno create QA",
                "amount": "650.00",
                "due_date": "2026-08-08",
                "status": "pending",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["site_name"] == "QA Charge Create"
    assert payload["student_name"] == "Alumno Charge Create QA"
    assert payload["tournament_registration_name"] == "Torneo Charge Create QA"
    assert payload["payer_name"] == "Tutor Charge Create QA"
    assert payload["payer_phone"] == "5500000615"
    assert payload["balance"] == "650.00"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"students"."medical_notes"' not in captured_sql
    assert '"guardians"."notes"' not in captured_sql
    assert '"tournaments"."expected_weeks"' not in captured_sql
    assert len(captured) <= 6


def test_discount_list_prefetched_related_fields_are_serialized(api_client):
    site = Site.objects.create(name="QA Discount List", code="qa-discount-list", address="QA")
    admin = User.objects.create_user(username="qa-discount-list-admin", password="x", role="admin")
    guardian = Guardian.objects.create(full_name="Tutor Discount QA", phone="5500000501", email="discount@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Discount QA",
        category="Sub-12",
        group_name="QA",
        status="active",
    )
    charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad Discount QA",
        amount=Decimal("1000.00"),
        status="partial",
        created_by=admin,
    )
    discount = Discount.objects.create(
        site=site,
        student=student,
        charge=charge,
        reason="Beca Discount QA",
        amount=Decimal("80.00"),
        status="approved",
        requested_by=admin,
        approved_by=admin,
        approved_at=timezone.now(),
    )

    api_client.force_authenticate(user=admin)
    response = api_client.get("/api/discounts/?status=approved")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == discount.id)
    assert payload["site_name"] == "QA Discount List"
    assert payload["student_name"] == "Alumno Discount QA"
    assert payload["charge_concept"] == "Mensualidad Discount QA"
    assert payload["requested_by_username"] == "qa-discount-list-admin"
    assert payload["approved_by_username"] == "qa-discount-list-admin"


def test_cashier_only_sees_primary_site_billing_data(auth_client):
    roma = make_site(name="QA Billing Scope Roma", code="qa-billing-scope-roma")
    coyoacan = make_site(name="QA Billing Scope Coyoacan", code="qa-billing-scope-coyoacan")
    cashier = make_user(role="cashier", primary_site=roma)
    _carlos, roma_charge, _guardian = _student_with_charge(roma, "Carlos Ruiz")
    _luis, _coyoacan_charge, _guardian = _student_with_charge(coyoacan, "Luis Gomez")
    Discount.objects.create(
        site=roma,
        student=roma_charge.student,
        charge=roma_charge,
        reason="Scope discount",
        amount=Decimal("10.00"),
        status="approved",
        requested_by=cashier,
        approved_by=cashier,
    )
    client, _payload, _user = auth_client(user=cashier)

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
    assert all(discount["site_name"] == roma.name for discount in discounts_response.json())


def test_cashier_can_request_discount_from_billing_flow(auth_client):
    roma = make_site(name="QA Discount Flow Roma", code="qa-discount-flow-roma")
    coyoacan = make_site(name="QA Discount Flow Coyoacan", code="qa-discount-flow-coyoacan")
    cashier = make_user(role="cashier", primary_site=roma)
    _carlos, roma_charge, _guardian = _student_with_charge(roma, "Carlos Ruiz")
    _luis, coyoacan_charge, _guardian = _student_with_charge(coyoacan, "Luis Gomez")
    client, _payload, _user = auth_client(user=cashier)

    response = client.post(
        "/api/discounts/",
        {"charge": roma_charge.id, "reason": "Hermanos", "amount": "75.00"},
        format="json",
    )

    assert response.status_code == 201
    discount = Discount.objects.get(id=response.json()["id"])
    assert discount.status == "requested"
    assert discount.requested_by.username == cashier.username
    assert discount.site == roma_charge.site
    assert response.json()["requested_by_username"] == cashier.username

    cross_site_response = client.post(
        "/api/discounts/",
        {"charge": coyoacan_charge.id, "reason": "Hermanos", "amount": "75.00"},
        format="json",
    )
    assert cross_site_response.status_code == 400


def test_payment_automation_simulation_flows(auth_client):
    site = make_site(name="QA Payment Automation", code="qa-payment-automation")
    cashier_user = make_user(role="cashier", primary_site=site)
    guardian_user = make_user(role="guardian")
    _student, roma_charge, _guardian = _student_with_charge(site, "Carlos Ruiz", guardian_user=guardian_user)
    cashier, _payload, _user = auth_client(user=cashier_user)

    transfer_response = cashier.post(
        "/api/payments/",
        {"charge": roma_charge.id, "method": "transfer", "amount": "100.00"},
        format="json",
    )
    assert transfer_response.status_code == 201
    assert transfer_response.json()["status"] == "processing"
    roma_charge.refresh_from_db()
    assert roma_charge.status == "pending"

    webhook_response = cashier.post(f"/api/payments/{transfer_response.json()['id']}/simulate-webhook/")
    assert webhook_response.status_code == 200
    assert webhook_response.json()["status"] == "registered"
    roma_charge.refresh_from_db()
    assert roma_charge.status == "partial"

    cash_response = cashier.post(
        "/api/payments/",
        {"charge": roma_charge.id, "method": "cash", "amount": "50.00"},
        format="json",
    )
    assert cash_response.status_code == 201
    assert cash_response.json()["status"] == "registered"
    assert cash_response.json()["confirmed_at"]
    roma_charge.refresh_from_db()
    assert roma_charge.status == "partial"


def test_confirm_cash_prefetches_guardian_without_extra_profile_query(api_client):
    site = Site.objects.create(name="QA Confirm Cash", code="qa-confirm-cash", address="QA")
    admin = User.objects.create_user(username="qa-confirm-admin", password="x", role="admin")
    guardian_user = User.objects.create_user(username="qa-confirm-guardian", password="x", role="guardian")
    guardian = Guardian.objects.create(
        user=guardian_user,
        full_name="Tutor Confirm QA",
        phone="5500000601",
        email="confirm@example.test",
        notes="Guardian notes should not be selected",
    )
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Confirm QA",
        category="Sub-12",
        group_name="QA",
        status="active",
    )
    charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad Confirm QA",
        amount=Decimal("500.00"),
        status="pending",
        created_by=admin,
    )
    payment = Payment.objects.create(
        site=site,
        charge=charge,
        student=student,
        method="cash",
        channel="cash_confirmation",
        status="awaiting_confirmation",
        amount=Decimal("50.00"),
        received_by=admin,
    )

    api_client.force_authenticate(user=guardian_user)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(f"/api/payments/{payment.id}/confirm-cash/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "registered"
    assert payload["student_name"] == "Alumno Confirm QA"
    payment_query = next(query["sql"] for query in captured if 'FROM "payments"' in query["sql"])
    assert '"guardians"."notes"' not in payment_query
    assert '"core_user"."password"' not in payment_query
    assert len(captured) <= 7


def test_discount_reject_uses_action_scoped_fields(api_client):
    site = Site.objects.create(name="QA Discount Reject", code="qa-discount-reject", address="QA address should not be selected")
    admin = User.objects.create_user(username="qa-discount-reject-admin", password="x", role="admin")
    guardian = Guardian.objects.create(
        full_name="Tutor Reject QA",
        phone="5500000602",
        email="reject@example.test",
        notes="Guardian notes should not be selected",
    )
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Reject QA",
        category="Sub-12",
        group_name="QA",
        status="active",
    )
    charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad Reject QA",
        amount=Decimal("500.00"),
        status="pending",
        created_by=admin,
    )
    discount = Discount.objects.create(
        site=site,
        charge=charge,
        student=student,
        reason="Beca reject QA",
        amount=Decimal("50.00"),
        status="requested",
        requested_by=admin,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(f"/api/discounts/{discount.id}/reject/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "rejected"
    assert payload["site_name"] == "QA Discount Reject"
    assert payload["student_name"] == "Alumno Reject QA"
    assert payload["charge_concept"] == "Mensualidad Reject QA"
    assert payload["requested_by_username"] == "qa-discount-reject-admin"
    assert payload["approved_by_username"] == "qa-discount-reject-admin"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"guardians"."notes"' not in captured_sql
    assert '"core_user"."password"' not in captured_sql
    assert len(captured) <= 2


def test_payment_expire_uses_action_scoped_fields(api_client):
    site = Site.objects.create(name="QA Payment Expire", code="qa-payment-expire", address="QA address should not be selected")
    admin = User.objects.create_user(username="qa-payment-expire-admin", password="x", role="admin")
    guardian = Guardian.objects.create(full_name="Tutor Expire QA", phone="5500000603", email="expire@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Expire QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        medical_notes="Student medical notes should not be selected",
    )
    charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad Expire QA",
        description="Charge description should not be selected",
        amount=Decimal("500.00"),
        status="pending",
        created_by=admin,
    )
    payment = Payment.objects.create(
        site=site,
        charge=charge,
        student=student,
        method="transfer",
        channel="transfer_clabe",
        status="processing",
        amount=Decimal("50.00"),
        received_by=admin,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(f"/api/payments/{payment.id}/expire/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "expired"
    assert payload["site_name"] == "QA Payment Expire"
    assert payload["student_name"] == "Alumno Expire QA"
    assert payload["charge_concept"] == "Mensualidad Expire QA"
    assert payload["received_by_username"] == "qa-payment-expire-admin"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"students"."medical_notes"' not in captured_sql
    assert '"charges"."description"' not in captured_sql
    assert '"core_user"."password"' not in captured_sql
    assert len(captured) <= 5


def test_transfer_payment_create_reuses_charge_related_fields(api_client):
    site = Site.objects.create(name="QA Transfer Create", code="qa-transfer-create", address="QA address should not be selected")
    cashier = User.objects.create_user(username="qa-transfer-cashier", password="x", role="cashier", primary_site=site)
    guardian = Guardian.objects.create(
        full_name="Tutor Transfer QA",
        phone="5500000604",
        email="transfer@example.test",
        notes="Guardian notes should not be selected",
        virtual_clabe="646180000000000001",
    )
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Transfer QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        medical_notes="Student medical notes should not be selected",
    )
    charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad Transfer QA",
        description="Charge description should not be selected",
        amount=Decimal("500.00"),
        status="pending",
        created_by=cashier,
    )

    api_client.force_authenticate(user=cashier)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/payments/",
            {"charge": charge.id, "method": "transfer", "amount": "50.00"},
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "processing"
    assert payload["reference"] == "CLABE-646180000000000001"
    assert payload["site_name"] == "QA Transfer Create"
    assert payload["student_name"] == "Alumno Transfer QA"
    assert payload["charge_concept"] == "Mensualidad Transfer QA"
    assert payload["received_by_username"] == "qa-transfer-cashier"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"guardians"."notes"' not in captured_sql
    assert '"students"."medical_notes"' not in captured_sql
    assert '"charges"."description"' not in captured_sql
    assert len(captured) <= 4


def test_admin_discount_create_reuses_charge_related_fields(api_client):
    site = Site.objects.create(name="QA Discount Create", code="qa-discount-create", address="QA address should not be selected")
    admin = User.objects.create_user(username="qa-discount-create-admin", password="x", role="admin")
    guardian = Guardian.objects.create(
        full_name="Tutor Discount Create QA",
        phone="5500000605",
        email="discount-create@example.test",
        notes="Guardian notes should not be selected",
    )
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Discount Create QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        medical_notes="Student medical notes should not be selected",
    )
    charge = Charge.objects.create(
        site=site,
        student=student,
        concept="Mensualidad Discount Create QA",
        description="Charge description should not be selected",
        amount=Decimal("500.00"),
        status="pending",
        created_by=admin,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/discounts/",
            {"charge": charge.id, "reason": "Beca create QA", "amount": "50.00"},
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "approved"
    assert payload["site_name"] == "QA Discount Create"
    assert payload["student_name"] == "Alumno Discount Create QA"
    assert payload["charge_concept"] == "Mensualidad Discount Create QA"
    assert payload["requested_by_username"] == "qa-discount-create-admin"
    assert payload["approved_by_username"] == "qa-discount-create-admin"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"guardians"."notes"' not in captured_sql
    assert '"students"."medical_notes"' not in captured_sql
    assert '"charges"."description"' not in captured_sql
    assert len(captured) <= 7
