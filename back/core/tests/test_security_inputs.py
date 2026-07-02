import pytest

from core.tests.factories import make_charge, make_site, make_student, make_user


pytestmark = [pytest.mark.api, pytest.mark.security, pytest.mark.django_db]


MALICIOUS_STRINGS = [
    "' OR '1'='1",
    "'; DROP TABLE core_user; --",
    "<script>alert('xss')</script>",
    "A" * 1000,
]


@pytest.mark.parametrize("payload", MALICIOUS_STRINGS)
def test_login_rejects_sql_like_payloads(api_client, payload):
    response = api_client.post(
        "/api/auth/login/",
        {"username": payload, "password": payload},
        format="json",
    )

    assert response.status_code in {400, 401}


@pytest.mark.parametrize("payload", MALICIOUS_STRINGS)
def test_student_profile_fields_accept_text_without_server_error(auth_client, payload):
    site = make_site()
    admin = make_user(role="admin", primary_site=site)
    student = make_student(site=site)
    client, _payload, _user = auth_client(user=admin)

    response = client.patch(
        f"/api/students/{student.id}/",
        {"medical_notes": payload, "emergency_contact": payload[:80]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["medical_notes"] == payload


def test_negative_payment_amount_is_rejected(auth_client):
    site = make_site()
    cashier = make_user(role="cashier", primary_site=site)
    student = make_student(site=site, full_name="Carlos Ruiz")
    charge = make_charge(student=student, created_by=cashier)
    client, _payload, _user = auth_client(user=cashier)

    response = client.post(
        "/api/payments/",
        {"charge": charge.id, "method": "cash", "amount": "-10.00"},
        format="json",
    )

    assert response.status_code == 400


def test_invalid_charge_id_does_not_create_payment(auth_client):
    site = make_site()
    cashier = make_user(role="cashier", primary_site=site)
    client, _payload, _user = auth_client(user=cashier)

    response = client.post(
        "/api/payments/",
        {"charge": 999999, "method": "cash", "amount": "10.00"},
        format="json",
    )

    assert response.status_code == 400


def test_guardian_cannot_access_accounting_export(auth_client):
    guardian = make_user(role="guardian")
    client, _payload, _user = auth_client(user=guardian)

    response = client.get("/api/reports/accounting.xlsx")

    assert response.status_code == 403
