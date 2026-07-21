from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

import numpy as np

from .store_schema import SCHEMA_SQL


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def embedding_blob(value: np.ndarray) -> bytes:
    normalized = np.asarray(value, dtype=np.float32)
    normalized /= max(float(np.linalg.norm(normalized)), 1e-12)
    return normalized.tobytes()


def blob_embedding(value: bytes | None) -> np.ndarray | None:
    if not value:
        return None
    result = np.frombuffer(value, dtype=np.float32).copy()
    if result.shape != (512,):
        return None
    return result / max(float(np.linalg.norm(result)), 1e-12)


class LocalStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "station.sqlite3"
        self.faces_dir = self.data_dir / "faces"
        self.references_dir = self.data_dir / "references"
        self.logs_dir = self.data_dir / "logs"
        for folder in (self.faces_dir, self.references_dir, self.logs_dir):
            folder.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self.initialize()

    @contextmanager
    def connection(self):
        with self._lock:
            connection = sqlite3.connect(self.db_path, timeout=30)
            connection.row_factory = sqlite3.Row
            connection.execute("pragma foreign_keys = on")
            try:
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

    def initialize(self) -> None:
        with self.connection() as db:
            db.executescript(SCHEMA_SQL)

    def replace_bootstrap(self, people: list[dict], sessions: list[dict]) -> None:
        now = utc_now()
        keys = [person["key"] for person in people]
        with self.connection() as db:
            db.execute("update people set active = 0")
            for person in people:
                db.execute(
                    """
                    insert into people
                        (person_key, person_type, remote_id, name, group_name, team_name, photo_url,
                         reference_version, active, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    on conflict(person_key) do update set
                        person_type=excluded.person_type, remote_id=excluded.remote_id, name=excluded.name,
                        group_name=excluded.group_name, team_name=excluded.team_name, photo_url=excluded.photo_url,
                        active=1, updated_at=excluded.updated_at,
                        reference_version=case
                            when people.reference_version = excluded.reference_version then people.reference_version
                            else excluded.reference_version
                        end,
                        embedding=case
                            when people.reference_version = excluded.reference_version then people.embedding
                            else null
                        end,
                        photo_path=case
                            when people.reference_version = excluded.reference_version then people.photo_path
                            else ''
                        end
                    """,
                    (
                        person["key"], person["type"], person["id"], person["name"],
                        person.get("group_name", ""), person.get("team_name", ""), person.get("photo_url", ""),
                        person.get("reference_version", ""), now,
                    ),
                )
            db.execute("delete from sessions")
            for session in sessions:
                db.execute(
                    """
                    insert into sessions
                        (remote_id, session_type, session_date, starts_at, ends_at, duration_minutes,
                         label, closed, roster_json, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session["id"], session["type"], session["date"], session.get("starts_at"),
                        session.get("ends_at"), session.get("duration_minutes", 120), session.get("label", "Sesion"),
                        int(bool(session.get("closed"))), json.dumps(session.get("roster", [])), now,
                    ),
                )

    def people_needing_embeddings(self) -> list[dict]:
        with self.connection() as db:
            return [dict(row) for row in db.execute("select * from people where active=1 and embedding is null order by name")]

    def save_person_embedding(self, person_key: str, photo_path: Path, embedding: np.ndarray) -> None:
        with self.connection() as db:
            db.execute(
                "update people set photo_path=?, embedding=?, updated_at=? where person_key=?",
                (str(photo_path), embedding_blob(embedding), utc_now(), person_key),
            )

    def known_database(self) -> tuple[list[dict], np.ndarray]:
        with self.connection() as db:
            rows = [dict(row) for row in db.execute("select * from people where active=1 and embedding is not null order by person_key")]
        embeddings = [blob_embedding(row.pop("embedding")) for row in rows]
        valid = [(row, embedding) for row, embedding in zip(rows, embeddings) if embedding is not None]
        if not valid:
            return [], np.empty((0, 512), dtype=np.float32)
        return [item[0] for item in valid], np.vstack([item[1] for item in valid]).astype(np.float32)

    def all_people(self) -> list[dict]:
        with self.connection() as db:
            rows = [dict(row) for row in db.execute("select * from people where active=1 order by name")]
        for row in rows:
            row.pop("embedding", None)
        return rows

    def get_person(self, person_key: str) -> dict | None:
        with self.connection() as db:
            row = db.execute("select * from people where active=1 and person_key=?", (person_key,)).fetchone()
        if not row:
            return None
        result = dict(row)
        result.pop("embedding", None)
        return result

    def find_session(self, person_key: str, occurred_at: datetime) -> int | None:
        local_date = occurred_at.astimezone().date().isoformat()
        with self.connection() as db:
            sessions = [dict(row) for row in db.execute("select * from sessions where session_date=? and closed=0", (local_date,))]
        candidates = []
        for session in sessions:
            roster = json.loads(session["roster_json"] or "[]")
            if person_key not in roster:
                continue
            if not session["starts_at"]:
                candidates.append((0, session["remote_id"]))
                continue
            start = datetime.combine(occurred_at.astimezone().date(), datetime_time.fromisoformat(session["starts_at"])).astimezone()
            duration = max(1, int(session["duration_minutes"] or 120))
            end = start + timedelta(minutes=duration)
            delta = abs((occurred_at.astimezone() - start).total_seconds())
            if start - timedelta(minutes=60) <= occurred_at.astimezone() <= end + timedelta(minutes=60):
                candidates.append((delta, session["remote_id"]))
        return min(candidates)[1] if candidates else None

    def upsert_presence(self, subject_key: str, kind: str, seen_at: datetime, similarity: float, crop_path: str = "") -> dict:
        day = seen_at.astimezone().date().isoformat()
        resolved_session = self.find_session(subject_key, seen_at) if kind == "known" else None
        session_id = resolved_session if resolved_session is not None else -1
        now = seen_at.isoformat()
        with self.connection() as db:
            db.execute(
                """
                insert into daily_presence
                    (subject_key, presence_date, subject_kind, first_seen_at, last_seen_at,
                     detection_count, best_similarity, best_crop_path, session_id)
                values (?, ?, ?, ?, ?, 1, ?, ?, ?)
                on conflict(subject_key, presence_date, session_id) do update set
                    last_seen_at=excluded.last_seen_at,
                    detection_count=daily_presence.detection_count + 1,
                    best_similarity=max(daily_presence.best_similarity, excluded.best_similarity),
                    best_crop_path=case when excluded.best_similarity >= daily_presence.best_similarity and excluded.best_crop_path <> ''
                                        then excluded.best_crop_path else daily_presence.best_crop_path end
                """,
                (subject_key, day, kind, now, now, similarity, crop_path, session_id),
            )
            row = db.execute(
                "select * from daily_presence where subject_key=? and presence_date=? and session_id=?",
                (subject_key, day, session_id),
            ).fetchone()
        return dict(row)

    def queue_event(self, event_id: str, event_type: str, payload: dict) -> None:
        now = utc_now()
        with self.connection() as db:
            db.execute(
                """
                insert into sync_queue(event_id, event_type, payload_json, next_attempt_at, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?)
                on conflict(event_id) do update set payload_json=excluded.payload_json,
                    status=case when sync_queue.status='done' then 'done' else 'pending' end,
                    updated_at=excluded.updated_at
                """,
                (event_id, event_type, json.dumps(payload), now, now, now),
            )

    def pending_queue(self, event_type: str | None = None, limit: int = 50) -> list[dict]:
        query = "select * from sync_queue where status='pending' and next_attempt_at <= ?"
        params: list[object] = [utc_now()]
        if event_type:
            query += " and event_type=?"
            params.append(event_type)
        query += " order by id limit ?"
        params.append(limit)
        with self.connection() as db:
            rows = [dict(row) for row in db.execute(query, params)]
        for row in rows:
            row["payload"] = json.loads(row.pop("payload_json"))
        return rows

    def mark_queue_done(self, event_ids: list[str]) -> None:
        if not event_ids:
            return
        with self.connection() as db:
            placeholders = ",".join("?" for _ in event_ids)
            rows = db.execute(
                f"select event_type,payload_json from sync_queue where event_id in ({placeholders})",
                event_ids,
            ).fetchall()
            for row in rows:
                if row["event_type"] != "known_event":
                    continue
                payload = json.loads(row["payload_json"])
                if payload.get("person_key") and payload.get("presence_date"):
                    db.execute(
                        "update daily_presence set synced=1 where subject_key=? and presence_date=? and session_id=?",
                        (payload["person_key"], payload["presence_date"], payload.get("session_id") or -1),
                    )
            db.executemany("update sync_queue set status='done', updated_at=? where event_id=?", [(utc_now(), item) for item in event_ids])

    def mark_queue_failed(self, event_id: str, error: str, retry_seconds: int) -> None:
        next_time = datetime.fromtimestamp(datetime.now().timestamp() + retry_seconds, timezone.utc).isoformat()
        with self.connection() as db:
            db.execute(
                "update sync_queue set attempts=attempts+1, next_attempt_at=?, last_error=?, updated_at=? where event_id=?",
                (next_time, error[:1000], utc_now(), event_id),
            )

    def unknown_database(self) -> tuple[list[dict], np.ndarray]:
        with self.connection() as db:
            rows = [dict(row) for row in db.execute("select * from unknown_subjects where status in ('candidate','consolidated','linked')")]
        embeddings = [blob_embedding(row.pop("centroid")) for row in rows]
        valid = [(row, embedding) for row, embedding in zip(rows, embeddings) if embedding is not None]
        if not valid:
            return [], np.empty((0, 512), dtype=np.float32)
        return [item[0] for item in valid], np.vstack([item[1] for item in valid]).astype(np.float32)

    def next_unknown_name(self) -> tuple[str, str]:
        for _ in range(100):
            number = int.from_bytes(__import__("secrets").token_bytes(2), "big") % 9000 + 1000
            name = f"Desconocido {number}"
            subject_id = str(uuid4())
            with self.connection() as db:
                if not db.execute("select 1 from unknown_subjects where temporary_name=?", (name,)).fetchone():
                    return subject_id, name
        return str(uuid4()), f"Desconocido {uuid4().hex[:4].upper()}"

    def create_unknown(self, embedding: np.ndarray, seen_at: datetime, crop_path: str, quality: float) -> dict:
        subject_id, name = self.next_unknown_name()
        with self.connection() as db:
            db.execute(
                """
                insert into unknown_subjects
                    (subject_id, temporary_name, centroid, best_crop_path, best_quality,
                     first_seen_at, last_seen_at, detection_count, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (subject_id, name, embedding_blob(embedding), crop_path, quality, seen_at.isoformat(), seen_at.isoformat(), utc_now()),
            )
        self.upsert_presence(subject_id, "unknown", seen_at, quality, crop_path)
        return self.get_unknown(subject_id)

    def update_unknown(self, subject_id: str, embedding: np.ndarray, seen_at: datetime, crop_path: str, quality: float, min_hits: int) -> dict:
        with self.connection() as db:
            row = db.execute("select centroid,detection_count,best_quality,status from unknown_subjects where subject_id=?", (subject_id,)).fetchone()
            if not row:
                raise LookupError(subject_id)
            previous = blob_embedding(row["centroid"])
            count = int(row["detection_count"] or 0)
            centroid = (previous * count + embedding) / max(count + 1, 1)
            centroid /= max(float(np.linalg.norm(centroid)), 1e-12)
            new_count = count + 1
            status = "consolidated" if row["status"] == "candidate" and new_count >= min_hits else row["status"]
            db.execute(
                """
                update unknown_subjects set centroid=?, last_seen_at=?, detection_count=?, status=?,
                    best_crop_path=case when ? >= best_quality and ? <> '' then ? else best_crop_path end,
                    best_quality=max(best_quality, ?), updated_at=? where subject_id=?
                """,
                (embedding_blob(centroid), seen_at.isoformat(), new_count, status, quality, crop_path, crop_path, quality, utc_now(), subject_id),
            )
        self.upsert_presence(subject_id, "unknown", seen_at, quality, crop_path)
        return self.get_unknown(subject_id)

    def get_unknown(self, subject_id: str) -> dict:
        with self.connection() as db:
            row = db.execute("select * from unknown_subjects where subject_id=?", (subject_id,)).fetchone()
        if not row:
            raise LookupError(subject_id)
        result = dict(row)
        result.pop("centroid", None)
        return result

    def link_unknown(self, subject_id: str, person_key: str, registration_payload: dict) -> None:
        with self.connection() as db:
            db.execute(
                "update unknown_subjects set status='linked', linked_person_key=?, updated_at=? where subject_id=?",
                (person_key, utc_now(), subject_id),
            )
        self.queue_event(f"unknown-register:{subject_id}", "unknown_register", registration_payload)

    def complete_unknown_link(self, subject_id: str, remote_subject_id: str | None) -> None:
        with self.connection() as db:
            db.execute(
                "update unknown_subjects set remote_subject_id=?, status='linked', updated_at=? where subject_id=?",
                (remote_subject_id, utc_now(), subject_id),
            )

    def sync_summary(self) -> dict:
        with self.connection() as db:
            pending = int(db.execute("select count(*) from sync_queue where status='pending'").fetchone()[0])
            failed = int(db.execute("select count(*) from sync_queue where status='pending' and attempts>0").fetchone()[0])
            done = int(db.execute("select count(*) from sync_queue where status='done'").fetchone()[0])
        return {"pending": pending, "retrying": failed, "done": done}

    def unknown_occurrences(self, subject_id: str) -> list[dict]:
        with self.connection() as db:
            return [dict(row) for row in db.execute(
                "select * from daily_presence where subject_key=? order by presence_date", (subject_id,)
            )]

    def dashboard(self, selected_date: str) -> dict:
        with self.connection() as db:
            presence = [dict(row) for row in db.execute(
                "select * from daily_presence where presence_date=? order by last_seen_at desc", (selected_date,)
            )]
            people = {row["person_key"]: dict(row) for row in db.execute("select * from people where active=1")}
            unknowns = {row["subject_id"]: dict(row) for row in db.execute("select * from unknown_subjects")}
            sessions = {row["remote_id"]: dict(row) for row in db.execute("select * from sessions")}
            pending = db.execute("select count(*) from sync_queue where status='pending'").fetchone()[0]
        for person in people.values():
            person.pop("embedding", None)
        known_results, unknown_results = [], []
        for item in presence:
            session = sessions.get(item["session_id"])
            item["session_label"] = session["label"] if session else "Sin sesion programada"
            if item["subject_kind"] == "known" and item["subject_key"] in people:
                known_results.append({**item, **people[item["subject_key"]]})
            elif item["subject_key"] in unknowns:
                unknown = unknowns[item["subject_key"]]
                unknown.pop("centroid", None)
                unknown_results.append({**unknown, **item})
        return {"date": selected_date, "known": known_results, "unknown": unknown_results, "people": list(people.values()), "pending_sync": pending}

    def image_path(self, kind: str, identifier: str) -> Path | None:
        with self.connection() as db:
            if kind == "person":
                row = db.execute("select photo_path from people where person_key=?", (identifier,)).fetchone()
            elif kind == "unknown":
                row = db.execute("select best_crop_path from unknown_subjects where subject_id=?", (identifier,)).fetchone()
            else:
                row = db.execute(
                    "select best_crop_path from daily_presence where subject_key=? order by last_seen_at desc limit 1",
                    (identifier,),
                ).fetchone()
        if not row or not row[0]:
            return None
        path = Path(row[0]).resolve()
        try:
            path.relative_to(self.data_dir.resolve())
        except ValueError:
            return None
        return path if path.exists() else None
