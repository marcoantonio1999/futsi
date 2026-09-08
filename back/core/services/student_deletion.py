"""Reviewable, explicit deletion of academy records and their owned files."""
import hashlib
import json
from collections.abc import Mapping

from django.apps import apps
from django.core import signing
from django.db import models, transaction
from django.db.models import Q
from rest_framework.exceptions import APIException, ValidationError

from core.models import (
    Guardian, Student, StudentTournamentRegistration, Charge, Payment, Discount, Invoice,
    AttendanceRecord, StudentAssessment, StudentValueAssessment, FaceRecognitionAttempt,
    FaceStationEvent, FaceStationUnknownLink, FaceStationDailyPresence,
    FaceStationDailyReport, HistoricalImportRow, AuditLog,
)
from .supabase_storage import parse_storage_uri, delete_private_file

SALT = "futsi.student-permanent-deletion.v1"


class DeletionChanged(APIException):
    status_code = 409
    default_detail = "Los datos del alumno cambiaron. Revisa de nuevo lo que se eliminará antes de confirmar."


def deletion_plan(student=None, *, lock=False, guardian=None):
    groups = []
    if guardian is not None:
        students = Student.objects.filter(guardian=guardian).order_by("pk")
        students = list(students.select_for_update() if lock else students)
    else:
        students = [student]
    student_ids = [row.pk for row in students]

    def add(model, label, condition):
        queryset = model.objects.filter(condition).order_by("pk")
        if lock:
            queryset = queryset.select_for_update()
        rows = list(queryset)
        groups.append({"model": model, "label": label, "rows": rows})
        return [row.pk for row in rows]

    subject = Q(student_id__in=student_ids)
    registrations = add(StudentTournamentRegistration, "Inscripciones a torneos", subject)
    charges = add(Charge, "Cargos", subject | Q(tournament_registration_id__in=registrations))
    payments = add(Payment, "Pagos", subject | Q(charge_id__in=charges))
    add(Discount, "Descuentos", subject | Q(charge_id__in=charges))
    invoice_filter = subject | Q(charge_id__in=charges) | Q(payment_id__in=payments)
    if guardian is not None:
        invoice_filter |= Q(guardian=guardian)
    add(Invoice, "Facturas", invoice_filter)
    add(AttendanceRecord, "Asistencias", subject)
    add(StudentAssessment, "Evaluaciones deportivas", subject)
    add(StudentValueAssessment, "Evaluaciones de valores", subject)
    add(FaceRecognitionAttempt, "Reconocimientos faciales", subject)
    add(FaceStationEvent, "Eventos de FaceGuard", subject)
    add(FaceStationUnknownLink, "Vínculos de FaceGuard", subject)
    keys = [f"student:{pk}" for pk in student_ids]
    add(FaceStationDailyPresence, "Registros de presencia diaria", Q(canonical_person_key__in=keys) | Q(subject_key__in=keys))
    groups.append({"model": Student, "label": "Alumnos a su cargo" if guardian is not None else "Ficha del alumno", "rows": students})
    if guardian is not None:
        groups.append({"model": Guardian, "label": "Ficha del tutor", "rows": [guardian]})
    history_filter = Q(pk__in=[])
    for group in groups:
        history_filter |= Q(target_table=group["model"]._meta.db_table, target_id__in=[str(row.pk) for row in group["rows"]])
    add(HistoricalImportRow, "Filas de importaciones vinculadas", history_filter)

    owned_files = collect_owned_files(groups)

    fingerprint = hashlib.sha256(json.dumps({
        "records": [[group["model"]._meta.label, [[row.pk, {field.attname: getattr(row, field.attname) for field in row._meta.fields}] for row in group["rows"]]] for group in groups],
        "files": owned_files,
    }, sort_keys=True, default=str).encode()).hexdigest()
    return {"groups": groups, "files": owned_files, "fingerprint": fingerprint}


