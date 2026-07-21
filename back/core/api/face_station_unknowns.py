from __future__ import annotations

import base64
import binascii
import json
import tempfile
from pathlib import Path

from django.db import connection
from django.utils import timezone

from core.services.supabase_storage import upload_private_file

from .face_station_service import parse_event


UNKNOWN_FACE_BUCKET = "unknown-attendance-faces"


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
