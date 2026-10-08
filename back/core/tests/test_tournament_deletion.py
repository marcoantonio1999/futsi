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


@pytest.fixture
def video_evidence_table():
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute('CREATE TABLE video_clips (id TEXT PRIMARY KEY, status TEXT, match_id INTEGER REFERENCES matches(id), attendance_session_id INTEGER REFERENCES attendance_sessions(id), metadata TEXT)')
    try:
        yield connection
    finally:
        with connection.cursor() as cursor:
            cursor.execute('DROP TABLE video_clips')


@pytest.mark.parametrize('clip_status', ['deleted', 'processed', 'failed'])
def test_tournament_deletion_preserves_faceguard_evidence_and_people(auth_client, video_evidence_table, clip_status):
    import json
    tournament = make_tournament()
    team = make_team(tournament=tournament)
    player = make_player(team=team, photo_url='supabase://private/permanent-photo.jpg')
    match = make_match(tournament=tournament, home_team=team)
    session = make_attendance_session(site=tournament.site, tournament=tournament, match=match)
    with video_evidence_table.cursor() as cursor:
        cursor.execute('INSERT INTO video_clips VALUES (%s,%s,%s,%s,%s)', ['evidence-test',clip_status,match.pk,session.pk,'{"original":"preserved"}'])
    client, _, _ = auth_client()
    payload = confirmation(client, tournament)
    response = client.delete(f'/api/tournaments/{tournament.pk}/', payload, format='json')
    assert response.status_code == 200, response.content
    player.refresh_from_db()
    assert player.team_id is None
    assert player.photo_url == 'supabase://private/permanent-photo.jpg'
    with video_evidence_table.cursor() as cursor:
        cursor.execute('SELECT status,match_id,attendance_session_id,metadata FROM video_clips')
        row = cursor.fetchone()
    assert row[:3] == (clip_status,None,None)
    metadata = json.loads(row[3])
    assert metadata['original'] == 'preserved'
    assert metadata['tournament_deletion_evidence']['attendance_session_id'] == session.pk
    assert metadata['tournament_deletion_evidence']['tournament_id'] == tournament.pk
    assert not Tournament.objects.filter(pk=tournament.pk).exists()


def test_tournament_pending_video_is_protected(auth_client, video_evidence_table):
    tournament = make_tournament()
    match = make_match(tournament=tournament)
    with video_evidence_table.cursor() as cursor:
        cursor.execute('INSERT INTO video_clips VALUES (%s,%s,%s,%s,%s)', ['pending','uploaded',match.pk,None,'{}'])
    client, _, _ = auth_client()
    assert client.get(f'/api/tournaments/{tournament.pk}/deletion-preview/').status_code == 400
    assert Tournament.objects.filter(pk=tournament.pk).exists()


def test_tournament_new_video_invalidates_review(auth_client, video_evidence_table):
    tournament = make_tournament()
    match = make_match(tournament=tournament)
    client, _, _ = auth_client()
    payload = confirmation(client, tournament)
    with video_evidence_table.cursor() as cursor:
        cursor.execute('INSERT INTO video_clips VALUES (%s,%s,%s,%s,%s)', ['new','processed',match.pk,None,'{}'])
    assert client.delete(f'/api/tournaments/{tournament.pk}/', payload, format='json').status_code == 409
    assert Tournament.objects.filter(pk=tournament.pk).exists()


def test_tournament_failure_rolls_back_evidence_detachment(auth_client, video_evidence_table):
    from django.db.models.query import QuerySet
    tournament = make_tournament()
    match = make_match(tournament=tournament)
    with video_evidence_table.cursor() as cursor:
        cursor.execute('INSERT INTO video_clips VALUES (%s,%s,%s,%s,%s)', ['rollback','processed',match.pk,None,'{}'])
    client, _, _ = auth_client()
    payload = confirmation(client, tournament)
    original = QuerySet.delete
    def fail_parent(query):
        if query.model is Tournament:
            raise RuntimeError('simulated failure after evidence detachment')
        return original(query)
    with patch.object(QuerySet, 'delete', fail_parent), pytest.raises(RuntimeError):
        client.delete(f'/api/tournaments/{tournament.pk}/', payload, format='json')
    with video_evidence_table.cursor() as cursor:
        cursor.execute('SELECT match_id,metadata FROM video_clips WHERE id=%s', ['rollback'])
        assert cursor.fetchone() == (match.pk,'{}')
    assert Tournament.objects.filter(pk=tournament.pk).exists()


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


def test_player_and_owned_files_survive_tournament_deletion_and_can_be_reassigned(auth_client):
    tournament = make_tournament()
    player = make_player(team=make_team(tournament=tournament), photo_url="supabase://private/photo-test.jpg")
    client, _, _ = auth_client()
    with patch("core.services.student_deletion.delete_private_file", side_effect=RuntimeError("storage unavailable")):
        response = client.delete(f"/api/tournaments/{tournament.pk}/", confirmation(client, tournament), format="json")
    assert response.status_code == 200, response.content
    assert response.json()["cleanup_pending"] == 0
    player.refresh_from_db()
    assert player.team_id is None
    assert player.photo_url == "supabase://private/photo-test.jpg"
    new_team = make_team()
    moved = client.patch(f"/api/players/{player.pk}/", {"team": new_team.pk}, format="json")
    assert moved.status_code == 200, moved.content
    player.refresh_from_db()
    assert player.team_id == new_team.pk
    with patch("core.services.student_deletion.delete_private_file") as remove_file:
        retry = client.post("/api/tournaments/deletion-cleanup/", {"deletion_id": response.json()["deletion_id"]}, format="json")
    assert retry.status_code == 200
    assert retry.json()["cleanup_pending"] == 0
    remove_file.assert_not_called()