def collect_owned_files(groups):
    deleted_ids = {group["model"]: [row.pk for row in group["rows"]] for group in groups}
    files = []
    for group in groups:
        for row in group["rows"]:
            for field in row._meta.fields:
                if not isinstance(field, models.FileField) and field.name not in {"photo_url", "waiver_url", "evidence_uri"}:
                    continue
                value = getattr(row, field.name)
                if isinstance(field, models.FileField) and value:
                    files.append({"kind": "field", "model": row._meta.label, "field": field.name, "name": value.name})
                elif field.name in {"photo_url", "waiver_url", "evidence_uri"} and isinstance(value, str) and parse_storage_uri(value):
                    files.append({"kind": "supabase", "uri": value})
    unique_files = {json.dumps(item, sort_keys=True): item for item in files}.values()
    owned_files = []
    for item in unique_files:
        shared = False
        # Never delete a file still referenced by another student or record.
        for model in apps.get_app_config("core").get_models():
            for field in model._meta.fields:
                eligible = isinstance(field, models.FileField) if item["kind"] == "field" else field.name in {"photo_url", "waiver_url", "evidence_uri", "avatar_url"}
                if eligible and model.objects.exclude(pk__in=deleted_ids.get(model, [])).filter(**{field.name: item.get("name", item.get("uri"))}).exists():
                    shared = True
                    break
            if shared:
                break
        if not shared:
            owned_files.append(item)

    return owned_files


def preview(student, actor):
    plan = deletion_plan(student)
    return {
        "student_id": student.pk, "full_name": student.full_name,
        "items": [{"label": group["label"], "count": len(group["rows"])} for group in plan["groups"] if group["rows"]],
        "file_count": len(plan["files"]),
        "confirmation_token": signing.dumps({"student": student.pk, "actor": actor.pk, "fingerprint": plan["fingerprint"]}, salt=SALT),
    }


def cleanup_files(audit):
    """Keep failures durable so retry never has to recreate a deleted student."""
    pending = []
    for item in audit.metadata.get("pending_files", []):
        try:
            if item["kind"] == "supabase":
                delete_private_file(*parse_storage_uri(item["uri"]))
            else:
                model = apps.get_model(item["model"])
                model._meta.get_field(item["field"]).storage.delete(item["name"])
        except Exception:
            pending.append(item)
    audit.metadata = {**audit.metadata, "pending_files": pending}
    audit.save(update_fields=["metadata", "updated_at"])
    return {"deletion_id": audit.pk, "cleanup_pending": len(pending)}


def permanently_delete(student, actor, payload):
    if not isinstance(payload, Mapping) or not isinstance(payload.get("confirmation_token"), str):
        raise ValidationError("Revisa la advertencia de eliminación antes de confirmar.")
    try:
        confirmation = signing.loads(payload.get("confirmation_token", ""), salt=SALT, max_age=600)
    except signing.BadSignature as exc:
        raise ValidationError("Revisa la advertencia de eliminación y vuelve a confirmar.") from exc
    if confirmation.get("student") != student.pk or confirmation.get("actor") != actor.pk:
        raise ValidationError("La confirmación no corresponde a este alumno o usuario.")
    if str(payload.get("confirmation_name", "")).strip() != student.full_name:
        raise ValidationError("Escribe el nombre completo del alumno para confirmar la eliminación definitiva.")
    with transaction.atomic():
        # Lock the parent before its dependents so new FK-linked records cannot
        # appear between the final review and deletion on PostgreSQL.
        student = Student.objects.select_for_update().get(pk=student.pk)
        plan = deletion_plan(student, lock=True)
        if confirmation["fingerprint"] != plan["fingerprint"]:
            raise DeletionChanged()
        execute_plan(plan)
        audit = AuditLog.objects.create(
            actor=actor, action="student_deleted", table_name="students", record_id=str(student.pk),
            metadata={"site_id": student.site_id, "counts": {group["model"]._meta.db_table: len(group["rows"]) for group in plan["groups"]}, "pending_files": plan["files"]},
        )
    return cleanup_files(audit)


def execute_plan(plan):
    """Caller must hold the parent locks and an atomic transaction."""
    by_model = {group["model"]: group for group in plan["groups"]}
    report_ids = {row.report_id for row in by_model[FaceStationDailyPresence]["rows"]}
    reports = list(FaceStationDailyReport.objects.select_for_update().filter(pk__in=report_ids).order_by("pk"))
    order = [HistoricalImportRow, Invoice, Discount, Payment, Charge, StudentTournamentRegistration,
             AttendanceRecord, StudentAssessment, StudentValueAssessment, FaceRecognitionAttempt,
             FaceStationEvent, FaceStationUnknownLink, FaceStationDailyPresence, Student, Guardian]
    for model in order:
        ids = [row.pk for row in by_model.get(model, {"rows": []})["rows"]]
        AuditLog.objects.filter(table_name=model._meta.db_table, record_id__in=[str(pk) for pk in ids]).delete()
        model.objects.filter(pk__in=ids).delete()
    for report in reports:
        report.row_count = report.presences.count()
        report.save(update_fields=["row_count", "updated_at"])
