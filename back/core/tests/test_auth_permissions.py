from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from core.models import AuditLog, CoachWorkLog, Expense, Match, Site, StaffPaymentRequest, StudentTournamentRegistration, Team, Tournament
from core.tests.factories import (
    make_guardian,
    make_site,
    make_student,
    make_team,
    make_tournament,
    make_user,
)


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_guardian_user_only_sees_their_students_and_cannot_create_charges(auth_client):
    guardian_user = make_user(role="guardian", username="qa-guardian-laura")
    guardian = make_guardian(user=guardian_user, full_name="Laura Martinez")
    other_guardian = make_guardian(full_name="Other Guardian")
    site = make_site(code="qa-guardian-site")
    for index in range(3):
        make_student(site=site, guardian=guardian, full_name=f"Laura Student {index}")
    make_student(site=site, guardian=other_guardian, full_name="Hidden Student")

    client, user, _ = auth_client(user=guardian_user)
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


def test_guardian_can_update_profile_contact_data(auth_client):
    guardian_user = make_user(role="guardian")
    make_guardian(user=guardian_user, full_name="Jorge Ramirez")
    client, _payload, _user = auth_client(user=guardian_user)

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


def test_cashier_only_sees_site_scope_and_can_create_students(auth_client):
    roma = make_site(name="Roma QA", code="qa-roma")
    coyoacan = make_site(name="Coyoacan QA", code="qa-coyoacan")
    cashier = make_user(role="cashier", username="qa-cashier-roma", primary_site=roma)
    guardian = make_guardian()
    for index in range(3):
        make_student(site=roma, guardian=guardian, full_name=f"Roma Student {index}")
    make_student(site=coyoacan, guardian=guardian, full_name="Coyoacan Student")

    client, user, _ = auth_client(user=cashier)
    assert user["role"] == "cashier"

    sites_response = client.get("/api/sites/")
    assert sites_response.status_code == 200
    assert [site["name"] for site in sites_response.json()] == ["Roma QA"]

    students_response = client.get("/api/students/")
    assert students_response.status_code == 200
    assert len(students_response.json()) == 3
    assert all(student["site_name"] == "Roma QA" for student in students_response.json())

    created_student_response = client.post(
        "/api/students/",
        {
            "site": students_response.json()[0]["site"],
            "guardian": students_response.json()[0]["guardian"],
            "full_name": "Alumno ventanilla",
            "status": "trial",
        },
        format="json",
    )
    assert created_student_response.status_code == 201
    assert created_student_response.json()["site_name"] == "Roma QA"

    forbidden_student_response = client.post(
        "/api/students/",
        {
            "site": coyoacan.id,
            "guardian": students_response.json()[0]["guardian"],
            "full_name": "Alumno fuera de sede",
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


def test_cashier_can_administer_tournaments_for_primary_site_only(auth_client):
    roma = make_site(name="Roma QA", code="qa-cashier-tournaments-roma")
    coyoacan = make_site(name="Coyoacan QA", code="qa-cashier-tournaments-coyoacan")
    cashier = make_user(role="cashier", username="qa-cashier-tournaments", primary_site=roma)
    student = make_student(site=roma, full_name="Alumno Torneo Roma")
    other_tournament = make_tournament(site=coyoacan, name="Torneo Coyoacan")

    client, user, _ = auth_client(user=cashier)
    assert user["role"] == "cashier"

    tournament_response = client.post(
        "/api/tournaments/",
        {
            "site": roma.id,
            "name": "Torneo ventanilla",
            "billing_type": "weekly_match",
            "starts_on": "2026-06-01",
            "expected_weeks": 12,
            "is_active": True,
        },
        format="json",
    )
    assert tournament_response.status_code == 201
    tournament = Tournament.objects.get(id=tournament_response.json()["id"])

    team_payload = {
        "tournament": tournament.id,
        "representative_name": "Representante",
        "representative_phone": "5500000000",
        "is_active": True,
    }
    home_response = client.post("/api/teams/", {**team_payload, "name": "Local"}, format="json")
    away_response = client.post("/api/teams/", {**team_payload, "name": "Visitante"}, format="json")
    assert home_response.status_code == 201
    assert away_response.status_code == 201
    teams = list(Team.objects.filter(tournament=tournament).order_by("id"))

    registration_response = client.post(
        "/api/student-tournament-registrations/",
        {
            "tournament": tournament.id,
            "student": student.id,
            "team": teams[0].id,
            "billing_type": "weekly_match",
            "weekly_amount": "650.00",
            "full_amount": "7800.00",
            "status": "registered",
        },
        format="json",
    )
    assert registration_response.status_code == 201
    assert StudentTournamentRegistration.objects.filter(tournament=tournament, student=student).exists()

    match_response = client.post(
        "/api/matches/",
        {
            "tournament": tournament.id,
            "site": roma.id,
            "home_team": teams[0].id,
            "away_team": teams[1].id,
            "played_on": "2026-06-01",
            "starts_at": "18:00",
            "duration_minutes": 50,
            "status": "scheduled",
        },
        format="json",
    )
    assert match_response.status_code == 201
    assert Match.objects.filter(tournament=tournament, site=roma).exists()

    forbidden_response = client.post(
        "/api/teams/",
        {**team_payload, "tournament": other_tournament.id, "name": "Fuera de sede"},
        format="json",
    )
    assert forbidden_response.status_code == 403


def test_dev_user_has_admin_scope_for_qa_and_developer_diagnostics(auth_client):
    admin = make_user(role="admin")
    roma = make_site(name="Roma QA")
    coyoacan = make_site(name="Coyoacan QA")

    client, user, _ = auth_client(role="dev")
    assert user["role"] == "dev"

    users_response = client.get("/api/users/")
    assert users_response.status_code == 200
    assert any(item["username"] == admin.username for item in users_response.json())

    sites_response = client.get("/api/sites/")
    assert sites_response.status_code == 200
    visible_site_ids = {site["id"] for site in sites_response.json()}
    assert {roma.id, coyoacan.id}.issubset(visible_site_ids)

    historical_response = client.get("/api/historical-imports/")
    assert historical_response.status_code == 200


def test_coach_sees_only_assigned_group_and_can_register_attendance_and_hours(auth_client):
    site = make_site(code="qa-coach-site")
    coach = make_user(
        role="coach",
        username="qa-coach",
        primary_site=site,
        coach_group_name="Equipo Sub-12 A",
        coach_hourly_rate=Decimal("250.00"),
    )
    guardian = make_guardian()
    for index in range(12):
        make_student(site=site, guardian=guardian, group_name="Equipo Sub-12 A", full_name=f"Coach Student {index}")
    make_student(site=site, guardian=guardian, group_name="Otro Grupo", full_name="Hidden Student")

    client, user, _ = auth_client(user=coach)
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

    with patch("core.domain_serializers.attendance.timezone.now", return_value=timezone.make_aware(datetime(2026, 5, 26, 17, 15))):
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
    assert CoachWorkLog.objects.get(id=work_log_response.json()["id"]).coach.username == "qa-coach"

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


def test_coach_cannot_administer_tournaments_or_registrations(auth_client):
    site = make_site(code="qa-coach-tournament-site")
    coach = make_user(role="coach", primary_site=site, coach_group_name="Equipo Sub-12 A")
    student = make_student(site=site, group_name="Equipo Sub-12 A")
    tournament = make_tournament(site=site)
    teams = [make_team(tournament=tournament), make_team(tournament=tournament)]

    client, user, _ = auth_client(user=coach)
    assert user["role"] == "coach"

    tournaments_response = client.get("/api/tournaments/")
    assert tournaments_response.status_code == 200
    assert tournaments_response.json()[0]["id"] == tournament.id

    students_response = client.get("/api/students/")
    assert students_response.status_code == 200
    assert students_response.json()[0]["id"] == student.id

    create_tournament_response = client.post(
        "/api/tournaments/",
        {
            "site": site.id,
            "name": "Torneo no permitido coach",
            "billing_type": "weekly_match",
            "starts_on": "2026-06-01",
            "expected_weeks": 12,
            "is_active": True,
        },
        format="json",
    )
    assert create_tournament_response.status_code == 403

    create_team_response = client.post(
        "/api/teams/",
        {
            "tournament": tournament.id,
            "name": "Equipo no permitido coach",
            "representative_name": "Representante",
            "representative_phone": "5500000000",
            "is_active": True,
        },
        format="json",
    )
    assert create_team_response.status_code == 403

    registration_response = client.post(
        "/api/student-tournament-registrations/",
        {
            "tournament": tournament.id,
            "student": student.id,
            "billing_type": "weekly_match",
            "weekly_amount": "650.00",
            "full_amount": "7800.00",
            "status": "registered",
        },
        format="json",
    )
    assert registration_response.status_code == 403

    match_response = client.post(
        "/api/matches/",
        {
            "tournament": tournament.id,
            "site": site.id,
            "home_team": teams[0].id,
            "away_team": teams[1].id,
            "played_on": "2026-06-01",
            "starts_at": "18:00",
            "status": "scheduled",
        },
        format="json",
    )
    assert match_response.status_code == 403


def test_audit_logs_are_admin_only(auth_client):
    AuditLog.objects.create(
        action="security_probe",
        table_name="students",
        record_id="1",
        metadata={"source": "test"},
    )

    cashier_client, _payload, _cashier = auth_client(role="cashier", primary_site=make_site())
    assert cashier_client.get("/api/audit-logs/").status_code == 403

    coach_client, _payload, _coach = auth_client(role="coach", primary_site=make_site())
    assert coach_client.get("/api/audit-logs/").status_code == 403

    admin_api, _payload, _admin = auth_client(role="admin")
    response = admin_api.get("/api/audit-logs/")
    assert response.status_code == 200
    assert any(item["action"] == "security_probe" for item in response.json())


def test_site_coordinator_finance_scope_cannot_be_expanded_by_site_filter(auth_client):
    roma = make_site(name="Roma QA", code="qa-coordinator-roma")
    coyoacan = make_site(name="Coyoacan QA", code="qa-coordinator-coyoacan")
    coordinator = make_user(role="site_coordinator", primary_site=roma)
    recipient = make_user(role="coach", primary_site=roma)
    Expense.objects.create(
        site=roma,
        category="Operacion",
        description="Roma expense",
        amount=Decimal("100.00"),
        expense_date=timezone.localdate(),
        status="approved",
        captured_by=coordinator,
        approved_by=coordinator,
    )
    Expense.objects.create(
        site=coyoacan,
        category="Operacion",
        description="Coyoacan expense",
        amount=Decimal("100.00"),
        expense_date=timezone.localdate(),
        status="approved",
        captured_by=coordinator,
        approved_by=coordinator,
    )
    StaffPaymentRequest.objects.create(
        site=roma,
        recipient=recipient,
        kind="coach_payroll",
        amount=Decimal("100.00"),
        description="Roma staff",
        status="requested",
        requested_by=coordinator,
    )
    StaffPaymentRequest.objects.create(
        site=coyoacan,
        recipient=recipient,
        kind="coach_payroll",
        amount=Decimal("100.00"),
        description="Coyoacan staff",
        status="requested",
        requested_by=coordinator,
    )

    client, user, _ = auth_client(user=coordinator)
    assert user["role"] == "site_coordinator"

    expenses_response = client.get(f"/api/expenses/?site={coyoacan.id}")
    assert expenses_response.status_code == 200
    assert expenses_response.json()
    assert all(item["site_name"] == "Roma QA" for item in expenses_response.json())

    staff_response = client.get(f"/api/staff-payment-requests/?site={coyoacan.id}")
    assert staff_response.status_code == 200
    assert staff_response.json()
    assert all(item["site_name"] == "Roma QA" for item in staff_response.json())


def test_cashier_cannot_close_another_site(auth_client):
    roma = make_site(code="qa-closure-roma")
    coyoacan = make_site(code="qa-closure-coyoacan")
    cashier = make_user(role="cashier", primary_site=roma)
    client, user, _ = auth_client(user=cashier)
    assert user["role"] == "cashier"

    response = client.post(
        "/api/daily-closures/",
        {
            "site": coyoacan.id,
            "business_date": "2026-06-15",
            "cash_expected": "100.00",
            "cash_reported": "100.00",
        },
        format="json",
    )
    assert response.status_code == 400
