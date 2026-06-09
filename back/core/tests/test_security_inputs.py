import pytest

from core.models import Charge


pytestmark = [pytest.mark.api, pytest.mark.security, pytest.mark.django_db]


MALICIOUS_STRINGS = [
    "' OR '1'='1",
    "'; DROP TABLE core_user; --",
    "<script>alert('xss')</script>",
    "A" * 1000,
]


@pytest.mark.parametrize("payload", MALICIOUS_STRINGS)
def test_login_rejects_sql_like_payloads(api_client, seeded_db, payload):
    response = api_client.post(
        "/api/auth/login/",
        {"username": payload, "password": payload},
        format="json",
    )

    assert response.status_code in {400, 401}


@pytest.mark.parametrize("payload", MALICIOUS_STRINGS)
def test_student_profile_fields_accept_text_without_server_error(admin_client, payload):
    students = admin_client.get("/api/students/").json()
    student = students[0]

    response = admin_client.patch(
        f"/api/students/{student['id']}/",
        {"medical_notes": payload, "emergency_contact": payload[:80]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["medical_notes"] == payload


def test_negative_payment_amount_is_rejected(login_client):
    client, _user = login_client("caja.roma", "demo12345")
    charge = Charge.objects.get(student__full_name="Carlos Ruiz")

    response = client.post(
        "/api/payments/",
        {"charge": charge.id, "method": "cash", "amount": "-10.00"},
        format="json",
    )

    assert response.status_code == 400


def test_invalid_charge_id_does_not_create_payment(login_client):
    client, _user = login_client("caja.roma", "demo12345")

    response = client.post(
        "/api/payments/",
        {"charge": 999999, "method": "cash", "amount": "10.00"},
        format="json",
    )

    assert response.status_code == 400


def test_guardian_cannot_access_accounting_export(login_client):
    client, _user = login_client("padre.laura", "familia12345")

    response = client.get("/api/reports/accounting.xlsx")

    assert response.status_code == 403
