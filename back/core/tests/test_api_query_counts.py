from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.authtoken.models import Token

from core.models import Court, DailyClosure, Guardian, Site, Team, Tournament, User
from core.tests.factories import (
    make_audit_log,
    make_cash_movement,
    make_charge,
    make_discount,
    make_expense,
    make_guardian,
    make_invoice,
    make_match,
    make_payment,
    make_player,
    make_round,
    make_site,
    make_staff_payment_request,
    make_student,
    make_student_assessment,
    make_student_tournament_registration,
    make_student_value_assessment,
    make_team,
    make_tournament,
    make_user,
)


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def _build_query_count_dataset():
    site = make_site(name="QA Query Site Main", code="qa-query-main")
    extra_sites = [
        make_site(name=f"QA Query Site {index}", code=f"qa-query-{index}")
        for index in range(2)
    ]
    sites = [site, *extra_sites]
    admin = make_user(role="admin", primary_site=site)
    cashier = make_user(role="cashier", primary_site=site)
    accounting = make_user(role="accounting", primary_site=site)
    coach = make_user(role="coach", primary_site=site, coach_group_name="QA Group")
    make_user(role="site_coordinator", primary_site=site)
    guardians = [
        make_guardian(user=make_user(role="guardian"))
        for _index in range(3)
    ]
    students = [
        make_student(site=sites[index % len(sites)], guardian=guardians[index % len(guardians)], group_name="QA Group")
        for index in range(6)
    ]
    tournaments = [make_tournament(site=site), make_tournament(site=extra_sites[0])]
    teams = [make_team(tournament=tournaments[0]) for _index in range(4)]

    for index in range(20):
        make_player(team=teams[index % len(teams)], jersey_number=index + 1)

    for index, student in enumerate(students[:3]):
        make_student_tournament_registration(
            tournament=tournaments[0],
            student=student,
            team=teams[index % len(teams)],
            registered_by=admin,
            jersey_number=index + 1,
        )

    rounds = [
        make_round(tournament=tournaments[0], number=1),
        make_round(tournament=tournaments[0], number=2),
    ]
    make_match(
        tournament=tournaments[0],
        site=site,
        home_team=teams[0],
        away_team=teams[1],
        round=rounds[0],
        status="finished",
        home_goals=2,
        away_goals=1,
        updated_by=admin,
    )
    make_match(
        tournament=tournaments[0],
        site=site,
        home_team=teams[2],
        away_team=teams[3],
        round=rounds[1],
        status="live",
        home_goals=1,
        away_goals=1,
        updated_by=admin,
    )

    for index, student in enumerate(students[:3], start=1):
        make_student_assessment(student=student, coach=coach, site=student.site, assessment_month=date(2026, index, 1))
        make_student_value_assessment(student=student, coach=coach, site=student.site, assessment_month=date(2026, index, 1))

    charges = [make_charge(student=student, site=student.site, created_by=admin) for student in students[:4]]
    for charge in charges[:3]:
        make_payment(charge, received_by=cashier)
    for charge in charges[:2]:
        make_discount(charge=charge, requested_by=cashier, approved_by=admin)

    for index in range(3):
        make_expense(site=sites[index % len(sites)], captured_by=cashier, approved_by=admin)

    staff_requests = [
        make_staff_payment_request(site=site, recipient=coach, requested_by=admin)
        for _index in range(2)
    ]
    for payment_request in staff_requests:
        make_cash_movement(site=site, responsible=cashier, created_by=admin, staff_payment_request=payment_request)

    make_invoice(charge=charges[0], issued_by=accounting)
    make_audit_log(actor=admin)
    return {"admin": admin, "cashier": cashier}


