import base64
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
    Guardian,
    PlayerAttendanceRecord,
    Student,
    User,
    UserRole,
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
    student_with_photo = make_student(
        site=station_context["site"],
        full_name="Alumno con foto",
        photo_url="supabase://student-private-photos/students/qa/photo.jpg",
    )
    other_student = make_student(site=make_site(), full_name="Alumno externo")
    adult_player = make_player()
    adult_player.team.tournament.site = station_context["site"]
    adult_player.team.tournament.save(update_fields=["site"])
    collaborator = make_user(
        role="coach",
        primary_site=station_context["site"],
        first_name="Coach",
        last_name="FaceGuard",
        avatar_url="supabase://adult-private-photos/collaborators/coach.jpg",
    )
    external_collaborator = make_user(
        role="cashier",
        primary_site=make_site(),
        first_name="Cajero",
        last_name="Externo",
    )
    make_user(
        role="guardian",
        primary_site=station_context["site"],
        first_name="Tutor",
        last_name="No colaborador",
    )
    session = make_attendance_session(site=station_context["site"], group_name=own_student.group_name)

    response = api_client.get("/api/face-station/bootstrap/", **station_headers(station_context))

    assert response.status_code == 200
    payload = response.json()
    assert payload["device"]["site_id"] == station_context["site"].id
    assert {row["id"] for row in payload["people"] if row["type"] == "student"} == {
        own_student.id,
        student_with_photo.id,
    }
    assert other_student.id not in {row["id"] for row in payload["people"]}
    people = {row["key"]: row for row in payload["people"]}
    assert people[f"student:{own_student.id}"]["reference_available"] is False
    assert people[f"student:{own_student.id}"]["photo_url"] == ""
    assert people[f"student:{student_with_photo.id}"]["reference_available"] is True
    assert people[f"student:{student_with_photo.id}"]["photo_url"].endswith(
        f"/api/face-station/people/student/{student_with_photo.id}/photo/"
    )
    assert people[f"collaborator:{collaborator.id}"]["name"] == "Coach FaceGuard"
    assert people[f"collaborator:{collaborator.id}"]["group_name"] == "Coach"
    assert people[f"collaborator:{collaborator.id}"]["reference_available"] is True
    assert f"collaborator:{external_collaborator.id}" not in people
    assert f"collaborator:{station_context['user'].id}" not in people
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


def test_collaborator_event_is_synced_without_academy_session(api_client, station_context):
    collaborator = make_user(
        role="coach",
        primary_site=station_context["site"],
        first_name="Coach",
        last_name="Presente",
    )
    event = event_payload("collaborator", collaborator.id)

    response = api_client.post(
        "/api/face-station/events/batch/",
        {"events": [event]},
        format="json",
        **station_headers(station_context),
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "synced"
    saved = FaceStationEvent.objects.get(event_id=event["event_id"])
    assert saved.collaborator == collaborator
    assert saved.session is None


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


def test_station_quick_creates_student_with_selected_crop_and_is_idempotent(
    api_client,
    station_context,
    monkeypatch,
):
    session = make_attendance_session(site=station_context["site"], group_name="")
    local_subject_id = str(uuid4())
    upload_calls = []

    def fake_upload(bucket, object_path, local_path, upsert=True):
        upload_calls.append((bucket, object_path, local_path.read_bytes(), upsert))
        return f"supabase://{bucket}/{object_path}"

    monkeypatch.setattr(
        "core.api.face_station_unknowns.upload_private_file",
        fake_upload,
    )
    payload = {
        "local_subject_id": local_subject_id,
        "full_name": "  Alumna   Nueva FaceGuard  ",
        "best_crop": (
            "data:image/jpeg;base64,"
            + base64.b64encode(b"selected-face-crop").decode("ascii")
        ),
        "events": [event_payload("student", 0, session.id)],
    }

    first = api_client.post(
        "/api/face-station/students/quick-create/",
        payload,
        format="json",
        **station_headers(station_context),
    )
    second = api_client.post(
        "/api/face-station/students/quick-create/",
        payload,
        format="json",
        **station_headers(station_context),
    )

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    student = Student.objects.get(full_name="Alumna Nueva FaceGuard")
    assert student.site == station_context["site"]
    assert student.status == "trial"
    assert student.group_name == ""
    assert student.category == ""
    assert student.photo_url.startswith("supabase://student-private-photos/")
    assert student.guardian.phone == "PENDIENTE"
    assert Guardian.objects.filter(pk=student.guardian_id).count() == 1
    assert Student.objects.filter(full_name="Alumna Nueva FaceGuard").count() == 1
    assert len(upload_calls) == 1
    assert upload_calls[0][0] == "student-private-photos"
    assert upload_calls[0][2] == b"selected-face-crop"
    assert FaceStationUnknownLink.objects.filter(
        device=station_context["device"],
        local_subject_id=local_subject_id,
        student=student,
    ).count() == 1
    assert AttendanceRecord.objects.filter(
        session=session,
        student=student,
        status="present",
    ).count() == 1


def test_station_quick_creates_collaborator_with_selected_crop_and_is_idempotent(
    api_client,
    station_context,
    monkeypatch,
):
    local_subject_id = str(uuid4())
    upload_calls = []

    def fake_upload(bucket, object_path, local_path, upsert=True):
        upload_calls.append((bucket, object_path, local_path.read_bytes(), upsert))
        return f"supabase://{bucket}/{object_path}"

    monkeypatch.setattr(
        "core.api.face_station_unknowns.upload_private_file",
        fake_upload,
    )
    payload = {
        "local_subject_id": local_subject_id,
        "full_name": "  Colaboradora   Nueva FaceGuard  ",
        "best_crop": (
            "data:image/jpeg;base64,"
            + base64.b64encode(b"collaborator-face-crop").decode("ascii")
        ),
        "events": [event_payload("collaborator", 0)],
    }

    first = api_client.post(
        "/api/face-station/collaborators/quick-create/",
        payload,
        format="json",
        **station_headers(station_context),
    )
    second = api_client.post(
        "/api/face-station/collaborators/quick-create/",
        payload,
        format="json",
        **station_headers(station_context),
    )

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    collaborator = User.objects.get(
        first_name="Colaboradora",
        last_name="Nueva FaceGuard",
        role=UserRole.COLLABORATOR,
    )
    assert collaborator.primary_site == station_context["site"]
    assert collaborator.has_usable_password() is False
    assert collaborator.avatar_url.startswith("supabase://adult-private-photos/")
    assert len(upload_calls) == 1
    assert upload_calls[0][0] == "adult-private-photos"
    assert upload_calls[0][2] == b"collaborator-face-crop"
    assert FaceStationUnknownLink.objects.filter(
        device=station_context["device"],
        local_subject_id=local_subject_id,
        collaborator=collaborator,
    ).count() == 1
    saved = FaceStationEvent.objects.get(collaborator=collaborator)
    assert saved.status == "synced"
    assert saved.session is None
