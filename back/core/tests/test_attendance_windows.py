from datetime import date, datetime, time
from unittest.mock import patch

import pytest
from django.utils import timezone

from core.api.automatic_attendance_domain import (
    comparison_roster_for_session,
    person_key,
    tournament_reference_roster_for_session,
)
from core.models import (
    AttendanceRecord,
    AttendanceSession,
    PlayerAttendanceRecord,
    StudentTournamentRegistration,
)
from core.tests.factories import (
    make_attendance_session,
    make_guardian,
    make_match,
    make_player,
    make_site,
    make_student,
    make_team,
    make_tournament,
    make_user,
)


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def local_moment(year, month, day, hour, minute):
    return timezone.make_aware(datetime(year, month, day, hour, minute))


def create_academy_context():
    site = make_site(code="qa-attendance-site")
    coach = make_user(
        role="coach",
        username="qa-attendance-coach",
        primary_site=site,
        coach_group_name="Equipo Sub-12 A",
    )
    student = make_student(site=site, guardian=make_guardian(), group_name="Equipo Sub-12 A")
    return site, coach, student


def create_academy_session(student, captured_by, starts_at=time(17, 0)):
    return make_attendance_session(
        site=student.site,
        captured_by=captured_by,
        date=date(2026, 6, 15),
        starts_at=starts_at,
        group_name=student.group_name,
    )


def test_attendance_can_be_marked_only_inside_operational_window(auth_client):
    _site, coach, student = create_academy_context()
    client, _payload, _user = auth_client(user=coach)
    session = create_academy_session(student, captured_by=coach, starts_at=time(17, 0))

    with patch("core.domain_serializers.attendance.timezone.now", return_value=local_moment(2026, 6, 15, 17, 15)):
        response = client.post(
            "/api/attendance-records/",
            {"session": session.id, "student": student.id, "status": "present"},
            format="json",
        )

    assert response.status_code == 201
    assert AttendanceRecord.objects.filter(session=session, student=student, status="present").exists()


def test_attendance_is_rejected_before_or_after_window(auth_client):
    _site, coach, student = create_academy_context()
    client, _payload, _user = auth_client(user=coach)
    session = create_academy_session(student, captured_by=coach, starts_at=time(17, 0))

    with patch("core.domain_serializers.attendance.timezone.now", return_value=local_moment(2026, 6, 15, 14, 30)):
        response = client.post(
            "/api/attendance-records/",
            {"session": session.id, "student": student.id, "status": "present"},
            format="json",
        )

    assert response.status_code == 400
    assert "ventana operativa" in str(response.content)


def test_tournament_attendance_roster_uses_registered_students_only(auth_client):
    site = make_site(code="qa-roster-site")
    admin = make_user(role="admin", username="qa-roster-admin", primary_site=site)
    client, _payload, _user = auth_client(user=admin)
    registered = make_student(site=site, full_name="Registered QA")
    outsider = make_student(site=site, full_name="Outsider QA")
    tournament = make_tournament(site=site, name="Copa QA Sub-12", starts_on=date(2026, 6, 15))
    home = make_team(tournament=tournament, name="QA Local")
    away = make_team(tournament=tournament, name="QA Visita")
    StudentTournamentRegistration.objects.create(tournament=tournament, student=registered, team=home, registered_by=admin)
    match = make_match(
        tournament=tournament,
        site=site,
        home_team=home,
        away_team=away,
        played_on=date(2026, 6, 15),
        starts_at=time(17, 0),
    )
    session = AttendanceSession.objects.create(
        site=site,
        session_type="tournament_match",
        date=match.played_on,
        starts_at=match.starts_at,
        tournament=tournament,
        match=match,
        captured_by=admin,
    )

    with patch("core.domain_serializers.attendance.timezone.now", return_value=local_moment(2026, 6, 15, 16, 30)):
        ok_response = client.post("/api/attendance-records/", {"session": session.id, "student": registered.id, "status": "present"}, format="json")
        bad_response = client.post("/api/attendance-records/", {"session": session.id, "student": outsider.id, "status": "present"}, format="json")

    assert ok_response.status_code == 201
    assert bad_response.status_code == 400
    assert "roster" in str(bad_response.content)


def test_match_updates_keep_generated_attendance_sessions_in_sync(auth_client):
    site = make_site(code="qa-sync-site")
    admin = make_user(role="admin", username="qa-sync-admin", primary_site=site)
    client, _payload, _user = auth_client(user=admin)
    tournament = make_tournament(site=site, name="Copa Sync QA", starts_on=date(2026, 6, 15))
    home = make_team(tournament=tournament, name="Sync Local")
    away = make_team(tournament=tournament, name="Sync Visita")

    create_response = client.post(
        "/api/matches/",
        {
            "tournament": tournament.id,
            "site": site.id,
            "home_team": home.id,
            "away_team": away.id,
            "played_on": "2026-06-15",
            "starts_at": "18:00",
            "duration_minutes": 45,
            "status": "scheduled",
        },
        format="json",
    )

    assert create_response.status_code == 201
    match_id = create_response.data["id"]
    sessions = AttendanceSession.objects.filter(match_id=match_id).order_by("id")
    assert sessions.count() == 1
    assert sessions[0].team_id is None
    assert sessions[0].group_name == "Sync Local vs Sync Visita"
    assert sessions[0].ends_at == time(18, 45)

    update_response = client.patch(
        f"/api/matches/{match_id}/",
        {"played_on": "2026-06-16", "starts_at": "19:10", "duration_minutes": 20},
        format="json",
    )

    assert update_response.status_code == 200
    sessions = AttendanceSession.objects.filter(match_id=match_id)
    assert sessions.count() == 1
    assert sessions[0].date == date(2026, 6, 16)
    assert sessions[0].starts_at == time(19, 10)
    assert sessions[0].ends_at == time(19, 30)

    cancel_response = client.patch(f"/api/matches/{match_id}/", {"status": "canceled"}, format="json")

    assert cancel_response.status_code == 200
    assert AttendanceSession.objects.filter(match_id=match_id).count() == 0


