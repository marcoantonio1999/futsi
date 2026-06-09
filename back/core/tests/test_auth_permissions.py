import pytest

from core.models import CoachWorkLog


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_guardian_user_only_sees_their_students_and_cannot_create_charges(login_client):
    client, user = login_client("padre.laura", "familia12345")
    assert user["role"] == "guardian"

    students_response = client.get("/api/students/")
    assert students_response.status_code == 200
    assert len(students_response.json()) == 3
    assert all(student["guardian_name"] == "Laura Martinez" for student in students_response.json())

    forbidden_response = client.post(
        "/api/charges/",
        {
            "site": students_response.json()[0]["site"],
            "student": students_response.json()[0]["id"],
            "concept": "No permitido",
            "amount": "100.00",
        },
        format="json",
    )
    assert forbidden_response.status_code == 403


def test_guardian_can_update_profile_contact_data(login_client):
    client, _user = login_client("padre.jorge", "familia12345")

    profile_response = client.patch(
        "/api/auth/me/",
        {
            "guardian_full_name": "Jorge Ramirez Actualizado",
            "guardian_email": "jorge.actualizado@example.com",
            "guardian_phone": "5510101010",
            "avatar_url": "https://example.com/avatar.jpg",
        },
        format="json",
    )
    assert profile_response.status_code == 200
    assert profile_response.json()["guardian_name"] == "Jorge Ramirez Actualizado"
    assert profile_response.json()["email"] == "jorge.actualizado@example.com"
    assert profile_response.json()["phone"] == "5510101010"
    assert profile_response.json()["avatar_url"] == "https://example.com/avatar.jpg"


def test_cashier_only_sees_site_scope_and_cannot_create_operational_records(login_client):
    client, user = login_client("caja.roma", "demo12345")
    assert user["role"] == "cashier"

    sites_response = client.get("/api/sites/")
    assert sites_response.status_code == 200
    assert [site["name"] for site in sites_response.json()] == ["Roma"]

    students_response = client.get("/api/students/")
    assert students_response.status_code == 200
    assert len(students_response.json()) == 21
    assert all(student["site_name"] == "Roma" for student in students_response.json())

    forbidden_student_response = client.post(
        "/api/students/",
        {
            "site": students_response.json()[0]["site"],
            "guardian": students_response.json()[0]["guardian"],
            "full_name": "Alumno no permitido",
            "status": "trial",
        },
        format="json",
    )
    assert forbidden_student_response.status_code == 403

    forbidden_charge_response = client.post(
        "/api/charges/",
        {
            "site": students_response.json()[0]["site"],
            "student": students_response.json()[0]["id"],
            "concept": "No permitido",
            "amount": "100.00",
        },
        format="json",
    )
    assert forbidden_charge_response.status_code == 403


def test_dev_user_has_admin_scope_for_qa_and_developer_diagnostics(login_client):
    client, user = login_client("dev", "dev12345")
    assert user["role"] == "dev"

    users_response = client.get("/api/users/")
    assert users_response.status_code == 200
    assert any(item["username"] == "admin" for item in users_response.json())

    sites_response = client.get("/api/sites/")
    assert sites_response.status_code == 200
    assert len(sites_response.json()) == 3

    historical_response = client.get("/api/historical-imports/")
    assert historical_response.status_code == 200


def test_coach_sees_only_assigned_group_and_can_register_attendance_and_hours(login_client):
    client, user = login_client("coach.roma", "demo12345")
    assert user["role"] == "coach"

    students_response = client.get("/api/students/")
    assert students_response.status_code == 200
    students = students_response.json()
    assert len(students) == 12
    assert all(student["group_name"] == "Equipo Sub-12 A" for student in students)

    session_response = client.post(
        "/api/attendance-sessions/",
        {
            "site": students[0]["site"],
            "session_type": "academy_class",
            "date": "2026-05-26",
            "starts_at": "17:00",
            "group_name": "Equipo Sub-12 A",
        },
        format="json",
    )
    assert session_response.status_code == 201

    attendance_response = client.post(
        "/api/attendance-records/",
        {
            "session": session_response.json()["id"],
            "student": students[0]["id"],
            "status": "present",
        },
        format="json",
    )
    assert attendance_response.status_code == 201

    work_log_response = client.post(
        "/api/coach-work-logs/",
        {
            "work_date": "2026-05-26",
            "hours": "2.50",
            "activity": "Entrenamiento",
            "notes": "Prueba de coach",
        },
        format="json",
    )
    assert work_log_response.status_code == 201
    assert CoachWorkLog.objects.get(id=work_log_response.json()["id"]).coach.username == "coach.roma"

    forbidden_expense_response = client.post(
        "/api/expenses/",
        {
            "site": students[0]["site"],
            "category": "Pago a coaches",
            "description": "No permitido",
            "amount": "300.00",
            "expense_date": "2026-05-26",
        },
        format="json",
    )
    assert forbidden_expense_response.status_code == 403
