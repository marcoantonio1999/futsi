from datetime import date, datetime, time
from unittest.mock import patch

import pytest
from django.utils import timezone

from core.models import (
    AttendanceRecord,
    AttendanceSession,
    Match,
    Player,
    PlayerAttendanceRecord,
    Site,
    Student,
    StudentTournamentRegistration,
    Team,
    Tournament,
    User,
)


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def local_moment(year, month, day, hour, minute):
    return timezone.make_aware(datetime(year, month, day, hour, minute))


def create_academy_session(student, starts_at=time(17, 0)):
    admin = User.objects.get(username="admin")
    return AttendanceSession.objects.create(
        site=student.site,
        session_type="academy_class",
        date=date(2026, 6, 15),
        starts_at=starts_at,
        group_name=student.group_name,
        captured_by=admin,
    )


def test_attendance_can_be_marked_only_inside_operational_window(login_client):
    client, _user = login_client("coach.roma", "demo12345")
    student = Student.objects.filter(site__code="roma", group_name="Equipo Sub-12 A").first()
    session = create_academy_session(student, starts_at=time(17, 0))

    with patch("core.domain_serializers.attendance.timezone.now", return_value=local_moment(2026, 6, 15, 17, 15)):
        response = client.post(
            "/api/attendance-records/",
            {"session": session.id, "student": student.id, "status": "present"},
            format="json",
        )

    assert response.status_code == 201
    assert AttendanceRecord.objects.filter(session=session, student=student, status="present").exists()


def test_attendance_is_rejected_before_or_after_window(login_client):
    client, _user = login_client("coach.roma", "demo12345")
    student = Student.objects.filter(site__code="roma", group_name="Equipo Sub-12 A").first()
    session = create_academy_session(student, starts_at=time(17, 0))

    with patch("core.domain_serializers.attendance.timezone.now", return_value=local_moment(2026, 6, 15, 14, 30)):
        response = client.post(
            "/api/attendance-records/",
            {"session": session.id, "student": student.id, "status": "present"},
            format="json",
        )

    assert response.status_code == 400
    assert "ventana operativa" in str(response.content)


def test_tournament_attendance_roster_uses_registered_students_only(login_client):
    client, _user = login_client("admin", "admin12345")
    site = Site.objects.get(code="roma")
    admin = User.objects.get(username="admin")
    registered = Student.objects.filter(site=site).first()
    outsider = Student.objects.filter(site=site).exclude(id=registered.id).first()
    tournament = Tournament.objects.create(site=site, name="Copa QA Sub-12", billing_type="weekly_match", starts_on=date(2026, 6, 15), expected_weeks=12)
    home = Team.objects.create(tournament=tournament, name="QA Local", representative_name="Rep Local", representative_phone="5500000001")
    away = Team.objects.create(tournament=tournament, name="QA Visita", representative_name="Rep Visita", representative_phone="5500000002")
    StudentTournamentRegistration.objects.create(tournament=tournament, student=registered, team=home, registered_by=admin)
    match = Match.objects.create(tournament=tournament, site=site, home_team=home, away_team=away, played_on=date(2026, 6, 15), starts_at=time(17, 0))
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


def test_adult_player_attendance_uses_match_team_and_window(login_client):
    client, _user = login_client("admin", "admin12345")
    site = Site.objects.get(code="roma")
    admin = User.objects.get(username="admin")
    tournament = Tournament.objects.create(site=site, name="Liga QA Adultos", billing_type="weekly_match", starts_on=date(2026, 6, 15), expected_weeks=12)
    home = Team.objects.create(tournament=tournament, name="Adultos QA Local", representative_name="Rep Local", representative_phone="5500000003")
    away = Team.objects.create(tournament=tournament, name="Adultos QA Visita", representative_name="Rep Visita", representative_phone="5500000004")
    home_player = Player.objects.create(team=home, full_name="Jugador Local QA", phone="5510101010", email="localqa@example.com", jersey_number=7)
    away_player = Player.objects.create(team=away, full_name="Jugador Visita QA", phone="5520202020", email="visitaqa@example.com", jersey_number=8)
    match = Match.objects.create(tournament=tournament, site=site, home_team=home, away_team=away, played_on=date(2026, 6, 15), starts_at=time(20, 0))
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


def test_seed_students_always_have_guardian_user(seeded_db):
    missing = Student.objects.filter(guardian__user__isnull=True).values_list("full_name", "guardian__full_name")
    assert list(missing) == []
