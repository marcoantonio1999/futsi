from datetime import date, timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from core.models import (
    Guardian,
    Match,
    Player,
    Round,
    Site,
    Student,
    StudentAssessment,
    StudentValueAssessment,
    Team,
    Tournament,
    User,
)


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_tournament_create_uses_lightweight_site_lookup(api_client):
    site = Site.objects.create(
        name="QA Tournament Create",
        code="qa-tournament-create",
        address="QA address should not be selected",
    )
    admin = User.objects.create_user(username="qa-tournament-create-admin", password="x", role="admin")

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/tournaments/",
            {
                "site": site.id,
                "name": "Torneo Tournament Create QA",
                "billing_type": "weekly_match",
                "starts_on": "2026-08-01",
                "expected_weeks": 10,
                "is_active": True,
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["site"] == site.id
    assert payload["name"] == "Torneo Tournament Create QA"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert len(captured) <= 2


def test_student_assessment_list_prefetched_related_fields_are_serialized(api_client):
    site = Site.objects.create(name="QA Assessment List", code="qa-assessment-list", address="QA")
    coach = User.objects.create_user(
        username="qa-assessment-coach",
        password="x",
        role="coach",
        primary_site=site,
        first_name="Coach",
        last_name="Tecnico",
    )
    guardian = Guardian.objects.create(full_name="Tutor Assessment QA", phone="5500000601", email="assessment@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Assessment QA",
        category="Sub-12",
        group_name="QA",
        status="active",
        photo_url="https://example.test/assessment.jpg",
    )
    assessment = StudentAssessment.objects.create(
        student=student,
        coach=coach,
        site=site,
        assessment_month=date(2026, 7, 1),
        pace=70,
        shooting=80,
        passing=90,
        dribbling=60,
        defense=50,
        physical=85,
        attitude=95,
        notes="Evaluacion tecnica QA",
    )

    api_client.force_authenticate(user=coach)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get("/api/student-assessments/")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == assessment.id)
    assert payload["student_name"] == "Alumno Assessment QA"
    assert payload["student_photo_url"] == "https://example.test/assessment.jpg"
    assert payload["category"] == "Sub-12"
    assert payload["group_name"] == "QA"
    assert payload["site_name"] == "QA Assessment List"
    assert payload["coach_name"] == "Coach Tecnico"
    assert payload["overall_rating"] == 76
    assert len(captured) <= 1


def test_student_assessment_create_reuses_student_site_lookup(api_client):
    site = Site.objects.create(
        name="QA Assessment Create",
        code="qa-assessment-create",
        address="QA address should not be selected",
    )
    coach = User.objects.create_user(
        username="qa-assessment-create-coach",
        password="x",
        role="coach",
        primary_site=site,
        first_name="Coach",
        last_name="Create",
    )
    guardian = Guardian.objects.create(full_name="Tutor Assessment Create QA", phone="5500000611")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Assessment Create QA",
        category="Sub-12",
        group_name="Create",
        status="active",
        photo_url="https://example.test/assessment-create.jpg",
        medical_notes="Medical notes should not be selected",
    )

    api_client.force_authenticate(user=coach)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/student-assessments/",
            {
                "student": student.id,
                "assessment_month": "2026-07-01",
                "pace": 70,
                "shooting": 80,
                "passing": 90,
                "dribbling": 60,
                "defense": 50,
                "physical": 85,
                "attitude": 95,
                "notes": "Evaluacion tecnica create QA",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["student_name"] == "Alumno Assessment Create QA"
    assert payload["student_photo_url"] == "https://example.test/assessment-create.jpg"
    assert payload["category"] == "Sub-12"
    assert payload["group_name"] == "Create"
    assert payload["site_name"] == "QA Assessment Create"
    assert payload["coach_name"] == "Coach Create"
    assert payload["overall_rating"] == 76
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"students"."medical_notes"' not in captured_sql
    assert '"sites"."address"' not in captured_sql
    assert len(captured) <= 8


def test_student_value_assessment_list_prefetched_related_fields_are_serialized(api_client):
    site = Site.objects.create(name="QA Value List", code="qa-value-list", address="QA")
    coach = User.objects.create_user(
        username="qa-value-coach",
        password="x",
        role="coach",
        primary_site=site,
        first_name="Coach",
        last_name="Valores",
    )
    guardian = Guardian.objects.create(full_name="Tutor Value QA", phone="5500000602", email="value@example.test")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Value QA",
        category="Sub-10",
        group_name="Valores",
        status="active",
        photo_url="https://example.test/value.jpg",
    )
    assessment = StudentValueAssessment.objects.create(
        student=student,
        coach=coach,
        site=site,
        assessment_month=date(2026, 7, 1),
        respect=80,
        discipline=70,
        teamwork=90,
        responsibility=75,
        sportsmanship=85,
        minutes_recommendation="Minutos constantes",
        notes="Evaluacion valores QA",
    )

    api_client.force_authenticate(user=coach)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get("/api/student-value-assessments/")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == assessment.id)
    assert payload["student_name"] == "Alumno Value QA"
    assert payload["student_photo_url"] == "https://example.test/value.jpg"
    assert payload["category"] == "Sub-10"
    assert payload["group_name"] == "Valores"
    assert payload["site_name"] == "QA Value List"
    assert payload["coach_name"] == "Coach Valores"
    assert payload["overall_values_rating"] == 80
    assert len(captured) <= 1


