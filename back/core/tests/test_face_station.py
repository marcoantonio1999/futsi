from uuid import uuid4

import pytest
from django.contrib.auth.hashers import make_password
from django.utils import timezone

from core.face_station_auth import build_station_token
from core.models import (
    AttendanceRecord,
    FaceRecognitionAttempt,
    FaceStationDevice,
    FaceStationEvent,
    FaceStationUnknownLink,
    PlayerAttendanceRecord,
)

from .factories import make_attendance_session, make_player, make_site, make_student, make_user


pytestmark = [pytest.mark.api, pytest.mark.django_db]


@pytest.fixture
def station_context():
    site = make_site(code="qa-face-station")
    service_user = make_user(role="site_coordinator", primary_site=site)
    secret = "qa-station-secret"
    device = FaceStationDevice.objects.create(
        name="Cancha QA",
        site=site,
        service_user=service_user,
        camera_id="qa_camera",
        secret_hash=make_password(secret),
    )
    return {
        "site": site,
        "user": service_user,
        "device": device,
        "token": build_station_token(device.public_id, secret),
    }


def station_headers(context):
    return {"HTTP_X_FUTSI_STATION_KEY": context["token"]}


def event_payload(person_type, person_id, session_id=None, event_id=None):
    return {
        "event_id": str(event_id or uuid4()),
        "person_type": person_type,
        "person_id": person_id,
        "occurred_at": timezone.now().isoformat(),
        "session_id": session_id,
        "detection_count": 7,
        "similarity": 0.78,
        "metadata": {"test": True},
    }


def test_station_token_is_required(api_client, station_context):
    missing = api_client.get("/api/face-station/bootstrap/")
    invalid = api_client.get(
        "/api/face-station/bootstrap/",
        HTTP_X_FUTSI_STATION_KEY=f"futsi_station:{station_context['device'].public_id}:incorrecto",
    )

    assert missing.status_code in {401, 403}
    assert invalid.status_code in {401, 403}


def test_bootstrap_is_scoped_to_station_site(api_client, station_context):
    own_student = make_student(site=station_context["site"], full_name="Alumno de la sede")
    other_student = make_student(site=make_site(), full_name="Alumno externo")
    adult_player = make_player()
    adult_player.team.tournament.site = station_context["site"]
    adult_player.team.tournament.save(update_fields=["site"])
    session = make_attendance_session(site=station_context["site"], group_name=own_student.group_name)

    response = api_client.get("/api/face-station/bootstrap/", **station_headers(station_context))

    assert response.status_code == 200
    payload = response.json()
    assert payload["device"]["site_id"] == station_context["site"].id
    assert {row["id"] for row in payload["people"] if row["type"] == "student"} == {own_student.id}
    assert other_student.id not in {row["id"] for row in payload["people"]}
    assert payload["sessions"][0]["id"] == session.id
    assert f"student:{own_student.id}" in payload["sessions"][0]["roster"]
    assert f"player:{adult_player.id}" not in payload["sessions"][0]["roster"]


def test_known_student_event_marks_attendance_once(api_client, station_context):
    student = make_student(site=station_context["site"], group_name="Sub-10 QA")
    session = make_attendance_session(site=station_context["site"], group_name="Sub-10 QA")
    event = event_payload("student", student.id, session.id)

    first = api_client.post(
        "/api/face-station/events/batch/",
        {"events": [event]},
        format="json",
        **station_headers(station_context),
    )
    second = api_client.post(
        "/api/face-station/events/batch/",
        {"events": [event]},
        format="json",
        **station_headers(station_context),
    )

    assert first.status_code == 200
    assert first.json()["results"][0]["status"] == "synced"
    assert second.json()["results"][0]["duplicate"] is True
    assert AttendanceRecord.objects.filter(session=session, student=student, status="present").count() == 1
    assert FaceRecognitionAttempt.objects.filter(session=session, student=student, engine="insightface-station").count() == 1
    assert FaceStationEvent.objects.filter(event_id=event["event_id"]).count() == 1


def test_detection_without_valid_session_does_not_fake_attendance(api_client, station_context):
    student = make_student(site=station_context["site"])
    event = event_payload("student", student.id)

    response = api_client.post(
        "/api/face-station/events/batch/",
        {"events": [event]},
        format="json",
        **station_headers(station_context),
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "no_session"
    assert AttendanceRecord.objects.filter(student=student).count() == 0


def test_station_rejects_person_from_another_site(api_client, station_context):
    outsider = make_student(site=make_site())
    response = api_client.post(
        "/api/face-station/events/batch/",
        {"events": [event_payload("student", outsider.id)]},
        format="json",
        **station_headers(station_context),
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "rejected"
    assert FaceStationEvent.objects.count() == 0


def test_adult_player_event_uses_player_attendance(api_client, station_context):
    player = make_player()
    player.team.tournament.site = station_context["site"]
    player.team.tournament.save(update_fields=["site"])
    session = make_attendance_session(
        site=station_context["site"],
        session_type="league_match",
        team=player.team,
        tournament=player.team.tournament,
        group_name="",
    )
    response = api_client.post(
        "/api/face-station/events/batch/",
        {"events": [event_payload("player", player.id, session.id)]},
        format="json",
        **station_headers(station_context),
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "synced"
    assert PlayerAttendanceRecord.objects.filter(session=session, player=player, status="present").count() == 1


def test_link_unknown_is_idempotent_and_syncs_its_occurrence(api_client, station_context):
    student = make_student(site=station_context["site"], group_name="Sub-12 QA")
    session = make_attendance_session(site=station_context["site"], group_name="Sub-12 QA")
    local_subject_id = str(uuid4())
    payload = {
        "local_subject_id": local_subject_id,
        "person_type": "student",
        "person_id": student.id,
        "events": [event_payload("student", student.id, session.id)],
    }

    first = api_client.post(
        "/api/face-station/unknowns/register/",
        payload,
        format="json",
        **station_headers(station_context),
    )
    second = api_client.post(
        "/api/face-station/unknowns/register/",
        payload,
        format="json",
        **station_headers(station_context),
    )

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert FaceStationUnknownLink.objects.filter(device=station_context["device"], local_subject_id=local_subject_id).count() == 1
    assert AttendanceRecord.objects.filter(session=session, student=student, status="present").count() == 1
