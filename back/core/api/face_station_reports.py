from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.face_station_auth import FaceStationAuthentication
from core.models import (
    Charge,
    ChargeStatus,
    Discount,
    DiscountStatus,
    FaceStationDailyPresence,
    FaceStationDailyReport,
    FaceStationMonthlyPolicy,
    Payment,
    Player,
    Site,
    Student,
    User,
)

from .face_station_service import FACE_STATION_COLLABORATOR_ROLES


REPORT_SCHEMA_VERSION = 1
MAX_DAILY_ROWS = 5000
DEFAULT_MONTHLY_FEE = 1000.0
DEFAULT_REGISTERED_MINIMUM_DAYS = 1
DEFAULT_UNKNOWN_MINIMUM_DAYS = 3
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ELEVATED_REPORT_ROLES = {"admin", "dev", "owner"}
SITE_REPORT_ROLES = {"site_coordinator"}
PAYMENT_STATUSES = {"registered", "reconciled"}


def _bounded_text(value, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


def _bounded_int(value, *, minimum: int = 0, maximum: int = 2_000_000_000) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = minimum
    return max(minimum, min(maximum, parsed))


def _bounded_float(value, *, minimum: float = 0.0, maximum: float = 1_000_000.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = minimum
    return round(max(minimum, min(maximum, parsed)), 4)


def _flag(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "si", "on"}
    return bool(value)


def _parse_report_date(value) -> date:
    raw = str(value or "")
    if not DATE_RE.fullmatch(raw):
        raise ValueError("report_date debe usar el formato YYYY-MM-DD.")
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError("report_date no es una fecha valida.") from exc


def _parse_month(value) -> tuple[str, date, date]:
    raw = str(value or "")
    if not MONTH_RE.fullmatch(raw):
        raise ValueError("month debe usar el formato YYYY-MM.")
    try:
        start = datetime.strptime(raw, "%Y-%m").date().replace(day=1)
        if not 2000 <= start.year <= 2100:
            raise ValueError
        end = (
            start.replace(year=start.year + 1, month=1)
            if start.month == 12
            else start.replace(month=start.month + 1)
        )
    except ValueError as exc:
        raise ValueError("month no es un mes valido.") from exc
    return raw, start, end


def _parse_timestamp(value, *, required: bool = False):
    raw = str(value or "").strip()
    if not raw:
        if required:
            raise ValueError("generated_at es obligatorio.")
        return None
    parsed = parse_datetime(raw)
    if parsed is None:
        raise ValueError("La marca de tiempo no es valida.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _person_snapshot(person_type: str, person) -> dict:
    if person_type in {"student", "player"}:
        name = person.full_name
    else:
        name = person.get_full_name().strip() or person.username
    group_name = ""
    team_name = ""
    if person_type == "student":
        group_name = person.group_name or person.category or ""
    elif person_type == "player":
        team_name = person.team.name
    elif person_type == "collaborator":
        group_name = person.get_role_display()
    return {
        "name": name,
        "person_type": person_type,
        "group_name": group_name,
        "team_name": team_name,
    }


def _resolve_canonical_person(device, raw_key: str) -> tuple[str, dict]:
    person_type, separator, raw_id = _bounded_text(raw_key, 80).partition(":")
    if not separator or person_type not in {"student", "player", "collaborator"}:
        raise ValueError("canonical_person_key no es valido.")
    try:
        person_id = int(raw_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("canonical_person_key no es valido.") from exc
    if person_type == "student":
        person = Student.objects.filter(
            pk=person_id,
            site_id=device.site_id,
        ).first()
    elif person_type == "player":
        person = (
            Player.objects.select_related("team")
            .filter(
                pk=person_id,
                team__tournament__site_id=device.site_id,
            )
            .first()
        )
    else:
        person = (
            User.objects.filter(
                pk=person_id,
                primary_site_id=device.site_id,
                role__in=FACE_STATION_COLLABORATOR_ROLES,
            )
            .exclude(pk=device.service_user_id)
            .first()
        )
    if person is None:
        raise ValueError("Una identidad registrada no pertenece a la sede de esta estacion.")
    key = f"{person_type}:{person_id}"
    return key, _person_snapshot(person_type, person)


def _normalized_policy(raw_policy) -> dict:
    source = raw_policy if isinstance(raw_policy, dict) else {}
    return {
        "monthly_fee_amount": _bounded_float(
            source.get("monthly_fee_amount", DEFAULT_MONTHLY_FEE),
            maximum=1_000_000,
        ),
        "registered_minimum_days": _bounded_int(
            source.get(
                "registered_minimum_days",
                DEFAULT_REGISTERED_MINIMUM_DAYS,
            ),
            minimum=1,
            maximum=366,
        ),
        "unknown_minimum_days": _bounded_int(
            source.get("unknown_minimum_days", DEFAULT_UNKNOWN_MINIMUM_DAYS),
            minimum=1,
            maximum=366,
        ),
    }


def _policy_contract(policy: dict) -> dict:
    return {
        "monthly_fee_amount": policy["monthly_fee_amount"],
        "minimum_attendance_days": policy["unknown_minimum_days"],
        "registered_minimum_attendance_days": policy[
            "registered_minimum_days"
        ],
        "unknown_minimum_attendance_days": policy[
            "unknown_minimum_days"
        ],
    }


def _normalize_daily_payload(device, raw_payload) -> dict:
    if not isinstance(raw_payload, dict):
        raise ValueError("El reporte debe ser un objeto JSON.")
    report_date = _parse_report_date(raw_payload.get("report_date"))
    generated_at = _parse_timestamp(raw_payload.get("generated_at"), required=True)
    if generated_at > timezone.now() + timedelta(days=1):
        raise ValueError("generated_at no puede estar en el futuro.")
    try:
        schema_version = int(
            raw_payload.get("schema_version", REPORT_SCHEMA_VERSION)
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("La version del reporte no es valida.") from exc
    if schema_version != REPORT_SCHEMA_VERSION:
        raise ValueError("La version del reporte no es compatible.")
    raw_rows = raw_payload.get("rows")
    if not isinstance(raw_rows, list):
        raise ValueError("rows debe ser una lista.")
    if len(raw_rows) > MAX_DAILY_ROWS:
        raise ValueError(f"El reporte admite hasta {MAX_DAILY_ROWS} identidades por dia.")

    normalized_by_key: dict[tuple[str, str], dict] = {}
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            raise ValueError("Cada identidad del reporte debe ser un objeto.")
        subject_kind = _bounded_text(raw_row.get("subject_kind"), 10)
        if subject_kind not in {"known", "unknown"}:
            raise ValueError("subject_kind debe ser known o unknown.")
        subject_key = _bounded_text(raw_row.get("subject_key"), 120)
        if not subject_key:
            raise ValueError("subject_key es obligatorio.")
        canonical_source = _bounded_text(
            raw_row.get("canonical_person_key"),
            80,
        )
        if subject_kind == "known" and not canonical_source:
            canonical_source = subject_key
        canonical_person_key = ""
        server_snapshot = {}
        if canonical_source:
            canonical_person_key, server_snapshot = _resolve_canonical_person(
                device,
                canonical_source,
            )
        first_seen_at = _parse_timestamp(raw_row.get("first_seen_at"))
        last_seen_at = _parse_timestamp(raw_row.get("last_seen_at"))
        normalized = {
            "subject_kind": subject_kind,
            "subject_key": subject_key,
            "canonical_person_key": canonical_person_key,
            "name": server_snapshot.get("name")
            or _bounded_text(raw_row.get("name"), 160)
            or subject_key,
            "person_type": server_snapshot.get("person_type")
            or _bounded_text(raw_row.get("person_type"), 32),
            "group_name": server_snapshot.get("group_name")
            or _bounded_text(raw_row.get("group_name"), 80),
            "team_name": server_snapshot.get("team_name")
            or _bounded_text(raw_row.get("team_name"), 120),
            "status": _bounded_text(raw_row.get("status"), 32),
            "session_count": _bounded_int(
                raw_row.get("session_count"),
                maximum=100_000,
            ),
            "detection_count": _bounded_int(raw_row.get("detection_count")),
            "first_seen_at": first_seen_at,
            "last_seen_at": last_seen_at,
            "best_similarity": _bounded_float(
                raw_row.get("best_similarity"),
                minimum=-1.0,
                maximum=1.0,
            ),
            "evidence_count": _bounded_int(
                raw_row.get("evidence_count"),
                maximum=100_000,
            ),
        }
        normalized_by_key[(subject_kind, subject_key)] = normalized

    rows = sorted(
        normalized_by_key.values(),
        key=lambda item: (item["subject_kind"], item["subject_key"]),
    )
    policy = _normalized_policy(raw_payload.get("policy"))
    hash_payload = {
        "schema_version": schema_version,
        "report_date": report_date.isoformat(),
        "finalized": _flag(raw_payload.get("finalized", True)),
        "policy": policy,
        "rows": [
            {
                **row,
                "first_seen_at": (
                    row["first_seen_at"].isoformat()
                    if row["first_seen_at"]
                    else ""
                ),
                "last_seen_at": (
                    row["last_seen_at"].isoformat()
                    if row["last_seen_at"]
                    else ""
                ),
            }
            for row in rows
        ],
    }
    payload_sha256 = hashlib.sha256(
        json.dumps(
            hash_payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return {
        **hash_payload,
        "report_date": report_date,
        "generated_at": generated_at,
        "revision": _bounded_int(
            raw_payload.get("revision", 1),
            minimum=1,
            maximum=2_000_000_000,
        ),
        "base_revision": _bounded_int(
            raw_payload.get("base_revision", 0),
            maximum=2_000_000_000,
        ),
        "base_payload_sha256": _bounded_text(
            raw_payload.get("base_payload_sha256"),
            64,
        ),
        "payload_sha256": payload_sha256,
        "rows": rows,
    }


class FaceStationDailyReportSyncView(APIView):
    authentication_classes = [FaceStationAuthentication]
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def put(self, request):
        device = request.auth
        site = Site.objects.select_for_update().get(pk=device.site_id)
        try:
            payload = _normalize_daily_payload(device, request.data)
        except ValueError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        report = (
            FaceStationDailyReport.objects.select_for_update()
            .filter(device=device, report_date=payload["report_date"])
            .first()
        )
        if report and report.payload_sha256 == payload["payload_sha256"]:
            if payload["generated_at"] > report.generated_at:
                report.generated_at = payload["generated_at"]
            report.save(
                update_fields=[
                    "generated_at",
                    "updated_at",
                ]
            )
            return Response(
                {
                    "status": "stored",
                    "duplicate": True,
                    "revision": report.revision,
                    "payload_sha256": report.payload_sha256,
                    "rows": report.row_count,
                }
            )
        if report and (
            payload["base_revision"] != report.revision
            or (
                payload["base_payload_sha256"]
                and payload["base_payload_sha256"] != report.payload_sha256
            )
            or payload["revision"] != report.revision + 1
        ):
            return Response(
                {
                    "detail": (
                        "El reporte cambio en el servidor. "
                        "No se sobrescribio la version mas reciente."
                    ),
                    "code": "revision_conflict",
                    "current_revision": report.revision,
                    "payload_sha256": report.payload_sha256,
                },
                status=status.HTTP_409_CONFLICT,
            )
        if report is None and (
            payload["base_revision"] != 0 or payload["revision"] != 1
        ):
            return Response(
                {
                    "detail": (
                        "La primera version de un reporte debe iniciar "
                        "en la revision 1."
                    ),
                    "code": "revision_conflict",
                    "current_revision": 0,
                    "payload_sha256": "",
                },
                status=status.HTTP_409_CONFLICT,
            )

        created = report is None
        if report is None:
            report = FaceStationDailyReport(
                device=device,
                site=site,
                report_date=payload["report_date"],
            )
        report.site = site
        report.revision = payload["revision"]
        report.payload_sha256 = payload["payload_sha256"]
        report.schema_version = payload["schema_version"]
        report.generated_at = payload["generated_at"]
        report.finalized = payload["finalized"]
        report.policy = payload["policy"]
        report.row_count = len(payload["rows"])
        report.save()
        if not created:
            report.presences.all().delete()
        FaceStationDailyPresence.objects.bulk_create(
            [
                FaceStationDailyPresence(report=report, **row)
                for row in payload["rows"]
            ],
            batch_size=500,
        )
        month_start = payload["report_date"].replace(day=1)
        monthly_policy, policy_created = (
            FaceStationMonthlyPolicy.objects.select_for_update().get_or_create(
                site=site,
                month_start=month_start,
                defaults={
                    "monthly_fee_amount": Decimal(
                        str(payload["policy"]["monthly_fee_amount"])
                    ),
                    "registered_minimum_days": payload["policy"][
                        "registered_minimum_days"
                    ],
                    "unknown_minimum_days": payload["policy"][
                        "unknown_minimum_days"
                    ],
                    "source_device": device,
                },
            )
        )
        current_month = timezone.localdate().replace(day=1)
        if not policy_created and month_start == current_month:
            monthly_policy.monthly_fee_amount = Decimal(
                str(payload["policy"]["monthly_fee_amount"])
            )
            monthly_policy.registered_minimum_days = payload["policy"][
                "registered_minimum_days"
            ]
            monthly_policy.unknown_minimum_days = payload["policy"][
                "unknown_minimum_days"
            ]
            monthly_policy.source_device = device
            monthly_policy.save(
                update_fields=[
                    "monthly_fee_amount",
                    "registered_minimum_days",
                    "unknown_minimum_days",
                    "source_device",
                    "updated_at",
                ]
            )
        return Response(
            {
                "status": "stored",
                "duplicate": False,
                "revision": report.revision,
                "payload_sha256": report.payload_sha256,
                "rows": report.row_count,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


def _reports_for_user(user):
    role = getattr(user, "role", "")
    if role in ELEVATED_REPORT_ROLES:
        return FaceStationDailyReport.objects.all()
    if role not in SITE_REPORT_ROLES:
        raise PermissionDenied("No tienes permiso para consultar reportes de asistencia.")
    if not getattr(user, "primary_site_id", None):
        raise PermissionDenied("Tu usuario no tiene una sede asignada.")
    return FaceStationDailyReport.objects.filter(site_id=user.primary_site_id)


def _registered_people(site_id: int, canonical_keys: set[str]) -> dict[str, dict]:
    ids: dict[str, set[int]] = {
        "student": set(),
        "player": set(),
        "collaborator": set(),
    }
    for key in canonical_keys:
        person_type, separator, raw_id = key.partition(":")
        if separator and person_type in ids:
            try:
                ids[person_type].add(int(raw_id))
            except ValueError:
                continue
    result: dict[str, dict] = {}
    for student in Student.objects.filter(
        site_id=site_id,
        id__in=ids["student"],
    ):
        result[f"student:{student.id}"] = {
            "name": student.full_name,
            "person_type": "student",
            "group_name": student.group_name or student.category or "",
            "team_name": "",
        }
    for player in Player.objects.select_related("team").filter(
        team__tournament__site_id=site_id,
        id__in=ids["player"],
    ):
        result[f"player:{player.id}"] = {
            "name": player.full_name,
            "person_type": "player",
            "group_name": "",
            "team_name": player.team.name,
        }
    for collaborator in User.objects.filter(
        primary_site_id=site_id,
        id__in=ids["collaborator"],
    ):
        result[f"collaborator:{collaborator.id}"] = {
            "name": collaborator.get_full_name().strip()
            or collaborator.username,
            "person_type": "collaborator",
            "group_name": collaborator.get_role_display(),
            "team_name": "",
        }
    return result


def _monthly_payments(
    site_id: int,
    student_ids: set[int],
    month_start: date,
    month_end: date,
) -> dict[int, dict]:
    if not student_ids:
        return {}
    charges = list(
        Charge.objects.filter(
            site_id=site_id,
            student_id__in=student_ids,
            due_date__gte=month_start,
            due_date__lt=month_end,
        )
        .exclude(status=ChargeStatus.CANCELED)
        .filter(
            Q(concept__icontains="mensual")
            | Q(description__icontains="mensual")
        )
        .values("id", "student_id", "amount")
    )
    if not charges:
        return {}
    required_by_student: dict[int, Decimal] = {}
    charge_ids = []
    for charge in charges:
        student_id = int(charge["student_id"])
        charge_ids.append(charge["id"])
        required_by_student[student_id] = (
            required_by_student.get(student_id, Decimal("0"))
            + Decimal(charge["amount"] or 0)
        )
    discounts = (
        Discount.objects.filter(
            site_id=site_id,
            charge_id__in=charge_ids,
            status=DiscountStatus.APPROVED,
        )
        .values("charge__student_id")
        .annotate(discount_amount=Sum("amount"))
    )
    for discount in discounts:
        student_id = int(discount["charge__student_id"])
        required_by_student[student_id] = max(
            required_by_student.get(student_id, Decimal("0"))
            - Decimal(discount["discount_amount"] or 0),
            Decimal("0"),
        )
    rows = (
        Payment.objects.filter(
            site_id=site_id,
            student_id__in=student_ids,
            charge_id__in=charge_ids,
            status__in=PAYMENT_STATUSES,
        )
        .values("student_id")
        .annotate(
            payment_count=Count("id"),
            payment_amount=Sum("amount"),
            last_paid_at=Max("paid_at"),
        )
    )
    result = {
        student_id: {
            "required_amount": float(required_amount),
            "payment_count": 0,
            "payment_amount": 0.0,
            "last_paid_at": "",
        }
        for student_id, required_amount in required_by_student.items()
    }
    for row in rows:
        student_id = int(row["student_id"])
        result[student_id] = {
            "required_amount": float(
                required_by_student.get(student_id, Decimal("0"))
            ),
            "payment_count": int(row["payment_count"] or 0),
            "payment_amount": float(row["payment_amount"] or 0),
            "last_paid_at": (
                row["last_paid_at"].isoformat()
                if row["last_paid_at"]
                else ""
            ),
        }
    return result


def _aggregate_month(
    reports,
    month_start: date,
    month_end: date,
) -> tuple[list[dict], dict, dict]:
    report_rows = list(reports.order_by("report_date", "device_id"))
    if not report_rows:
        return [], {}, {}
    latest_report = max(
        report_rows,
        key=lambda item: (item.updated_at, item.id),
    )
    policy_row = FaceStationMonthlyPolicy.objects.filter(
        site_id=latest_report.site_id,
        month_start=month_start,
    ).first()
    policy = (
        {
            "monthly_fee_amount": float(policy_row.monthly_fee_amount),
            "registered_minimum_days": int(
                policy_row.registered_minimum_days
            ),
            "unknown_minimum_days": int(policy_row.unknown_minimum_days),
        }
        if policy_row
        else _normalized_policy({})
    )
    presences = list(
        FaceStationDailyPresence.objects.filter(
            report__in=report_rows,
            report__report_date__gte=month_start,
            report__report_date__lt=month_end,
        ).select_related("report")
    )
    canonical_keys = {
        row.canonical_person_key
        for row in presences
        if row.canonical_person_key
    }
    site_id = report_rows[0].site_id
    people = _registered_people(site_id, canonical_keys)
    student_ids = {
        int(key.split(":", 1)[1])
        for key in canonical_keys
        if key.startswith("student:")
    }
    payments = _monthly_payments(
        site_id,
        student_ids,
        month_start,
        month_end,
    )
    aggregated: dict[str, dict] = {}
    for presence in presences:
        canonical = presence.canonical_person_key
        identity_key = (
            canonical
            if canonical
            else f"unknown:{presence.report.device_id}:{presence.subject_key}"
        )
        person = people.get(canonical, {})
        item = aggregated.setdefault(
            identity_key,
            {
                "subject_kind": "known" if canonical else "unknown",
                "subject_key": canonical or identity_key,
                "linked_person_key": canonical or None,
                "status": "known" if canonical else presence.status,
                "name": person.get("name") or presence.name,
                "person_type": person.get("person_type")
                or presence.person_type
                or ("unknown" if not canonical else ""),
                "group_name": person.get("group_name") or presence.group_name,
                "team_name": person.get("team_name") or presence.team_name,
                "_dates": set(),
                "session_count": 0,
                "detection_count": 0,
                "first_date": presence.report.report_date,
                "last_date": presence.report.report_date,
                "first_seen_at": presence.first_seen_at,
                "last_seen_at": presence.last_seen_at,
                "best_similarity": presence.best_similarity,
                "evidence_count": 0,
            },
        )
        item["_dates"].add(presence.report.report_date)
        item["session_count"] += presence.session_count
        item["detection_count"] += presence.detection_count
        item["evidence_count"] += presence.evidence_count
        item["first_date"] = min(item["first_date"], presence.report.report_date)
        item["last_date"] = max(item["last_date"], presence.report.report_date)
        if presence.first_seen_at and (
            not item["first_seen_at"]
            or presence.first_seen_at < item["first_seen_at"]
        ):
            item["first_seen_at"] = presence.first_seen_at
        if presence.last_seen_at and (
            not item["last_seen_at"]
            or presence.last_seen_at > item["last_seen_at"]
        ):
            item["last_seen_at"] = presence.last_seen_at
        item["best_similarity"] = max(
            item["best_similarity"],
            presence.best_similarity,
        )
        if not canonical and presence.status:
            item["status"] = presence.status

    items = []
    for item in aggregated.values():
        attendance_days = len(item.pop("_dates"))
        recognized = item["subject_kind"] == "known"
        minimum_days = (
            policy["registered_minimum_days"]
            if recognized
            else policy["unknown_minimum_days"]
        )
        person_type, _, raw_id = (
            item["subject_key"].partition(":")
            if recognized
            else ("", "", "")
        )
        fee_applicable = not recognized or person_type == "student"
        eligible = fee_applicable and attendance_days >= minimum_days
        student_id = (
            int(raw_id)
            if person_type == "student" and raw_id.isdigit()
            else None
        )
        payment = payments.get(student_id, {}) if student_id else {}
        payment_applicable = person_type == "student"
        required_payment = float(payment.get("required_amount", 0))
        payment_registered = bool(student_id and student_id in payments) and (
            float(payment.get("payment_amount", 0)) >= required_payment
        )
        items.append(
            {
                **item,
                "attendance_days": attendance_days,
                "first_date": item["first_date"].isoformat(),
                "last_date": item["last_date"].isoformat(),
                "first_seen_at": (
                    item["first_seen_at"].isoformat()
                    if item["first_seen_at"]
                    else ""
                ),
                "last_seen_at": (
                    item["last_seen_at"].isoformat()
                    if item["last_seen_at"]
                    else ""
                ),
                "payment_applicable": payment_applicable,
                "fee_applicable": fee_applicable,
                "payment_registered": payment_registered,
                "payment_count": int(payment.get("payment_count", 0)),
                "payment_amount": float(payment.get("payment_amount", 0)),
                "last_paid_at": payment.get("last_paid_at", ""),
                "expected_fee_eligible": eligible,
                "expected_fee_minimum_days": minimum_days,
                "expected_monthly_amount": (
                    policy["monthly_fee_amount"] if eligible else 0
                ),
            }
        )
    return items, policy, {
        "site_id": latest_report.site_id,
        "site_name": latest_report.site.name,
        "synced_at": max(report.updated_at for report in report_rows).isoformat(),
        "generated_at": max(
            report.generated_at for report in report_rows
        ).isoformat(),
        "report_days": len({report.report_date for report in report_rows}),
        "finalized": all(report.finalized for report in report_rows),
    }


class FaceStationMonthlyReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            selected_month, month_start, month_end = _parse_month(
                request.query_params.get("month")
                or timezone.localdate().strftime("%Y-%m")
            )
        except ValueError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reports = _reports_for_user(request.user).select_related("site", "device")
        raw_site = request.query_params.get("site")
        if raw_site:
            try:
                site_id = int(raw_site)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "site debe ser un identificador numerico."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            reports = reports.filter(site_id=site_id)
        reports = reports.filter(
            report_date__gte=month_start,
            report_date__lt=month_end,
        )
        if not raw_site:
            latest = reports.order_by("-updated_at").first()
            if latest:
                reports = reports.filter(site_id=latest.site_id)
        items, policy, metadata = _aggregate_month(
            reports,
            month_start,
            month_end,
        )
        if not metadata:
            empty_policy = _normalized_policy({})
            return Response(
                {
                    "available": False,
                    "month": selected_month,
                    "items": [],
                    "total": 0,
                    "offset": 0,
                    "limit": 0,
                    "summary": {
                        "people": 0,
                        "known": 0,
                        "unknown": 0,
                        "attendance_days": 0,
                        "sessions": 0,
                        "detections": 0,
                        "expected_payers": 0,
                        "expected_revenue": 0,
                        "payment_registered": 0,
                        "payment_missing": 0,
                    },
                    "revenue_policy": _policy_contract(empty_policy),
                }
            )

        query = _bounded_text(request.query_params.get("q"), 100).lower()
        kind = _bounded_text(request.query_params.get("kind") or "all", 10)
        if kind not in {"all", "known", "unknown"}:
            return Response(
                {"detail": "kind debe ser all, known o unknown."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        filtered = [
            item
            for item in items
            if (kind == "all" or item["subject_kind"] == kind)
            and (
                not query
                or query
                in " ".join(
                    [
                        item["name"],
                        item["group_name"],
                        item["team_name"],
                        item["subject_key"],
                    ]
                ).lower()
            )
        ]
        filtered.sort(
            key=lambda item: (
                -item["attendance_days"],
                item["name"].lower(),
            )
        )
        summary = {
            "people": len(filtered),
            "known": sum(
                item["subject_kind"] == "known" for item in filtered
            ),
            "unknown": sum(
                item["subject_kind"] == "unknown" for item in filtered
            ),
            "attendance_days": sum(
                item["attendance_days"] for item in filtered
            ),
            "sessions": sum(item["session_count"] for item in filtered),
            "detections": sum(item["detection_count"] for item in filtered),
            "expected_payers": sum(
                bool(item["expected_fee_eligible"]) for item in filtered
            ),
            "expected_revenue": round(
                sum(item["expected_monthly_amount"] for item in filtered),
                2,
            ),
            "payment_registered": sum(
                bool(item["payment_registered"]) for item in filtered
            ),
            "payment_missing": sum(
                bool(item["payment_applicable"])
                and not bool(item["payment_registered"])
                for item in filtered
            ),
        }
        offset = _bounded_int(
            request.query_params.get("offset", 0),
            maximum=max(len(filtered), 0),
        )
        limit = _bounded_int(
            request.query_params.get("limit", 48),
            minimum=1,
            maximum=100,
        )
        return Response(
            {
                "available": True,
                "month": selected_month,
                "items": filtered[offset : offset + limit],
                "total": len(filtered),
                "offset": offset,
                "limit": limit,
                "summary": summary,
                "revenue_policy": _policy_contract(policy),
                **metadata,
            }
        )