def test_student_value_assessment_create_reuses_student_site_lookup(api_client):
    site = Site.objects.create(
        name="QA Value Create",
        code="qa-value-create",
        address="QA address should not be selected",
    )
    coach = User.objects.create_user(
        username="qa-value-create-coach",
        password="x",
        role="coach",
        primary_site=site,
        first_name="Coach",
        last_name="Valores",
    )
    guardian = Guardian.objects.create(full_name="Tutor Value Create QA", phone="5500000612")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Value Create QA",
        category="Sub-10",
        group_name="Valores",
        status="active",
        photo_url="https://example.test/value-create.jpg",
        medical_notes="Medical notes should not be selected",
    )

    api_client.force_authenticate(user=coach)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/student-value-assessments/",
            {
                "student": student.id,
                "assessment_month": "2026-07-01",
                "respect": 80,
                "discipline": 70,
                "teamwork": 90,
                "responsibility": 75,
                "sportsmanship": 85,
                "notes": "Evaluacion valores create QA",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["student_name"] == "Alumno Value Create QA"
    assert payload["student_photo_url"] == "https://example.test/value-create.jpg"
    assert payload["category"] == "Sub-10"
    assert payload["group_name"] == "Valores"
    assert payload["site_name"] == "QA Value Create"
    assert payload["coach_name"] == "Coach Valores"
    assert payload["overall_values_rating"] == 80
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"students"."medical_notes"' not in captured_sql
    assert '"sites"."address"' not in captured_sql
    assert len(captured) <= 8


def test_team_create_reuses_tournament_site_lookup(api_client):
    site = Site.objects.create(
        name="QA Team Create",
        code="qa-team-create",
        address="QA address should not be selected",
    )
    admin = User.objects.create_user(username="qa-team-create-admin", password="x", role="admin")
    tournament = Tournament.objects.create(
        site=site,
        name="Torneo Team Create QA",
        billing_type="weekly_match",
        starts_on=date(2026, 8, 1),
        expected_weeks=10,
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/teams/",
            {
                "tournament": tournament.id,
                "name": "Equipo Team Create QA",
                "representative_name": "Representante Team",
                "representative_phone": "5500000617",
                "representative_email": "team-create@example.test",
                "is_active": True,
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["tournament_name"] == "Torneo Team Create QA"
    assert payload["site"] == site.id
    assert payload["site_name"] == "QA Team Create"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"sites"."address"' not in captured_sql
    assert '"tournaments"."expected_weeks"' not in captured_sql
    assert len(captured) <= 3


def test_student_tournament_registration_create_uses_lightweight_related_lookups(api_client):
    site = Site.objects.create(
        name="QA Registration Create",
        code="qa-registration-create",
        address="QA address should not be selected",
    )
    admin = User.objects.create_user(username="qa-registration-create-admin", password="x", role="admin")
    guardian = Guardian.objects.create(full_name="Tutor Registration Create QA", phone="5500000613")
    student = Student.objects.create(
        site=site,
        guardian=guardian,
        full_name="Alumno Registration Create QA",
        category="Sub-11",
        group_name="Registro",
        status="active",
        medical_notes="Medical notes should not be selected",
    )
    tournament = Tournament.objects.create(
        site=site,
        name="Torneo Registration Create QA",
        billing_type="weekly_match",
        starts_on=date(2026, 8, 1),
        expected_weeks=10,
    )
    team = Team.objects.create(
        tournament=tournament,
        name="Equipo Registration Create QA",
        representative_name="Representante",
        representative_phone="5500000614",
        representative_email="representative@example.test",
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.post(
            "/api/student-tournament-registrations/",
            {
                "tournament": tournament.id,
                "student": student.id,
                "team": team.id,
                "jersey_number": 11,
                "weekly_amount": "650.00",
                "status": "registered",
                "notes": "Registro create QA",
            },
            format="json",
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["tournament_name"] == "Torneo Registration Create QA"
    assert payload["site"] == site.id
    assert payload["site_name"] == "QA Registration Create"
    assert payload["student_name"] == "Alumno Registration Create QA"
    assert payload["student_category"] == "Sub-11"
    assert payload["student_group_name"] == "Registro"
    assert payload["team_name"] == "Equipo Registration Create QA"
    assert payload["registered_by_username"] == "qa-registration-create-admin"
    captured_sql = "\n".join(query["sql"] for query in captured)
    assert '"students"."medical_notes"' not in captured_sql
    assert '"sites"."address"' not in captured_sql
    assert '"teams"."representative_email"' not in captured_sql
    assert len(captured) <= 5


def test_player_list_prefetched_related_fields_are_serialized(api_client):
    site = Site.objects.create(name="QA Player List", code="qa-player-list", address="QA")
    admin = User.objects.create_user(username="qa-player-list-admin", password="x", role="admin")
    player_user = User.objects.create_user(username="qa-player-list-user", password="x", role="adult_player")
    tournament = Tournament.objects.create(
        site=site,
        name="Liga Player List QA",
        billing_type="weekly_match",
        starts_on=date(2026, 6, 1),
        expected_weeks=6,
    )
    team = Team.objects.create(tournament=tournament, name="Equipo Player QA", representative_name="R", representative_phone="1")
    player = Player.objects.create(
        user=player_user,
        team=team,
        full_name="Jugador Player QA",
        phone="5500000401",
        email="player@example.test",
        jersey_number=9,
        photo_url="https://example.test/player.jpg",
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get(f"/api/players/?team={team.id}")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == player.id)
    assert payload["user"] == player_user.id
    assert payload["team_name"] == "Equipo Player QA"
    assert payload["tournament"] == tournament.id
    assert payload["tournament_name"] == "Liga Player List QA"
    assert payload["site"] == site.id
    assert payload["site_name"] == "QA Player List"
    assert len(captured) <= 1


def test_match_list_prefetched_related_fields_are_serialized(api_client):
    site = Site.objects.create(name="QA Match List", code="qa-match-list", address="QA")
    admin = User.objects.create_user(username="qa-match-list-admin", password="x", role="admin")
    tournament = Tournament.objects.create(
        site=site,
        name="Liga Match List QA",
        billing_type="weekly_match",
        starts_on=date(2026, 6, 1),
        expected_weeks=6,
    )
    round_obj = Round.objects.create(tournament=tournament, number=2, starts_on=date(2026, 6, 8))
    home = Team.objects.create(tournament=tournament, name="Home QA", representative_name="H", representative_phone="1")
    away = Team.objects.create(tournament=tournament, name="Away QA", representative_name="A", representative_phone="2")
    match = Match.objects.create(
        tournament=tournament,
        round=round_obj,
        site=site,
        home_team=home,
        away_team=away,
        played_on=date(2026, 6, 8),
        home_goals=3,
        away_goals=2,
        status="finished",
        updated_by=admin,
    )

    api_client.force_authenticate(user=admin)
    response = api_client.get(f"/api/matches/?tournament={tournament.id}")

    assert response.status_code == 200
    payload = next(item for item in response.json() if item["id"] == match.id)
    assert payload["tournament_name"] == "Liga Match List QA"
    assert payload["site_name"] == "QA Match List"
    assert payload["round_number"] == 2
    assert payload["home_team_name"] == "Home QA"
    assert payload["away_team_name"] == "Away QA"
    assert payload["updated_by_username"] == "qa-match-list-admin"


def test_match_standings_ignore_unscheduled_results_and_sort_by_points(api_client):
    site = Site.objects.create(name="QA Sports", code="qa-sports", address="QA")
    admin = User.objects.create_user(username="qa-sports-admin", password="x", role="admin")
    tournament = Tournament.objects.create(
        site=site,
        name="Liga Sports QA",
        billing_type="weekly_match",
        starts_on=date(2026, 6, 1),
        expected_weeks=6,
    )
    alpha = Team.objects.create(tournament=tournament, name="Alpha", representative_name="A", representative_phone="1")
    beta = Team.objects.create(tournament=tournament, name="Beta", representative_name="B", representative_phone="2")
    gamma = Team.objects.create(tournament=tournament, name="Gamma", representative_name="G", representative_phone="3")
    Match.objects.create(
        tournament=tournament,
        site=site,
        home_team=alpha,
        away_team=beta,
        played_on=date(2026, 6, 1),
        home_goals=2,
        away_goals=0,
        status="finished",
        updated_by=admin,
    )
    Match.objects.create(
        tournament=tournament,
        site=site,
        home_team=gamma,
        away_team=alpha,
        played_on=date(2026, 6, 8),
        home_goals=3,
        away_goals=1,
        status="live",
        updated_by=admin,
    )
    Match.objects.create(
        tournament=tournament,
        site=site,
        home_team=beta,
        away_team=gamma,
        played_on=date(2026, 6, 15),
        home_goals=1,
        away_goals=1,
        status="finished",
        updated_by=admin,
    )
    Match.objects.create(
        tournament=tournament,
        site=site,
        home_team=alpha,
        away_team=gamma,
        played_on=date(2026, 6, 22),
        home_goals=9,
        away_goals=0,
        status="scheduled",
        updated_by=admin,
    )
    Match.objects.create(
        tournament=tournament,
        site=site,
        home_team=beta,
        away_team=alpha,
        played_on=date(2026, 6, 29),
        home_goals=0,
        away_goals=9,
        status="canceled",
        updated_by=admin,
    )

    api_client.force_authenticate(user=admin)
    response = api_client.get(f"/api/matches/standings/?tournament={tournament.id}")

    assert response.status_code == 200
    rows = response.json()
    assert [row["team_name"] for row in rows] == ["Gamma", "Alpha", "Beta"]
    assert rows[0]["points"] == 4
    assert rows[0]["goal_difference"] == 2
    assert rows[0]["is_leader"] is True
    assert rows[1]["points"] == 3
    assert rows[1]["goal_difference"] == 0
    assert rows[2]["points"] == 1
    assert all(row["played"] == 2 for row in rows)


def test_match_standings_many_matches_keep_query_count_bounded(api_client):
    site = Site.objects.create(name="QA Sports Scale", code="qa-sports-scale", address="QA")
    admin = User.objects.create_user(username="qa-sports-scale-admin", password="x", role="admin")
    tournament = Tournament.objects.create(
        site=site,
        name="Liga Sports Scale QA",
        billing_type="weekly_match",
        starts_on=date(2026, 6, 1),
        expected_weeks=12,
    )
    teams = [
        Team.objects.create(
            tournament=tournament,
            name=f"Scale {index}",
            representative_name=f"Representante {index}",
            representative_phone=f"55{index:08d}",
        )
        for index in range(4)
    ]
    Match.objects.bulk_create(
        [
            Match(
                tournament=tournament,
                site=site,
                home_team=teams[index % len(teams)],
                away_team=teams[(index + 1) % len(teams)],
                played_on=date(2026, 6, 1) + timedelta(days=index % 30),
                home_goals=index % 5,
                away_goals=(index + 2) % 5,
                status="finished",
                updated_by=admin,
            )
            for index in range(160)
        ]
    )

    api_client.force_authenticate(user=admin)
    with CaptureQueriesContext(connection) as captured:
        response = api_client.get(f"/api/matches/standings/?tournament={tournament.id}")

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 4
    assert sum(row["played"] for row in rows) == 320
    assert len(captured) <= 2