def test_basic_catalog_lists_do_not_regress_to_n_plus_one(api_client):
    dataset = _build_query_count_dataset()
    admin = dataset["admin"]
    api_client.force_authenticate(user=admin)

    with CaptureQueriesContext(connection) as user_queries:
        users_response = api_client.get("/api/users/")
    with CaptureQueriesContext(connection) as guardian_queries:
        guardians_response = api_client.get("/api/guardians/")
    with CaptureQueriesContext(connection) as charge_queries:
        charges_response = api_client.get("/api/charges/")

    assert users_response.status_code == 200
    assert guardians_response.status_code == 200
    assert charges_response.status_code == 200
    assert len(users_response.json()) >= 8
    assert len(guardians_response.json()) >= 3
    assert len(charges_response.json()) >= 4
    assert len(user_queries) <= 2
    assert len(guardian_queries) <= 2
    assert len(charge_queries) <= 3


@pytest.mark.parametrize(
    ("path", "minimum_items", "max_queries"),
    [
        ("/api/sites/", 3, 2),
        ("/api/students/", 6, 5),
        ("/api/tournaments/", 2, 2),
        ("/api/teams/", 4, 2),
        ("/api/student-tournament-registrations/", 3, 2),
        ("/api/players/", 20, 1),
        ("/api/rounds/", 2, 2),
        ("/api/matches/", 2, 1),
        ("/api/matches/standings/", 4, 2),
        ("/api/student-assessments/", 3, 1),
        ("/api/student-value-assessments/", 3, 1),
        ("/api/payments/", 3, 2),
        ("/api/discounts/", 2, 1),
        ("/api/expenses/", 3, 2),
        ("/api/staff-payment-requests/", 2, 1),
        ("/api/cash-movements/", 2, 1),
        ("/api/invoices/", 1, 1),
        ("/api/audit-logs/", 1, 1),
    ],
)
def test_core_read_endpoints_keep_constant_query_counts(api_client, path, minimum_items, max_queries):
    dataset = _build_query_count_dataset()
    admin = dataset["admin"]
    api_client.force_authenticate(user=admin)

    with CaptureQueriesContext(connection) as captured:
        response = api_client.get(path)

    assert response.status_code == 200
    assert len(response.json()) >= minimum_items
    assert len(captured) <= max_queries


def test_simple_reference_lists_keep_single_query_with_rows(api_client):
    admin = make_user(role="admin")
    sites = [
        Site.objects.create(name=f"QA Query Site {index}", code=f"qa-query-site-{index}", address="QA")
        for index in range(3)
    ]
    for site in sites:
        for index in range(5):
            Court.objects.create(site=site, name=f"Cancha {site.id}-{index}", is_active=True)
            DailyClosure.objects.create(
                site=site,
                business_date=date(2026, 1, 1) + timedelta(days=index),
                cash_expected=Decimal("100.00"),
                cash_reported=Decimal("100.00"),
                closed_by=admin,
            )
    api_client.force_authenticate(user=admin)

    with CaptureQueriesContext(connection) as court_queries:
        courts_response = api_client.get("/api/courts/")
    with CaptureQueriesContext(connection) as closure_queries:
        closures_response = api_client.get("/api/daily-closures/")

    assert courts_response.status_code == 200
    assert closures_response.status_code == 200
    assert len(courts_response.json()) >= 15
    assert len(closures_response.json()) >= 15
    assert len(court_queries) <= 1
    assert len(closure_queries) <= 1


def test_admin_site_list_avoids_unneeded_distinct(api_client):
    admin = User.objects.create_user(username="qa-sites-distinct-admin", password="x", role="admin")
    for index in range(3):
        Site.objects.create(name=f"QA Sites Distinct {index}", code=f"qa-sites-distinct-{index}", address="QA")

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get("/api/sites/")

    assert response.status_code == 200
    site_query = next(query["sql"] for query in captured if 'FROM "sites"' in query["sql"])
    assert "SELECT DISTINCT" not in site_query.upper()
    assert len(captured) <= 1


def test_admin_team_list_avoids_unneeded_distinct(api_client):
    site = Site.objects.create(name="QA Teams Distinct", code="qa-teams-distinct", address="QA")
    tournament = Tournament.objects.create(
        site=site,
        name="Torneo Teams Distinct QA",
        billing_type="weekly_match",
        starts_on=date(2026, 8, 1),
        expected_weeks=10,
    )
    admin = User.objects.create_user(username="qa-teams-distinct-admin", password="x", role="admin")
    for index in range(3):
        Team.objects.create(
            tournament=tournament,
            name=f"Equipo Teams Distinct {index}",
            representative_name="Representante",
            representative_phone="5500000621",
        )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get("/api/teams/")

    assert response.status_code == 200
    team_query = next(query["sql"] for query in captured if 'FROM "teams"' in query["sql"])
    assert "SELECT DISTINCT" not in team_query.upper()
    assert len(captured) <= 1


