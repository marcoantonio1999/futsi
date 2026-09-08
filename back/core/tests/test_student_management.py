import pytest

from core.models import AuditLog, Guardian, Student
from core.tests.factories import make_charge, make_guardian, make_site, make_student

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def confirm_delete(client, student):
    preview = client.get(f"/api/students/{student.pk}/deletion-preview/")
    assert preview.status_code == 200, preview.content
    return client.delete(f"/api/students/{student.pk}/", {"confirmation_token": preview.json()["confirmation_token"], "confirmation_name": student.full_name}, format="json")


def test_edit_updates_identity_academy_and_guardian_without_losing_photo(auth_client):
    student = make_student(photo_url="supabase://student-private-photos/existing.jpg")
    guardian, site = make_guardian(), make_site()
    client, _, _ = auth_client()
    response = client.patch(f"/api/students/{student.pk}/", {
        "full_name": "Nombre corregido", "guardian": guardian.pk, "site": site.pk,
        "birth_date": "2015-03-12", "category": "Sub-12", "group_name": "Grupo B", "status": "paused",
        "pause_start": "2026-09-01", "pause_end": "2026-10-01", "pause_reason": "Viaje familiar",
        "emergency_contact": "Tutor de emergencia", "emergency_phone": "5512345678", "medical_notes": "Alergia",
    }, format="multipart")
    assert response.status_code == 200, response.content
    student.refresh_from_db()
    assert (student.full_name, student.guardian_id, student.site_id) == ("Nombre corregido", guardian.pk, site.pk)
    assert (student.category, student.group_name, student.status) == ("Sub-12", "Grupo B", "paused")
    assert str(student.birth_date) == "2015-03-12"
    assert student.photo_url.endswith("/existing.jpg")
    assert student.medical_notes == "Alergia"


def test_invalid_edit_keeps_previous_values(auth_client):
    student = make_student()
    original_name = student.full_name
    client, _, _ = auth_client()
    response = client.patch(f"/api/students/{student.pk}/", {"full_name": "No guardar", "pause_start": "2026-10-01", "pause_end": "2026-09-01"}, format="multipart")
    assert response.status_code == 400
    student.refresh_from_db()
    assert student.full_name == original_name
    assert student.pause_start is None


def test_delete_removes_only_student_and_is_audited(auth_client):
    student = make_student()
    sibling = make_student(site=student.site, guardian=student.guardian)
    client, _, user = auth_client()
    student_id, guardian_id = student.pk, student.guardian_id
    response = confirm_delete(client, student)
    assert response.status_code == 200, response.content
    assert not Student.objects.filter(pk=student_id).exists()
    assert Student.objects.filter(pk=sibling.pk, guardian_id=guardian_id).exists()
    assert Guardian.objects.filter(pk=guardian_id).exists()
    audit = AuditLog.objects.get(action="student_deleted", record_id=str(student_id))
    assert audit.actor == user
    assert audit.previous_values == {}
    assert audit.metadata["counts"]["students"] == 1


def test_confirmed_delete_removes_financial_history(auth_client):
    student = make_student()
    charge = make_charge(student=student, site=student.site)
    client, _, _ = auth_client()
    response = confirm_delete(client, student)
    assert response.status_code == 200, response.content
    assert not Student.objects.filter(pk=student.pk).exists()
    assert not type(charge).objects.filter(pk=charge.pk).exists()
    assert AuditLog.objects.filter(action="student_deleted", record_id=str(student.pk)).exists()


@pytest.mark.parametrize("role", ["cashier", "site_coordinator"])
def test_delete_obeys_site_scope(auth_client, role):
    own_site = make_site()
    own_student = make_student(site=own_site)
    other_student = make_student()
    client, _, _ = auth_client(role=role, primary_site=own_site)
    assert client.delete(f"/api/students/{other_student.pk}/").status_code == 404
    assert Student.objects.filter(pk=other_student.pk).exists()
    assert confirm_delete(client, own_student).status_code == 200


@pytest.mark.parametrize("role", ["guardian", "coach", "adult_player", "adult_representative"])
def test_unauthorized_roles_cannot_delete_students(auth_client, role):
    student = make_student()
    client, _, _ = auth_client(role=role, primary_site=student.site)
    assert client.delete(f"/api/students/{student.pk}/").status_code == 403
    assert Student.objects.filter(pk=student.pk).exists()