def test_adult_player_attendance_uses_match_team_and_window(auth_client):
    site = make_site(code="qa-adult-attendance-site")
    admin = make_user(role="admin", username="qa-adult-attendance-admin", primary_site=site)
    client, _payload, _user = auth_client(user=admin)
    tournament = make_tournament(site=site, name="Liga QA Adultos", starts_on=date(2026, 6, 15))
    home = make_team(tournament=tournament, name="Adultos QA Local")
    away = make_team(tournament=tournament, name="Adultos QA Visita")
    home_player = make_player(team=home, full_name="Jugador Local QA", phone="5510101010", jersey_number=7)
    away_player = make_player(team=away, full_name="Jugador Visita QA", phone="5520202020", jersey_number=8)
    match = make_match(
        tournament=tournament,
        site=site,
        home_team=home,
        away_team=away,
        played_on=date(2026, 6, 15),
        starts_at=time(20, 0),
    )
    session = AttendanceSession.objects.create(
        site=site,
        session_type="tournament_match",
        date=match.played_on,
        starts_at=match.starts_at,
        tournament=tournament,
        match=match,
        team=home,
        captured_by=admin,
    )

    with patch("core.domain_serializers.attendance.timezone.now", return_value=local_moment(2026, 6, 15, 20, 30)):
        ok_response = client.post("/api/player-attendance-records/", {"session": session.id, "player": home_player.id, "status": "present"}, format="json")
        bad_response = client.post("/api/player-attendance-records/", {"session": session.id, "player": away_player.id, "status": "present"}, format="json")

    assert ok_response.status_code == 201
    assert bad_response.status_code == 400
    assert PlayerAttendanceRecord.objects.filter(session=session, player=home_player, status="present").exists()


def test_automatic_attendance_comparison_roster_uses_deduped_adult_database(monkeypatch):
    site = make_site(code="qa-auto-roster-site")
    admin = make_user(role="admin", username="qa-auto-roster-admin", primary_site=site)
    students = [make_student(site=site, full_name=f"Rostro Student {index}") for index in range(3)]
    tournament = make_tournament(site=site, name="Copa Rostro QA", starts_on=date(2026, 6, 15))
    home = make_team(tournament=tournament, name="Rostro Local")
    away = make_team(tournament=tournament, name="Rostro Visita")
    third = make_team(tournament=tournament, name="Rostro Tercero")
    StudentTournamentRegistration.objects.create(tournament=tournament, student=students[0], team=home, registered_by=admin)
    StudentTournamentRegistration.objects.create(tournament=tournament, student=students[1], team=away, registered_by=admin)
    StudentTournamentRegistration.objects.create(tournament=tournament, student=students[2], team=third, registered_by=admin)
    home_player = make_player(team=home, full_name="Adulto Local Rostro", phone="5511110101", photo_url="supabase://adult-private-photos/qa/home.jpg")
    away_player = make_player(team=away, full_name="Adulto Visita Rostro", phone="5522220102", photo_url="supabase://adult-private-photos/qa/away.jpg")
    third_player = make_player(team=third, full_name="Adulto Tercero Rostro", phone="5533330103", photo_url="supabase://adult-private-photos/qa/third.jpg")
    third_duplicate = make_player(team=away, full_name="Adulto Tercero Rostro", phone="5533330103", photo_url=third_player.photo_url)
    match = make_match(
        tournament=tournament,
        site=site,
        home_team=home,
        away_team=away,
        played_on=date(2026, 6, 15),
        starts_at=time(19, 0),
    )
    session = AttendanceSession.objects.create(
        site=site,
        session_type="tournament_match",
        date=match.played_on,
        starts_at=match.starts_at,
        tournament=tournament,
        match=match,
        team=home,
        captured_by=admin,
    )

    comparison_keys = {person_key(person) for person in comparison_roster_for_session(session)}

    assert person_key(students[0]) in comparison_keys
    assert person_key(home_player) in comparison_keys
    assert person_key(away_player) in comparison_keys
    assert person_key(third_player) in comparison_keys
    assert person_key(students[2]) not in comparison_keys
    assert person_key(third_duplicate) not in comparison_keys

    tournament_keys = {person_key(person) for person in tournament_reference_roster_for_session(session)}
    assert person_key(students[2]) in tournament_keys
    assert person_key(third_player) in tournament_keys

    monkeypatch.setenv("AUTO_ATTENDANCE_INCLUDE_OFF_ROSTER_KNOWN", "0")
    roster_only_keys = {person_key(person) for person in comparison_roster_for_session(session)}
    assert roster_only_keys == {person_key(students[0])}


def test_factory_students_can_have_guardian_user():
    guardian_user = make_user(role="guardian")
    guardian = make_guardian(user=guardian_user)
    student = make_student(guardian=guardian)

    assert student.guardian.user == guardian_user
