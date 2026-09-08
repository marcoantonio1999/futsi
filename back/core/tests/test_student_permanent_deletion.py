from unittest.mock import patch
from datetime import timedelta

import pytest
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone

from core.models import Student, Charge, Payment, Discount, Invoice, AuditLog, FaceRecognitionAttempt, FaceStationDailyReport, FaceStationDailyPresence, FaceStationDevice, HistoricalImport, HistoricalImportRow
from core.tests.factories import make_student, make_guardian, make_site, make_charge, make_payment, make_discount, make_invoice, make_attendance_session, make_attendance_record, make_student_assessment, make_student_value_assessment, make_student_tournament_registration, make_user

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def confirmation(client, student):
    response = client.get(f"/api/students/{student.pk}/deletion-preview/")
    assert response.status_code == 200, response.content
    return {"confirmation_token": response.json()["confirmation_token"], "confirmation_name": student.full_name}


def remove(client, student, payload=None):
    return client.delete(f"/api/students/{student.pk}/", payload or confirmation(client, student), format="json")


def test_removes_entire_dependency_chain_but_preserves_siblings_and_shared_parents(auth_client):
    student = make_student()
    sibling = make_student(guardian=student.guardian, site=student.site)
    registration = make_student_tournament_registration(student=student)
    # The payment is intentionally linked only through its charge.
    charge = make_charge(student=student, tournament_registration=registration)
    payment = make_payment(charge=charge, student=None)
    discount = make_discount(charge=charge, student=None)
    invoice = make_invoice(payment=payment, guardian=student.guardian, student=None)
    session = make_attendance_session(site=student.site)
    attendance = make_attendance_record(student=student, session=session)
    sibling_attendance = make_attendance_record(student=sibling, session=session)
    assessment = make_student_assessment(student=student)
    values = make_student_value_assessment(student=student)
    attempt = FaceRecognitionAttempt.objects.create(session=session, student=student, captured_by=make_user())
    sibling_charge = make_charge(student=sibling)
    sibling_payment = make_payment(charge=sibling_charge)
    client, _, _ = auth_client()
    response = remove(client, student)
    assert response.status_code == 200, response.content
    for row in [student, registration, charge, payment, discount, invoice, attendance, assessment, values, attempt]:
        assert not type(row).objects.filter(pk=row.pk).exists(), type(row).__name__
    for row in [sibling, sibling.guardian, session, sibling_attendance, sibling_charge, sibling_payment, registration.team, registration.tournament]:
        assert type(row).objects.filter(pk=row.pk).exists(), type(row).__name__


def test_preview_is_read_only_and_requires_final_confirmation(auth_client):
    student = make_student()
    charge = make_charge(student=student)
    make_payment(charge=charge)
    client, _, _ = auth_client()
    response = client.get(f"/api/students/{student.pk}/deletion-preview/")
    assert response.status_code == 200
    assert {item["label"]: item["count"] for item in response.json()["items"]}["Pagos"] == 1
    assert Student.objects.filter(pk=student.pk).exists()
    assert client.delete(f"/api/students/{student.pk}/").status_code == 400
    payload = confirmation(client, student)
    payload["confirmation_name"] = "Otro alumno"
    assert remove(client, student, payload).status_code == 400
    assert Charge.objects.filter(pk=charge.pk).exists()


def test_confirmation_cannot_be_reused_for_another_student_or_user(auth_client):
    student, other = make_student(), make_student()
    client, _, _ = auth_client()
    payload = confirmation(client, student)
    payload["confirmation_name"] = other.full_name
    assert remove(client, other, payload).status_code == 400
    other_client, _, _ = auth_client()
    payload["confirmation_name"] = student.full_name
    assert remove(other_client, student, payload).status_code == 400


@pytest.mark.parametrize("change", ["new_payment", "amount"])
def test_new_or_changed_history_requires_review_again(auth_client, change):
    student = make_student()
    charge = make_charge(student=student)
    client, _, _ = auth_client()
    payload = confirmation(client, student)
    if change == "new_payment":
        make_payment(charge=charge)
    else:
        Charge.objects.filter(pk=charge.pk).update(amount=1)
    assert remove(client, student, payload).status_code == 409
    assert Student.objects.filter(pk=student.pk).exists()


