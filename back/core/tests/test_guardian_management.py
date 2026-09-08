from unittest.mock import patch

import pytest
from django.db import IntegrityError
from core.models import Guardian, Student, Charge, Payment, Invoice, AuditLog, User
from core.tests.factories import make_guardian, make_student, make_site, make_user, make_charge, make_payment, make_invoice

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def confirmation(client, guardian):
    response = client.get(f"/api/guardians/{guardian.pk}/deletion-preview/")
    assert response.status_code == 200, response.content
    return {"confirmation_token": response.json()["confirmation_token"], "confirmation_name": guardian.full_name}


def remove(client, guardian, payload=None):
    return client.delete(f"/api/guardians/{guardian.pk}/", payload or confirmation(client, guardian), format="json")


def test_create_and_edit_contact_billing_notes_preserve_login_clabe_and_children(auth_client):
    client, _, _ = auth_client()
    payload = {"full_name": "Papá QA", "phone": "5512345678", "email": "qa@example.com", "tax_name": "Razón QA", "tax_id": "RFCQA", "notes": "Responsable de dos alumnos"}
    response = client.post("/api/guardians/", payload, format="json")
    assert response.status_code == 201, response.content
    guardian = Guardian.objects.get(pk=response.json()["id"])
    user = make_user(role="guardian")
    guardian.user = user
    guardian.save()
    clabe = guardian.virtual_clabe
    children = [make_student(guardian=guardian), make_student(guardian=guardian)]
    payload.update(full_name="Tutor actualizado", phone="5598765432", email="nuevo@example.com", tax_name="Otra razón", tax_id="NUEVORFC", notes="Notas actualizadas")
    response = client.patch(f"/api/guardians/{guardian.pk}/", payload, format="json")
    assert response.status_code == 200, response.content
    guardian.refresh_from_db()
    for key, value in payload.items():
        assert getattr(guardian, key) == value
    assert guardian.user_id == user.pk
    assert guardian.virtual_clabe == clabe
    assert set(guardian.students.values_list("pk", flat=True)) == {row.pk for row in children}


def test_invalid_edit_does_not_change_contact(auth_client):
    guardian = make_guardian()
    client, _, _ = auth_client()
    response = client.patch(f"/api/guardians/{guardian.pk}/", {"full_name": "", "email": "invalid"}, format="json")
    assert response.status_code == 400
    assert Guardian.objects.get(pk=guardian.pk).full_name == guardian.full_name


def test_delete_family_removes_both_students_finances_and_direct_invoice_only(auth_client):
    user = make_user(role="guardian")
    guardian = make_guardian(user=user)
    first = make_student(guardian=guardian)
    second = make_student(guardian=guardian, site=first.site)
    outsider = make_student()
    charge = make_charge(student=first)
    payment = make_payment(charge=charge)
    invoice = make_invoice(guardian=guardian, site=first.site, student=None, payment=None)
    other_charge = make_charge(student=outsider)
    client, _, _ = auth_client()
    preview = client.get(f"/api/guardians/{guardian.pk}/deletion-preview/").json()
    assert {row["id"] for row in preview["students"]} == {first.pk, second.pk}
    assert {item["label"]: item["count"] for item in preview["items"]}["Alumnos a su cargo"] == 2
    assert Guardian.objects.filter(pk=guardian.pk).exists()
    response = remove(client, guardian)
    assert response.status_code == 200, response.content
    for row in [guardian, first, second, charge, payment, invoice]:
        assert not type(row).objects.filter(pk=row.pk).exists()
    for row in [user, outsider, other_charge, first.site]:
        assert type(row).objects.filter(pk=row.pk).exists()


def test_delete_unassigned_guardian_requires_review_and_correct_name(auth_client):
    guardian = make_guardian()
    client, _, _ = auth_client()
    assert client.delete(f"/api/guardians/{guardian.pk}/").status_code == 400
    payload = confirmation(client, guardian)
    payload["confirmation_name"] = "Otro tutor"
    assert remove(client, guardian, payload).status_code == 400
    assert Guardian.objects.filter(pk=guardian.pk).exists()
    assert remove(client, guardian).status_code == 200


@pytest.mark.parametrize("change", ["new_child", "new_payment", "updated_contact"])
def test_changed_family_requires_new_review(auth_client, change):
    guardian = make_guardian()
    student = make_student(guardian=guardian)
    client, _, _ = auth_client()
    payload = confirmation(client, guardian)
    if change == "new_child":
        make_student(guardian=guardian)
    elif change == "new_payment":
        make_payment(charge=make_charge(student=student))
    else:
        Guardian.objects.filter(pk=guardian.pk).update(phone="changed")
    assert remove(client, guardian, payload).status_code == 409
    assert guardian.students.count() >= 1


def test_token_bound_to_guardian_and_actor(auth_client):
    guardian, other = make_guardian(), make_guardian()
    client, _, _ = auth_client()
    payload = confirmation(client, guardian)
    other_client, _, _ = auth_client()
    assert remove(other_client, guardian, payload).status_code == 400
    payload["confirmation_name"] = other.full_name
    assert remove(client, other, payload).status_code == 400


