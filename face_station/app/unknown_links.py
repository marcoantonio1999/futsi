from __future__ import annotations

import base64
from datetime import datetime
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from .futsi_client import FutsiClient


def unknown_link_events(runtime, subject_id: str, person_key: str = "") -> tuple[dict, list[dict]]:
    subject = runtime.store.get_unknown(subject_id)
    subject_id = subject["subject_id"]
    occurrences = runtime.store.unknown_occurrences(subject_id)
    if not occurrences:
        raise ValueError("El desconocido no tiene apariciones guardadas.")

    events = []
    for occurrence in occurrences:
        occurred_at = datetime.fromisoformat(occurrence["first_seen_at"])
        session_id = runtime.store.find_session(person_key, occurred_at) if person_key else None
        presence_key = f"{occurrence['presence_date']}:{occurrence['session_id']}"
        event_id = str(
            uuid5(
                NAMESPACE_URL,
                (
                    f"futsi:{runtime.station_id or 'local'}:unknown:{subject_id}:"
                    f"{occurrence['presence_date']}:{occurrence['session_id']}"
                ),
            )
        )
        events.append(
            {
                "event_id": event_id,
                "occurred_at": occurrence["first_seen_at"],
                "session_id": session_id,
                "detection_count": occurrence["detection_count"],
                "similarity": occurrence["best_similarity"],
                "metadata": {
                    "linked_from_unknown": True,
                    "presence_key": presence_key,
                },
            }
        )
    return subject, events


def link_unknown_subject(runtime, subject_id: str, person_key: str) -> dict:
    subject, events = unknown_link_events(runtime, subject_id, person_key)
    subject_id = subject["subject_id"]
    if subject["status"] not in {"candidate", "consolidated", "linked"}:
        raise ValueError("El rostro desconocido ya no se puede vincular.")
    person = runtime.store.get_person(person_key)
    if not person:
        raise ValueError("La persona seleccionada no existe en el padron local.")
    payload = {
        "local_subject_id": subject_id,
        "person_type": person["person_type"],
        "person_id": person["remote_id"],
        "person_key": person_key,
        "best_crop_path": subject.get("best_crop_path", ""),
        "events": events,
    }
    runtime.store.link_unknown(subject_id, person_key, payload)
    runtime.reload_unknown_database()
    return {"linked": True, "subject": runtime.store.get_unknown(subject_id), "person": person}


def _create_person_from_unknown(
    runtime,
    subject_id: str,
    full_name: str,
    crop_id: int,
    person_type: str,
) -> dict:
    if person_type not in {"student", "collaborator"}:
        raise ValueError("El tipo de persona no es valido.")
    person_label = "alumno" if person_type == "student" else "colaborador"
    normalized_name = " ".join(str(full_name or "").split())
    if len(normalized_name) < 3:
        raise ValueError(f"Captura el nombre completo del {person_label}.")
    if len(normalized_name) > 160:
        raise ValueError("El nombre completo no puede exceder 160 caracteres.")
    config = runtime.config_manager.config
    if not config.station_token:
        raise ValueError("La estacion no tiene un token para registrar personas.")

    subject, events = unknown_link_events(runtime, subject_id)
    if subject["status"] not in {"candidate", "consolidated"}:
        raise ValueError("El rostro desconocido ya fue vinculado.")
    crop = runtime.store.unknown_registration_crop(subject["subject_id"], crop_id)
    embedding = crop.get("embedding")
    if embedding is None:
        if runtime._engine is None:
            raise ValueError("El motor facial debe estar activo para preparar la referencia.")
        embedding = runtime._engine.embedding_from_reference(Path(crop["crop_path"]))

    encoded = base64.b64encode(Path(crop["crop_path"]).read_bytes()).decode("ascii")
    client = FutsiClient(
        config.api_url,
        config.station_token,
        config.reference_proxy_url,
    )
    payload = {
        "local_subject_id": subject["subject_id"],
        "full_name": normalized_name,
        "best_crop": f"data:image/jpeg;base64,{encoded}",
        "events": events,
    }
    response = (
        client.create_student_from_unknown(payload)
        if person_type == "student"
        else client.create_collaborator_from_unknown(payload)
    )
    person = response.get("person")
    if not isinstance(person, dict) or not person.get("key"):
        raise RuntimeError(f"La academia no devolvio el {person_label} registrado.")

    event_to_presence = {
        event["event_id"]: str(event.get("metadata", {}).get("presence_key") or "")
        for event in events
    }
    session_by_presence = {}
    for result in response.get("events", []):
        presence_key = event_to_presence.get(str(result.get("event_id") or ""), "")
        if presence_key:
            session_by_presence[presence_key] = int(result.get("session_id") or -1)
    local_person = runtime.store.register_person_from_unknown(
        subject["subject_id"],
        crop_id,
        person,
        embedding,
        response.get("remote_subject_id"),
        session_by_presence,
        expected_person_type=person_type,
    )
    runtime.reload_unknown_database()
    return {
        "created": bool(response.get("created")),
        "duplicate": bool(response.get("duplicate")),
        "person": local_person,
        "selected_crop_id": int(crop_id),
        "events": response.get("events", []),
    }


def create_student_from_unknown(
    runtime,
    subject_id: str,
    full_name: str,
    crop_id: int,
) -> dict:
    return _create_person_from_unknown(
        runtime,
        subject_id,
        full_name,
        crop_id,
        "student",
    )


def create_collaborator_from_unknown(
    runtime,
    subject_id: str,
    full_name: str,
    crop_id: int,
) -> dict:
    return _create_person_from_unknown(
        runtime,
        subject_id,
        full_name,
        crop_id,
        "collaborator",
    )
