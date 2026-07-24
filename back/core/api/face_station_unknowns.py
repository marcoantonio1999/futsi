from __future__ import annotations

import base64
import binascii
import json
import tempfile
from pathlib import Path
from uuid import uuid4

from django.db import connection
from django.utils import timezone

from core.models import FaceStationUnknownLink, Guardian, Student, User, UserRole
from core.services.supabase_storage import upload_private_file

from .face_station_service import parse_event


UNKNOWN_FACE_BUCKET = "unknown-attendance-faces"
STUDENT_PHOTO_BUCKET = "student-private-photos"
COLLABORATOR_PHOTO_BUCKET = "adult-private-photos"


def decode_face_crop(image_data: str) -> Path | None:
    if not image_data:
        return None
    _, _, encoded = image_data.partition(",")
    try:
        payload = base64.b64decode(encoded or image_data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("best_crop no contiene una imagen base64 valida.") from exc
    if len(payload) > 3 * 1024 * 1024:
        raise ValueError("El recorte facial excede 3 MB.")
    handle = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    handle.write(payload)
    handle.close()
    return Path(handle.name)


def table_exists(table_name: str) -> bool:
    return table_name in connection.introspection.table_names()


def register_linked_unknown(device, payload: dict, person, events: list[dict]) -> dict:
    if not table_exists("unknown_attendance_subjects"):
        return {"subject_id": None, "storage_warning": "La tabla de desconocidos no existe en esta base."}
    crop_path = decode_face_crop(str(payload.get("best_crop", "")))
    face_uri = ""
    storage_warning = ""
    if crop_path:
        object_path = f"face-stations/{device.site.code}/{device.public_id}/{payload.get('local_subject_id')}.jpg"
        try:
            face_uri = upload_private_file(UNKNOWN_FACE_BUCKET, object_path, crop_path)
        except Exception as exc:
            storage_warning = str(exc)
        finally:
            crop_path.unlink(missing_ok=True)

    first_seen = min((parse_event(item)["occurred_at"] for item in events), default=timezone.now())
    last_seen = max((parse_event(item)["occurred_at"] for item in events), default=first_seen)
    metadata = {
        "source": "face_station",
        "local_subject_id": str(payload.get("local_subject_id", "")),
        "registered_at": timezone.now().isoformat(),
        "face_crop_uri": face_uri,
    }
    if payload.get("person_type") == "collaborator":
        metadata["matched_collaborator_id"] = int(person.id)
    student_id = person.id if payload.get("person_type") == "student" else None
    player_id = person.id if payload.get("person_type") == "player" else None
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into public.unknown_attendance_subjects
                (camera_id, site_id, status, first_seen_at, last_seen_at, capture_count,
                 matched_person_type, matched_student_id, matched_player_id, notes, metadata, created_at, updated_at)
            values (%s, %s, 'identified', %s, %s, %s, %s, %s, %s, %s, %s::jsonb, now(), now())
            returning id, temporary_name
            """,
            [
                device.camera_id,
                device.site_id,
                first_seen,
                last_seen,
                sum(max(1, int(item.get("detection_count", 1))) for item in events),
                payload.get("person_type"),
                student_id,
                player_id,
                f"Vinculado desde {device.name}.",
                json.dumps(metadata),
            ],
        )
        subject_id, temporary_name = cursor.fetchone()
    return {
        "subject_id": str(subject_id),
        "temporary_name": temporary_name,
        "face_uri": face_uri,
        "storage_warning": storage_warning,
    }


def create_station_student(
    device,
    payload: dict,
    events: list[dict],
) -> tuple[Student, FaceStationUnknownLink]:
    full_name = " ".join(str(payload.get("full_name") or "").split())
    local_subject_id = str(payload.get("local_subject_id") or "").strip()[:80]
    if len(full_name) < 3:
        raise ValueError("Captura el nombre completo del alumno.")
    if len(full_name) > 160:
        raise ValueError("El nombre completo no puede exceder 160 caracteres.")
    if not local_subject_id:
        raise ValueError("local_subject_id es obligatorio.")

    crop_path = decode_face_crop(str(payload.get("best_crop") or ""))
    if not crop_path:
        raise ValueError("Selecciona un recorte para usarlo como foto del alumno.")
    object_path = (
        f"students/{device.site_id}/face-station/{device.public_id}/"
        f"{local_subject_id}.jpg"
    )
    try:
        photo_uri = upload_private_file(
            STUDENT_PHOTO_BUCKET,
            object_path,
            crop_path,
            upsert=True,
        )
    finally:
        crop_path.unlink(missing_ok=True)

    guardian = Guardian.objects.create(
        full_name=f"Datos de tutor pendientes - {full_name}"[:160],
        phone="PENDIENTE",
        notes=(
            f"Registro provisional creado por {device.name} desde Face Station. "
            "Completar los datos del tutor."
        ),
    )
    student = Student.objects.create(
        site=device.site,
        guardian=guardian,
        full_name=full_name,
        group_name="",
        category="",
        status="trial",
        photo_url=photo_uri,
    )
    registration = register_linked_unknown(
        device,
        {**payload, "person_type": "student"},
        student,
        events,
    )
    link = FaceStationUnknownLink.objects.create(
        device=device,
        local_subject_id=local_subject_id,
        person_type="student",
        student=student,
        remote_subject_id=registration.get("subject_id") or None,
        evidence_uri=photo_uri,
        metadata={
            "created_from_face_station": True,
            "storage_warning": registration.get("storage_warning", ""),
        },
    )
    return student, link


def create_station_collaborator(
    device,
    payload: dict,
    events: list[dict],
) -> tuple[User, FaceStationUnknownLink]:
    full_name = " ".join(str(payload.get("full_name") or "").split())
    local_subject_id = str(payload.get("local_subject_id") or "").strip()[:80]
    if len(full_name) < 3:
        raise ValueError("Captura el nombre completo del colaborador.")
    if len(full_name) > 150:
        raise ValueError("El nombre completo no puede exceder 150 caracteres.")
    if not local_subject_id:
        raise ValueError("local_subject_id es obligatorio.")

    crop_path = decode_face_crop(str(payload.get("best_crop") or ""))
    if not crop_path:
        raise ValueError("Selecciona un recorte para usarlo como foto del colaborador.")
    object_path = (
        f"collaborators/{device.site_id}/face-station/{device.public_id}/"
        f"{local_subject_id}.jpg"
    )
    try:
        photo_uri = upload_private_file(
            COLLABORATOR_PHOTO_BUCKET,
            object_path,
            crop_path,
            upsert=True,
        )
    finally:
        crop_path.unlink(missing_ok=True)

    first_name, _, last_name = full_name.partition(" ")
    collaborator = User.objects.create_user(
        username=f"faceguard-{device.site_id}-{uuid4().hex[:16]}",
        password=None,
        first_name=first_name,
        last_name=last_name,
        role=UserRole.COLLABORATOR,
        primary_site=device.site,
        avatar_url=photo_uri,
        is_active=True,
    )
    registration = register_linked_unknown(
        device,
        {**payload, "person_type": "collaborator"},
        collaborator,
        events,
    )
    link = FaceStationUnknownLink.objects.create(
        device=device,
        local_subject_id=local_subject_id,
        person_type="collaborator",
        collaborator=collaborator,
        remote_subject_id=registration.get("subject_id") or None,
        evidence_uri=photo_uri,
        metadata={
            "created_from_face_station": True,
            "storage_warning": registration.get("storage_warning", ""),
        },
    )
    return collaborator, link
