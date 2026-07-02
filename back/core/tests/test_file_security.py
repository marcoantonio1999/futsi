import os
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.file_security import FileSecurityError, resolve_child_path
from core.tests.factories import make_user


pytestmark = [pytest.mark.api, pytest.mark.security, pytest.mark.django_db]


def test_resolve_child_path_rejects_traversal(tmp_path):
    base = tmp_path / "base"
    base.mkdir()

    with pytest.raises(FileSecurityError):
        resolve_child_path(base, "../secret.jpg")


def test_automatic_attendance_evidence_uses_safe_relative_path(auth_client, tmp_path):
    job_id = "a" * 32
    evidence_dir = tmp_path / "automatic_attendance" / "procesados" / job_id / "evidence" / "session_1"
    evidence_dir.mkdir(parents=True)
    (evidence_dir / "ok.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    (tmp_path / "automatic_attendance" / "procesados" / "secret.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    client, _payload, _user = auth_client(role="admin")

    with override_settings(MEDIA_ROOT=tmp_path):
        ok = client.get(f"/api/automatic-attendance/evidence/{job_id}/evidence/session_1/ok.jpg")
        traversal = client.get(f"/api/automatic-attendance/evidence/{job_id}/../secret.jpg")

    assert ok.status_code == 200
    assert ok["Content-Type"] == "image/jpeg"
    assert traversal.status_code == 404


def test_automatic_attendance_evidence_rejects_invalid_job_id(auth_client, tmp_path):
    client, _payload, _user = auth_client(role="admin")

    with override_settings(MEDIA_ROOT=tmp_path):
        response = client.get("/api/automatic-attendance/evidence/not-a-job/evidence/ok.jpg")

    assert response.status_code == 404


def test_automatic_attendance_evidence_respects_retention(auth_client, tmp_path):
    job_id = "b" * 32
    evidence_dir = tmp_path / "automatic_attendance" / "procesados" / job_id / "evidence"
    evidence_dir.mkdir(parents=True)
    old_file = evidence_dir / "old.jpg"
    old_file.write_bytes(b"\xff\xd8\xff\xd9")
    old_timestamp = (timezone.now() - timedelta(days=3)).timestamp()
    os.utime(old_file, (old_timestamp, old_timestamp))
    client, _payload, _user = auth_client(role="admin")

    with override_settings(MEDIA_ROOT=tmp_path, FILE_EVIDENCE_RETENTION_DAYS=1):
        response = client.get(f"/api/automatic-attendance/evidence/{job_id}/evidence/old.jpg")

    assert response.status_code == 404


def test_automatic_attendance_upload_validates_extension_mime_and_size(tmp_path, settings, monkeypatch):
    settings.MEDIA_ROOT = tmp_path
    settings.FILE_UPLOAD_MAX_VIDEO_BYTES = 3
    monkeypatch.setenv("AUTOMATIC_ATTENDANCE_LOCAL_ENABLED", "true")
    user = make_user(role="admin")
    client = APIClient()
    client.force_authenticate(user=user)

    invalid_extension = client.post(
        "/api/automatic-attendance/upload/",
        {"video": SimpleUploadedFile("video.txt", b"abcd", content_type="video/mp4")},
        format="multipart",
    )
    invalid_mime = client.post(
        "/api/automatic-attendance/upload/",
        {"video": SimpleUploadedFile("video.mp4", b"ab", content_type="text/plain")},
        format="multipart",
    )
    too_large = client.post(
        "/api/automatic-attendance/upload/",
        {"video": SimpleUploadedFile("video.mp4", b"abcd", content_type="video/mp4")},
        format="multipart",
    )

    assert invalid_extension.status_code == 400
    assert invalid_mime.status_code == 400
    assert too_large.status_code == 413


def test_historical_excel_upload_validates_extension_mime_and_size(auth_client, settings):
    settings.FILE_UPLOAD_MAX_EXCEL_BYTES = 3
    client, _payload, _user = auth_client(role="admin")

    invalid_extension = client.post(
        "/api/historical-imports/preview/",
        {"file": SimpleUploadedFile("historico.csv", b"abcd", content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        format="multipart",
    )
    invalid_mime = client.post(
        "/api/historical-imports/preview/",
        {"file": SimpleUploadedFile("historico.xlsx", b"ab", content_type="text/plain")},
        format="multipart",
    )
    too_large = client.post(
        "/api/historical-imports/preview/",
        {"file": SimpleUploadedFile("historico.xlsx", b"abcd", content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        format="multipart",
    )

    assert invalid_extension.status_code == 400
    assert invalid_mime.status_code == 400
    assert too_large.status_code == 413
