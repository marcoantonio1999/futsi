from datetime import timedelta
import pytest
from django.utils import timezone
from core.models import StudentTournamentRegistration, Charge, Match
from core.api.billing_generators import generate_student_tournament_charges_for_user
from core.tests.factories import make_tournament, make_team, make_student, make_student_tournament_registration, make_charge, make_payment, make_user

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_withdrawal_preserves_payment_plan_charges_and_student_and_stops_new_billing(auth_client):
    registration = make_student_tournament_registration(billing_type="full_tournament", full_amount="2500.00")
    charge = make_charge(student=registration.student, tournament_registration=registration)
    payment = make_payment(charge=charge)
    client, _, actor = auth_client()
    response = client.patch(f"/api/student-tournament-registrations/{registration.pk}/", {"status": "withdrawn"}, format="json")
    assert response.status_code == 200, response.content
    registration.refresh_from_db()
    assert registration.status == "withdrawn"
    assert registration.billing_type == "full_tournament"
    assert str(registration.full_amount) == "2500.00"
    assert registration.student.tournament_registrations.count() == 1
    assert Charge.objects.filter(pk=charge.pk).exists()
    assert type(payment).objects.filter(pk=payment.pk).exists()
    assert generate_student_tournament_charges_for_user(actor, timezone.localdate() + timedelta(days=14)) == []


def test_reenroll_updates_existing_registration_and_can_change_team(auth_client):
    registration = make_student_tournament_registration(status="withdrawn")
    new_team = make_team(tournament=registration.tournament)
    client, _, _ = auth_client()
    response = client.patch(f"/api/student-tournament-registrations/{registration.pk}/", {"status": "registered", "team": new_team.pk, "jersey_number": 12, "billing_starts_on": timezone.localdate().isoformat()}, format="json")
    assert response.status_code == 200, response.content
    registration.refresh_from_db()
    assert registration.status == "registered" and registration.team_id == new_team.pk
    assert StudentTournamentRegistration.objects.filter(student=registration.student, tournament=registration.tournament).count() == 1


def test_registration_rejects_team_from_another_tournament_and_keeps_original_team(auth_client):
    registration = make_student_tournament_registration()
    wrong_team = make_team()
    client, _, _ = auth_client()
    response = client.patch(f"/api/student-tournament-registrations/{registration.pk}/", {"team": wrong_team.pk}, format="json")
    assert response.status_code == 400
    assert StudentTournamentRegistration.objects.get(pk=registration.pk).team_id == registration.team_id


def test_cannot_repurpose_an_existing_enrollment_for_another_student(auth_client):
    registration = make_student_tournament_registration()
    other_student = make_student(site=registration.tournament.site)
    client, _, _ = auth_client()
    response = client.patch(f"/api/student-tournament-registrations/{registration.pk}/", {"student": other_student.pk}, format="json")
    assert response.status_code == 400


@pytest.mark.parametrize("role", ["cashier", "site_coordinator"])
def test_scoped_operators_cannot_withdraw_other_sites_or_create_enrollment_there(auth_client, role):
    own = make_tournament()
    other = make_student_tournament_registration()
    client, _, _ = auth_client(role=role, primary_site=own.site)
    assert client.patch(f"/api/student-tournament-registrations/{other.pk}/", {"status": "withdrawn"}, format="json").status_code == 404
    student = make_student(site=other.tournament.site)
    assert client.post("/api/student-tournament-registrations/", {"tournament": other.tournament_id, "student": student.pk, "team": other.team_id}, format="json").status_code == 403


@pytest.mark.parametrize("payload", [{"weekly_amount": "-10"}, {"full_amount": "-10"}, {"status": "not-a-status"}])
def test_invalid_registration_updates_are_rejected(auth_client, payload):
    registration = make_student_tournament_registration()
    client, _, _ = auth_client()
    assert client.patch(f"/api/student-tournament-registrations/{registration.pk}/", payload, format="json").status_code == 400


def test_duplicate_registration_is_rejected(auth_client):
    registration = make_student_tournament_registration()
    client, _, _ = auth_client()
    response = client.post("/api/student-tournament-registrations/", {"tournament": registration.tournament_id, "student": registration.student_id, "team": registration.team_id}, format="json")
    assert response.status_code == 400
    assert StudentTournamentRegistration.objects.count() == 1


@pytest.mark.parametrize("invalid", ["same_team", "other_tournament", "other_site", "zero_duration"])
def test_schedule_rejects_inconsistent_teams_site_and_duration(auth_client, invalid):
    tournament = make_tournament()
    home, away = make_team(tournament=tournament), make_team(tournament=tournament)
    payload = {"tournament": tournament.pk, "site": tournament.site_id, "home_team": home.pk, "away_team": away.pk, "played_on": timezone.localdate().isoformat(), "starts_at": "18:00", "duration_minutes": 60, "status": "scheduled"}
    if invalid == "same_team": payload["away_team"] = home.pk
    if invalid == "other_tournament": payload["away_team"] = make_team().pk
    if invalid == "other_site": payload["site"] = make_tournament().site_id
    if invalid == "zero_duration": payload["duration_minutes"] = 0
    client, _, _ = auth_client()
    response = client.post("/api/matches/", payload, format="json")
    assert response.status_code == 400, response.content
    assert Match.objects.count() == 0


def test_schedule_valid_match_creates_sessions(auth_client):
    tournament = make_tournament()
    home, away = make_team(tournament=tournament), make_team(tournament=tournament)
    client, _, _ = auth_client()
    response = client.post("/api/matches/", {"tournament": tournament.pk, "site": tournament.site_id, "home_team": home.pk, "away_team": away.pk, "played_on": timezone.localdate().isoformat(), "starts_at": "18:00", "duration_minutes": 60, "status": "scheduled"}, format="json")
    assert response.status_code == 201, response.content
    match = Match.objects.get(pk=response.json()["id"])
    session = match.attendance_sessions.get()
    assert session.team_id is None
    assert session.tournament_id == tournament.pk
    assert session.group_name == f"{home.name} vs {away.name}"
    assert session.duration_minutes == 60