def test_database_failure_rolls_back_all_records_and_does_not_touch_files(auth_client):
    student = make_student(photo_url="supabase://student-private-photos/test.jpg")
    charge = make_charge(student=student)
    payment = make_payment(charge=charge)
    client, _, _ = auth_client()
    payload = confirmation(client, student)
    with patch("core.services.student_deletion.AuditLog.objects.create", side_effect=IntegrityError("QA rollback")), patch("core.services.student_deletion.delete_private_file") as delete_file:
        with pytest.raises(IntegrityError):
            remove(client, student, payload)
    assert Student.objects.filter(pk=student.pk).exists()
    assert Payment.objects.filter(pk=payment.pk).exists()
    assert Charge.objects.filter(pk=charge.pk).exists()
    delete_file.assert_not_called()


def test_own_files_are_deleted_and_shared_photos_are_preserved(auth_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    student = make_student(photo_url="supabase://student-private-photos/shared.jpg")
    sibling = make_student(photo_url=student.photo_url)
    payment = make_payment(charge=make_charge(student=student))
    payment.receipt_file.save("receipt.txt", ContentFile(b"QA test receipt"))
    path = payment.receipt_file.path
    from pathlib import Path
    client, _, _ = auth_client()
    with patch("core.services.student_deletion.delete_private_file") as delete_file:
        response = remove(client, student)
    assert response.status_code == 200
    assert response.json()["cleanup_pending"] == 0
    assert not Path(path).exists()
    delete_file.assert_not_called()
    assert Student.objects.filter(pk=sibling.pk).exists()


def test_failed_storage_cleanup_is_durable_and_retryable_in_scope(auth_client):
    student = make_student(photo_url="supabase://student-private-photos/owned.jpg")
    client, _, _ = auth_client(role="cashier", primary_site=student.site)
    with patch("core.services.student_deletion.delete_private_file", side_effect=RuntimeError("provider failure")):
        response = remove(client, student)
    assert response.status_code == 200
    result = response.json()
    assert result["cleanup_pending"] == 1
    assert not Student.objects.filter(pk=student.pk).exists()
    other_client, _, _ = auth_client(role="cashier", primary_site=make_site())
    assert other_client.post("/api/students/deletion-cleanup/", {"deletion_id": result["deletion_id"]}, format="json").status_code == 404
    with patch("core.services.student_deletion.delete_private_file", return_value=True) as delete_file:
        retry = client.post("/api/students/deletion-cleanup/", {"deletion_id": result["deletion_id"]}, format="json")
    assert retry.status_code == 200
    assert retry.json()["cleanup_pending"] == 0
    delete_file.assert_called_once_with("student-private-photos", "owned.jpg")
    assert AuditLog.objects.get(pk=result["deletion_id"]).metadata["pending_files"] == []


def test_deletes_daily_presence_and_import_rows_without_deleting_shared_reports(auth_client):
    student = make_student()
    sibling = make_student(site=student.site, guardian=student.guardian)
    client, _, user = auth_client()
    device = FaceStationDevice.objects.create(name="QA device", site=student.site, service_user=user, secret_hash="qa")
    report = FaceStationDailyReport.objects.create(device=device, site=student.site, report_date=timezone.localdate(), generated_at=timezone.now(), payload_sha256="qa", row_count=2)
    for person in [student, sibling]:
        FaceStationDailyPresence.objects.create(report=report, subject_kind="known", subject_key=f"student:{person.pk}", canonical_person_key=f"student:{person.pk}", name=person.full_name, person_type="student")
    payment = make_payment(charge=make_charge(student=student))
    historical = HistoricalImport.objects.create(original_filename="qa.xlsx", uploaded_by=user)
    row = HistoricalImportRow.objects.create(historical_import=historical, row_type="income", sheet_name="qa", source_row=1, concept="qa", amount=payment.amount, target_table="payments", target_id=str(payment.pk), raw_data={"name": student.full_name})
    response = remove(client, student)
    assert response.status_code == 200, response.content
    assert not HistoricalImportRow.objects.filter(pk=row.pk).exists()
    assert HistoricalImport.objects.filter(pk=historical.pk).exists()
    report.refresh_from_db()
    assert report.row_count == 1
    assert list(report.presences.values_list("canonical_person_key", flat=True)) == [f"student:{sibling.pk}"]


@pytest.mark.parametrize("role", ["guardian", "coach", "adult_player", "adult_representative"])
def test_preview_and_file_cleanup_require_deletion_permissions(auth_client, role):
    student = make_student()
    client, _, _ = auth_client(role=role, primary_site=student.site)
    assert client.get(f"/api/students/{student.pk}/deletion-preview/").status_code == 403
    assert client.post("/api/students/deletion-cleanup/", {"deletion_id": 1}, format="json").status_code == 403
