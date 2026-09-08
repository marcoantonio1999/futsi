"""Confirmed, atomic removal of a tutor and the academy records under their care."""
from collections.abc import Mapping

from django.core import signing
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.models import Guardian, Student, AuditLog
from .student_deletion import deletion_plan, execute_plan, cleanup_files, DeletionChanged

SALT = "futsi.guardian-permanent-deletion.v1"


def validate_scope(plan, actor):
    if actor.role not in {"cashier", "site_coordinator"}:
        return
    if not actor.primary_site_id:
        raise PermissionDenied("Necesitas una sede asignada para eliminar tutores.")
    for group in plan["groups"]:
        for row in group["rows"]:
            site_id = getattr(row, "site_id", actor.primary_site_id)
            if site_id != actor.primary_site_id:
                raise PermissionDenied("Este tutor tiene alumnos o registros fuera de tu sede. Un administrador debe revisar su eliminación.")


def preview(guardian, actor):
    plan = deletion_plan(guardian=guardian)
    validate_scope(plan, actor)
    students = next(group["rows"] for group in plan["groups"] if group["model"] is Student)
    return {
        "guardian_id": guardian.pk, "full_name": guardian.full_name,
        "students": [{"id": row.pk, "full_name": row.full_name} for row in students],
        "items": [{"label": group["label"], "count": len(group["rows"])} for group in plan["groups"] if group["rows"]],
        "file_count": len(plan["files"]),
        "confirmation_token": signing.dumps({"guardian": guardian.pk, "actor": actor.pk, "fingerprint": plan["fingerprint"]}, salt=SALT),
    }


def permanently_delete(guardian, actor, payload):
    if not isinstance(payload, Mapping) or not isinstance(payload.get("confirmation_token"), str):
        raise ValidationError("Revisa los alumnos y datos asociados antes de confirmar.")
    try:
        confirmation = signing.loads(payload["confirmation_token"], salt=SALT, max_age=600)
    except signing.BadSignature as exc:
        raise ValidationError("Revisa otra vez la advertencia antes de confirmar.") from exc
    if confirmation.get("guardian") != guardian.pk or confirmation.get("actor") != actor.pk:
        raise ValidationError("La confirmación no corresponde a este tutor o usuario.")
    if str(payload.get("confirmation_name", "")).strip() != guardian.full_name:
        raise ValidationError("Escribe el nombre completo del tutor para confirmar.")
    with transaction.atomic():
        guardian = Guardian.objects.select_for_update().get(pk=guardian.pk)
        plan = deletion_plan(guardian=guardian, lock=True)
        validate_scope(plan, actor)
        if confirmation["fingerprint"] != plan["fingerprint"]:
            raise DeletionChanged("Los datos del tutor o sus alumnos cambiaron. Revisa el detalle antes de confirmar.")
        execute_plan(plan)
        audit = AuditLog.objects.create(
            actor=actor, action="guardian_deleted", table_name="guardians", record_id=str(guardian.pk),
            metadata={"site_id": actor.primary_site_id, "counts": {group["model"]._meta.db_table: len(group["rows"]) for group in plan["groups"]}, "pending_files": plan["files"]},
        )
    return cleanup_files(audit)
