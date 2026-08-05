from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from django.contrib.auth.hashers import make_password
from django.utils import timezone

from core.face_station_auth import build_station_token
from core.models import (
    FaceStationDailyPresence,
    FaceStationDailyReport,
    FaceStationDevice,
)

from .factories import (
    make_charge,
    make_discount,
    make_payment,
    make_site,
    make_student,
    make_user,
)


pytestmark = [pytest.mark.api, pytest.mark.django_db]


@pytest.fixture
def report_station():
    site = make_site(code="qa-face-report")
    service_user = make_user(role="site_coordinator", primary_site=site)
    secret = "qa-report-secret"
    device = FaceStationDevice.objects.create(
        name="FaceGuard QA",
        site=site,
        service_user=service_user,
        camera_id="qa-report-camera",
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


def daily_payload(
    report_date,
    rows,
    *,
    revision=1,
    base_revision=0,
    base_payload_sha256="",
    monthly_fee=1000,
    unknown_minimum_days=3,
):
    generated_at = timezone.make_aware(
        datetime.combine(report_date, datetime.min.time())
        + timedelta(hours=23),
        timezone.get_current_timezone(),
    )
    return {
        "schema_version": 1,
        "report_date": report_date.isoformat(),
        "revision": revision,
        "base_revision": base_revision,
        "base_payload_sha256": base_payload_sha256,
        "generated_at": generated_at.isoformat(),
        "finalized": True,
        "policy": {
            "monthly_fee_amount": monthly_fee,
            "registered_minimum_days": 1,
            "unknown_minimum_days": unknown_minimum_days,
        },
        "rows": rows,
    }


def known_row(student, *, detections=10):
    return {
        "subject_kind": "known",
        "subject_key": f"student:{student.id}",
        "canonical_person_key": f"student:{student.id}",
        "name": "Nombre local obsoleto",
        "person_type": "student",
        "group_name": student.group_name,
        "session_count": 1,
        "detection_count": detections,
        "best_similarity": 0.83,
        "evidence_count": 4,
    }


def unknown_row(subject_key="unknown-qa", *, detections=20):
    return {
        "subject_kind": "unknown",
        "subject_key": subject_key,
        "name": "Desconocido QA",
        "status": "consolidated",
        "session_count": 1,
        "detection_count": detections,
        "best_similarity": 0.74,
        "evidence_count": 3,
    }


def test_daily_report_sync_is_idempotent_and_replaces_obsolete_rows(
    api_client,
    report_station,
):
    student = make_student(site=report_station["site"], full_name="Alumno Real")
    report_date = timezone.localdate()
    first_payload = daily_payload(
        report_date,
        [known_row(student), unknown_row()],
    )

    first = api_client.put(
        "/api/face-station/reports/daily/",
        first_payload,
        format="json",
        **station_headers(report_station),
    )
    duplicate = api_client.put(
        "/api/face-station/reports/daily/",
        first_payload,
        format="json",
        **station_headers(report_station),
    )

    assert first.status_code == 201
    assert first.json()["duplicate"] is False
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    report = FaceStationDailyReport.objects.get()
    assert report.row_count == 2
    assert report.presences.count() == 2
    assert report.presences.get(canonical_person_key=f"student:{student.id}").name == "Alumno Real"

    replacement = daily_payload(
        report_date,
        [unknown_row(detections=31)],
        revision=2,
        base_revision=report.revision,
        base_payload_sha256=report.payload_sha256,
    )
    updated = api_client.put(
        "/api/face-station/reports/daily/",
        replacement,
        format="json",
        **station_headers(report_station),
    )

    assert updated.status_code == 200
    report.refresh_from_db()
    assert report.revision == 2
    assert report.row_count == 1
    assert list(report.presences.values_list("subject_kind", "subject_key")) == [
        ("unknown", "unknown-qa")
    ]

    stale_payload = daily_payload(
        report_date,
        [known_row(student)],
        revision=1,
    )
    stale = api_client.put(
        "/api/face-station/reports/daily/",
        stale_payload,
        format="json",
        **station_headers(report_station),
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "revision_conflict"


def test_daily_report_rejects_registered_person_from_another_site(
    api_client,
    report_station,
):
    external_student = make_student(site=make_site())
    response = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(timezone.localdate(), [known_row(external_student)]),
        format="json",
        **station_headers(report_station),
    )

    assert response.status_code == 400
    assert FaceStationDailyReport.objects.count() == 0
    assert FaceStationDailyPresence.objects.count() == 0


def test_monthly_report_matches_faceguard_day_rules_and_server_payments(
    api_client,
    report_station,
):
    student = make_student(
        site=report_station["site"],
        full_name="Mariana Mensual",
    )
    charge = make_charge(student=student, site=report_station["site"])
    month_start = timezone.localdate().replace(day=1)
    paid_at = timezone.make_aware(
        datetime.combine(month_start, datetime.min.time())
        + timedelta(days=1, hours=12),
        timezone.get_current_timezone(),
    )
    make_payment(charge, amount="875.00", paid_at=paid_at)

    for index in range(3):
        report_date = month_start + timedelta(days=index)
        rows = [unknown_row(detections=20 + index)]
        if index == 0:
            rows.append(known_row(student, detections=12))
        response = api_client.put(
            "/api/face-station/reports/daily/",
            daily_payload(report_date, rows, unknown_minimum_days=3),
            format="json",
            **station_headers(report_station),
        )
        assert response.status_code == 201

    admin = make_user(role="admin")
    api_client.force_authenticate(user=admin)
    response = api_client.get(
        "/api/face-station/reports/monthly/",
        {
            "month": month_start.strftime("%Y-%m"),
            "site": report_station["site"].id,
            "limit": 48,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["summary"] == {
        "people": 2,
        "known": 1,
        "unknown": 1,
        "attendance_days": 4,
        "sessions": 4,
        "detections": 75,
        "expected_payers": 2,
        "expected_revenue": 2000.0,
        "payment_registered": 0,
        "payment_missing": 1,
    }
    rows = {row["subject_kind"]: row for row in payload["items"]}
    assert rows["known"]["name"] == "Mariana Mensual"
    assert rows["known"]["attendance_days"] == 1
    assert rows["known"]["payment_amount"] == 875.0
    assert rows["known"]["payment_registered"] is False
    assert rows["unknown"]["attendance_days"] == 3
    assert rows["unknown"]["expected_monthly_amount"] == 1000.0
    assert payload["report_days"] == 3


def test_monthly_report_is_scoped_to_the_users_site(
    api_client,
    report_station,
):
    report_date = timezone.localdate()
    response = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(report_date, [unknown_row()]),
        format="json",
        **station_headers(report_station),
    )
    assert response.status_code == 201

    other_site = make_site()
    coordinator = make_user(role="site_coordinator", primary_site=other_site)
    api_client.force_authenticate(user=coordinator)
    hidden = api_client.get(
        "/api/face-station/reports/monthly/",
        {
            "month": report_date.strftime("%Y-%m"),
            "site": report_station["site"].id,
        },
    )
    assert hidden.status_code == 200
    assert hidden.json()["available"] is False

    guardian = make_user(role="guardian")
    api_client.force_authenticate(user=guardian)
    forbidden = api_client.get(
        "/api/face-station/reports/monthly/",
        {"month": report_date.strftime("%Y-%m")},
    )
    assert forbidden.status_code == 403

    coach = make_user(
        role="coach",
        primary_site=report_station["site"],
        section_permissions=["attendance"],
    )
    api_client.force_authenticate(user=coach)
    coach_forbidden = api_client.get(
        "/api/face-station/reports/monthly/",
        {"month": report_date.strftime("%Y-%m")},
    )
    assert coach_forbidden.status_code == 403


def test_daily_report_accepts_historical_inactive_person(
    api_client,
    report_station,
):
    student = make_student(
        site=report_station["site"],
        full_name="Alumno dado de baja",
        status="dropped",
    )
    response = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(timezone.localdate(), [known_row(student)]),
        format="json",
        **station_headers(report_station),
    )

    assert response.status_code == 201
    assert FaceStationDailyPresence.objects.get().name == "Alumno dado de baja"


def test_daily_report_conflict_never_overwrites_newer_server_data(
    api_client,
    report_station,
):
    report_date = timezone.localdate()
    first = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(report_date, [unknown_row("server-version")]),
        format="json",
        **station_headers(report_station),
    )
    assert first.status_code == 201

    conflict = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(
            report_date,
            [unknown_row("stale-local-copy")],
            revision=2,
            base_revision=0,
        ),
        format="json",
        **station_headers(report_station),
    )

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "revision_conflict"
    assert list(
        FaceStationDailyPresence.objects.values_list(
            "subject_key",
            flat=True,
        )
    ) == ["server-version"]


