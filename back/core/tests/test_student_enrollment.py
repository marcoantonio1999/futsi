from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from core.models import Guardian, Student
from core.tests.factories import make_guardian, make_site, make_student, make_user

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def portrait():
    buffer = BytesIO()
    Image.new("RGB", (100, 120), "green").save(buffer, format="PNG")
    return SimpleUploadedFile("portrait.png", buffer.getvalue(), content_type="image/png")


def test_inline_guardian_can_be_assigned_to_siblings(auth_client):
    site = make_site()
    client, _, _ = auth_client(role="cashier", primary_site=site)
    response = client.post("/api/guardians/", {"full_name": "Papá de hermanos", "phone": "5512345678"}, format="json")
    assert response.status_code == 201, response.content
    guardian_id = response.json()["id"]
    assert guardian_id in [row["id"] for row in client.get("/api/guardians/").json()]
    other_site_client, _, _ = auth_client(role="cashier", primary_site=make_site())
    assert guardian_id not in [row["id"] for row in other_site_client.get("/api/guardians/").json()]
    for name in ["Hermana uno", "Hermano dos"]:
        response = client.post("/api/students/", {"full_name": name, "site": site.pk, "guardian": guardian_id}, format="json")
        assert response.status_code == 201, response.content
    guardian = Guardian.objects.get(pk=guardian_id)
    assert guardian.students.count() == 2
    assert guardian.user_id is None


def test_student_requires_guardian_before_any_upload(auth_client):
    client, _, _ = auth_client()
    with patch("core.services.student_photos.upload_private_file") as upload:
        response = client.post("/api/students/", {"full_name": "Alumno", "site": make_site().pk, "photo": portrait()}, format="multipart")
    assert response.status_code == 400
    assert "guardian" in response.json()
    upload.assert_not_called()
    assert Student.objects.count() == 0


def test_photo_upload_is_private_and_stored_with_student(auth_client):
    client, _, _ = auth_client()
    guardian, site = make_guardian(), make_site()
    def upload(bucket, object_path, local_path, upsert):
        assert bucket == "student-private-photos"
        assert upsert is False
        with Image.open(local_path) as image:
            assert image.format == "JPEG"
        assert Student.objects.count() == 0
        return f"supabase://{bucket}/{object_path}"
    with patch("core.services.student_photos.upload_private_file", side_effect=upload):
        response = client.post("/api/students/", {"full_name": "Alumno con foto", "guardian": guardian.pk, "site": site.pk, "photo": portrait(), "birth_date": "", "pause_start": "", "pause_end": ""}, format="multipart")
    assert response.status_code == 201, response.content
    student = Student.objects.get(pk=response.json()["id"])
    assert student.photo_url.startswith("supabase://student-private-photos/academy/")
    assert not student.photo
    assert student.birth_date is None


def test_storage_failure_does_not_create_student_or_expose_provider_detail(auth_client):
    client, _, _ = auth_client()
    with patch("core.services.student_photos.upload_private_file", side_effect=RuntimeError("SECRET provider response")):
        response = client.post("/api/students/", {"full_name": "Alumno", "guardian": make_guardian().pk, "site": make_site().pk, "photo": portrait()}, format="multipart")
    assert response.status_code == 503
    assert "SECRET" not in response.content.decode()
    assert Student.objects.count() == 0


def test_failed_photo_replacement_keeps_existing_student_data(auth_client):
    student = make_student(photo_url="supabase://student-private-photos/old.jpg")
    client, _, _ = auth_client()
    with patch("core.services.student_photos.upload_private_file", side_effect=RuntimeError("Unavailable")):
        response = client.patch(f"/api/students/{student.pk}/", {"medical_notes": "Changed", "photo": portrait()}, format="multipart")
    assert response.status_code == 503
    student.refresh_from_db()
    assert student.photo_url.endswith("/old.jpg")
    assert student.medical_notes == ""