def test_student_create_uses_lightweight_site_and_guardian_lookups(api_client):
    site = Site.objects.create(
        name="QA Student Create",
        code="qa-student-create",
        address="QA address should not be selected",
    )
    guardian = Guardian.objects.create(
        full_name="Tutor Student Create QA",
        phone="5500000618",
        email="student-create@example.test",
        notes="Guardian notes should not be selected",
    )
    admin = User.objects.create_user(username="qa-student-create-admin", password="x", role="admin")

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/students/",
            {
                "site": site.id,
                "guardian": guardian.id,
                "full_name": "Alumno Student Create QA",
                "birth_date": "2015-01-01",
                "category": "Sub-11",
                "group_name": "Create",
                "status": "active",
                "medical_notes": "Medical notes are part of the created student",
                "emergency_contact": "Contacto QA",
                "emergency_phone": "5500000619",
                "uniform_status": "pending",
                "joined_at": "2026-08-01",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["site_name"] == "QA Student Create"
    assert payload["guardian_name"] == "Tutor Student Create QA"
    assert payload["guardian_phone"] == "5500000618"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"guardians"."notes"' not in captured_sql
    assert len(captured) <= 6


def test_court_create_uses_lightweight_site_lookup(api_client):
    site = Site.objects.create(
        name="QA Court Create",
        code="qa-court-create",
        address="QA address should not be selected",
    )
    admin = User.objects.create_user(username="qa-court-create-admin", password="x", role="admin")

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/courts/",
            {
                "site": site.id,
                "name": "Cancha Court Create QA",
                "is_active": True,
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["site"] == site.id
    assert payload["name"] == "Cancha Court Create QA"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert len(captured) <= 3


def test_guardian_create_uses_lightweight_user_lookup(api_client):
    admin = User.objects.create_user(username="qa-guardian-create-admin", password="x", role="admin")
    guardian_user = User.objects.create_user(
        username="qa-guardian-create-user",
        password="x",
        role="guardian",
        section_permissions=["students", "billing"],
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/guardians/",
            {
                "user": guardian_user.id,
                "full_name": "Tutor Guardian Create QA",
                "phone": "5500000620",
                "email": "guardian-create@example.test",
                "tax_name": "Tutor Fiscal QA",
                "tax_id": "GUAQA001",
                "virtual_clabe": "646180000000000020",
                "notes": "Notes are part of the created guardian",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["username"] == "qa-guardian-create-user"
    assert payload["full_name"] == "Tutor Guardian Create QA"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"core_user"."password"' not in captured_sql
    assert '"core_user"."section_permissions"' not in captured_sql
    assert len(captured) <= 3


def test_daily_closure_create_uses_lightweight_site_lookup(api_client):
    site = Site.objects.create(
        name="QA Closure Create",
        code="qa-closure-create",
        address="QA address should not be selected",
    )
    admin = User.objects.create_user(username="qa-closure-create-admin", password="x", role="admin")

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/daily-closures/",
            {
                "site": site.id,
                "business_date": "2026-08-01",
                "cash_expected": "1000.00",
                "cash_reported": "995.00",
                "notes": "Cierre create QA",
                "is_reopened": False,
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["site"] == site.id
    assert payload["closed_by"] == admin.id
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert len(captured) <= 3


def test_cashier_auth_me_keeps_profile_lookup_constant(api_client):
    dataset = _build_query_count_dataset()
    cashier = dataset["cashier"]
    token, _ = Token.objects.get_or_create(user=cashier)
    api_client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    with CaptureQueriesContext(connection) as captured:
        response = api_client.get("/api/auth/me/")

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == cashier.username
    assert body["primary_site_name"] == cashier.primary_site.name
    assert len(captured) <= 2
