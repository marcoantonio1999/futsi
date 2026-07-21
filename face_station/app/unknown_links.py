from __future__ import annotations

from datetime import datetime
from uuid import NAMESPACE_URL, uuid5


def link_unknown_subject(runtime, subject_id: str, person_key: str) -> dict:
    subject = runtime.store.get_unknown(subject_id)
    if subject["status"] not in {"candidate", "consolidated", "linked"}:
        raise ValueError("El rostro desconocido ya no se puede vincular.")
    person = runtime.store.get_person(person_key)
    if not person:
        raise ValueError("La persona seleccionada no existe en el padron local.")
    occurrences = runtime.store.unknown_occurrences(subject_id)
    if not occurrences:
        raise ValueError("El desconocido no tiene apariciones guardadas.")

    events = []
    for occurrence in occurrences:
        occurred_at = datetime.fromisoformat(occurrence["first_seen_at"])
        session_id = runtime.store.find_session(person_key, occurred_at)
        event_id = str(
            uuid5(
                NAMESPACE_URL,
                (
                    f"futsi:{runtime.station_id or 'local'}:unknown:{subject_id}:"
                    f"{occurrence['presence_date']}:{session_id or -1}"
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
                "metadata": {"linked_from_unknown": True},
            }
        )
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