@pytest.mark.parametrize("role", ["cashier", "site_coordinator"])
def test_scoped_users_cannot_delete_shared_tutor_or_edit_other_site(auth_client, role):
    guardian = make_guardian()
    first = make_student(guardian=guardian)
    second = make_student(guardian=guardian)
    client, _, _ = auth_client(role=role, primary_site=first.site)
    assert client.get(f"/api/guardians/{guardian.pk}/deletion-preview/").status_code == 403
    other_guardian = make_guardian()
    make_student(guardian=other_guardian, site=second.site)
    assert client.patch(f"/api/guardians/{other_guardian.pk}/", {"full_name": "changed"}, format="json").status_code == 404
    admin, _, _ = auth_client()
    payload = confirmation(admin, guardian)
    assert remove(client, guardian, payload).status_code == 400
    assert guardian.students.count() == 2


def test_scoped_user_can_delete_own_created_tutor_and_retry_files(auth_client):
    site = make_site()
    client, _, user = auth_client(role="cashier", primary_site=site)
    response = client.post("/api/guardians/", {"full_name": "Tutor QA", "phone": "5512345678"}, format="json")
    guardian = Guardian.objects.get(pk=response.json()["id"])
    student = make_student(guardian=guardian, site=site, photo_url="supabase://student-private-photos/guardian-test.jpg")
    with patch("core.services.student_deletion.delete_private_file", side_effect=RuntimeError("provider unavailable")):
        response = remove(client, guardian)
    assert response.status_code == 200, response.content
    result = response.json()
    assert result["cleanup_pending"] == 1
    assert not Student.objects.filter(pk=student.pk).exists()
    other_client, _, _ = auth_client(role="cashier", primary_site=make_site())
    assert other_client.post("/api/guardians/deletion-cleanup/", {"deletion_id": result["deletion_id"]}, format="json").status_code == 404
    with patch("core.services.student_deletion.delete_private_file") as cleanup:
        retry = client.post("/api/guardians/deletion-cleanup/", {"deletion_id": result["deletion_id"]}, format="json")
    assert retry.status_code == 200
    assert retry.json()["cleanup_pending"] == 0
    cleanup.assert_called_once()


def test_family_shares_owned_photo_deleted_once_but_other_families_keep_shared_photo(auth_client):
    guardian = make_guardian()
    own_uri = "supabase://student-private-photos/family.jpg"
    shared_uri = "supabase://student-private-photos/shared.jpg"
    make_student(guardian=guardian, photo_url=own_uri)
    make_student(guardian=guardian, photo_url=own_uri)
    make_student(guardian=guardian, photo_url=shared_uri)
    outsider = make_student(photo_url=shared_uri)
    client, _, _ = auth_client()
    with patch("core.services.student_deletion.delete_private_file") as cleanup:
        assert remove(client, guardian).status_code == 200
    cleanup.assert_called_once_with("student-private-photos", "family.jpg")
    assert Student.objects.filter(pk=outsider.pk).exists()


def test_atomic_family_deletion_does_not_leave_partial_records_on_error(auth_client):
    guardian = make_guardian()
    first = make_student(guardian=guardian, photo_url="supabase://student-private-photos/rollback.jpg")
    second = make_student(guardian=guardian)
    payment = make_payment(charge=make_charge(student=first))
    client, _, _ = auth_client()
    payload = confirmation(client, guardian)
    with patch("core.services.guardian_deletion.AuditLog.objects.create", side_effect=IntegrityError("QA rollback")), patch("core.services.student_deletion.delete_private_file") as cleanup:
        with pytest.raises(IntegrityError):
            remove(client, guardian, payload)
    for row in [guardian, first, second, payment]:
        assert type(row).objects.filter(pk=row.pk).exists()
    cleanup.assert_not_called()


@pytest.mark.parametrize("role", ["guardian", "coach", "adult_player", "adult_representative"])
def test_unauthorized_roles_cannot_create_edit_preview_or_delete(auth_client, role):
    guardian = make_guardian()
    client, _, _ = auth_client(role=role)
    assert client.post("/api/guardians/", {"full_name": "QA", "phone": "123"}, format="json").status_code == 403
    assert client.patch(f"/api/guardians/{guardian.pk}/", {"full_name": "QA"}, format="json").status_code == 403
    assert client.get(f"/api/guardians/{guardian.pk}/deletion-preview/").status_code == 403
    assert client.delete(f"/api/guardians/{guardian.pk}/").status_code == 403


def test_scoped_user_without_site_has_no_access(auth_client):
    guardian = make_guardian()
    client, _, _ = auth_client(role="cashier")
    assert client.get("/api/guardians/").json() == []
    assert client.post("/api/guardians/", {"full_name": "QA", "phone": "123"}, format="json").status_code == 403
    assert client.patch(f"/api/guardians/{guardian.pk}/", {"full_name": "QA"}, format="json").status_code == 404