def test_historical_month_policy_is_frozen_after_first_sync(
    api_client,
    report_station,
):
    current_month = timezone.localdate().replace(day=1)
    historical_date = (
        current_month.replace(year=current_month.year - 1, month=12)
        if current_month.month == 1
        else current_month.replace(month=current_month.month - 1)
    )
    first = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(
            historical_date,
            [unknown_row()],
            monthly_fee=1000,
        ),
        format="json",
        **station_headers(report_station),
    )
    assert first.status_code == 201
    report = FaceStationDailyReport.objects.get()
    second = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(
            historical_date,
            [unknown_row(detections=99)],
            revision=2,
            base_revision=1,
            base_payload_sha256=report.payload_sha256,
            monthly_fee=2500,
        ),
        format="json",
        **station_headers(report_station),
    )
    assert second.status_code == 200

    admin = make_user(role="admin")
    api_client.force_authenticate(user=admin)
    response = api_client.get(
        "/api/face-station/reports/monthly/",
        {
            "month": historical_date.strftime("%Y-%m"),
            "site": report_station["site"].id,
        },
    )
    assert response.status_code == 200
    assert response.json()["revenue_policy"]["monthly_fee_amount"] == 1000.0


def test_month_out_of_supported_range_returns_400(
    api_client,
):
    admin = make_user(role="admin")
    api_client.force_authenticate(user=admin)

    response = api_client.get(
        "/api/face-station/reports/monthly/",
        {"month": "9999-12"},
    )

    assert response.status_code == 400


