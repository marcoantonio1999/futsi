from unittest.mock import patch
import pytest
from core.models import Tournament, Student, Guardian, AuditLog, Charge, Team
from core.services.tournament_deletion import deletion_plan
from core.tests.factories import (
    make_tournament, make_student_tournament_registration, make_charge, make_payment,
    make_discount, make_invoice, make_team, make_match, make_round, make_attendance_session,
    make_attendance_record, make_player,
)

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def confirmation(client, tournament):
    response = client.get(f"/api/tournaments/{tournament.pk}/deletion-preview/")
    assert response.status_code == 200, response.content
    return {"confirmation_token": response.json()["confirmation_token"], "confirmation_name": tournament.name}


def test_anonymous_requests_are_rejected_without_server_error():
    from rest_framework.test import APIClient
    client = APIClient()
    tournament = make_tournament()
    assert client.get(f"/api/tournaments/{tournament.pk}/deletion-preview/").status_code in {401, 403}
    assert client.delete(f"/api/tournaments/{tournament.pk}/", {}, format="json").status_code in {401, 403}
    assert client.post("/api/tournaments/deletion-cleanup/", {}, format="json").status_code in {401, 403}


def test_delete_tournament_with_history_preserves_students_family_and_other_tournaments(auth_client):
    registration = make_student_tournament_registration()
    tournament = registration.tournament
    student = registration.student
    unrelated_charge = make_charge(student=student)
    unrelated_registration = make_student_tournament_registration(student=student)
    charge = make_charge(student=student, tournament_registration=registration)
    payment = make_payment(charge)
    make_discount(charge=charge)
    make_invoice(payment=payment)
    round = make_round(tournament=tournament)
    match = make_match(tournament=tournament, home_team=registration.team, round=round)
    session = make_attendance_session(site=tournament.site, tournament=tournament, match=match, round=round)
    make_attendance_record(session=session, student=student)
    plan = deletion_plan(tournament)
    removed = [(group["model"], [row.pk for row in group["rows"]]) for group in plan["groups"]]
    client, _, _ = auth_client()
    payload = confirmation(client, tournament)
    response = client.delete(f"/api/tournaments/{tournament.pk}/", payload, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["cleanup_pending"] == 0
    for model, ids in removed:
        assert not model.objects.filter(pk__in=ids).exists(), model.__name__
    assert Student.objects.filter(pk=student.pk).exists()
    assert Guardian.objects.filter(pk=student.guardian_id).exists()
    assert Charge.objects.filter(pk=unrelated_charge.pk).exists()
    assert Tournament.objects.filter(pk=unrelated_registration.tournament_id).exists()
    assert AuditLog.objects.filter(action="tournament_deleted", record_id=str(tournament.pk)).exists()


@pytest.mark.parametrize("invalid", ["missing", "wrong_name", "other_tournament", "other_actor", "changed"])
def test_delete_requires_review_of_current_tournament_and_exact_confirmation(auth_client, invalid):
    tournament = make_tournament()
    client, _, _ = auth_client()
    payload = confirmation(client, tournament)
    if invalid == "missing": payload = {}
    if invalid == "wrong_name": payload["confirmation_name"] = "wrong"
    if invalid == "other_tournament": payload = confirmation(client, make_tournament())
    if invalid == "other_actor": client, _, _ = auth_client()
    if invalid == "changed": make_team(tournament=tournament)
    response = client.delete(f"/api/tournaments/{tournament.pk}/", payload, format="json")
    assert response.status_code == (409 if invalid == "changed" else 400)
    assert Tournament.objects.filter(pk=tournament.pk).exists()


@pytest.mark.parametrize("role", ["coach", "guardian", "accounting", "adult_representative"])
def test_read_only_roles_cannot_preview_or_delete(auth_client, role):
    tournament = make_tournament()
    client, _, _ = auth_client(role=role, primary_site=tournament.site)
    assert client.get(f"/api/tournaments/{tournament.pk}/deletion-preview/").status_code == 403
    assert client.delete(f"/api/tournaments/{tournament.pk}/", {}, format="json").status_code == 403


@pytest.mark.parametrize("role", ["cashier", "site_coordinator"])
@pytest.mark.parametrize("own_site", [True, False, None])
def test_operator_scope_for_deletion(auth_client, role, own_site):
    tournament = make_tournament()
    site = tournament.site if own_site else make_tournament().site if own_site is False else None
    client, _, _ = auth_client(role=role, primary_site=site)
    if own_site:
        response = client.delete(f"/api/tournaments/{tournament.pk}/", confirmation(client, tournament), format="json")
        assert response.status_code == 200, response.content
    else:
        assert client.get(f"/api/tournaments/{tournament.pk}/deletion-preview/").status_code in {403, 404}
        assert client.delete(f"/api/tournaments/{tournament.pk}/", {}, format="json").status_code in {403, 404}


def test_deletion_rolls_back_if_any_dependent_cannot_be_removed(auth_client):
    tournament = make_tournament()
    make_team(tournament=tournament)
    client, _, _ = auth_client()
    payload = confirmation(client, tournament)
    from django.db.models.query import QuerySet
    original = QuerySet.delete
    def fail_parent(query):
        if query.model is Tournament:
            raise RuntimeError("simulated failure")
        return original(query)
    with patch.object(QuerySet, "delete", fail_parent), pytest.raises(RuntimeError):
        client.delete(f"/api/tournaments/{tournament.pk}/", payload, format="json")
    assert Team.objects.filter(tournament=tournament).exists()
    assert Tournament.objects.filter(pk=tournament.pk).exists()
    assert not AuditLog.objects.filter(action="tournament_deleted").exists()


def test_owned_files_can_be_retried_after_tournament_has_been_deleted(auth_client):
    tournament = make_tournament()
    player = make_player(team=make_team(tournament=tournament), photo_url="supabase://private/photo-test.jpg")
    client, _, _ = auth_client()
    with patch("core.services.student_deletion.delete_private_file", side_effect=RuntimeError("storage unavailable")):
        response = client.delete(f"/api/tournaments/{tournament.pk}/", confirmation(client, tournament), format="json")
    assert response.status_code == 200, response.content
    assert response.json()["cleanup_pending"] == 1
    assert not type(player).objects.filter(pk=player.pk).exists()
    with patch("core.services.student_deletion.delete_private_file") as remove_file:
        retry = client.post("/api/tournaments/deletion-cleanup/", {"deletion_id": response.json()["deletion_id"]}, format="json")
    assert retry.status_code == 200
    assert retry.json()["cleanup_pending"] == 0
    remove_file.assert_called_once()