def test_photo_replacement_and_edit_without_photo(auth_client):
    student = make_student(photo_url="supabase://student-private-photos/old.jpg", photo="students/photos/old.jpg")
    client, _, _ = auth_client()
    with patch("core.services.student_photos.upload_private_file", return_value="supabase://student-private-photos/new.jpg"):
        response = client.patch(f"/api/students/{student.pk}/", {"photo": portrait()}, format="multipart")
    assert response.status_code == 200, response.content
    student.refresh_from_db()
    assert not student.photo
    response = client.patch(f"/api/students/{student.pk}/", {"medical_notes": "Alergia", "pause_start": "", "pause_end": ""}, format="multipart")
    assert response.status_code == 200, response.content
    student.refresh_from_db()
    assert student.photo_url.endswith("/new.jpg")
    assert student.medical_notes == "Alergia"


def test_database_failure_cleans_up_uploaded_file(auth_client):
    client, _, _ = auth_client()
    guardian, site = make_guardian(), make_site()
    with patch("core.services.student_photos.upload_private_file", return_value="supabase://student-private-photos/new.jpg"), patch("core.models.Student.save", side_effect=IntegrityError("failed")), patch("core.services.student_photos.delete_private_file") as delete:
        with pytest.raises(IntegrityError):
            client.post("/api/students/", {"full_name": "Alumno", "guardian": guardian.pk, "site": site.pk, "photo": portrait()}, format="multipart")
    delete.assert_called_once()
    assert delete.call_args.args[0] == "student-private-photos"


@pytest.mark.parametrize("file", [SimpleUploadedFile("fake.jpg", b"not an image", content_type="image/jpeg"), SimpleUploadedFile("large.jpg", b"x" * (5 * 1024 * 1024 + 1), content_type="image/jpeg")])
def test_invalid_images_rejected_before_upload(auth_client, file):
    client, _, _ = auth_client()
    with patch("core.services.student_photos.upload_private_file") as upload:
        response = client.post("/api/students/", {"full_name": "Alumno", "site": make_site().pk, "guardian": make_guardian().pk, "photo": file}, format="multipart")
    assert response.status_code == 400
    upload.assert_not_called()


@pytest.mark.parametrize("role", ["cashier", "site_coordinator"])
def test_student_create_and_photo_read_respect_site_scope(auth_client, role):
    student = make_student(photo_url="supabase://student-private-photos/portrait.jpg")
    client, _, _ = auth_client(role=role, primary_site=make_site())
    with patch("core.services.student_photos.upload_private_file") as upload, patch("core.api.catalog.download_private_file") as download:
        response = client.post("/api/students/", {"full_name": "Alumno", "site": student.site_id, "guardian": student.guardian_id, "photo": portrait()}, format="multipart")
        assert response.status_code == 403
        response = client.get(f"/api/students/{student.pk}/photo-content/")
        assert response.status_code == 404
    upload.assert_not_called()
    download.assert_not_called()


def test_private_photo_requires_authorized_guardian_and_cleans_tempfile(auth_client, tmp_path):
    parent = make_user(role="guardian")
    student = make_student(guardian=make_guardian(user=parent), photo_url="supabase://student-private-photos/portrait.jpg")
    photo_path = tmp_path / "portrait.jpg"
    photo_path.write_bytes(b"jpeg-payload")
    client, _, _ = auth_client(user=parent)
    with patch("core.api.catalog.download_private_file", return_value=str(photo_path)) as download:
        response = client.get(f"/api/students/{student.pk}/photo-content/")
        assert response.status_code == 200
        assert response.content == b"jpeg-payload"
        assert response["Cache-Control"] == "private, no-store"
        download.assert_called_once_with("student-private-photos", "portrait.jpg")
    assert not photo_path.exists()
    other_client, _, _ = auth_client(role="guardian")
    assert other_client.get(f"/api/students/{student.pk}/photo-content/").status_code == 404


@pytest.mark.parametrize("role", ["adult_representative", "adult_player"])
def test_adult_roles_cannot_access_academy_students(auth_client, role):
    student = make_student()
    client, _, _ = auth_client(role=role)
    assert client.get(f"/api/students/{student.pk}/photo-content/").status_code == 403
    assert client.post("/api/students/", {"full_name": "Alumno", "site": student.site_id, "guardian": student.guardian_id}, format="json").status_code == 403