def test_collaborator_attendance_does_not_generate_academy_fee(
    api_client,
    report_station,
):
    collaborator = make_user(
        role="collaborator",
        primary_site=report_station["site"],
        first_name="Personal",
        last_name="Limpieza",
    )
    person_key = f"collaborator:{collaborator.id}"
    response = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(
            timezone.localdate(),
            [
                {
                    "subject_kind": "known",
                    "subject_key": person_key,
                    "canonical_person_key": person_key,
                    "name": "Nombre local",
                    "person_type": "collaborator",
                    "session_count": 1,
                    "detection_count": 15,
                }
            ],
        ),
        format="json",
        **station_headers(report_station),
    )
    assert response.status_code == 201

    admin = make_user(role="admin")
    api_client.force_authenticate(user=admin)
    report = api_client.get(
        "/api/face-station/reports/monthly/",
        {
            "month": timezone.localdate().strftime("%Y-%m"),
            "site": report_station["site"].id,
        },
    ).json()

    assert report["summary"]["people"] == 1
    assert report["summary"]["expected_payers"] == 0
    assert report["summary"]["expected_revenue"] == 0
    assert report["items"][0]["fee_applicable"] is False
    assert report["items"][0]["expected_monthly_amount"] == 0


def test_approved_discount_counts_toward_monthly_charge_balance(
    api_client,
    report_station,
):
    student = make_student(site=report_station["site"])
    month_start = timezone.localdate().replace(day=1)
    charge = make_charge(
        student=student,
        site=report_station["site"],
        amount="1000.00",
        due_date=month_start + timedelta(days=9),
    )
    make_payment(charge, amount="800.00")
    make_discount(
        charge=charge,
        amount="200.00",
        status="approved",
    )
    response = api_client.put(
        "/api/face-station/reports/daily/",
        daily_payload(month_start, [known_row(student)]),
        format="json",
        **station_headers(report_station),
    )
    assert response.status_code == 201

    admin = make_user(role="admin")
    api_client.force_authenticate(user=admin)
    report = api_client.get(
        "/api/face-station/reports/monthly/",
        {
            "month": month_start.strftime("%Y-%m"),
            "site": report_station["site"].id,
        },
    ).json()

    assert report["items"][0]["payment_amount"] == 800.0
    assert report["items"][0]["payment_registered"] is True
    assert report["summary"]["payment_missing"] == 0
