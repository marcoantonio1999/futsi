from __future__ import annotations

import base64
import binascii
import json
import os
import sqlite3
import time
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from threading import Lock, RLock, Thread
from uuid import NAMESPACE_URL, uuid4, uuid5

import numpy as np

from .daily_evidence import select_daily_evidence
from .store_schema import SCHEMA_SQL
from .time_utils import BUSINESS_TIME_ZONE, business_time
from .unknown_gallery import (
    UNKNOWN_COHERENCE_THRESHOLD,
    UNKNOWN_DUPLICATE_THRESHOLD,
    UNKNOWN_REFERENCE_LIMIT,
    robust_reference_centroid,
    select_retained_reference_indices,
)

UNKNOWN_INACTIVE_STATUSES = frozenset({"ignored", "quarantined"})
MONTHLY_REVENUE_MIN_DAYS = 3
MONTHLY_REGISTERED_REVENUE_MIN_DAYS = 1
MATCH_ANALYSIS_VERSION = "match-window-v8-scheduled-rolling-window"
MATCH_WINDOW_MINUTES = 50
MATCH_MIN_UNIQUE_PEOPLE = 10
MATCH_SCHEDULE_TOLERANCE_MINUTES = 15
RETENTION_DELETE_BATCH_SIZE = 5_000

# Los equipos cambian cada jornada, pero estos bloques se repiten cada semana.
# El indice usa datetime.date.weekday(): lunes=0, domingo=6.
MATCH_WEEKLY_SCHEDULE = {
    0: (
        ("20:00", 50, "Femenil"),
        ("20:50", 50, "Femenil"),
        ("21:40", 50, "Femenil"),
        ("22:30", 50, "Nocturno"),
    ),
    1: (
        ("20:00", 50, "Premier"),
        ("20:50", 50, "Premier"),
        ("21:40", 50, "Femenil"),
        ("22:30", 50, "Nocturno"),
    ),
    2: (
        ("20:00", 50, "Premier"),
        ("20:50", 50, "Premier"),
        ("21:40", 50, "Nocturno"),
        ("22:30", 50, "Nocturno"),
    ),
    3: (
        ("20:00", 50, "Premier"),
        ("20:50", 50, "Premier"),
        ("21:40", 50, "Nocturno"),
        ("22:30", 50, "Nocturno"),
    ),
    4: (
        ("19:40", 50, "Brasileña"),
        ("20:30", 50, "Brasileña"),
        ("21:20", 50, "Brasileña"),
        ("22:10", 50, "Brasileña"),
        ("23:00", 50, "Brasileña"),
    ),
    5: (
        ("08:00", 60, "Renta"),
        ("09:00", 50, "Española"),
        ("09:50", 50, "Española"),
        ("10:40", 50, "Española"),
        ("11:30", 50, "Española"),
        ("12:20", 50, "Española"),
        ("13:10", 50, "Española"),
        ("14:00", 60, "Horario disponible"),
        ("15:00", 50, "Europa"),
        ("15:50", 50, "Europa"),
        ("16:40", 50, "Europa"),
        ("17:30", 50, "Europa"),
        ("18:20", 50, "Europa"),
        ("19:10", 50, "Europa"),
        ("20:00", 50, "Europa"),
        ("20:50", 50, "Europa"),
        ("21:40", 50, "Europa"),
    ),
    6: (
        ("08:00", 60, "Renta"),
        ("09:00", 60, "Renta"),
        ("10:00", 60, "Renta"),
        ("11:00", 60, "Renta"),
        ("12:00", 60, "Renta"),
        ("13:00", 60, "Renta"),
        ("14:00", 60, "Horario disponible"),
        ("15:00", 50, "UEFA"),
        ("15:50", 50, "UEFA"),
        ("16:40", 50, "UEFA"),
        ("17:30", 50, "UEFA"),
        ("18:20", 50, "UEFA"),
        ("19:10", 50, "UEFA"),
        ("20:00", 50, "UEFA"),
        ("20:50", 50, "UEFA"),
        ("21:40", 50, "UEFA"),
    ),
}


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
        self.spool_dir = self.data_dir / "crop-spool"
        self.references_dir = self.data_dir / "references"
        self.logs_dir = self.data_dir / "logs"
        for folder in (self.faces_dir, self.spool_dir, self.references_dir, self.logs_dir):
            folder.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        # Raw crop ingestion has its own serialized writer. Keeping it out of
        # ``_lock`` lets SQLite WAL accept captures while a long report keeps
        # the general store lock (and a read snapshot) open.
        self._ingest_lock = Lock()
        self._match_analysis_guard = Lock()
        self._match_analysis_state_lock = RLock()
        self._match_analysis_state = {
            "running": False,
            "force": False,
            "started_at": "",
            "finished_at": "",
            "current_date": "",
            "processed_days": 0,
            "total_days": 0,
            "last_error": "",
        }
        self.initialize()

    @contextmanager
    def connection(self, *, immediate: bool = False):
        with self._lock:
            connection = sqlite3.connect(self.db_path, timeout=30)
            connection.row_factory = sqlite3.Row
            connection.execute("pragma foreign_keys = on")
            connection.execute("pragma busy_timeout = 30000")
            connection.execute("pragma synchronous = normal")
            try:
                if immediate:
                    connection.execute("begin immediate")
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
            self._ensure_column(db, "people", "reference_available", "integer not null default 0")
            db.execute(
                """
                update people set reference_available=1
                where embedding is not null
                   or reference_version like '%:supabase://%'
                   or reference_version like '%:/media/%'
                   or reference_version like '%:media/%'
                """
            )
            self._ensure_column(db, "unknown_subjects", "quality_hits", "integer not null default 0")
            self._ensure_column(db, "unknown_subjects", "quality_version", "text not null default ''")
            self._ensure_column(db, "unknown_subjects", "quality_json", "text not null default '{}'")
            self._ensure_column(db, "unknown_subjects", "merged_into", "text")
            self._ensure_column(db, "face_crops", "embedding", "blob")
            self._ensure_column(db, "face_crops", "analysis_version", "text not null default ''")
            self._ensure_column(db, "face_crops", "quality_pass", "integer not null default 0")
            self._ensure_column(db, "face_crops", "quality_json", "text not null default '{}'")
            self._ensure_column(
                db,
                "face_crops",
                "evidence_selected",
                "integer not null default 1",
            )
            self._ensure_column(
                db,
                "face_crops",
                "evidence_reason",
                "text not null default 'uncurated'",
            )
            self._ensure_column(
                db,
                "face_crops",
                "evidence_score",
                "real not null default 0",
            )
            self._ensure_column(
                db,
                "face_crops",
                "evidence_curated_at",
                "text not null default ''",
            )
            self._ensure_column(
                db,
                "evidence_retention_runs",
                "quarantine_path",
                "text not null default ''",
            )
            self._ensure_column(
                db,
                "evidence_retention_runs",
                "purge_after",
                "text not null default ''",
            )
            self._ensure_column(
                db,
                "evidence_retention_runs",
                "error",
                "text not null default ''",
            )
            for column, definition in (
                ("scheduled_count", "integer not null default 0"),
                ("scheduled_confirmed_count", "integer not null default 0"),
                ("unscheduled_count", "integer not null default 0"),
                ("source_schedule_count", "integer not null default 0"),
            ):
                self._ensure_column(
                    db,
                    "match_analysis_days",
                    column,
                    definition,
                )
            for column, definition in (
                ("window_type", "text not null default 'unscheduled'"),
                (
                    "window_status",
                    "text not null default 'outside_schedule'",
                ),
                ("schedule_id", "integer"),
                ("tournament", "text not null default ''"),
                ("home_team", "text not null default ''"),
                ("away_team", "text not null default ''"),
                ("scheduled_starts_at", "text not null default ''"),
                ("scheduled_ends_at", "text not null default ''"),
                ("evidence_starts_at", "text not null default ''"),
                ("evidence_ends_at", "text not null default ''"),
                ("tolerance_minutes", "integer not null default 0"),
            ):
                self._ensure_column(
                    db,
                    "match_analysis_windows",
                    column,
                    definition,
                )
            db.execute(
                """
                create index if not exists ix_face_crops_evidence_day
                on face_crops(
                    substr(seen_at,1,10),evidence_selected,
                    subject_kind,subject_key,id
                )
                """
            )
            db.execute(
                """
                create index if not exists ix_match_analysis_windows_type
                on match_analysis_windows(window_type,analysis_date)
                """
            )
            self._initialize_known_references(db)
            self._seed_unknown_name_counter(db)
            self._initialize_crop_processing_stats(db)
        self._recover_incomplete_retention_runs()

    def runtime_state(self, key: str, default: str = "") -> str:
        with self.connection() as db:
            row = db.execute(
                "select state_value from runtime_state where state_key=?",
                (str(key),),
            ).fetchone()
        return str(row["state_value"]) if row else default

    def set_runtime_state(self, key: str, value: str) -> None:
        with self.connection() as db:
            db.execute(
                """
                insert into runtime_state(state_key,state_value,updated_at)
                values (?,?,?)
                on conflict(state_key) do update set
                    state_value=excluded.state_value,
                    updated_at=excluded.updated_at
                """,
                (str(key), str(value), utc_now()),
            )

    def attendance_report_dates(self) -> list[str]:
        with self.connection() as db:
            return [
                str(row["presence_date"])
                for row in db.execute(
                    """
                    select presence_date
                    from (
                        select distinct presence_date
                        from daily_presence
                        where length(presence_date)=10
                        union
                        select substr(
                            state_key,
                            length('daily_report_sync:') + 1
                        ) as presence_date
                        from runtime_state
                        where state_key like 'daily_report_sync:%'
                    )
                    where length(presence_date)=10
                    order by presence_date
                    """
                )
            ]

    def daily_attendance_report(self, report_date: str) -> list[dict]:
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    """
                    select presence.subject_kind,
                           presence.subject_key,
                           case
                               when presence.subject_kind='known'
                               then presence.subject_key
                               else coalesce(unknown_subject.linked_person_key,'')
                           end as canonical_person_key,
                           case
                               when presence.subject_kind='known'
                               then coalesce(person.name,presence.subject_key)
                               when unknown_subject.linked_person_key is not null
                               then coalesce(linked_person.name,unknown_subject.temporary_name,presence.subject_key)
                               else coalesce(unknown_subject.temporary_name,presence.subject_key)
                           end as name,
                           coalesce(person.person_type,linked_person.person_type,'unknown') as person_type,
                           coalesce(person.group_name,linked_person.group_name,'') as group_name,
                           coalesce(person.team_name,linked_person.team_name,'') as team_name,
                           coalesce(
                               unknown_subject.status,
                               case when presence.subject_kind='known' then 'known' else '' end
                           ) as status,
                           count(*) as session_count,
                           sum(presence.detection_count) as detection_count,
                           min(presence.first_seen_at) as first_seen_at,
                           max(presence.last_seen_at) as last_seen_at,
                           max(presence.best_similarity) as best_similarity,
                           (
                               select count(*)
                               from face_crops crop
                               where crop.subject_kind=presence.subject_kind
                                 and crop.subject_key=presence.subject_key
                                 and substr(crop.seen_at,1,10)=?
                                 and crop.evidence_selected=1
                                 and crop.quality_pass=1
                                 and crop.evidence_reason<>'manual_rejected'
                           ) as evidence_count
                    from daily_presence presence
                    left join people person
                      on presence.subject_kind='known'
                     and person.person_key=presence.subject_key
                    left join unknown_subjects unknown_subject
                      on presence.subject_kind='unknown'
                     and unknown_subject.subject_id=presence.subject_key
                    left join people linked_person
                      on linked_person.person_key=unknown_subject.linked_person_key
                    where presence.presence_date=?
                      and (
                          presence.subject_kind<>'unknown'
                          or coalesce(unknown_subject.status,'') not in ('ignored','quarantined')
                      )
                    group by presence.subject_kind,presence.subject_key
                    order by presence.subject_kind,presence.subject_key
                    """,
                    (str(report_date), str(report_date)),
                )
            ]
        return rows

    @staticmethod
    def _ensure_column(db: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {row[1] for row in db.execute(f"pragma table_info({table})")}
        if column not in columns:
            db.execute(f"alter table {table} add column {column} {definition}")

    @staticmethod
    def _authorized_file_path(
        candidate: str | Path | None,
        *authorized_roots: Path,
    ) -> Path | None:
        """Resolve a stored path only when it belongs to an explicit data root.

        Resolving both sides is important on Windows: ``faces`` may be a
        junction whose physical target lives on another drive.  Comparing it
        only with ``data_dir`` would reject valid crops, while accepting any
        existing database path would allow an arbitrary local file to be
        served.
        """
        if not candidate:
            return None
        try:
            resolved_path = Path(str(candidate)).resolve()
        except (OSError, RuntimeError, ValueError):
            return None
        for root in authorized_roots:
            try:
                resolved_path.relative_to(Path(root).resolve())
            except (OSError, RuntimeError, ValueError):
                continue
            try:
                return resolved_path if resolved_path.is_file() else None
            except OSError:
                return None
        return None

    @staticmethod
    def _seed_unknown_name_counter(db: sqlite3.Connection) -> None:
        highest_numeric_suffix = 9999
        for row in db.execute(
            """
            select temporary_name from unknown_subjects
            where temporary_name like 'Desconocido %'
            """
        ):
            suffix = str(row["temporary_name"]).removeprefix("Desconocido ").strip()
            if suffix.isdigit():
                highest_numeric_suffix = max(highest_numeric_suffix, int(suffix))
        next_value = highest_numeric_suffix + 1
        db.execute(
            """
            insert into local_counters(counter_key,next_value)
            values ('unknown_name',?)
            on conflict(counter_key) do update set
                next_value=max(local_counters.next_value,excluded.next_value)
            """,
            (next_value,),
        )

    @staticmethod
    def _initialize_crop_processing_stats(db: sqlite3.Connection) -> None:
        # Existing installations predate the aggregate table. Backfill once;
        # after that the schema triggers keep this summary transactionally in
        # sync with every queue insert, status transition, and delete.
        if db.execute("select 1 from crop_processing_stats limit 1").fetchone():
            return
        db.execute(
            """
            insert into crop_processing_stats(capture_date,status,item_count,file_bytes)
            select substr(captured_at,1,10),status,count(*),coalesce(sum(max(file_bytes,0)),0)
            from crop_processing_queue
            group by substr(captured_at,1,10),status
            """
        )

    @staticmethod
    def _initialize_known_references(db: sqlite3.Connection) -> None:
        """Backfill one authoritative anchor for installations predating galleries."""
        now = utc_now()
        db.execute(
            """
            insert into known_references
                (person_key,crop_path,embedding,quality,captured_at,quality_json,
                 source,pinned,created_at)
            select person_key,
                   case
                       when trim(photo_path)<>'' then photo_path
                       else 'registered://' || person_key
                   end,
                   embedding,
                   0.55,
                   updated_at,
                   '{"accepted":true,"source":"registered_backfill"}',
                   'registered',
                   1,
                   ?
            from people
            where active=1
              and reference_available=1
              and embedding is not null
              and not exists (
                  select 1 from known_references reference
                  where reference.person_key=people.person_key
                    and reference.pinned=1
              )
            """,
            (now,),
        )

    def replace_bootstrap(
        self,
        people: list[dict],
        sessions: list[dict],
        monthly_payments: list[dict] | None = None,
    ) -> None:
        now = utc_now()
        keys = [person["key"] for person in people]
        with self.connection() as db:
            db.execute("update people set active = 0")
            for person in people:
                reference_version = str(person.get("reference_version", "") or "")
                reference_available = self._reference_is_available(person, reference_version)
                photo_url = str(person.get("photo_url", "") or "") if reference_available else ""
                previous = db.execute(
                    """
                    select reference_version,reference_available
                    from people where person_key=?
                    """,
                    (person["key"],),
                ).fetchone()
                invalidate_gallery = bool(
                    previous
                    and (
                        str(previous["reference_version"] or "") != reference_version
                        or not reference_available
                    )
                )
                db.execute(
                    """
                    insert into people
                        (person_key, person_type, remote_id, name, group_name, team_name, photo_url,
                         reference_version, reference_available, active, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    on conflict(person_key) do update set
                        person_type=excluded.person_type, remote_id=excluded.remote_id, name=excluded.name,
                        group_name=excluded.group_name, team_name=excluded.team_name, photo_url=excluded.photo_url,
                        reference_available=excluded.reference_available,
                        active=1, updated_at=excluded.updated_at,
                        reference_version=case
                            when people.reference_version = excluded.reference_version then people.reference_version
                            else excluded.reference_version
                        end,
                        embedding=case
                            when people.reference_version = excluded.reference_version
                                 and excluded.reference_available=1 then people.embedding
                            else null
                        end,
                        photo_path=case
                            when people.reference_version = excluded.reference_version
                                 and excluded.reference_available=1 then people.photo_path
                            else ''
                        end
                    """,
                    (
                        person["key"], person["type"], person["id"], person["name"],
                        person.get("group_name", ""), person.get("team_name", ""), photo_url,
                        reference_version, int(reference_available), now,
                    ),
                )
                if invalidate_gallery:
                    db.execute(
                        "delete from known_references where person_key=?",
                        (person["key"],),
                    )
            db.execute("delete from monthly_payments")
            for payment in monthly_payments or []:
                person_key_value = str(payment.get("person_key") or "")
                payment_month = str(payment.get("month") or "")
                if person_key_value not in keys or len(payment_month) != 7:
                    continue
                db.execute(
                    """
                    insert into monthly_payments
                        (person_key,payment_month,payment_count,amount,
                         last_paid_at,updated_at)
                    values (?,?,?,?,?,?)
                    on conflict(person_key,payment_month) do update set
                        payment_count=excluded.payment_count,
                        amount=excluded.amount,
                        last_paid_at=excluded.last_paid_at,
                        updated_at=excluded.updated_at
                    """,
                    (
                        person_key_value,
                        payment_month,
                        max(0, int(payment.get("payment_count") or 0)),
                        max(0.0, float(payment.get("amount") or 0.0)),
                        str(payment.get("last_paid_at") or ""),
                        now,
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

    @staticmethod
    def _reference_is_available(person: dict, reference_version: str = "") -> bool:
        if "reference_available" in person:
            return bool(person.get("reference_available"))
        version = reference_version or str(person.get("reference_version", "") or "")
        return any(marker in version for marker in (":supabase://", ":/media/", ":media/"))

    def people_needing_embeddings(self) -> list[dict]:
        with self.connection() as db:
            return [
                dict(row)
                for row in db.execute(
                    """
                    select * from people
                    where active=1 and reference_available=1 and embedding is null
                    order by name
                    """
                )
            ]

    def reference_summary(self) -> dict[str, int]:
        with self.connection() as db:
            row = db.execute(
                """
                select count(*) as total,
                       sum(case when reference_available=1 then 1 else 0 end) as configured,
                       sum(case when embedding is not null then 1 else 0 end) as ready,
                       sum(case when reference_available=1 and embedding is null then 1 else 0 end) as pending,
                       sum(case when reference_available=0 then 1 else 0 end) as missing
                from people where active=1
                """
            ).fetchone()
        return {
            "total": int(row["total"] or 0),
            "configured": int(row["configured"] or 0),
            "ready": int(row["ready"] or 0),
            "pending": int(row["pending"] or 0),
            "missing": int(row["missing"] or 0),
        }

    def save_person_embedding(self, person_key: str, photo_path: Path, embedding: np.ndarray) -> None:
        captured_at = datetime.now(timezone.utc)
        normalized_photo_path = str(photo_path)
        with self.connection() as db:
            registered_paths = {
                str(row["crop_path"])
                for row in db.execute(
                    """
                    select crop_path from known_references
                    where person_key=? and pinned=1
                    """,
                    (person_key,),
                )
            }
            if registered_paths and normalized_photo_path not in registered_paths:
                # A changed authoritative portrait starts a fresh adaptive
                # gallery; old observations may belong to a corrected record.
                db.execute(
                    "delete from known_references where person_key=?",
                    (person_key,),
                )
            db.execute(
                "update people set photo_path=?, embedding=?, reference_available=1, updated_at=? where person_key=?",
                (
                    normalized_photo_path,
                    embedding_blob(embedding),
                    utc_now(),
                    person_key,
                ),
            )
            db.execute(
                """
                delete from known_references
                where person_key=? and source='registered' and crop_path<>?
                """,
                (person_key, normalized_photo_path),
            )
            self._save_known_reference(
                db,
                person_key,
                normalized_photo_path,
                embedding,
                0.55,
                captured_at,
                {
                    "accepted": True,
                    "source": "registered",
                },
                source="registered",
                pinned=True,
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

    def identity_catalog(
        self,
        *,
        query: str = "",
        status: str = "all",
        offset: int = 0,
        limit: int = 48,
    ) -> dict:
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    """
                    select person_key,person_type,remote_id,name,group_name,team_name,photo_url,
                           photo_path,reference_version,embedding is not null as embedding_ready
                    from people where active=1 order by name,person_key
                    """
                )
            ]
            unknown_counts = {
                row["status"]: int(row["count"])
                for row in db.execute(
                    "select status,count(*) as count from unknown_subjects group by status"
                )
            }
        groups: dict[str, dict] = {}
        for row in rows:
            reference_version = str(row.get("reference_version") or "")
            marker = ":supabase://"
            identity_key = (
                f"supabase://{reference_version.split(marker, 1)[1]}"
                if marker in reference_version
                else str(row["person_key"])
            )
            ready = bool(row.get("embedding_ready") and row.get("photo_path") and Path(row["photo_path"]).is_file())
            group = groups.setdefault(
                identity_key,
                {
                    "identity_key": identity_key,
                    "person_key": row["person_key"],
                    "name": row["name"],
                    "person_type": row["person_type"],
                    "group_name": row.get("group_name") or "",
                    "team_name": row.get("team_name") or "",
                    "reference_ready": ready,
                    "registration_count": 0,
                    "registrations": [],
                },
            )
            group["registration_count"] += 1
            group["reference_ready"] = bool(group["reference_ready"] or ready)
            if ready:
                group["person_key"] = row["person_key"]
            group["registrations"].append(
                {
                    "person_key": row["person_key"],
                    "person_type": row["person_type"],
                    "remote_id": row["remote_id"],
                    "group_name": row.get("group_name") or "",
                    "team_name": row.get("team_name") or "",
                }
            )
        identities = list(groups.values())
        normalized_query = query.casefold().strip()
        if normalized_query:
            identities = [
                row
                for row in identities
                if normalized_query
                in " ".join(
                    [row["name"], row["group_name"], row["team_name"]]
                ).casefold()
            ]
        if status == "ready":
            identities = [row for row in identities if row["reference_ready"]]
        elif status == "missing":
            identities = [row for row in identities if not row["reference_ready"]]
        elif status == "duplicates":
            identities = [row for row in identities if row["registration_count"] > 1]
        identities.sort(key=lambda row: (not row["reference_ready"], row["name"].casefold()))
        total_filtered = len(identities)
        page = identities[max(0, offset):max(0, offset) + max(1, min(limit, 100))]
        all_identities = list(groups.values())
        return {
            "items": page,
            "offset": max(0, offset),
            "limit": max(1, min(limit, 100)),
            "total": total_filtered,
            "summary": {
                "records": len(rows),
                "identities": len(all_identities),
                "ready": sum(1 for row in all_identities if row["reference_ready"]),
                "missing": sum(1 for row in all_identities if not row["reference_ready"]),
                "duplicates": sum(1 for row in all_identities if row["registration_count"] > 1),
                "unknown_total": sum(unknown_counts.values()),
                "unknown_review": (
                    unknown_counts.get("candidate", 0)
                    + unknown_counts.get("consolidated", 0)
                ),
                "unknown_candidate": unknown_counts.get("candidate", 0),
                "unknown_consolidated": unknown_counts.get("consolidated", 0),
                "unknown_linked": unknown_counts.get("linked", 0),
                "unknown_ignored": unknown_counts.get("ignored", 0),
                "unknown_quarantined": unknown_counts.get("quarantined", 0),
                "unknown_archived": unknown_counts.get("archived", 0),
            },
        }

    def unknown_catalog(
        self,
        *,
        query: str = "",
        status: str = "review",
        offset: int = 0,
        limit: int = 48,
        snapshot: int | None = None,
    ) -> dict:
        allowed_statuses = {
            "all",
            "review",
            "candidate",
            "consolidated",
            "linked",
            "ignored",
            "quarantined",
            "archived",
        }
        normalized_status = str(status or "review").strip().lower()
        if normalized_status not in allowed_statuses:
            raise ValueError("Estado de desconocido no valido.")
        normalized_query = str(query or "").strip().lower()
        safe_offset = max(0, int(offset))
        safe_limit = max(1, min(int(limit), 100))

        filters: list[str] = []
        params: list[object] = []
        if normalized_status == "review":
            filters.append("unknown_subject.status in ('candidate','consolidated')")
        elif normalized_status != "all":
            filters.append("unknown_subject.status=?")
            params.append(normalized_status)
        if normalized_query:
            search = f"%{normalized_query}%"
            filters.append(
                """
                (
                    lower(unknown_subject.temporary_name) like ?
                    or lower(unknown_subject.subject_id) like ?
                    or lower(coalesce(linked_person.name,'')) like ?
                    or lower(coalesce(merged_subject.temporary_name,'')) like ?
                )
                """
            )
            params.extend([search, search, search, search])
        with self.connection() as db:
            current_snapshot = int(
                db.execute(
                    "select coalesce(max(rowid),0) from unknown_subjects"
                ).fetchone()[0]
                or 0
            )
            safe_snapshot = (
                current_snapshot
                if snapshot is None
                else min(max(0, int(snapshot)), current_snapshot)
            )
            filters.append("unknown_subject.rowid<=?")
            params.append(safe_snapshot)
            where = " and ".join(filters)
            unknown_counts = {
                row["status"]: int(row["count"])
                for row in db.execute(
                    "select status,count(*) as count from unknown_subjects group by status"
                )
            }
            total = int(
                db.execute(
                    f"""
                    select count(*)
                    from unknown_subjects unknown_subject
                    left join people linked_person
                      on linked_person.person_key=unknown_subject.linked_person_key
                    left join unknown_subjects merged_subject
                      on merged_subject.subject_id=unknown_subject.merged_into
                    where {where}
                    """,
                    params,
                ).fetchone()[0]
            )
            rows = [
                dict(row)
                for row in db.execute(
                    f"""
                    with selected as (
                        select unknown_subject.subject_id,
                               unknown_subject.temporary_name,
                               unknown_subject.status,
                               unknown_subject.best_crop_path,
                               unknown_subject.best_quality,
                               unknown_subject.first_seen_at,
                               unknown_subject.last_seen_at,
                               unknown_subject.detection_count,
                               unknown_subject.quality_hits,
                               unknown_subject.quality_json,
                               unknown_subject.linked_person_key,
                               unknown_subject.merged_into,
                               unknown_subject.updated_at,
                               coalesce(linked_person.name,'') as linked_person_name,
                               coalesce(merged_subject.temporary_name,'') as merged_into_name
                        from unknown_subjects unknown_subject
                        left join people linked_person
                          on linked_person.person_key=unknown_subject.linked_person_key
                        left join unknown_subjects merged_subject
                          on merged_subject.subject_id=unknown_subject.merged_into
                        where {where}
                        order by unknown_subject.rowid desc
                        limit ? offset ?
                    )
                    select selected.*,
                           (
                               select crop.crop_path
                               from face_crops crop
                               where crop.subject_kind='unknown'
                                 and crop.subject_key=selected.subject_id
                                 and crop.evidence_reason<>'manual_rejected'
                               order by crop.seen_at desc,crop.id desc
                               limit 1
                           ) as fallback_crop_path,
                           (
                               select crop.quality
                               from face_crops crop
                               where crop.subject_kind='unknown'
                                 and crop.subject_key=selected.subject_id
                                 and crop.evidence_reason<>'manual_rejected'
                               order by crop.seen_at desc,crop.id desc
                               limit 1
                           ) as fallback_crop_quality,
                           (
                               select crop.crop_path
                               from face_crops crop
                               where crop.subject_kind='unknown'
                                 and crop.subject_key=selected.subject_id
                               order by crop.seen_at desc,crop.id desc
                               limit 1
                           ) as any_crop_path,
                           (
                               select crop.quality
                               from face_crops crop
                               where crop.subject_kind='unknown'
                                 and crop.subject_key=selected.subject_id
                               order by crop.seen_at desc,crop.id desc
                               limit 1
                           ) as any_crop_quality,
                           (
                               select count(*)
                               from face_crops crop
                               where crop.subject_kind='unknown'
                                 and crop.subject_key=selected.subject_id
                           ) as crop_count,
                           (
                               select count(*)
                               from face_crops crop
                               where crop.subject_kind='unknown'
                                 and crop.subject_key=selected.subject_id
                                 and crop.quality_pass=1
                                 and crop.evidence_reason<>'manual_rejected'
                           ) as valid_crop_count
                    from selected
                    """,
                    (*params, safe_limit, safe_offset),
                )
            ]

        for row in rows:
            image_available = False
            thumbnail_quality = 0.0
            path_candidates = (
                (
                    str(row.pop("best_crop_path", "") or ""),
                    float(row.get("best_quality") or 0.0),
                ),
                (
                    str(row.pop("fallback_crop_path", "") or ""),
                    float(row.pop("fallback_crop_quality", 0.0) or 0.0),
                ),
                (
                    str(row.pop("any_crop_path", "") or ""),
                    float(row.pop("any_crop_quality", 0.0) or 0.0),
                ),
            )
            for thumbnail_path, candidate_quality in path_candidates:
                if not thumbnail_path:
                    continue
                if self._authorized_file_path(thumbnail_path, self.faces_dir):
                    image_available = True
                    thumbnail_quality = candidate_quality
                    break
            try:
                quality_payload = json.loads(str(row.pop("quality_json", "{}") or "{}"))
            except (TypeError, ValueError, json.JSONDecodeError):
                quality_payload = {}
            if not isinstance(quality_payload, dict):
                quality_payload = {}
            reasons = quality_payload.get("reasons")
            row["image_available"] = image_available
            row["quality_score"] = (
                thumbnail_quality
                if image_available
                else max(
                    float(row.get("best_quality") or 0.0),
                    float(quality_payload.get("score") or 0.0),
                )
            )
            row["quality_reasons"] = [
                str(reason)
                for reason in (reasons if isinstance(reasons, list) else [])
                if str(reason).strip()
            ][:4]
            row["yaw"] = float(quality_payload.get("yaw") or 0.0)
            row["pitch"] = float(quality_payload.get("pitch") or 0.0)
            row["roll"] = float(quality_payload.get("roll") or 0.0)
            row["sharpness"] = float(quality_payload.get("sharpness") or 0.0)

        total_unknowns = sum(unknown_counts.values())
        return {
            "items": rows,
            "total": total,
            "offset": safe_offset,
            "limit": safe_limit,
            "snapshot": safe_snapshot,
            "status": normalized_status,
            "summary": {
                "total": total_unknowns,
                "review": (
                    unknown_counts.get("candidate", 0)
                    + unknown_counts.get("consolidated", 0)
                ),
                "candidate": unknown_counts.get("candidate", 0),
                "consolidated": unknown_counts.get("consolidated", 0),
                "linked": unknown_counts.get("linked", 0),
                "ignored": unknown_counts.get("ignored", 0),
                "quarantined": unknown_counts.get("quarantined", 0),
                "archived": unknown_counts.get("archived", 0),
            },
        }

    def unknown_catalog_image_path(self, subject_id: str) -> Path | None:
        requested_id = str(subject_id or "").strip()
        if not requested_id:
            return None
        with self.connection() as db:
            row = db.execute(
                """
                select unknown_subject.best_crop_path,
                    (
                        select crop.crop_path
                        from face_crops crop
                        where crop.subject_kind='unknown'
                          and crop.subject_key=unknown_subject.subject_id
                          and crop.evidence_reason<>'manual_rejected'
                        order by crop.seen_at desc,crop.id desc
                        limit 1
                    ) as fallback_crop_path,
                    (
                        select crop.crop_path
                        from face_crops crop
                        where crop.subject_kind='unknown'
                          and crop.subject_key=unknown_subject.subject_id
                        order by crop.seen_at desc,crop.id desc
                        limit 1
                    ) as any_crop_path
                from unknown_subjects unknown_subject
                where unknown_subject.subject_id=?
                """,
                (requested_id,),
            ).fetchone()
        if not row:
            return None
        for candidate in (
            row["best_crop_path"],
            row["fallback_crop_path"],
            row["any_crop_path"],
        ):
            path = self._authorized_file_path(candidate, self.faces_dir)
            if path:
                return path
        return None

    def get_person(self, person_key: str) -> dict | None:
        with self.connection() as db:
            row = db.execute("select * from people where active=1 and person_key=?", (person_key,)).fetchone()
        if not row:
            return None
        result = dict(row)
        result.pop("embedding", None)
        return result

    def find_session(self, person_key: str, occurred_at: datetime) -> int | None:
        with self.connection() as db:
            return self._find_session(db, person_key, occurred_at)

    @staticmethod
    def _find_session(
        db: sqlite3.Connection,
        person_key: str,
        occurred_at: datetime,
    ) -> int | None:
        local_occurred = business_time(occurred_at)
        local_date = local_occurred.date().isoformat()
        sessions = [
            dict(row)
            for row in db.execute(
                "select * from sessions where session_date=? and closed=0",
                (local_date,),
            )
        ]
        candidates = []
        for session in sessions:
            roster = json.loads(session["roster_json"] or "[]")
            if person_key not in roster:
                continue
            if not session["starts_at"]:
                candidates.append((0, session["remote_id"]))
                continue
            start = datetime.combine(
                local_occurred.date(),
                datetime_time.fromisoformat(session["starts_at"]),
                tzinfo=BUSINESS_TIME_ZONE,
            )
            duration = max(1, int(session["duration_minutes"] or 120))
            end = start + timedelta(minutes=duration)
            delta = abs((local_occurred - start).total_seconds())
            if start - timedelta(minutes=60) <= local_occurred <= end + timedelta(minutes=60):
                candidates.append((delta, session["remote_id"]))
        return min(candidates)[1] if candidates else None

    def upsert_presence(
        self,
        subject_key: str,
        kind: str,
        seen_at: datetime,
        similarity: float,
        crop_path: str = "",
        detection_increment: int = 1,
        first_seen_at: datetime | None = None,
    ) -> dict:
        with self.connection() as db:
            return self._upsert_presence(
                db,
                subject_key,
                kind,
                seen_at,
                similarity,
                crop_path,
                detection_increment=detection_increment,
                first_seen_at=first_seen_at,
            )

    @classmethod
    def _upsert_presence(
        cls,
        db: sqlite3.Connection,
        subject_key: str,
        kind: str,
        seen_at: datetime,
        similarity: float,
        crop_path: str = "",
        detection_increment: int = 1,
        first_seen_at: datetime | None = None,
    ) -> dict:
        day = business_time(seen_at).date().isoformat()
        resolved_session = cls._find_session(db, subject_key, seen_at) if kind == "known" else None
        session_id = resolved_session if resolved_session is not None else -1
        first_seen = (first_seen_at or seen_at).isoformat()
        last_seen = seen_at.isoformat()
        increment = max(1, int(detection_increment))
        db.execute(
            """
            insert into daily_presence
                (subject_key, presence_date, subject_kind, first_seen_at, last_seen_at,
                 detection_count, best_similarity, best_crop_path, session_id)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(subject_key, presence_date, session_id) do update set
                last_seen_at=excluded.last_seen_at,
                detection_count=daily_presence.detection_count + excluded.detection_count,
                best_similarity=max(daily_presence.best_similarity, excluded.best_similarity),
                best_crop_path=case when excluded.best_similarity >= daily_presence.best_similarity and excluded.best_crop_path <> ''
                                    then excluded.best_crop_path else daily_presence.best_crop_path end
            """,
            (subject_key, day, kind, first_seen, last_seen, increment, similarity, crop_path, session_id),
        )
        row = db.execute(
            "select * from daily_presence where subject_key=? and presence_date=? and session_id=?",
            (subject_key, day, session_id),
        ).fetchone()
        return dict(row)

    def queue_event(self, event_id: str, event_type: str, payload: dict) -> None:
        with self.connection() as db:
            self._queue_event(db, event_id, event_type, payload)

    @staticmethod
    def _queue_event(
        db: sqlite3.Connection,
        event_id: str,
        event_type: str,
        payload: dict,
    ) -> None:
        now = utc_now()
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

    def enqueue_crop_for_processing(
        self,
        *,
        captured_at: datetime,
        camera_key: str,
        camera_label: str,
        crop_path: str,
        file_bytes: int,
        crop_width: int,
        crop_height: int,
        det_score: float,
        bbox: tuple[int, int, int, int],
        landmarks: np.ndarray | None,
    ) -> dict:
        rows = self.enqueue_crops_for_processing(
            [
                {
                    "captured_at": captured_at,
                    "camera_key": camera_key,
                    "camera_label": camera_label,
                    "crop_path": crop_path,
                    "file_bytes": file_bytes,
                    "crop_width": crop_width,
                    "crop_height": crop_height,
                    "det_score": det_score,
                    "bbox": bbox,
                    "landmarks": landmarks,
                }
            ]
        )
        return rows[0]

    def enqueue_crops_for_processing(self, items: list[dict]) -> list[dict]:
        """Atomically enqueue raw crops through the dedicated WAL writer.

        Every item accepts the same fields as ``enqueue_crop_for_processing``.
        The complete batch commits once; an invalid or duplicate item rolls
        back the rows and their aggregate-stat triggers together.
        """
        if not items:
            return []

        created_at = utc_now()
        values = []
        for item in items:
            captured_at = item["captured_at"]
            points = (
                np.asarray(item.get("landmarks"), dtype=np.float32).tolist()
                if item.get("landmarks") is not None
                else []
            )
            values.append(
                (
                    captured_at.isoformat(),
                    item["camera_key"],
                    item["camera_label"],
                    item["crop_path"],
                    max(0, int(item["file_bytes"])),
                    max(0, int(item["crop_width"])),
                    max(0, int(item["crop_height"])),
                    float(item["det_score"]),
                    json.dumps(list(item["bbox"])),
                    json.dumps(points),
                    created_at,
                    created_at,
                )
            )

        with self._ingest_lock:
            db = sqlite3.connect(self.db_path, timeout=30)
            db.row_factory = sqlite3.Row
            db.execute("pragma foreign_keys = on")
            db.execute("pragma busy_timeout = 30000")
            db.execute("pragma synchronous = normal")
            journal_mode = str(
                db.execute("pragma journal_mode").fetchone()[0]
            ).lower()
            if journal_mode != "wal":
                db.close()
                raise RuntimeError(
                    "La cola de recortes requiere SQLite en modo WAL."
                )
            try:
                db.execute("begin immediate")
                inserted_ids = []
                for row_values in values:
                    cursor = db.execute(
                        """
                        insert into crop_processing_queue
                            (captured_at,camera_key,camera_label,crop_path,file_bytes,
                             crop_width,crop_height,det_score,bbox_json,landmarks_json,
                             status,created_at,updated_at)
                        values (?,?,?,?,?,?,?,?,?,?,'pending',?,?)
                        """,
                        row_values,
                    )
                    inserted_ids.append(int(cursor.lastrowid))
                rows = [
                    dict(
                        db.execute(
                            "select * from crop_processing_queue where id=?",
                            (row_id,),
                        ).fetchone()
                    )
                    for row_id in inserted_ids
                ]
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        return [self._public_crop_queue_row(row) for row in rows]

    @staticmethod
    def _public_crop_queue_row(row: dict) -> dict:
        row.pop("crop_path", None)
        row.pop("bbox_json", None)
        row.pop("landmarks_json", None)
        return row

    def crop_queue_summary(self, selected_date: str | None = None) -> dict:
        selected_date = selected_date or datetime.now(
            BUSINESS_TIME_ZONE
        ).date().isoformat()
        with self.connection() as db:
            row = db.execute(
                """
                select coalesce(sum(item_count),0) as captured,
                       coalesce(sum(case when status='pending' then item_count else 0 end),0) as pending,
                       coalesce(sum(case when status='processing' then item_count else 0 end),0) as processing,
                       coalesce(sum(case when status='processed' then item_count else 0 end),0) as processed,
                       coalesce(sum(case when status='discarded' then item_count else 0 end),0) as discarded,
                       coalesce(sum(case when status='error' then item_count else 0 end),0) as failed,
                       coalesce(sum(case when status in ('pending','processing','error') then file_bytes else 0 end),0) as active_bytes,
                       coalesce(sum(file_bytes),0) as captured_bytes
                from crop_processing_stats
                where capture_date=?
                """,
                (selected_date,),
            ).fetchone()
            oldest = db.execute(
                """
                select min(captured_at) as captured_at from crop_processing_queue
                where status in ('pending','processing','error')
                """
            ).fetchone()
        return {
            "date": selected_date,
            "captured": int(row["captured"] or 0),
            "pending": int(row["pending"] or 0),
            "processing": int(row["processing"] or 0),
            "processed": int(row["processed"] or 0),
            "discarded": int(row["discarded"] or 0),
            "failed": int(row["failed"] or 0),
            "active_bytes": int(row["active_bytes"] or 0),
            "captured_bytes": int(row["captured_bytes"] or 0),
            "oldest_at": str(oldest["captured_at"]) if oldest and oldest["captured_at"] else "",
        }

    def crop_queue_total_summary(self) -> dict:
        today = datetime.now(BUSINESS_TIME_ZONE).date().isoformat()
        with self.connection() as db:
            row = db.execute(
                """
                select coalesce(sum(item_count),0) as captured,
                       coalesce(sum(case when status='pending' then item_count else 0 end),0) as pending,
                       coalesce(sum(case when status='processing' then item_count else 0 end),0) as processing,
                       coalesce(sum(case when status='processed' then item_count else 0 end),0) as processed,
                       coalesce(sum(case when status='discarded' then item_count else 0 end),0) as discarded,
                       coalesce(sum(case when status='error' then item_count else 0 end),0) as failed,
                       coalesce(sum(case when status in ('pending','processing','error') then file_bytes else 0 end),0) as active_bytes,
                       coalesce(sum(file_bytes),0) as captured_bytes
                from crop_processing_stats
                """
            ).fetchone()
            oldest = db.execute(
                """
                select min(captured_at) as captured_at from crop_processing_queue
                where status in ('pending','processing','error')
                """
            ).fetchone()
        return {
            "date": today,
            "captured": int(row["captured"] or 0),
            "pending": int(row["pending"] or 0),
            "processing": int(row["processing"] or 0),
            "processed": int(row["processed"] or 0),
            "discarded": int(row["discarded"] or 0),
            "failed": int(row["failed"] or 0),
            "active_bytes": int(row["active_bytes"] or 0),
            "captured_bytes": int(row["captured_bytes"] or 0),
            "oldest_at": str(oldest["captured_at"]) if oldest and oldest["captured_at"] else "",
        }

    def crop_queue(
        self,
        *,
        selected_date: str | None = None,
        status: str = "active",
        offset: int = 0,
        limit: int = 48,
    ) -> dict:
        if status not in {"active", "pending", "processing", "error", "all"}:
            raise ValueError("Estado de cola no valido.")
        selected_date = selected_date or datetime.now(
            BUSINESS_TIME_ZONE
        ).date().isoformat()
        clauses = ["substr(captured_at,1,10)=?"]
        params: list[object] = [selected_date]
        if status == "active":
            clauses.append("status in ('pending','processing','error')")
        elif status != "all":
            clauses.append("status=?")
            params.append(status)
        where = " and ".join(clauses)
        safe_offset = max(0, int(offset))
        safe_limit = max(1, min(int(limit), 100))
        with self.connection() as db:
            total = int(
                db.execute(
                    f"select count(*) from crop_processing_queue where {where}",
                    params,
                ).fetchone()[0]
            )
            rows = [
                self._public_crop_queue_row(dict(row))
                for row in db.execute(
                    f"""
                    select * from crop_processing_queue
                    where {where}
                    order by captured_at desc,id desc
                    limit ? offset ?
                    """,
                    (*params, safe_limit, safe_offset),
                )
            ]
        return {
            "date": selected_date,
            "items": rows,
            "total": total,
            "offset": safe_offset,
            "limit": safe_limit,
            "summary": self.crop_queue_summary(selected_date),
        }

    @staticmethod
    def _processing_crop_row(row: sqlite3.Row | dict) -> dict:
        result = dict(row)
        result["bbox"] = json.loads(result.pop("bbox_json") or "[]")
        result["landmarks"] = json.loads(result.pop("landmarks_json") or "[]")
        return result

    def pending_crop_batch(self, limit: int) -> list[dict]:
        safe_limit = max(1, min(int(limit), 64))
        with self.connection() as db:
            rows = db.execute(
                """
                select * from crop_processing_queue
                where status='pending'
                order by captured_at,id
                limit ?
                """,
                (safe_limit,),
            ).fetchall()
        return [self._processing_crop_row(row) for row in rows]

    def claim_pending_crop(self, crop_id: int | None = None) -> dict | None:
        with self.connection(immediate=True) as db:
            if crop_id is None:
                row = db.execute(
                    """
                    select * from crop_processing_queue
                    where status='pending'
                    order by captured_at,id limit 1
                    """
                ).fetchone()
            else:
                row = db.execute(
                    """
                    select * from crop_processing_queue
                    where id=? and status='pending'
                    """,
                    (int(crop_id),),
                ).fetchone()
            if not row:
                return None
            updated_at = utc_now()
            cursor = db.execute(
                """
                update crop_processing_queue
                set status='processing',last_error='',updated_at=?
                where id=? and status='pending'
                """,
                (updated_at, row["id"]),
            )
            if cursor.rowcount != 1:
                return None
            result = dict(row)
            result["status"] = "processing"
            result["updated_at"] = updated_at
        return self._processing_crop_row(result)

    def finish_crop_processing(
        self,
        crop_id: int,
        *,
        status: str,
        result_kind: str = "",
        result_key: str = "",
        result_name: str = "",
        similarity: float = 0.0,
        error: str = "",
        expected_status: str = "",
    ) -> bool:
        if status not in {"processed", "discarded", "error"}:
            raise ValueError("Estado final de recorte no valido.")
        with self.connection() as db:
            return self._finish_crop_processing(
                db,
                crop_id,
                status=status,
                result_kind=result_kind,
                result_key=result_key,
                result_name=result_name,
                similarity=similarity,
                error=error,
                expected_status=expected_status,
            )

    @staticmethod
    def _finish_crop_processing(
        db: sqlite3.Connection,
        crop_id: int,
        *,
        status: str,
        result_kind: str = "",
        result_key: str = "",
        result_name: str = "",
        similarity: float = 0.0,
        error: str = "",
        expected_status: str = "",
    ) -> bool:
        if status not in {"processed", "discarded", "error"}:
            raise ValueError("Estado final de recorte no valido.")
        now = utc_now()
        where = "where id=?"
        params: list[object] = [
            status,
            result_kind,
            result_key,
            result_name,
            float(similarity),
            str(error)[:1000],
            now if status != "error" else "",
            now,
            int(crop_id),
        ]
        if expected_status:
            where += " and status=?"
            params.append(expected_status)
        cursor = db.execute(
            f"""
            update crop_processing_queue
            set status=?,result_kind=?,result_key=?,result_name=?,similarity=?,
                last_error=?,processed_at=?,updated_at=?
            {where}
            """,
            params,
        )
        return cursor.rowcount == 1

    def crop_processing_result(self, crop_id: int) -> dict | None:
        with self.connection() as db:
            row = db.execute(
                "select * from crop_processing_queue where id=?",
                (int(crop_id),),
            ).fetchone()
        return self._public_crop_queue_row(dict(row)) if row else None

    def face_crop_path_recorded(self, crop_path: str) -> bool:
        if not crop_path:
            return False
        with self.connection() as db:
            row = db.execute(
                """
                select 1 from face_crops where crop_path=?
                union all
                select 1 from unassigned_crops where crop_path=?
                limit 1
                """,
                (
                    str(Path(crop_path).resolve()),
                    str(Path(crop_path).resolve()),
                ),
            ).fetchone()
        return row is not None

    def record_unassigned_crop(
        self,
        *,
        captured_at: datetime,
        camera: str,
        crop_path: str,
        embedding: np.ndarray,
        quality: float,
        det_score: float,
        reason: str,
        similarity: float,
        match_metadata: dict,
        quality_payload: dict,
        analysis_version: str,
        queue_crop_id: int | None = None,
    ) -> dict:
        with self.connection() as db:
            return self._record_unassigned_crop(
                db,
                captured_at=captured_at,
                camera=camera,
                crop_path=crop_path,
                embedding=embedding,
                quality=quality,
                det_score=det_score,
                reason=reason,
                similarity=similarity,
                match_metadata=match_metadata,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
                queue_crop_id=queue_crop_id,
            )

    @staticmethod
    def _record_unassigned_crop(
        db: sqlite3.Connection,
        *,
        captured_at: datetime,
        camera: str,
        crop_path: str,
        embedding: np.ndarray,
        quality: float,
        det_score: float,
        reason: str,
        similarity: float,
        match_metadata: dict,
        quality_payload: dict,
        analysis_version: str,
        queue_crop_id: int | None = None,
    ) -> dict:
        normalized_reason = str(reason or "sin_coincidencia").strip()[:100]
        if not normalized_reason:
            normalized_reason = "sin_coincidencia"
        normalized_embedding = np.asarray(embedding, dtype=np.float32)
        if normalized_embedding.shape != (512,) or not np.isfinite(normalized_embedding).all():
            raise ValueError("El recorte sin asignar no contiene un embedding facial valido.")
        resolved_path = str(Path(crop_path).resolve())
        now = utc_now()
        db.execute(
            """
            insert into unassigned_crops
                (queue_crop_id,captured_at,camera,crop_path,embedding,quality,det_score,
                 reason,similarity,match_json,quality_json,analysis_version,status,
                 created_at,updated_at)
            values (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
            on conflict(crop_path) do update set
                queue_crop_id=coalesce(unassigned_crops.queue_crop_id,excluded.queue_crop_id),
                captured_at=excluded.captured_at,
                camera=excluded.camera,
                embedding=excluded.embedding,
                quality=excluded.quality,
                det_score=excluded.det_score,
                reason=excluded.reason,
                similarity=excluded.similarity,
                match_json=excluded.match_json,
                quality_json=excluded.quality_json,
                analysis_version=excluded.analysis_version,
                updated_at=excluded.updated_at
            """,
            (
                int(queue_crop_id) if queue_crop_id is not None else None,
                captured_at.isoformat(),
                str(camera),
                resolved_path,
                embedding_blob(normalized_embedding),
                float(quality),
                float(det_score),
                normalized_reason,
                float(similarity),
                json.dumps(match_metadata or {}, ensure_ascii=True),
                json.dumps(quality_payload or {}, ensure_ascii=True),
                str(analysis_version),
                now,
                now,
            ),
        )
        row = db.execute(
            "select * from unassigned_crops where crop_path=?",
            (resolved_path,),
        ).fetchone()
        result = dict(row)
        result.pop("embedding", None)
        return result

    def unassigned_summary(self) -> dict:
        with self.connection() as db:
            row = db.execute(
                """
                select count(*) as total,
                       sum(case when status='pending' then 1 else 0 end) as pending,
                       sum(case when status='resolved' then 1 else 0 end) as resolved,
                       sum(case when status='discarded' then 1 else 0 end) as discarded,
                       sum(case when status='pending' and reason='calidad_insuficiente'
                                then 1 else 0 end) as low_quality,
                       sum(case when status='pending' and reason like '%ambigu%'
                                then 1 else 0 end) as ambiguous
                from unassigned_crops
                """
            ).fetchone()
        return {
            "total": int(row["total"] or 0),
            "pending": int(row["pending"] or 0),
            "resolved": int(row["resolved"] or 0),
            "discarded": int(row["discarded"] or 0),
            "low_quality": int(row["low_quality"] or 0),
            "ambiguous": int(row["ambiguous"] or 0),
        }

    def unassigned_crop_image_path(self, crop_id: int) -> Path | None:
        with self.connection() as db:
            row = db.execute(
                "select crop_path from unassigned_crops where id=?",
                (int(crop_id),),
            ).fetchone()
        if not row:
            return None
        path = Path(str(row["crop_path"])).resolve()
        return path if path.is_file() else None

    def commit_night_crop(self, crop_id: int, plan: dict) -> dict:
        """Commit one prepared night result without keeping SQLite open during inference.

        The durable claim is intentionally a separate transaction. This method
        performs every result write plus the final queue transition in one short
        transaction so a retry cannot double-count attendance or detections.
        """
        crop_id = int(crop_id)
        requested_status = str(plan.get("status") or "").strip()
        if requested_status not in {"processed", "discarded"}:
            raise ValueError("El plan nocturno debe terminar como processed o discarded.")
        requested_kind = str(plan.get("result_kind") or "").strip()
        if requested_status == "processed" and requested_kind not in {
            "known",
            "unknown",
            "unassigned",
        }:
            raise ValueError(
                "Un recorte procesado debe indicar known, unknown o unassigned."
            )

        with self.connection(immediate=True) as db:
            queue_row = db.execute(
                "select * from crop_processing_queue where id=?",
                (crop_id,),
            ).fetchone()
            if not queue_row:
                raise LookupError(f"No existe el recorte nocturno {crop_id}.")
            if queue_row["status"] in {"processed", "discarded"}:
                result = self._public_crop_queue_row(dict(queue_row))
                result["already_committed"] = True
                result["queue_committed"] = True
                return result
            if queue_row["status"] != "processing":
                raise RuntimeError(
                    f"El recorte nocturno {crop_id} esta en estado {queue_row['status']}, no processing."
                )

            result_kind = requested_kind
            result_key = str(plan.get("result_key") or "")
            result_name = str(plan.get("result_name") or "")
            similarity = float(plan.get("similarity") or 0.0)
            outcome: dict = {
                "status": requested_status,
                "result_kind": result_kind,
                "result_key": result_key,
                "result_name": result_name,
                "similarity": similarity,
                "already_committed": False,
            }

            if requested_status == "processed" and result_kind == "known":
                outcome.update(self._commit_known_night_plan(db, plan))
            elif requested_status == "processed" and result_kind == "unknown":
                outcome.update(self._commit_unknown_night_plan(db, plan))
            elif requested_status == "processed" and result_kind == "unassigned":
                outcome.update(
                    self._commit_unassigned_night_plan(
                        db,
                        crop_id,
                        plan,
                    )
                )

            final_status = str(outcome.get("status") or requested_status)
            final_kind = str(outcome.get("result_kind") or result_kind)
            final_key = str(outcome.get("result_key") or result_key)
            final_name = str(outcome.get("result_name") or result_name)
            final_similarity = float(outcome.get("similarity") or similarity)
            if not self._finish_crop_processing(
                db,
                crop_id,
                status=final_status,
                result_kind=final_kind,
                result_key=final_key,
                result_name=final_name,
                similarity=final_similarity,
                expected_status="processing",
            ):
                raise RuntimeError(
                    f"El recorte nocturno {crop_id} cambio de estado antes del commit."
                )
            outcome.update(
                {
                    "status": final_status,
                    "result_kind": final_kind,
                    "result_key": final_key,
                    "result_name": final_name,
                    "similarity": final_similarity,
                    "queue_committed": True,
                }
            )
            return outcome

    @classmethod
    def _commit_unassigned_night_plan(
        cls,
        db: sqlite3.Connection,
        crop_id: int,
        plan: dict,
    ) -> dict:
        seen_at = cls._night_plan_datetime(plan.get("seen_at"))
        crop_path = str(plan.get("crop_path") or "")
        if not crop_path:
            raise ValueError("El plan sin asignar no contiene un recorte.")
        row = cls._record_unassigned_crop(
            db,
            captured_at=seen_at,
            camera=str(plan.get("camera") or ""),
            crop_path=crop_path,
            embedding=np.asarray(plan.get("embedding"), dtype=np.float32),
            quality=float(plan.get("quality") or 0.0),
            det_score=float(plan.get("det_score") or 0.0),
            reason=str(plan.get("reason") or "sin_coincidencia"),
            similarity=float(plan.get("similarity") or 0.0),
            match_metadata=dict(plan.get("match_metadata") or {}),
            quality_payload=dict(plan.get("quality_payload") or {}),
            analysis_version=str(plan.get("analysis_version") or ""),
            queue_crop_id=int(crop_id),
        )
        return {
            "status": "processed",
            "result_kind": "unassigned",
            "result_key": f"unassigned:{int(row['id'])}",
            "result_name": "Sin asignar",
            "similarity": float(plan.get("similarity") or 0.0),
            "unassigned": row,
        }

    @classmethod
    def _commit_known_night_plan(
        cls,
        db: sqlite3.Connection,
        plan: dict,
    ) -> dict:
        person_key = str(plan.get("person_key") or plan.get("result_key") or "").strip()
        if not person_key:
            raise ValueError("Falta person_key en el plan conocido.")
        seen_at = cls._night_plan_datetime(plan.get("seen_at"))
        crop_path = str(plan.get("crop_path") or "")
        similarity = float(plan.get("similarity") or 0.0)
        embedding_value = plan.get("embedding")
        embedding = (
            np.asarray(embedding_value, dtype=np.float32)
            if embedding_value is not None
            else None
        )
        if embedding is not None and (
            embedding.shape != (512,) or not np.isfinite(embedding).all()
        ):
            raise ValueError("El plan conocido no contiene un embedding facial valido.")
        quality = float(plan.get("quality") or 0.0)
        quality_pass = bool(plan.get("quality_pass"))
        reference_quality_pass = bool(plan.get("reference_quality_pass"))
        quality_payload = dict(plan.get("quality_payload") or {})
        analysis_version = str(plan.get("analysis_version") or "")
        presence = cls._upsert_presence(
            db,
            person_key,
            "known",
            seen_at,
            similarity,
            crop_path,
        )
        if not cls._record_crop(
            db,
            person_key,
            "known",
            seen_at,
            crop_path,
            similarity,
            quality,
            str(plan.get("camera") or ""),
            embedding=embedding,
            analysis_version=analysis_version,
            quality_pass=quality_pass,
            quality_payload=quality_payload,
        ):
            raise RuntimeError("No se pudo registrar el recorte conocido.")
        adaptive_reference_count = 0
        if reference_quality_pass:
            if embedding is None:
                raise ValueError(
                    "Una referencia adaptativa conocida requiere embedding."
                )
            retained_rows, _ = cls._save_known_reference(
                db,
                person_key,
                crop_path,
                embedding,
                quality,
                seen_at,
                quality_payload,
                source="observed",
                pinned=False,
            )
            adaptive_reference_count = len(retained_rows)

        event_id = str(plan.get("event_id") or "").strip()
        if not event_id:
            event_id = str(
                uuid5(
                    NAMESPACE_URL,
                    (
                        f"futsi:{str(plan.get('station_id') or 'local')}:{person_key}:"
                        f"{presence['presence_date']}:{presence['session_id']}"
                    ),
                )
            )
        if event_id:
            event_payload = {
                "event_id": event_id,
                "person_type": str(plan.get("person_type") or ""),
                "person_id": int(plan.get("person_id") or 0),
                "person_key": person_key,
                "presence_date": presence["presence_date"],
                "occurred_at": presence["first_seen_at"],
                "session_id": presence["session_id"] if presence["session_id"] != -1 else None,
                "detection_count": presence["detection_count"],
                "similarity": similarity,
                "source_subject_id": str(plan.get("source_subject_id") or ""),
                "metadata": {"camera_id": str(plan.get("camera_id") or "")},
            }
            cls._queue_event(db, event_id, "known_event", event_payload)
        return {
            "status": "processed",
            "result_kind": "known",
            "result_key": person_key,
            "result_name": str(plan.get("result_name") or person_key),
            "similarity": similarity,
            "presence": presence,
            "crop_path": crop_path,
            "adaptive_reference_added": reference_quality_pass,
            "adaptive_reference_count": adaptive_reference_count,
        }

    @classmethod
    def _commit_unknown_night_plan(
        cls,
        db: sqlite3.Connection,
        plan: dict,
    ) -> dict:
        seen_at = cls._night_plan_datetime(plan.get("seen_at"))
        subject_id = str(plan.get("subject_id") or plan.get("result_key") or "").strip()
        temporary_name = str(plan.get("temporary_name") or plan.get("result_name") or "").strip()
        embedding = np.asarray(plan.get("embedding"), dtype=np.float32)
        if embedding.shape != (512,) or not np.isfinite(embedding).all():
            raise ValueError("El plan desconocido no contiene un embedding facial valido.")
        crop_path = str(plan.get("crop_path") or "")
        quality = float(plan.get("quality") or 0.0)
        similarity = float(plan.get("similarity") or 0.0)
        quality_pass = bool(plan.get("quality_pass"))
        reference_quality_pass = bool(plan.get("reference_quality_pass", quality_pass))
        quality_payload = dict(plan.get("quality_payload") or {})
        analysis_version = str(plan.get("analysis_version") or "")

        current = None
        if subject_id:
            try:
                current = cls._get_unknown(db, subject_id)
            except LookupError:
                current = None
        if current is None:
            if not subject_id or not temporary_name:
                subject_id, reserved_name = cls._next_unknown_name(
                    db,
                    subject_id=subject_id,
                )
                temporary_name = temporary_name or reserved_name
            cls._create_unknown_identity(
                db,
                subject_id,
                temporary_name,
                embedding,
                seen_at,
                crop_path,
                quality,
                quality_pass=reference_quality_pass,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
            promoted = reference_quality_pass
            status = "consolidated" if reference_quality_pass else "candidate"
            detection_count = 1
            first_seen_at = seen_at
            best_crop_path = crop_path if reference_quality_pass else ""
        else:
            update = cls._update_unknown_identity(
                db,
                subject_id,
                embedding,
                seen_at,
                crop_path,
                quality,
                quality_pass=reference_quality_pass,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
            subject_id = str(update["subject_id"])
            inactive = update.get("inactive_result") or update.get("ignored_result")
            if inactive:
                return {
                    "status": "discarded",
                    "result_kind": str(update["status"]),
                    "result_key": subject_id,
                    "result_name": str(inactive.get("temporary_name") or subject_id),
                    "similarity": similarity,
                    "subject": inactive,
                    "presence": None,
                    "crop_path": "",
                }
            promoted = bool(update["promoted"])
            status = str(update["status"])
            detection_count = int(update["detection_count"])
            first_seen_at = datetime.fromisoformat(str(update["first_seen_at"]))
            best_crop_path = str(update["best_crop_path"])

        presence = None
        if status in {"consolidated", "linked"}:
            presence = cls._upsert_presence(
                db,
                subject_id,
                "unknown",
                seen_at,
                similarity,
                best_crop_path,
                detection_increment=detection_count if promoted else 1,
                first_seen_at=first_seen_at if promoted else None,
            )
        if not cls._record_crop(
            db,
            subject_id,
            "unknown",
            seen_at,
            crop_path,
            similarity,
            quality,
            str(plan.get("camera") or ""),
            embedding=embedding,
            analysis_version=analysis_version,
            quality_pass=quality_pass,
            quality_payload=quality_payload,
        ):
            raise RuntimeError("No se pudo registrar el recorte desconocido.")
        subject = cls._get_unknown(db, subject_id)
        subject["daily_detection_count"] = int(presence["detection_count"]) if presence else 0
        subject["promoted"] = promoted
        return {
            "status": "processed",
            "result_kind": "unknown",
            "result_key": subject_id,
            "result_name": str(subject["temporary_name"]),
            "similarity": similarity,
            "subject": subject,
            "presence": presence,
            "crop_path": crop_path,
        }

    @staticmethod
    def _night_plan_datetime(value) -> datetime:
        if isinstance(value, datetime):
            return value
        if not value:
            raise ValueError("Falta seen_at en el plan nocturno.")
        return datetime.fromisoformat(str(value))

    def recover_processing_crops(self) -> int:
        with self.connection() as db:
            cursor = db.execute(
                "update crop_processing_queue set status='pending',updated_at=? where status='processing'",
                (utc_now(),),
            )
            return int(cursor.rowcount)

    def discard_queued_crops_outside_horizontal_roi(
        self,
        *,
        camera_key: str,
        selected_date: str,
        frame_width: int,
        roi_left: float,
        roi_right: float,
    ) -> dict:
        """Retire queued crops whose face center falls in a configured side exclusion zone."""
        width = max(1, int(frame_width))
        left_px = width * float(roi_left)
        right_px = width * float(roi_right)
        if left_px <= 0 and right_px >= width:
            return {"discarded": 0, "bytes_removed": 0}
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    """
                    select id,crop_path,file_bytes,bbox_json
                    from crop_processing_queue
                    where camera_key=? and substr(captured_at,1,10)=?
                      and status in ('pending','error')
                    """,
                    (camera_key, selected_date),
                )
            ]
            discarded = []
            for row in rows:
                try:
                    bbox = json.loads(row["bbox_json"] or "[]")
                    center_x = (float(bbox[0]) + float(bbox[2])) / 2
                except (TypeError, ValueError, IndexError, json.JSONDecodeError):
                    continue
                if center_x < left_px or center_x >= right_px:
                    discarded.append(row)
            now = utc_now()
            db.executemany(
                """
                update crop_processing_queue
                set status='discarded',result_kind='excluded_zone',
                    result_name='Zona excluida',last_error='',
                    processed_at=?,updated_at=?
                where id=? and status in ('pending','error')
                """,
                [(now, now, int(row["id"])) for row in discarded],
            )

        spool_root = self.spool_dir.resolve()
        bytes_removed = 0
        for row in discarded:
            path = Path(row["crop_path"]).resolve()
            try:
                path.relative_to(spool_root)
            except ValueError:
                continue
            if path.is_file():
                path.unlink()
                bytes_removed += max(0, int(row["file_bytes"] or 0))
        return {"discarded": len(discarded), "bytes_removed": bytes_removed}

    def crop_queue_image_path(self, crop_id: int) -> Path | None:
        with self.connection() as db:
            row = db.execute(
                "select crop_path from crop_processing_queue where id=?",
                (int(crop_id),),
            ).fetchone()
        if not row or not row["crop_path"]:
            return None
        path = Path(row["crop_path"]).resolve()
        try:
            path.relative_to(self.spool_dir.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None

    def unknown_database(self) -> tuple[list[dict], np.ndarray]:
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    "select * from unknown_subjects where status in ('consolidated','linked','ignored')"
                )
            ]
        embeddings = [blob_embedding(row.pop("centroid")) for row in rows]
        valid = [(row, embedding) for row, embedding in zip(rows, embeddings) if embedding is not None]
        if not valid:
            return [], np.empty((0, 512), dtype=np.float32)
        return [item[0] for item in valid], np.vstack([item[1] for item in valid]).astype(np.float32)

    def known_reference_database(
        self,
        person_key: str | None = None,
    ) -> tuple[list[dict], np.ndarray]:
        where = """
            where person.active=1
              and person.reference_available=1
              and person.embedding is not null
        """
        params: tuple = ()
        if person_key:
            where += " and reference.person_key=?"
            params = (str(person_key),)
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    f"""
                    select reference.*,
                           person.remote_id,person.name,person.person_type,
                           person.group_name,person.team_name,person.photo_url,
                           person.photo_path,person.reference_version,
                           person.reference_available,person.active,
                           person.updated_at
                    from known_references reference
                    join people person on person.person_key=reference.person_key
                    {where}
                    order by reference.person_key,reference.pinned desc,
                             reference.quality desc,reference.id
                    """,
                    params,
                )
            ]
        embeddings = [blob_embedding(row.pop("embedding")) for row in rows]
        valid = [
            (row, embedding)
            for row, embedding in zip(rows, embeddings)
            if embedding is not None
        ]
        if not valid:
            return [], np.empty((0, 512), dtype=np.float32)
        return (
            [item[0] for item in valid],
            np.vstack([item[1] for item in valid]).astype(np.float32),
        )

    def save_known_observation_reference(
        self,
        person_key: str,
        crop_path: str,
        embedding: np.ndarray,
        quality: float,
        seen_at: datetime,
        quality_payload: dict,
    ) -> dict:
        with self.connection() as db:
            person = db.execute(
                """
                select person_key from people
                where person_key=? and active=1
                """,
                (str(person_key),),
            ).fetchone()
            if not person:
                raise LookupError(person_key)
            retained_rows, _ = self._save_known_reference(
                db,
                str(person_key),
                str(crop_path),
                embedding,
                float(quality),
                seen_at,
                quality_payload,
                source="observed",
                pinned=False,
            )
        retained_paths = {str(row["crop_path"]) for row in retained_rows}
        return {
            "person_key": str(person_key),
            "retained": str(crop_path) in retained_paths,
            "reference_count": len(retained_rows),
        }

    def unknown_reference_database(self) -> tuple[list[dict], np.ndarray]:
        """Return every retained reference with its owning persistent identity."""
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    """
                    select s.subject_id,s.temporary_name,s.status,s.linked_person_key,
                           r.id as reference_id,r.crop_path,r.quality,
                           r.captured_at,r.embedding
                    from unknown_references r
                    join unknown_subjects s on s.subject_id=r.subject_id
                    where s.status in ('consolidated','linked','ignored')
                    order by s.subject_id,r.quality desc,r.id
                    """
                )
            ]
        embeddings = [blob_embedding(row.pop("embedding")) for row in rows]
        valid = [(row, embedding) for row, embedding in zip(rows, embeddings) if embedding is not None]
        if not valid:
            return [], np.empty((0, 512), dtype=np.float32)
        return [item[0] for item in valid], np.vstack([item[1] for item in valid]).astype(np.float32)

    def candidate_database(
        self,
        active_after: datetime,
        active_before: datetime | None = None,
    ) -> tuple[list[dict], np.ndarray]:
        where = "status='candidate' and last_seen_at>=?"
        params: list[str] = [active_after.isoformat()]
        if active_before is not None:
            where += " and first_seen_at<=?"
            params.append(active_before.isoformat())
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    f"""
                    select * from unknown_subjects
                    where {where}
                    order by last_seen_at desc
                    """,
                    params,
                )
            ]
        embeddings = [blob_embedding(row.pop("centroid")) for row in rows]
        valid = [(row, embedding) for row, embedding in zip(rows, embeddings) if embedding is not None]
        if not valid:
            return [], np.empty((0, 512), dtype=np.float32)
        return [item[0] for item in valid], np.vstack([item[1] for item in valid]).astype(np.float32)

    @staticmethod
    def _canonical_unknown_id(db: sqlite3.Connection, subject_id: str) -> str:
        current = str(subject_id or "").strip()
        visited: set[str] = set()
        while current and current not in visited:
            visited.add(current)
            row = db.execute(
                "select subject_id,merged_into from unknown_subjects where subject_id=?",
                (current,),
            ).fetchone()
            if not row:
                raise LookupError(subject_id)
            merged_into = str(row["merged_into"] or "").strip()
            if not merged_into:
                return str(row["subject_id"])
            current = merged_into
        raise RuntimeError("Se detecto un ciclo en la fusion de desconocidos.")

    def resolve_unknown_id(self, subject_id: str) -> str:
        with self.connection() as db:
            return self._canonical_unknown_id(db, subject_id)

    def next_unknown_name(self) -> tuple[str, str]:
        with self.connection(immediate=True) as db:
            # Reserve the number in SQLite before returning it. This remains
            # collision-free even if another station process is started.
            return self._next_unknown_name(db)

    @classmethod
    def _next_unknown_name(
        cls,
        db: sqlite3.Connection,
        *,
        subject_id: str = "",
    ) -> tuple[str, str]:
        row = db.execute(
            "select next_value from local_counters where counter_key='unknown_name'"
        ).fetchone()
        if not row:
            cls._seed_unknown_name_counter(db)
            row = db.execute(
                "select next_value from local_counters where counter_key='unknown_name'"
            ).fetchone()
        number = max(10000, int(row["next_value"]))
        while db.execute(
            "select 1 from unknown_subjects where temporary_name=?",
            (f"Desconocido {number}",),
        ).fetchone():
            number += 1
        db.execute(
            """
            update local_counters set next_value=?
            where counter_key='unknown_name'
            """,
            (number + 1,),
        )
        return subject_id or str(uuid4()), f"Desconocido {number}"

    def create_unknown(
        self,
        embedding: np.ndarray,
        seen_at: datetime,
        crop_path: str,
        quality: float,
        subject_id: str = "",
        temporary_name: str = "",
        *,
        quality_pass: bool = False,
        quality_payload: dict | None = None,
        analysis_version: str = "",
    ) -> dict:
        if not subject_id or not temporary_name:
            subject_id, temporary_name = self.next_unknown_name()
        with self.connection() as db:
            self._create_unknown_identity(
                db,
                subject_id,
                temporary_name,
                embedding,
                seen_at,
                crop_path,
                quality,
                quality_pass=quality_pass,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
        presence = None
        if quality_pass:
            presence = self.upsert_presence(
                subject_id,
                "unknown",
                seen_at,
                quality,
                crop_path,
                detection_increment=1,
                first_seen_at=seen_at,
            )
        result = self.get_unknown(subject_id)
        result["daily_detection_count"] = int(presence["detection_count"]) if presence else 0
        result["promoted"] = bool(quality_pass)
        return result

    @classmethod
    def _create_unknown_identity(
        cls,
        db: sqlite3.Connection,
        subject_id: str,
        temporary_name: str,
        embedding: np.ndarray,
        seen_at: datetime,
        crop_path: str,
        quality: float,
        *,
        quality_pass: bool = False,
        quality_payload: dict | None = None,
        analysis_version: str = "",
    ) -> None:
        status = "consolidated" if quality_pass else "candidate"
        db.execute(
            """
            insert into unknown_subjects
                (subject_id, temporary_name, status, centroid, best_crop_path, best_quality,
                 first_seen_at, last_seen_at, detection_count, quality_hits,
                 quality_version, quality_json, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            """,
            (
                subject_id,
                temporary_name,
                status,
                embedding_blob(embedding),
                crop_path if quality_pass else "",
                quality if quality_pass else 0.0,
                seen_at.isoformat(),
                seen_at.isoformat(),
                int(quality_pass),
                analysis_version if quality_pass else "",
                json.dumps(quality_payload or {}, ensure_ascii=True) if quality_pass else "{}",
                utc_now(),
            ),
        )
        if quality_pass and crop_path:
            cls._save_unknown_reference(
                db,
                subject_id,
                crop_path,
                embedding,
                quality,
                seen_at,
                quality_payload or {},
            )

    def flatten_legacy_crop_layout(self) -> dict[str, int]:
        """Move legacy date/kind/subject/file crops into date/kind/subject_file."""
        root = self.faces_dir.resolve()
        candidates = []
        for source in sorted(root.glob("*/*/*/*.jpg")):
            if not source.is_file():
                continue
            try:
                relative = source.resolve().relative_to(root)
            except ValueError:
                continue
            if len(relative.parts) != 4:
                continue
            date_name, kind, subject_key, filename = relative.parts
            target_dir = root / date_name / kind
            target = target_dir / f"{subject_key}_{filename}"
            suffix = 1
            while target.exists():
                target = target_dir / f"{subject_key}_{source.stem}_{suffix}.jpg"
                suffix += 1
            candidates.append((source.resolve(), target.resolve()))
        if not candidates:
            return {"moved": 0, "updated_references": 0, "removed_directories": 0}

        path_mapping = {str(source): str(target) for source, target in candidates}
        moved = []
        updated_references = 0
        try:
            for source, target in candidates:
                target.parent.mkdir(parents=True, exist_ok=True)
                source.replace(target)
                moved.append((source, target))
            with self.connection() as db:
                for source, target in candidates:
                    for table in ("unknown_subjects", "daily_presence"):
                        cursor = db.execute(
                            f"update {table} set best_crop_path=? where best_crop_path=?",
                            (str(target), str(source)),
                        )
                        updated_references += cursor.rowcount
                    cursor = db.execute(
                        "update face_crops set crop_path=? where crop_path=?",
                        (str(target), str(source)),
                    )
                    updated_references += cursor.rowcount
                    cursor = db.execute(
                        "update unknown_references set crop_path=? where crop_path=?",
                        (str(target), str(source)),
                    )
                    updated_references += cursor.rowcount
                queue_rows = db.execute("select id,payload_json from sync_queue").fetchall()
                for queue_row in queue_rows:
                    payload = json.loads(queue_row["payload_json"])
                    old_path = str(payload.get("best_crop_path") or "")
                    new_path = path_mapping.get(old_path)
                    if not new_path:
                        continue
                    payload["best_crop_path"] = new_path
                    db.execute(
                        "update sync_queue set payload_json=?, updated_at=? where id=?",
                        (json.dumps(payload, ensure_ascii=False), utc_now(), queue_row["id"]),
                    )
                    updated_references += 1
        except Exception:
            for source, target in reversed(moved):
                if target.exists() and not source.exists():
                    source.parent.mkdir(parents=True, exist_ok=True)
                    target.replace(source)
            raise

        removed_directories = 0
        for directory in sorted({source.parent for source, _ in candidates}, reverse=True):
            try:
                directory.rmdir()
                removed_directories += 1
            except OSError:
                pass
        return {
            "moved": len(moved),
            "updated_references": updated_references,
            "removed_directories": removed_directories,
        }

    def update_unknown(
        self,
        subject_id: str,
        embedding: np.ndarray,
        seen_at: datetime,
        crop_path: str,
        quality: float,
        *,
        quality_pass: bool = False,
        quality_payload: dict | None = None,
        analysis_version: str = "",
    ) -> dict:
        with self.connection() as db:
            outcome = self._update_unknown_identity(
                db,
                subject_id,
                embedding,
                seen_at,
                crop_path,
                quality,
                quality_pass=quality_pass,
                quality_payload=quality_payload,
                analysis_version=analysis_version,
            )
        inactive = outcome.get("inactive_result") or outcome.get("ignored_result")
        if inactive:
            return inactive
        subject_id = outcome["subject_id"]
        status = outcome["status"]
        promoted = bool(outcome["promoted"])
        new_count = int(outcome["detection_count"])
        best_crop_path = str(outcome["best_crop_path"])
        first_seen_at = str(outcome["first_seen_at"])
        presence = None
        if status in {"consolidated", "linked"}:
            presence = self.upsert_presence(
                subject_id,
                "unknown",
                seen_at,
                quality,
                best_crop_path,
                detection_increment=new_count if promoted else 1,
                first_seen_at=datetime.fromisoformat(first_seen_at) if promoted else None,
            )
        result = self.get_unknown(subject_id)
        result["daily_detection_count"] = int(presence["detection_count"]) if presence else 0
        result["promoted"] = promoted
        return result

    @classmethod
    def _update_unknown_identity(
        cls,
        db: sqlite3.Connection,
        subject_id: str,
        embedding: np.ndarray,
        seen_at: datetime,
        crop_path: str,
        quality: float,
        *,
        quality_pass: bool = False,
        quality_payload: dict | None = None,
        analysis_version: str = "",
    ) -> dict:
        subject_id = cls._canonical_unknown_id(db, subject_id)
        row = db.execute(
            "select * from unknown_subjects where subject_id=?",
            (subject_id,),
        ).fetchone()
        if not row:
            raise LookupError(subject_id)
        if row["status"] in UNKNOWN_INACTIVE_STATUSES:
            result = dict(row)
            result.pop("centroid", None)
            result["daily_detection_count"] = 0
            result["promoted"] = False
            status = str(row["status"])
            return {
                "subject_id": subject_id,
                "status": status,
                "promoted": False,
                "detection_count": int(row["detection_count"] or 0),
                "best_crop_path": str(row["best_crop_path"] or ""),
                "first_seen_at": str(row["first_seen_at"]),
                "inactive_result": result,
                "ignored_result": result if status == "ignored" else None,
            }
        previous = blob_embedding(row["centroid"])
        count = int(row["detection_count"] or 0)
        # Rejected views are evidence, never identity references. In
        # particular, a face looking down must not pull a good frontal
        # centroid away from the person's stable representation.
        centroid = previous
        new_count = count + 1
        reference_retained = False
        best_reference = None
        if quality_pass and crop_path:
            references, reference_embeddings = cls._save_unknown_reference(
                db,
                subject_id,
                crop_path,
                embedding,
                quality,
                seen_at,
                quality_payload or {},
            )
            reference_retained = any(
                str(reference.get("crop_path") or "") == crop_path
                for reference in references
            )
            best_reference = (
                max(
                    references,
                    key=lambda reference: (
                        float(reference.get("quality") or 0.0),
                        -int(reference.get("id") or 0),
                    ),
                )
                if references
                else None
            )
            reference_centroid = cls._unknown_reference_centroid(
                references,
                reference_embeddings,
            )
            if reference_centroid is not None:
                centroid = reference_centroid
        quality_hits = int(row["quality_hits"] or 0) + int(reference_retained)
        status = row["status"]
        promoted = False
        if status == "candidate" and reference_retained:
            status = "consolidated"
            promoted = True
        refresh_best = best_reference is not None
        selected_best_path = (
            str(best_reference.get("crop_path") or "")
            if best_reference
            else str(row["best_crop_path"] or "")
        )
        selected_best_quality = (
            float(best_reference.get("quality") or 0.0)
            if best_reference
            else float(row["best_quality"] or 0.0)
        )
        selected_best_json = (
            str(best_reference.get("quality_json") or "{}")
            if best_reference
            else str(row["quality_json"] or "{}")
        )
        selected_best_version = (
            analysis_version
            if best_reference and selected_best_path == crop_path
            else str(row["quality_version"] or analysis_version)
        )
        db.execute(
            """
            update unknown_subjects set centroid=?, last_seen_at=?, detection_count=?, status=?,
                best_crop_path=case when ? then ? else best_crop_path end,
                best_quality=case when ? then ? else best_quality end,
                quality_hits=?, quality_version=case when ? then ? else quality_version end,
                quality_json=case when ? then ? else quality_json end,
                updated_at=? where subject_id=?
            """,
            (
                embedding_blob(centroid), seen_at.isoformat(), new_count, status,
                int(refresh_best), selected_best_path,
                int(refresh_best), selected_best_quality,
                quality_hits, int(refresh_best), selected_best_version,
                int(refresh_best), selected_best_json,
                utc_now(), subject_id,
            ),
        )
        return {
            "subject_id": subject_id,
            "status": status,
            "promoted": promoted,
            "detection_count": new_count,
            "best_crop_path": selected_best_path,
            "first_seen_at": str(row["first_seen_at"]),
            "inactive_result": None,
            "ignored_result": None,
        }

    @staticmethod
    def _save_known_reference(
        db: sqlite3.Connection,
        person_key: str,
        crop_path: str,
        embedding: np.ndarray,
        quality: float,
        seen_at: datetime,
        quality_payload: dict,
        *,
        source: str,
        pinned: bool,
    ) -> tuple[list[dict], list[np.ndarray]]:
        db.execute(
            """
            insert into known_references
                (person_key,crop_path,embedding,quality,captured_at,quality_json,
                 source,pinned,created_at)
            values (?,?,?,?,?,?,?,?,?)
            on conflict(person_key,crop_path) do update set
                embedding=excluded.embedding,
                quality=max(known_references.quality,excluded.quality),
                captured_at=excluded.captured_at,
                quality_json=excluded.quality_json,
                source=case
                    when known_references.pinned=1 then known_references.source
                    else excluded.source
                end,
                pinned=max(known_references.pinned,excluded.pinned)
            """,
            (
                str(person_key),
                str(crop_path),
                embedding_blob(embedding),
                float(quality),
                seen_at.isoformat(),
                json.dumps(quality_payload or {}, ensure_ascii=True),
                str(source or "observed"),
                int(bool(pinned)),
                utc_now(),
            ),
        )
        return LocalStore._curate_known_references(db, str(person_key))

    @staticmethod
    def _curate_known_references(
        db: sqlite3.Connection,
        person_key: str,
    ) -> tuple[list[dict], list[np.ndarray]]:
        rows = [
            dict(row)
            for row in db.execute(
                """
                select * from known_references
                where person_key=?
                order by pinned desc,quality desc,id
                """,
                (str(person_key),),
            )
        ]
        valid_rows: list[dict] = []
        embeddings: list[np.ndarray] = []
        for row in rows:
            embedding = blob_embedding(row.get("embedding"))
            if embedding is None:
                continue
            valid_rows.append(row)
            embeddings.append(embedding)
        selected_indexes = select_retained_reference_indices(
            embeddings,
            [float(row.get("quality") or 0.0) for row in valid_rows],
            limit=UNKNOWN_REFERENCE_LIMIT,
            duplicate_threshold=UNKNOWN_DUPLICATE_THRESHOLD,
            coherence_threshold=UNKNOWN_COHERENCE_THRESHOLD,
        )
        pinned_indexes = [
            index
            for index, row in enumerate(valid_rows)
            if bool(row.get("pinned"))
        ]
        retained_indexes: list[int] = []
        for index in [*pinned_indexes, *selected_indexes]:
            if index in retained_indexes:
                continue
            retained_indexes.append(index)
            if len(retained_indexes) >= UNKNOWN_REFERENCE_LIMIT:
                break
        retained_rows = [valid_rows[index] for index in retained_indexes]
        retained_embeddings = [embeddings[index] for index in retained_indexes]
        retained_ids = [int(row["id"]) for row in retained_rows]
        if retained_ids:
            placeholders = ",".join("?" for _ in retained_ids)
            db.execute(
                f"""
                delete from known_references
                where person_key=? and id not in ({placeholders})
                """,
                (str(person_key), *retained_ids),
            )
        else:
            db.execute(
                "delete from known_references where person_key=?",
                (str(person_key),),
            )
        # Do not rewrite the authoritative portrait embedding with live
        # observations. Matching consumes the complete retained gallery, while
        # people.embedding remains a stable fallback and recovery anchor.
        return retained_rows, retained_embeddings

    @staticmethod
    def _promote_unknown_references_to_known(
        db: sqlite3.Connection,
        subject_id: str,
        person_key: str,
        *,
        pinned_crop_path: str = "",
        pinned_embedding: np.ndarray | None = None,
        pinned_quality: float = 0.0,
        pinned_captured_at: str = "",
        pinned_quality_json: str = "{}",
    ) -> tuple[list[dict], list[np.ndarray]]:
        """Copy trusted manual-link references into the known gallery."""
        now = utc_now()
        for reference in db.execute(
            """
            select crop_path,embedding,quality,captured_at,quality_json
            from unknown_references where subject_id=?
            order by quality desc,id
            """,
            (str(subject_id),),
        ):
            db.execute(
                """
                insert into known_references
                    (person_key,crop_path,embedding,quality,captured_at,
                     quality_json,source,pinned,created_at)
                values (?,?,?,?,?,?,'linked_unknown',0,?)
                on conflict(person_key,crop_path) do update set
                    embedding=excluded.embedding,
                    quality=max(known_references.quality,excluded.quality),
                    captured_at=excluded.captured_at,
                    quality_json=excluded.quality_json,
                    source=case
                        when known_references.pinned=1
                        then known_references.source
                        else excluded.source
                    end
                """,
                (
                    str(person_key),
                    str(reference["crop_path"]),
                    reference["embedding"],
                    float(reference["quality"] or 0.0),
                    str(reference["captured_at"] or now),
                    str(reference["quality_json"] or "{}"),
                    now,
                ),
            )
        if pinned_crop_path and pinned_embedding is not None:
            db.execute(
                """
                insert into known_references
                    (person_key,crop_path,embedding,quality,captured_at,
                     quality_json,source,pinned,created_at)
                values (?,?,?,?,?,?,'manual_registration',1,?)
                on conflict(person_key,crop_path) do update set
                    embedding=excluded.embedding,
                    quality=max(known_references.quality,excluded.quality),
                    captured_at=excluded.captured_at,
                    quality_json=excluded.quality_json,
                    source='manual_registration',
                    pinned=1
                """,
                (
                    str(person_key),
                    str(pinned_crop_path),
                    embedding_blob(pinned_embedding),
                    float(pinned_quality),
                    str(pinned_captured_at or now),
                    str(pinned_quality_json or "{}"),
                    now,
                ),
            )
        return LocalStore._curate_known_references(db, str(person_key))

    @staticmethod
    def _save_unknown_reference(
        db: sqlite3.Connection,
        subject_id: str,
        crop_path: str,
        embedding: np.ndarray,
        quality: float,
        seen_at: datetime,
        quality_payload: dict,
    ) -> tuple[list[dict], list[np.ndarray]]:
        rejected = db.execute(
            """
            select 1 from face_crops
            where crop_path=? and evidence_reason='manual_rejected'
            """,
            (str(crop_path),),
        ).fetchone()
        if rejected:
            return LocalStore._curate_unknown_references(db, subject_id)
        db.execute(
            """
            insert into unknown_references
                (subject_id,crop_path,embedding,quality,captured_at,quality_json,created_at)
            values (?,?,?,?,?,?,?)
            on conflict(crop_path) do update set
                subject_id=excluded.subject_id,embedding=excluded.embedding,quality=excluded.quality,
                captured_at=excluded.captured_at,quality_json=excluded.quality_json
            """,
            (
                subject_id,
                crop_path,
                embedding_blob(embedding),
                float(quality),
                seen_at.isoformat(),
                json.dumps(quality_payload, ensure_ascii=True),
                utc_now(),
            ),
        )
        return LocalStore._curate_unknown_references(db, subject_id)

    @staticmethod
    def _curate_unknown_references(
        db: sqlite3.Connection,
        subject_id: str,
    ) -> tuple[list[dict], list[np.ndarray]]:
        rows = [
            dict(row)
            for row in db.execute(
                """
                select * from unknown_references
                where subject_id=?
                order by quality desc,id
                """,
                (subject_id,),
            )
        ]
        valid_rows: list[dict] = []
        embeddings: list[np.ndarray] = []
        for row in rows:
            embedding = blob_embedding(row.get("embedding"))
            if embedding is None:
                continue
            valid_rows.append(row)
            embeddings.append(embedding)
        retained_indexes = select_retained_reference_indices(
            embeddings,
            [float(row.get("quality") or 0.0) for row in valid_rows],
            limit=UNKNOWN_REFERENCE_LIMIT,
            duplicate_threshold=UNKNOWN_DUPLICATE_THRESHOLD,
            coherence_threshold=UNKNOWN_COHERENCE_THRESHOLD,
        )
        retained_rows = [valid_rows[index] for index in retained_indexes]
        retained_embeddings = [embeddings[index] for index in retained_indexes]
        retained_ids = [int(row["id"]) for row in retained_rows]
        if retained_ids:
            placeholders = ",".join("?" for _ in retained_ids)
            db.execute(
                f"""
                delete from unknown_references
                where subject_id=? and id not in ({placeholders})
                """,
                (subject_id, *retained_ids),
            )
        else:
            db.execute(
                "delete from unknown_references where subject_id=?",
                (subject_id,),
            )
        return retained_rows, retained_embeddings

    @staticmethod
    def _unknown_reference_centroid(
        rows: list[dict],
        embeddings: list[np.ndarray],
    ) -> np.ndarray | None:
        if not embeddings:
            return None
        return robust_reference_centroid(
            embeddings,
            [float(row.get("quality") or 0.0) for row in rows],
            coherence_threshold=UNKNOWN_COHERENCE_THRESHOLD,
        )

    def get_unknown(self, subject_id: str) -> dict:
        with self.connection() as db:
            return self._get_unknown(db, subject_id)

    @classmethod
    def _get_unknown(
        cls,
        db: sqlite3.Connection,
        subject_id: str,
    ) -> dict:
        subject_id = cls._canonical_unknown_id(db, subject_id)
        row = db.execute(
            "select * from unknown_subjects where subject_id=?",
            (subject_id,),
        ).fetchone()
        if not row:
            raise LookupError(subject_id)
        result = dict(row)
        result.pop("centroid", None)
        return result

    def set_unknowns_ignored(self, subject_ids: list[str], ignored: bool) -> dict:
        requested = [
            str(subject_id).strip()
            for subject_id in subject_ids
            if str(subject_id).strip()
        ]
        if not requested:
            raise ValueError("Selecciona al menos una persona para excluir.")

        with self.connection() as db:
            canonical_ids: list[str] = []
            for subject_id in requested:
                canonical = self._canonical_unknown_id(db, subject_id)
                if canonical not in canonical_ids:
                    canonical_ids.append(canonical)

            placeholders = ",".join("?" for _ in canonical_ids)
            rows = [
                dict(row)
                for row in db.execute(
                    f"""
                    select subject_id,temporary_name,status,quality_hits,best_crop_path
                    from unknown_subjects
                    where subject_id in ({placeholders})
                    """,
                    canonical_ids,
                )
            ]
            if len(rows) != len(canonical_ids):
                raise LookupError("No se encontraron todas las personas seleccionadas.")

            unavailable = [
                row["temporary_name"]
                for row in rows
                if row["status"] not in {"candidate", "consolidated", "ignored"}
            ]
            if unavailable:
                raise ValueError(
                    "No se pueden excluir identidades vinculadas o archivadas: "
                    + ", ".join(sorted(unavailable))
                )

            now = utc_now()
            if ignored:
                db.execute(
                    f"""
                    update unknown_subjects
                    set status='ignored',updated_at=?
                    where subject_id in ({placeholders})
                    """,
                    (now, *canonical_ids),
                )
            else:
                db.execute(
                    f"""
                    update unknown_subjects
                    set status=case
                            when quality_hits>0 or best_crop_path<>'' then 'consolidated'
                            else 'candidate'
                        end,
                        updated_at=?
                    where subject_id in ({placeholders})
                    """,
                    (now, *canonical_ids),
                )

        rows_by_id = {row["subject_id"]: row for row in rows}
        return {
            "ignored": bool(ignored),
            "subject_ids": canonical_ids,
            "names": [rows_by_id[subject_id]["temporary_name"] for subject_id in canonical_ids],
            "count": len(canonical_ids),
        }

    def quarantine_unknown(
        self,
        subject_id: str,
        reason: str,
        *,
        create_backup: bool = True,
        verify_integrity: bool = True,
    ) -> dict:
        requested_id = str(subject_id or "").strip()
        normalized_reason = str(reason or "").strip()
        if not requested_id:
            raise ValueError("Selecciona la identidad que se pondra en cuarentena.")
        if not normalized_reason:
            raise ValueError("Indica por que la identidad no es valida.")

        backup_path: Path | None = None
        with self.connection() as db:
            canonical_id = self._canonical_unknown_id(db, requested_id)
            row = db.execute(
                "select * from unknown_subjects where subject_id=?",
                (canonical_id,),
            ).fetchone()
            if not row:
                raise LookupError(requested_id)
            if row["status"] not in {
                "candidate",
                "consolidated",
                "ignored",
                "quarantined",
            }:
                raise ValueError(
                    "No se puede poner en cuarentena una identidad vinculada o archivada."
                )

            attendance_row = db.execute(
                """
                select count(*) as rows,coalesce(sum(detection_count),0) as detections
                from daily_presence
                where subject_kind='unknown' and subject_key=?
                """,
                (canonical_id,),
            ).fetchone()
            references_preserved = int(
                db.execute(
                    "select count(*) from unknown_references where subject_id=?",
                    (canonical_id,),
                ).fetchone()[0]
            )
            crops_preserved = int(
                db.execute(
                    """
                    select count(*) from face_crops
                    where subject_kind='unknown' and subject_key=?
                    """,
                    (canonical_id,),
                ).fetchone()[0]
            )
            queue_rows_preserved = int(
                db.execute(
                    "select count(*) from crop_processing_queue where result_key=?",
                    (canonical_id,),
                ).fetchone()[0]
            )

            if row["status"] == "quarantined":
                return {
                    "quarantined": True,
                    "already_quarantined": True,
                    "subject": self._get_unknown(db, canonical_id),
                    "reason": normalized_reason,
                    "attendance_rows_hidden": int(attendance_row["rows"] or 0),
                    "attendance_detections_hidden": int(
                        attendance_row["detections"] or 0
                    ),
                    "references_preserved": references_preserved,
                    "crops_preserved": crops_preserved,
                    "queue_rows_preserved": queue_rows_preserved,
                    "backup_path": "",
                }

            if create_backup:
                backup_dir = self.data_dir / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_path = backup_dir / (
                    "unknown-quarantine-"
                    f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-"
                    f"{uuid4().hex[:8]}.sqlite3"
                )
                backup_db = sqlite3.connect(backup_path)
                try:
                    db.backup(backup_db)
                finally:
                    backup_db.close()
                check_db = sqlite3.connect(backup_path)
                try:
                    backup_integrity = check_db.execute(
                        "pragma integrity_check"
                    ).fetchone()[0]
                finally:
                    check_db.close()
                if backup_integrity != "ok":
                    raise RuntimeError(
                        "La copia SQLite previa a la cuarentena no paso integrity_check."
                    )

            now = utc_now()
            try:
                quality_payload = json.loads(str(row["quality_json"] or "{}"))
            except (TypeError, ValueError, json.JSONDecodeError):
                quality_payload = {}
            if not isinstance(quality_payload, dict):
                quality_payload = {}
            existing_quarantine = quality_payload.get("quarantine")
            if not isinstance(existing_quarantine, dict):
                existing_quarantine = {}
            quality_payload["quarantine"] = {
                "reason": normalized_reason,
                "quarantined_at": str(
                    existing_quarantine.get("quarantined_at") or now
                ),
                "previous_status": str(
                    existing_quarantine.get("previous_status") or row["status"]
                ),
            }
            update_cursor = db.execute(
                """
                update unknown_subjects
                set status='quarantined',quality_json=?,updated_at=?
                where subject_id=? and status=?
                """,
                (
                    json.dumps(quality_payload, ensure_ascii=False),
                    now,
                    canonical_id,
                    str(row["status"]),
                ),
            )
            if int(update_cursor.rowcount) != 1:
                raise RuntimeError(
                    "La identidad cambio mientras se preparaba la cuarentena."
                )

            if verify_integrity:
                integrity = db.execute("pragma integrity_check").fetchone()[0]
                if integrity != "ok":
                    raise RuntimeError(
                        f"SQLite reporto integridad invalida: {integrity}"
                    )
                foreign_key_errors = [
                    dict(error) for error in db.execute("pragma foreign_key_check")
                ]
                if foreign_key_errors:
                    raise RuntimeError(
                        "SQLite reporto referencias rotas al poner la identidad "
                        f"en cuarentena: {foreign_key_errors[:5]}"
                    )

        return {
            "quarantined": True,
            "already_quarantined": False,
            "subject": self.get_unknown(canonical_id),
            "reason": normalized_reason,
            "attendance_rows_hidden": int(attendance_row["rows"] or 0),
            "attendance_detections_hidden": int(
                attendance_row["detections"] or 0
            ),
            "references_preserved": references_preserved,
            "crops_preserved": crops_preserved,
            "queue_rows_preserved": queue_rows_preserved,
            "backup_path": str(backup_path or ""),
        }

    def quarantined_unknowns(
        self,
        query: str = "",
        offset: int = 0,
        limit: int = 48,
    ) -> dict:
        normalized_query = str(query or "").strip().lower()
        search = f"%{normalized_query}%"
        safe_offset = max(0, int(offset))
        safe_limit = max(1, min(int(limit), 100))
        where = "status='quarantined' and (?='' or lower(temporary_name) like ?)"
        params = (normalized_query, search)
        with self.connection() as db:
            total = int(
                db.execute(
                    f"select count(*) from unknown_subjects where {where}",
                    params,
                ).fetchone()[0]
            )
            rows = [
                dict(row)
                for row in db.execute(
                    f"""
                    select subject_id,temporary_name,status,best_crop_path,best_quality,
                           first_seen_at,last_seen_at,detection_count,quality_hits,
                           quality_json,updated_at
                    from unknown_subjects
                    where {where}
                    order by updated_at desc,temporary_name collate nocase
                    limit ? offset ?
                    """,
                    (*params, safe_limit, safe_offset),
                )
            ]
        for row in rows:
            try:
                payload = json.loads(str(row.get("quality_json") or "{}"))
            except (TypeError, ValueError, json.JSONDecodeError):
                payload = {}
            quarantine = (
                payload.get("quarantine")
                if isinstance(payload, dict)
                and isinstance(payload.get("quarantine"), dict)
                else {}
            )
            row["quarantine_reason"] = str(quarantine.get("reason") or "")
            row["quarantined_at"] = str(quarantine.get("quarantined_at") or "")
            row.pop("quality_json", None)
        return {
            "items": rows,
            "total": total,
            "offset": safe_offset,
            "limit": safe_limit,
        }

    def ignored_unknowns(self, query: str = "", offset: int = 0, limit: int = 48) -> dict:
        normalized_query = str(query or "").strip().lower()
        search = f"%{normalized_query}%"
        safe_offset = max(0, int(offset))
        safe_limit = max(1, min(int(limit), 100))
        where = "status='ignored' and (?='' or lower(temporary_name) like ?)"
        params = (normalized_query, search)
        with self.connection() as db:
            total = int(
                db.execute(
                    f"select count(*) from unknown_subjects where {where}",
                    params,
                ).fetchone()[0]
            )
            rows = [
                dict(row)
                for row in db.execute(
                    f"""
                    select subject_id,temporary_name,status,best_crop_path,best_quality,
                           first_seen_at,last_seen_at,detection_count,quality_hits
                    from unknown_subjects
                    where {where}
                    order by last_seen_at desc,temporary_name collate nocase
                    limit ? offset ?
                    """,
                    (*params, safe_limit, safe_offset),
                )
            ]
        return {
            "items": rows,
            "total": total,
            "offset": safe_offset,
            "limit": safe_limit,
        }

    def merge_unknowns(
        self,
        target_subject_id: str,
        source_subject_ids: list[str],
        *,
        create_backup: bool = True,
        existing_backup_path: Path | None = None,
        verify_integrity: bool = True,
    ) -> dict:
        requested_sources = [
            str(subject_id).strip()
            for subject_id in source_subject_ids
            if str(subject_id).strip()
        ]
        if not str(target_subject_id or "").strip():
            raise ValueError("Selecciona la identidad principal.")
        if not requested_sources:
            raise ValueError("Selecciona al menos otro desconocido para unir.")

        with self.connection() as db:
            target_subject_id = self._canonical_unknown_id(db, target_subject_id)
            canonical_sources = []
            for subject_id in requested_sources:
                canonical = self._canonical_unknown_id(db, subject_id)
                if canonical != target_subject_id and canonical not in canonical_sources:
                    canonical_sources.append(canonical)
            if not canonical_sources:
                raise ValueError("Las identidades seleccionadas ya pertenecen al mismo grupo.")

            subject_ids = [target_subject_id, *canonical_sources]
            placeholders = ",".join("?" for _ in subject_ids)
            rows = [
                dict(row)
                for row in db.execute(
                    f"select * from unknown_subjects where subject_id in ({placeholders})",
                    subject_ids,
                )
            ]
            rows_by_id = {row["subject_id"]: row for row in rows}
            if len(rows_by_id) != len(subject_ids):
                raise LookupError("No se encontraron todos los desconocidos seleccionados.")
            unavailable = [
                row["temporary_name"]
                for row in rows
                if row["status"] not in {"candidate", "consolidated"}
            ]
            if unavailable:
                raise ValueError(
                    "No se pueden unir identidades vinculadas o archivadas: "
                    + ", ".join(sorted(unavailable))
                )

            references = [
                dict(row)
                for row in db.execute(
                    f"""
                    select * from unknown_references
                    where subject_id in ({placeholders})
                    order by quality desc,id asc
                    """,
                    subject_ids,
                )
            ]
            valid_references = []
            valid_reference_embeddings = []
            for reference in references:
                reference_embedding = blob_embedding(reference.get("embedding"))
                if reference_embedding is None:
                    continue
                valid_references.append(reference)
                valid_reference_embeddings.append(reference_embedding)
            retained_indexes = select_retained_reference_indices(
                valid_reference_embeddings,
                [float(reference.get("quality") or 0.0) for reference in valid_references],
                limit=UNKNOWN_REFERENCE_LIMIT,
                duplicate_threshold=UNKNOWN_DUPLICATE_THRESHOLD,
                coherence_threshold=UNKNOWN_COHERENCE_THRESHOLD,
            )
            best_references = [valid_references[index] for index in retained_indexes]
            retained_embeddings = [valid_reference_embeddings[index] for index in retained_indexes]
            if retained_embeddings:
                centroid = robust_reference_centroid(
                    retained_embeddings,
                    [float(reference.get("quality") or 0.0) for reference in best_references],
                    coherence_threshold=UNKNOWN_COHERENCE_THRESHOLD,
                )
            else:
                row_embeddings = [
                    (
                        blob_embedding(row["centroid"]),
                        max(float(row["detection_count"] or 0), 1.0),
                    )
                    for row in rows
                ]
                row_embeddings = [item for item in row_embeddings if item[0] is not None]
                if not row_embeddings:
                    raise ValueError("Las identidades seleccionadas no tienen embeddings validos.")
                embeddings = np.vstack([item[0] for item in row_embeddings])
                weights = np.asarray([item[1] for item in row_embeddings], dtype=np.float32)
                centroid = np.average(embeddings, axis=0, weights=weights)
                centroid /= max(float(np.linalg.norm(centroid)), 1e-12)

            best_row = max(rows, key=lambda row: float(row["best_quality"] or 0.0))
            best_reference = (
                max(best_references, key=lambda row: (float(row.get("quality") or 0.0), -int(row["id"])))
                if best_references
                else None
            )
            best_crop_path = str(
                (best_reference or {}).get("crop_path")
                or best_row.get("best_crop_path")
                or ""
            )
            best_quality = max(
                [float(row["best_quality"] or 0.0) for row in rows]
                + [float((best_reference or {}).get("quality") or 0.0)]
            )
            best_quality_json = str(
                (best_reference or {}).get("quality_json")
                or best_row.get("quality_json")
                or "{}"
            )
            status = (
                "consolidated"
                if references or any(row["status"] == "consolidated" for row in rows)
                else "candidate"
            )
            first_seen_at = min(str(row["first_seen_at"]) for row in rows)
            last_seen_at = max(str(row["last_seen_at"]) for row in rows)
            detection_count = sum(int(row["detection_count"] or 0) for row in rows)
            quality_hits = sum(int(row["quality_hits"] or 0) for row in rows)
            now = utc_now()

            backup_path = existing_backup_path
            if create_backup:
                backup_dir = self.data_dir / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_path = backup_dir / (
                    f"unknown-merge-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}.sqlite3"
                )
                backup_db = sqlite3.connect(backup_path)
                try:
                    db.backup(backup_db)
                finally:
                    backup_db.close()

            db.execute(
                """
                update unknown_subjects set status=?,centroid=?,best_crop_path=?,best_quality=?,
                    first_seen_at=?,last_seen_at=?,detection_count=?,quality_hits=?,
                    quality_version=?,quality_json=?,merged_into=null,updated_at=?
                where subject_id=?
                """,
                (
                    status,
                    embedding_blob(centroid),
                    best_crop_path,
                    best_quality,
                    first_seen_at,
                    last_seen_at,
                    detection_count,
                    quality_hits,
                    str(best_row.get("quality_version") or ""),
                    best_quality_json,
                    now,
                    target_subject_id,
                ),
            )

            db.execute(
                f"update unknown_references set subject_id=? where subject_id in ({','.join('?' for _ in canonical_sources)})",
                (target_subject_id, *canonical_sources),
            )
            retained_reference_ids = [int(reference["id"]) for reference in best_references]
            if retained_reference_ids:
                retained_placeholders = ",".join("?" for _ in retained_reference_ids)
                db.execute(
                    f"""
                    delete from unknown_references
                    where subject_id=? and id not in ({retained_placeholders})
                    """,
                    (target_subject_id, *retained_reference_ids),
                )
            else:
                db.execute(
                    "delete from unknown_references where subject_id=?",
                    (target_subject_id,),
                )

            crop_cursor = db.execute(
                f"""
                update face_crops
                set subject_key=?,evidence_selected=1,
                    evidence_reason='uncurated',evidence_score=0,
                    evidence_curated_at=''
                where subject_kind='unknown'
                  and subject_key in ({','.join('?' for _ in canonical_sources)})
                """,
                (target_subject_id, *canonical_sources),
            )
            crops_moved = int(crop_cursor.rowcount)
            db.execute(
                """
                update face_crops
                set evidence_selected=1,evidence_reason='uncurated',
                    evidence_score=0,evidence_curated_at=''
                where subject_kind='unknown' and subject_key=?
                """,
                (target_subject_id,),
            )
            queue_cursor = db.execute(
                f"""
                update crop_processing_queue
                set result_key=?,result_name=?,updated_at=?
                where result_kind='unknown'
                  and result_key in ({','.join('?' for _ in canonical_sources)})
                """,
                (
                    target_subject_id,
                    str(rows_by_id[target_subject_id]["temporary_name"]),
                    now,
                    *canonical_sources,
                ),
            )
            queue_results_moved = int(queue_cursor.rowcount)

            presence_rows = list(
                db.execute(
                    f"""
                    select * from daily_presence
                    where subject_kind='unknown'
                      and subject_key in ({','.join('?' for _ in canonical_sources)})
                    order by presence_date,session_id
                    """,
                    canonical_sources,
                )
            )
            for presence in presence_rows:
                db.execute(
                    """
                    insert into daily_presence
                        (subject_key,presence_date,subject_kind,first_seen_at,last_seen_at,
                         detection_count,best_similarity,best_crop_path,session_id,synced)
                    values (?,?,'unknown',?,?,?,?,?,?,?)
                    on conflict(subject_key,presence_date,session_id) do update set
                        subject_kind='unknown',
                        first_seen_at=min(daily_presence.first_seen_at,excluded.first_seen_at),
                        last_seen_at=max(daily_presence.last_seen_at,excluded.last_seen_at),
                        detection_count=daily_presence.detection_count + excluded.detection_count,
                        best_crop_path=case
                            when excluded.best_similarity >= daily_presence.best_similarity
                                 and excluded.best_crop_path <> ''
                            then excluded.best_crop_path else daily_presence.best_crop_path end,
                        best_similarity=max(daily_presence.best_similarity,excluded.best_similarity),
                        synced=min(daily_presence.synced,excluded.synced)
                    """,
                    (
                        target_subject_id,
                        presence["presence_date"],
                        presence["first_seen_at"],
                        presence["last_seen_at"],
                        int(presence["detection_count"] or 0),
                        float(presence["best_similarity"] or 0.0),
                        str(presence["best_crop_path"] or ""),
                        int(presence["session_id"]),
                        int(presence["synced"] or 0),
                    ),
                )
            db.execute(
                f"""
                delete from daily_presence
                where subject_kind='unknown'
                  and subject_key in ({','.join('?' for _ in canonical_sources)})
                """,
                canonical_sources,
            )
            stats_rows = list(
                db.execute(
                    f"""
                    select * from daily_detection_stats
                    where subject_kind='unknown'
                      and subject_key in ({','.join('?' for _ in canonical_sources)})
                    order by evidence_date
                    """,
                    canonical_sources,
                )
            )
            for stats in stats_rows:
                db.execute(
                    """
                    insert into daily_detection_stats
                        (subject_key,subject_kind,evidence_date,detection_count,
                         first_seen_at,last_seen_at,retained_count,curated_at)
                    values (?,'unknown',?,?,?,?,?,?)
                    on conflict(subject_key,subject_kind,evidence_date) do update set
                        detection_count=daily_detection_stats.detection_count
                            + excluded.detection_count,
                        first_seen_at=case
                            when daily_detection_stats.first_seen_at=''
                            then excluded.first_seen_at
                            when excluded.first_seen_at=''
                            then daily_detection_stats.first_seen_at
                            else min(
                                daily_detection_stats.first_seen_at,
                                excluded.first_seen_at
                            )
                        end,
                        last_seen_at=max(
                            daily_detection_stats.last_seen_at,
                            excluded.last_seen_at
                        ),
                        retained_count=daily_detection_stats.retained_count
                            + excluded.retained_count,
                        curated_at=excluded.curated_at
                    """,
                    (
                        target_subject_id,
                        stats["evidence_date"],
                        int(stats["detection_count"] or 0),
                        str(stats["first_seen_at"] or ""),
                        str(stats["last_seen_at"] or ""),
                        int(stats["retained_count"] or 0),
                        now,
                    ),
                )
            db.execute(
                f"""
                delete from daily_detection_stats
                where subject_kind='unknown'
                  and subject_key in ({','.join('?' for _ in canonical_sources)})
                """,
                canonical_sources,
            )

            db.execute(
                f"""
                update unknown_subjects
                set status='archived',linked_person_key=null,remote_subject_id=null,
                    merged_into=?,updated_at=?
                where subject_id in ({','.join('?' for _ in canonical_sources)})
                """,
                (target_subject_id, now, *canonical_sources),
            )
            if verify_integrity:
                integrity = db.execute("pragma integrity_check").fetchone()[0]
                if integrity != "ok":
                    raise RuntimeError(f"SQLite reporto integridad invalida: {integrity}")
                foreign_key_errors = [
                    dict(row) for row in db.execute("pragma foreign_key_check")
                ]
                if foreign_key_errors:
                    raise RuntimeError(
                        "SQLite reporto referencias rotas despues de unir "
                        f"desconocidos: {foreign_key_errors[:5]}"
                    )

        target = self.get_unknown(target_subject_id)
        return {
            "merged": True,
            "target": target,
            "merged_subject_ids": canonical_sources,
            "merged_names": [rows_by_id[subject_id]["temporary_name"] for subject_id in canonical_sources],
            "crops_moved": crops_moved,
            "queue_results_moved": queue_results_moved,
            "attendance_rows_merged": len(presence_rows),
            "backup_path": str(backup_path or ""),
        }

    def link_unknown(self, subject_id: str, person_key: str, registration_payload: dict) -> None:
        with self.connection() as db:
            subject_id = self._canonical_unknown_id(db, subject_id)
            person = db.execute(
                """
                select person_key from people
                where person_key=? and active=1 and embedding is not null
                """,
                (str(person_key),),
            ).fetchone()
            db.execute(
                "update unknown_subjects set status='linked', linked_person_key=?, updated_at=? where subject_id=?",
                (person_key, utc_now(), subject_id),
            )
            if person:
                self._promote_unknown_references_to_known(
                    db,
                    subject_id,
                    str(person_key),
                )
        self.queue_event(f"unknown-register:{subject_id}", "unknown_register", registration_payload)

    def complete_unknown_link(self, subject_id: str, remote_subject_id: str | None) -> None:
        with self.connection() as db:
            subject_id = self._canonical_unknown_id(db, subject_id)
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

    def recent_detections(
        self,
        selected_date: str | None = None,
        limit: int = 40,
        offset: int = 0,
    ) -> list[dict]:
        selected_date = selected_date or datetime.now(
            BUSINESS_TIME_ZONE
        ).date().isoformat()
        with self.connection() as db:
            rows = db.execute(
                """
                with crop_groups as (
                    select subject_key,subject_kind as kind,count(*) as crop_count,
                           min(seen_at) as crop_first,max(seen_at) as crop_last
                    from face_crops
                    where substr(seen_at,1,10)=?
                      and evidence_reason<>'manual_rejected'
                    group by subject_key,subject_kind
                ),
                presence_groups as (
                    select subject_key,subject_kind as kind,sum(detection_count) as presence_count,
                           min(first_seen_at) as presence_first,max(last_seen_at) as presence_last,
                           max(best_similarity) as presence_similarity,max(best_crop_path) as presence_crop
                    from daily_presence
                    where presence_date=?
                    group by subject_key,subject_kind
                ),
                stats_groups as (
                    select subject_key,subject_kind as kind,
                           detection_count as stats_count,
                           first_seen_at as stats_first,
                           last_seen_at as stats_last
                    from daily_detection_stats
                    where evidence_date=?
                ),
                detection_keys as (
                    select subject_key,kind from crop_groups
                    union
                    select subject_key,kind from presence_groups
                    union
                    select subject_key,kind from stats_groups
                )
                select detection_keys.subject_key,
                       detection_keys.kind,
                       coalesce(person.name,unknown_subject.temporary_name,detection_keys.subject_key) as name,
                       coalesce((
                           select latest.similarity from face_crops latest
                           where latest.subject_key=detection_keys.subject_key
                             and latest.subject_kind=detection_keys.kind
                             and substr(latest.seen_at,1,10)=?
                             and latest.evidence_selected=1
                           order by latest.seen_at desc,latest.id desc limit 1
                       ),presence_groups.presence_similarity,0) as similarity,
                       max(
                           coalesce(crop_groups.crop_last,''),
                           coalesce(presence_groups.presence_last,''),
                           coalesce(stats_groups.stats_last,'')
                       ) as seen_at,
                       coalesce((
                           select latest.crop_path from face_crops latest
                           where latest.subject_key=detection_keys.subject_key
                             and latest.subject_kind=detection_keys.kind
                             and substr(latest.seen_at,1,10)=?
                             and latest.evidence_selected=1
                           order by latest.seen_at desc,latest.id desc limit 1
                       ),presence_groups.presence_crop,'') as crop_path,
                       max(
                           coalesce(crop_groups.crop_count,0),
                           coalesce(presence_groups.presence_count,0),
                           coalesce(stats_groups.stats_count,0)
                       ) as detection_count,
                       (
                           select latest.id from face_crops latest
                           where latest.subject_key=detection_keys.subject_key
                             and latest.subject_kind=detection_keys.kind
                             and substr(latest.seen_at,1,10)=?
                             and latest.evidence_selected=1
                           order by latest.seen_at desc,latest.id desc limit 1
                       ) as crop_id,
                       coalesce((
                           select latest.camera from face_crops latest
                           where latest.subject_key=detection_keys.subject_key
                             and latest.subject_kind=detection_keys.kind
                             and substr(latest.seen_at,1,10)=?
                             and latest.evidence_selected=1
                           order by latest.seen_at desc,latest.id desc limit 1
                       ),'') as camera,
                       coalesce(unknown_subject.status,
                           case when detection_keys.kind='known' then 'known' else '' end) as status
                from detection_keys
                left join crop_groups
                  on crop_groups.subject_key=detection_keys.subject_key and crop_groups.kind=detection_keys.kind
                left join presence_groups
                  on presence_groups.subject_key=detection_keys.subject_key and presence_groups.kind=detection_keys.kind
                left join stats_groups
                  on stats_groups.subject_key=detection_keys.subject_key and stats_groups.kind=detection_keys.kind
                left join people person
                  on detection_keys.kind='known' and person.person_key=detection_keys.subject_key
                left join unknown_subjects unknown_subject
                  on detection_keys.kind='unknown' and unknown_subject.subject_id=detection_keys.subject_key
                where detection_keys.kind<>'unknown'
                   or coalesce(unknown_subject.status,'') not in ('ignored','quarantined')
                order by seen_at desc
                limit ? offset ?
                """,
                (
                    selected_date,
                    selected_date,
                    selected_date,
                    selected_date,
                    selected_date,
                    selected_date,
                    selected_date,
                    max(1, min(int(limit), 200)),
                    max(0, int(offset)),
                ),
            ).fetchall()
        return [dict(row) for row in rows]

    def detection_summary(self, selected_date: str | None = None) -> dict[str, int]:
        selected_date = selected_date or datetime.now(
            BUSINESS_TIME_ZONE
        ).date().isoformat()
        with self.connection() as db:
            row = db.execute(
                """
                with crop_groups as (
                    select subject_key,subject_kind as kind,count(*) as crop_count
                    from face_crops
                    where substr(seen_at,1,10)=?
                      and evidence_reason<>'manual_rejected'
                    group by subject_key,subject_kind
                ),
                presence_groups as (
                    select subject_key,subject_kind as kind,sum(detection_count) as presence_count
                    from daily_presence where presence_date=?
                    group by subject_key,subject_kind
                ),
                stats_groups as (
                    select subject_key,subject_kind as kind,
                           detection_count as stats_count
                    from daily_detection_stats where evidence_date=?
                ),
                detection_keys as (
                    select subject_key,kind from crop_groups
                    union
                    select subject_key,kind from presence_groups
                    union
                    select subject_key,kind from stats_groups
                )
                select count(*) as subjects,
                       coalesce(sum(
                           max(
                               coalesce(crop_groups.crop_count,0),
                               coalesce(presence_groups.presence_count,0),
                               coalesce(stats_groups.stats_count,0)
                           )
                       ),0) as detections
                from detection_keys
                left join crop_groups
                  on crop_groups.subject_key=detection_keys.subject_key and crop_groups.kind=detection_keys.kind
                left join presence_groups
                  on presence_groups.subject_key=detection_keys.subject_key and presence_groups.kind=detection_keys.kind
                left join stats_groups
                  on stats_groups.subject_key=detection_keys.subject_key and stats_groups.kind=detection_keys.kind
                left join unknown_subjects unknown_subject
                  on detection_keys.kind='unknown' and unknown_subject.subject_id=detection_keys.subject_key
                where detection_keys.kind<>'unknown'
                   or coalesce(unknown_subject.status,'') not in ('ignored','quarantined')
                """,
                (selected_date, selected_date, selected_date),
            ).fetchone()
        return {"subjects": int(row["subjects"] or 0), "detections": int(row["detections"] or 0)}

    def record_crop(
        self,
        subject_key: str,
        kind: str,
        seen_at: datetime,
        crop_path: str,
        similarity: float,
        quality: float,
        camera: str = "",
        *,
        embedding: np.ndarray | None = None,
        analysis_version: str = "",
        quality_pass: bool = False,
        quality_payload: dict | None = None,
    ) -> bool:
        if not crop_path:
            return False
        with self.connection() as db:
            return self._record_crop(
                db,
                subject_key,
                kind,
                seen_at,
                crop_path,
                similarity,
                quality,
                camera,
                embedding=embedding,
                analysis_version=analysis_version,
                quality_pass=quality_pass,
                quality_payload=quality_payload,
            )

    @staticmethod
    def _record_crop(
        db: sqlite3.Connection,
        subject_key: str,
        kind: str,
        seen_at: datetime,
        crop_path: str,
        similarity: float,
        quality: float,
        camera: str = "",
        *,
        embedding: np.ndarray | None = None,
        analysis_version: str = "",
        quality_pass: bool = False,
        quality_payload: dict | None = None,
    ) -> bool:
        if not crop_path:
            return False
        if kind == "unknown":
            subject = db.execute(
                "select status from unknown_subjects where subject_id=?",
                (subject_key,),
            ).fetchone()
            if subject and subject["status"] in UNKNOWN_INACTIVE_STATUSES:
                return False
        db.execute(
            """
            insert into face_crops
                (subject_key, subject_kind, seen_at, crop_path, similarity, quality, camera,
                 embedding,analysis_version,quality_pass,quality_json,
                 evidence_selected,evidence_reason,evidence_score,evidence_curated_at,
                 created_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'uncurated', 0, '', ?)
            on conflict(crop_path) do update set
                subject_key=excluded.subject_key,
                subject_kind=excluded.subject_kind,
                seen_at=excluded.seen_at,
                similarity=excluded.similarity,
                quality=excluded.quality,
                camera=excluded.camera,
                embedding=coalesce(excluded.embedding,face_crops.embedding),
                analysis_version=excluded.analysis_version,
                quality_pass=excluded.quality_pass,
                quality_json=excluded.quality_json,
                evidence_selected=case
                    when face_crops.evidence_reason='manual_rejected'
                    then 0 else 1 end,
                evidence_reason=case
                    when face_crops.evidence_reason='manual_rejected'
                    then face_crops.evidence_reason else 'uncurated' end,
                evidence_score=case
                    when face_crops.evidence_reason='manual_rejected'
                    then face_crops.evidence_score else 0 end,
                evidence_curated_at=case
                    when face_crops.evidence_reason='manual_rejected'
                    then face_crops.evidence_curated_at else '' end
            """,
            (
                subject_key,
                kind,
                seen_at.isoformat(),
                str(Path(crop_path).resolve()),
                float(similarity),
                float(quality),
                camera,
                embedding_blob(embedding) if embedding is not None else None,
                analysis_version,
                int(quality_pass),
                json.dumps(quality_payload or {}, ensure_ascii=True),
                utc_now(),
            ),
        )
        return True

    @staticmethod
    def _iter_json_strings(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for nested in value.values():
                yield from LocalStore._iter_json_strings(nested)
        elif isinstance(value, (list, tuple)):
            for nested in value:
                yield from LocalStore._iter_json_strings(nested)

    @staticmethod
    def _path_key(value: str | Path) -> str:
        text = str(value or "").strip()
        if not text or "://" in text:
            return ""
        try:
            return os.path.normcase(os.path.normpath(str(Path(text).resolve())))
        except (OSError, RuntimeError, ValueError):
            return ""

    @classmethod
    def _protected_crop_paths(cls, db: sqlite3.Connection) -> set[str]:
        protected: set[str] = set()
        queries = (
            "select crop_path from unknown_references where trim(crop_path)<>''",
            "select crop_path from known_references where trim(crop_path)<>''",
            "select photo_path as crop_path from people where trim(photo_path)<>''",
            "select best_crop_path as crop_path from unknown_subjects where trim(best_crop_path)<>''",
            "select best_crop_path as crop_path from daily_presence where trim(best_crop_path)<>''",
            """
            select crop.crop_path
            from face_crops crop
            join unknown_subjects subject
              on crop.subject_kind='unknown' and subject.subject_id=crop.subject_key
            where subject.status='quarantined' and trim(crop.crop_path)<>''
            """,
        )
        for query in queries:
            for row in db.execute(query):
                key = cls._path_key(row["crop_path"])
                if key:
                    protected.add(key)
        for row in db.execute(
            """
            select payload_json from sync_queue
            where status<>'done' and trim(payload_json)<>''
            """
        ):
            try:
                payload = json.loads(row["payload_json"])
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            for value in cls._iter_json_strings(payload):
                key = cls._path_key(value)
                if key:
                    protected.add(key)
        return protected

    def curate_daily_evidence(
        self,
        selected_date: str,
        *,
        limit: int = 30,
    ) -> dict:
        """Select a compact, auditable evidence set for every identity on a day.

        This operation only changes selection metadata. Files and crop rows are
        kept intact during the safety window.
        """
        try:
            datetime.strptime(str(selected_date), "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("Fecha de evidencia no valida.") from exc
        safe_limit = max(1, int(limit))
        curated_at = utc_now()
        with self.connection(immediate=True) as db:
            rows = [
                dict(row)
                for row in db.execute(
                    """
                    select id,subject_key,subject_kind,seen_at,crop_path,
                           quality,camera,embedding,quality_pass,quality_json
                    from face_crops
                    where substr(seen_at,1,10)=?
                      and evidence_reason<>'manual_rejected'
                    order by subject_kind,subject_key,seen_at,id
                    """,
                    (str(selected_date),),
                )
            ]
            protected_paths = self._protected_crop_paths(db)
            groups: dict[tuple[str, str], list[dict]] = {}
            for row in rows:
                groups.setdefault(
                    (str(row["subject_kind"]), str(row["subject_key"])),
                    [],
                ).append(row)

            selected_total = 0
            protected_total = 0
            quality_rejected_total = 0
            group_reports: list[dict] = []
            for (kind, subject_key), group_rows in groups.items():
                eligible_rows = [
                    row
                    for row in group_rows
                    if int(row.get("quality_pass") or 0) == 1
                ]
                quality_rejected_rows = [
                    row
                    for row in group_rows
                    if int(row.get("quality_pass") or 0) != 1
                ]
                required_ids = [
                    int(row["id"])
                    for row in eligible_rows
                    if self._path_key(row["crop_path"]) in protected_paths
                ]
                effective_limit = max(safe_limit, len(required_ids))
                selection = select_daily_evidence(
                    [
                        {
                            "id": int(row["id"]),
                            "captured_at": row["seen_at"],
                            "camera": row["camera"],
                            "quality": float(row["quality"] or 0.0),
                            "embedding": blob_embedding(row.get("embedding")),
                        }
                        for row in eligible_rows
                    ],
                    limit=effective_limit,
                    required_ids=required_ids,
                )
                decisions = {
                    int(decision.candidate_id): decision
                    for decision in selection.decisions
                }
                db.executemany(
                    """
                    update face_crops
                    set evidence_selected=?,evidence_reason=?,evidence_score=?,
                        evidence_curated_at=?
                    where id=?
                    """,
                    [
                        (
                            int(decision.retained),
                            decision.reason,
                            float(decision.selection_score or 0.0),
                            curated_at,
                            crop_id,
                        )
                        for crop_id, decision in decisions.items()
                    ],
                )
                if quality_rejected_rows:
                    db.executemany(
                        """
                        update face_crops
                        set evidence_selected=0,
                            evidence_reason='quality_rejected',
                            evidence_score=0,
                            evidence_curated_at=?
                        where id=? and evidence_reason<>'manual_rejected'
                        """,
                        [
                            (curated_at, int(row["id"]))
                            for row in quality_rejected_rows
                        ],
                    )
                retained_count = int(selection.summary.retained_count)
                selected_total += retained_count
                protected_total += len(required_ids)
                quality_rejected_total += len(quality_rejected_rows)

                presence = db.execute(
                    """
                    select coalesce(sum(detection_count),0) as detections,
                           min(first_seen_at) as first_seen_at,
                           max(last_seen_at) as last_seen_at
                    from daily_presence
                    where subject_key=? and subject_kind=? and presence_date=?
                    """,
                    (subject_key, kind, str(selected_date)),
                ).fetchone()
                crop_first = str(group_rows[0]["seen_at"] or "")
                crop_last = str(group_rows[-1]["seen_at"] or "")
                first_values = [
                    value
                    for value in (
                        crop_first,
                        str(presence["first_seen_at"] or ""),
                    )
                    if value
                ]
                last_values = [
                    value
                    for value in (
                        crop_last,
                        str(presence["last_seen_at"] or ""),
                    )
                    if value
                ]
                detection_count = max(
                    len(group_rows),
                    int(presence["detections"] or 0),
                )
                db.execute(
                    """
                    insert into daily_detection_stats
                        (subject_key,subject_kind,evidence_date,detection_count,
                         first_seen_at,last_seen_at,retained_count,curated_at)
                    values (?,?,?,?,?,?,?,?)
                    on conflict(subject_key,subject_kind,evidence_date) do update set
                        detection_count=max(
                            daily_detection_stats.detection_count,
                            excluded.detection_count
                        ),
                        first_seen_at=case
                            when daily_detection_stats.first_seen_at=''
                            then excluded.first_seen_at
                            when excluded.first_seen_at=''
                            then daily_detection_stats.first_seen_at
                            else min(
                                daily_detection_stats.first_seen_at,
                                excluded.first_seen_at
                            )
                        end,
                        last_seen_at=max(
                            daily_detection_stats.last_seen_at,
                            excluded.last_seen_at
                        ),
                        retained_count=excluded.retained_count,
                        curated_at=excluded.curated_at
                    """,
                    (
                        subject_key,
                        kind,
                        str(selected_date),
                        detection_count,
                        min(first_values) if first_values else "",
                        max(last_values) if last_values else "",
                        retained_count,
                        curated_at,
                    ),
                )
                group_reports.append(
                    {
                        "subject_key": subject_key,
                        "subject_kind": kind,
                        "candidates": len(group_rows),
                        "eligible": len(eligible_rows),
                        "quality_rejected": len(quality_rejected_rows),
                        "selected": retained_count,
                        "protected": len(required_ids),
                        "limit": effective_limit,
                    }
                )

        return {
            "date": str(selected_date),
            "groups": len(groups),
            "candidates": len(rows),
            "selected": selected_total,
            "redundant": max(0, len(rows) - selected_total),
            "quality_rejected": quality_rejected_total,
            "protected": protected_total,
            "limit": safe_limit,
            "curated_at": curated_at,
            "items": group_reports,
        }

    def enforce_strict_face_evidence_policy(
        self,
        *,
        max_yaw: float = 15.0,
        recurate: bool = True,
        daily_limit: int = 30,
    ) -> dict:
        """Quarantine profile/failed evidence while preserving audit files.

        Existing files and crop rows remain untouched. Invalid crops are
        removed from evidence selection and from adaptive galleries. Unknown
        identities that lose every trusted reference stop generating
        attendance and are quarantined for audit instead of remaining active.
        """
        safe_max_yaw = float(max_yaw)
        if not 0.0 < safe_max_yaw <= 45.0:
            raise ValueError("max_yaw debe estar entre 0 y 45 grados.")
        curated_at = utc_now()
        tightened_pose = 0
        affected_unknown_ids: list[str] = []
        affected_dates: list[str] = []
        unknown_references_removed = 0
        known_references_removed = 0
        identities_quarantined = 0
        identities_rebuilt = 0
        attendance_rows_removed = 0

        with self.connection(immediate=True) as db:
            pose_rows = [
                dict(row)
                for row in db.execute(
                    """
                    select id,quality_json
                    from face_crops
                    where quality_pass=1
                      and evidence_reason<>'manual_rejected'
                    """
                )
            ]
            pose_updates: list[tuple[str, int]] = []
            for row in pose_rows:
                try:
                    payload = json.loads(str(row.get("quality_json") or "{}"))
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                if not isinstance(payload, dict):
                    continue
                try:
                    yaw = abs(float(payload.get("yaw") or 0.0))
                except (TypeError, ValueError):
                    continue
                if yaw <= safe_max_yaw:
                    continue
                reasons = [
                    str(reason)
                    for reason in payload.get("reasons", [])
                    if str(reason)
                ]
                if "rostro_de_lado" not in reasons:
                    reasons.append("rostro_de_lado")
                payload["accepted"] = False
                payload["reasons"] = reasons
                payload["strict_policy"] = {
                    "max_yaw": safe_max_yaw,
                    "applied_at": curated_at,
                }
                pose_updates.append(
                    (
                        json.dumps(payload, ensure_ascii=True),
                        int(row["id"]),
                    )
                )
            if pose_updates:
                db.executemany(
                    """
                    update face_crops
                    set quality_pass=0,quality_json=?
                    where id=?
                    """,
                    pose_updates,
                )
            tightened_pose = len(pose_updates)

            db.execute(
                """
                update face_crops
                set evidence_selected=0,
                    evidence_reason='quality_rejected',
                    evidence_score=0,
                    evidence_curated_at=?
                where quality_pass=0
                  and evidence_reason<>'manual_rejected'
                """,
                (curated_at,),
            )
            affected_dates = [
                str(row["evidence_date"])
                for row in db.execute(
                    """
                    select distinct substr(seen_at,1,10) as evidence_date
                    from face_crops
                    where quality_pass=0
                      and evidence_reason='quality_rejected'
                    order by evidence_date
                    """
                )
                if str(row["evidence_date"] or "")
            ]

            db.execute(
                """
                create temp table if not exists strict_rejected_paths (
                    crop_path text primary key
                )
                """
            )
            db.execute("delete from strict_rejected_paths")
            db.execute(
                """
                insert or ignore into strict_rejected_paths(crop_path)
                select crop_path
                from face_crops
                where quality_pass=0 and trim(crop_path)<>''
                """
            )
            affected_unknown_ids = [
                str(row["subject_id"])
                for row in db.execute(
                    """
                    select distinct reference.subject_id
                    from unknown_references reference
                    join strict_rejected_paths rejected
                      on rejected.crop_path=reference.crop_path
                    order by reference.subject_id
                    """
                )
            ]
            unknown_references_removed = int(
                db.execute(
                    """
                    delete from unknown_references
                    where exists (
                        select 1
                        from strict_rejected_paths rejected
                        where rejected.crop_path=unknown_references.crop_path
                    )
                    """
                ).rowcount
            )
            known_references_removed = int(
                db.execute(
                    """
                    delete from known_references
                    where pinned=0
                      and exists (
                          select 1
                          from strict_rejected_paths rejected
                          where rejected.crop_path=known_references.crop_path
                      )
                    """
                ).rowcount
            )

            for subject_id in affected_unknown_ids:
                subject = db.execute(
                    """
                    select status,quality_json
                    from unknown_subjects where subject_id=?
                    """,
                    (subject_id,),
                ).fetchone()
                if not subject:
                    continue
                references, embeddings = self._curate_unknown_references(
                    db,
                    subject_id,
                )
                centroid = self._unknown_reference_centroid(
                    references,
                    embeddings,
                )
                if references and centroid is not None:
                    best = max(
                        references,
                        key=lambda row: (
                            float(row.get("quality") or 0.0),
                            str(row.get("captured_at") or ""),
                            int(row.get("id") or 0),
                        ),
                    )
                    status = str(subject["status"] or "")
                    next_status = (
                        "consolidated"
                        if status in {"candidate", "consolidated"}
                        else status
                    )
                    db.execute(
                        """
                        update unknown_subjects
                        set status=?,centroid=?,best_crop_path=?,best_quality=?,
                            quality_hits=?,quality_version=?,
                            quality_json=?,updated_at=?
                        where subject_id=?
                        """,
                        (
                            next_status,
                            embedding_blob(centroid),
                            str(best.get("crop_path") or ""),
                            float(best.get("quality") or 0.0),
                            len(references),
                            "strict-frontal-gallery-v1",
                            str(best.get("quality_json") or "{}"),
                            curated_at,
                            subject_id,
                        ),
                    )
                    identities_rebuilt += 1
                    continue

                current_status = str(subject["status"] or "")
                if current_status not in {"candidate", "consolidated"}:
                    continue
                valid_rows: list[dict] = []
                valid_embeddings: list[np.ndarray] = []
                for candidate in db.execute(
                    """
                    select embedding
                    from face_crops
                    where subject_kind='unknown' and subject_key=?
                      and quality_pass=1 and embedding is not null
                    order by quality desc,seen_at desc,id desc
                    limit 30
                    """,
                    (subject_id,),
                ):
                    embedding = blob_embedding(candidate["embedding"])
                    if embedding is not None:
                        valid_rows.append({"quality": 1.0})
                        valid_embeddings.append(embedding)
                fallback_centroid = self._unknown_reference_centroid(
                    valid_rows,
                    valid_embeddings,
                )
                if fallback_centroid is not None:
                    next_status = "candidate"
                    next_centroid = embedding_blob(fallback_centroid)
                else:
                    next_status = "quarantined"
                    next_centroid = None
                    identities_quarantined += 1
                try:
                    subject_payload = json.loads(
                        str(subject["quality_json"] or "{}")
                    )
                except (TypeError, ValueError, json.JSONDecodeError):
                    subject_payload = {}
                if not isinstance(subject_payload, dict):
                    subject_payload = {}
                subject_payload["strict_evidence_policy"] = {
                    "reason": "sin_referencia_frontal_valida",
                    "max_yaw": safe_max_yaw,
                    "applied_at": curated_at,
                }
                db.execute(
                    """
                    update unknown_subjects
                    set status=?,centroid=coalesce(?,centroid),
                        best_crop_path='',best_quality=0,quality_hits=0,
                        quality_version='strict-frontal-gallery-v1',
                        quality_json=?,updated_at=?
                    where subject_id=?
                    """,
                    (
                        next_status,
                        next_centroid,
                        json.dumps(subject_payload, ensure_ascii=True),
                        curated_at,
                        subject_id,
                    ),
                )
                attendance_rows_removed += int(
                    db.execute(
                        """
                        delete from daily_presence
                        where subject_kind='unknown' and subject_key=?
                        """,
                        (subject_id,),
                    ).rowcount
                )

        curation_reports = (
            [
                self.curate_daily_evidence(
                    selected_date,
                    limit=max(1, int(daily_limit)),
                )
                for selected_date in affected_dates
            ]
            if recurate
            else []
        )
        return {
            "max_yaw": safe_max_yaw,
            "tightened_pose": tightened_pose,
            "quality_rejected": sum(
                int(report.get("quality_rejected") or 0)
                for report in curation_reports
            ),
            "affected_dates": affected_dates,
            "unknown_references_removed": unknown_references_removed,
            "known_references_removed": known_references_removed,
            "identities_rebuilt": identities_rebuilt,
            "identities_quarantined": identities_quarantined,
            "attendance_rows_removed": attendance_rows_removed,
            "curated_dates": len(curation_reports),
            "applied_at": curated_at,
        }

    def evidence_dates_needing_curation(
        self,
        *,
        through_date: str | None = None,
    ) -> list[str]:
        params: list[object] = []
        where = (
            "trim(evidence_curated_at)='' "
            "and evidence_reason<>'manual_rejected'"
        )
        if through_date:
            try:
                datetime.strptime(str(through_date), "%Y-%m-%d")
            except ValueError as exc:
                raise ValueError("Fecha limite no valida.") from exc
            where += " and substr(seen_at,1,10)<=?"
            params.append(str(through_date))
        with self.connection() as db:
            dates = [
                str(row["evidence_date"])
                for row in db.execute(
                    f"""
                    select distinct substr(seen_at,1,10) as evidence_date
                    from face_crops
                    where {where}
                    order by evidence_date
                    """,
                    params,
                )
            ]
        return dates

    def curate_pending_daily_evidence(
        self,
        *,
        limit: int = 30,
        through_date: str | None = None,
    ) -> dict:
        reports = [
            self.curate_daily_evidence(selected_date, limit=limit)
            for selected_date in self.evidence_dates_needing_curation(
                through_date=through_date
            )
        ]
        return {
            "dates": len(reports),
            "groups": sum(int(report["groups"]) for report in reports),
            "candidates": sum(int(report["candidates"]) for report in reports),
            "selected": sum(int(report["selected"]) for report in reports),
            "redundant": sum(int(report["redundant"]) for report in reports),
            "items": reports,
        }

    def _retention_candidates(
        self,
        db: sqlite3.Connection,
        *,
        cutoff_date: str,
    ) -> list[dict]:
        protected_paths = self._protected_crop_paths(db)
        incomplete_dates = {
            str(row["capture_date"])
            for row in db.execute(
                """
                select capture_date
                from crop_processing_stats
                where status in ('pending','processing') and item_count>0
                """
            )
        }
        candidates = []
        faces_root = self.faces_dir.resolve()
        for row in db.execute(
            """
            select id,subject_key,subject_kind,seen_at,crop_path
            from face_crops
            where evidence_selected=0
              and trim(evidence_curated_at)<>''
              and substr(seen_at,1,10)<?
            order by seen_at,id
            """,
            (str(cutoff_date),),
        ):
            item = dict(row)
            evidence_date = str(item["seen_at"])[:10]
            if evidence_date in incomplete_dates:
                continue
            key = self._path_key(item["crop_path"])
            if not key or key in protected_paths:
                continue
            path = Path(str(item["crop_path"])).resolve()
            try:
                relative = path.relative_to(faces_root)
            except ValueError:
                continue
            if not path.is_file():
                continue
            item["relative_path"] = str(relative)
            try:
                item["file_bytes"] = int(path.stat().st_size)
            except OSError:
                continue
            candidates.append(item)
        return candidates

    def retention_preview(
        self,
        *,
        safety_days: int = 7,
        run_at: datetime | None = None,
    ) -> dict:
        safe_days = max(1, int(safety_days))
        local_now = run_at or datetime.now().astimezone()
        if local_now.tzinfo is None:
            local_now = local_now.astimezone()
        cutoff_date = (local_now - timedelta(days=safe_days)).date().isoformat()
        with self.connection() as db:
            candidates = self._retention_candidates(
                db,
                cutoff_date=cutoff_date,
            )
        return {
            "dry_run": True,
            "cutoff_date": cutoff_date,
            "safety_days": safe_days,
            "crops": len(candidates),
            "bytes": sum(int(row["file_bytes"]) for row in candidates),
            "dates": sorted({str(row["seen_at"])[:10] for row in candidates}),
        }

    @staticmethod
    def _write_manifest(path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(path)

    @staticmethod
    def _move_with_retry(source: Path, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        last_error: OSError | None = None
        for attempt in range(3):
            try:
                source.replace(destination)
                return
            except OSError as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.15 * (attempt + 1))
        raise last_error or OSError("No se pudo mover el archivo.")

    @staticmethod
    def _delete_face_crops_by_ids(
        db: sqlite3.Connection,
        crop_ids: list[int],
        *,
        batch_size: int | None = None,
    ) -> int:
        """Delete a large evidence set without exceeding SQLite variables.

        The caller must own the surrounding transaction. All chunks therefore
        commit or roll back together even though each DELETE stays comfortably
        below SQLite's host-parameter limit.
        """
        if not crop_ids:
            return 0
        if not db.in_transaction:
            raise RuntimeError(
                "La eliminacion por lotes requiere una transaccion activa."
            )
        chunk_size = max(
            1,
            min(
                int(batch_size or RETENTION_DELETE_BATCH_SIZE),
                RETENTION_DELETE_BATCH_SIZE,
            ),
        )
        deleted = 0
        for start in range(0, len(crop_ids), chunk_size):
            chunk = crop_ids[start : start + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            deleted += int(
                db.execute(
                    f"delete from face_crops where id in ({placeholders})",
                    chunk,
                ).rowcount
            )
        return deleted

    def prune_redundant_evidence(
        self,
        *,
        safety_days: int = 7,
        run_at: datetime | None = None,
        dry_run: bool = False,
    ) -> dict:
        """Quarantine redundant evidence and then atomically remove its rows."""
        preview = self.retention_preview(
            safety_days=safety_days,
            run_at=run_at,
        )
        if dry_run or preview["crops"] == 0:
            return preview

        local_now = run_at or datetime.now().astimezone()
        if local_now.tzinfo is None:
            local_now = local_now.astimezone()
        run_id = f"retention-{local_now.strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}"
        backup_dir = self.data_dir / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"{run_id}.sqlite3"
        quarantine_root = (self.data_dir / "retention-trash" / run_id).resolve()
        manifest_path = backup_dir / f"{run_id}.json"
        purge_after = (local_now + timedelta(hours=24)).isoformat()

        with self.connection() as db:
            candidates = self._retention_candidates(
                db,
                cutoff_date=str(preview["cutoff_date"]),
            )
            if not candidates:
                return {
                    **preview,
                    "crops": 0,
                    "bytes": 0,
                    "dates": [],
                }
            backup_db = sqlite3.connect(backup_path)
            try:
                db.backup(backup_db)
            finally:
                backup_db.close()
            check_db = sqlite3.connect(backup_path)
            try:
                if check_db.execute("pragma integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("La copia SQLite de retencion no paso integrity_check.")
            finally:
                check_db.close()

        created_at = utc_now()
        with self.connection(immediate=True) as db:
            db.execute(
                """
                insert into evidence_retention_runs
                    (run_id,cutoff_date,status,backup_path,manifest_path,
                     quarantine_path,purge_after,error,groups_curated,
                     crops_selected,crops_pruned,bytes_pruned,report_json,
                     created_at,completed_at)
                values (?,?,?,?,?,?,?,'',0,0,0,0,'{}',?,'')
                """,
                (
                    run_id,
                    str(preview["cutoff_date"]),
                    "staging",
                    str(backup_path),
                    str(manifest_path),
                    str(quarantine_root),
                    purge_after,
                    created_at,
                ),
            )
            item_rows = []
            for row in candidates:
                source = Path(str(row["crop_path"])).resolve()
                destination = (quarantine_root / str(row["relative_path"])).resolve()
                try:
                    destination.relative_to(quarantine_root)
                except ValueError as exc:
                    raise RuntimeError("Ruta de cuarentena invalida.") from exc
                item_rows.append(
                    (
                        run_id,
                        int(row["id"]),
                        str(source),
                        str(destination),
                        int(row["file_bytes"]),
                        "planned",
                        "",
                        created_at,
                    )
                )
            db.executemany(
                """
                insert into evidence_retention_items
                    (run_id,face_crop_id,source_path,quarantine_path,file_bytes,
                     state,error,updated_at)
                values (?,?,?,?,?,?,?,?)
                """,
                item_rows,
            )

        manifest = {
            "run_id": run_id,
            "status": "staging",
            "cutoff_date": preview["cutoff_date"],
            "safety_days": int(safety_days),
            "backup_path": str(backup_path),
            "quarantine_path": str(quarantine_root),
            "purge_after": purge_after,
            "items": [
                {
                    "face_crop_id": int(row["id"]),
                    "source_path": str(Path(str(row["crop_path"])).resolve()),
                    "quarantine_path": str(
                        (quarantine_root / str(row["relative_path"])).resolve()
                    ),
                    "file_bytes": int(row["file_bytes"]),
                }
                for row in candidates
            ],
        }
        self._write_manifest(manifest_path, manifest)
        moved: list[tuple[int, Path, Path]] = []
        database_committed = False
        try:
            with self.connection() as db:
                db.execute(
                    """
                    update evidence_retention_runs set status='moving'
                    where run_id=?
                    """,
                    (run_id,),
                )
            for row in candidates:
                source = Path(str(row["crop_path"])).resolve()
                destination = (quarantine_root / str(row["relative_path"])).resolve()
                self._move_with_retry(source, destination)
                moved.append((int(row["id"]), source, destination))
                with self.connection() as db:
                    db.execute(
                        """
                        update evidence_retention_items
                        set state='moved',updated_at=? where run_id=? and face_crop_id=?
                        """,
                        (utc_now(), run_id, int(row["id"])),
                    )

            with self.connection(immediate=True) as db:
                protected_paths = self._protected_crop_paths(db)
                for crop_id, source, destination in moved:
                    row = db.execute(
                        """
                        select crop_path,evidence_selected,evidence_curated_at
                        from face_crops where id=?
                        """,
                        (crop_id,),
                    ).fetchone()
                    if (
                        not row
                        or self._path_key(row["crop_path"]) != self._path_key(source)
                        or bool(row["evidence_selected"])
                        or not str(row["evidence_curated_at"] or "")
                        or self._path_key(source) in protected_paths
                        or not destination.is_file()
                    ):
                        raise RuntimeError(
                            f"El recorte {crop_id} cambio durante la retencion."
                        )
                ids = [crop_id for crop_id, _, _ in moved]
                deleted = self._delete_face_crops_by_ids(db, ids)
                if int(deleted) != len(ids):
                    raise RuntimeError("No se eliminaron todas las filas planificadas.")
                if db.execute("pragma integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("SQLite reporto integridad invalida tras la retencion.")
                foreign_key_errors = list(db.execute("pragma foreign_key_check"))
                if foreign_key_errors:
                    raise RuntimeError(
                        "SQLite reporto referencias rotas tras la retencion."
                    )
                bytes_pruned = sum(
                    int(row["file_bytes"])
                    for row in candidates
                )
                report = {
                    **preview,
                    "dry_run": False,
                    "run_id": run_id,
                    "status": "committed",
                    "backup_path": str(backup_path),
                    "manifest_path": str(manifest_path),
                    "quarantine_path": str(quarantine_root),
                    "purge_after": purge_after,
                }
                db.execute(
                    """
                    update evidence_retention_items
                    set state='committed',updated_at=?
                    where run_id=?
                    """,
                    (utc_now(), run_id),
                )
                db.execute(
                    """
                    update evidence_retention_runs
                    set status='committed',crops_pruned=?,bytes_pruned=?,
                        report_json=?,completed_at=?,error=''
                    where run_id=?
                    """,
                    (
                        len(ids),
                        bytes_pruned,
                        json.dumps(report, ensure_ascii=True),
                        utc_now(),
                        run_id,
                    ),
                )
            database_committed = True
            manifest["status"] = "committed"
            manifest["completed_at"] = utc_now()
            try:
                self._write_manifest(manifest_path, manifest)
            except Exception as manifest_exc:
                report["manifest_warning"] = str(manifest_exc)
                with self.connection() as db:
                    db.execute(
                        """
                        update evidence_retention_runs
                        set error=?,report_json=? where run_id=?
                        """,
                        (
                            f"No se pudo actualizar el manifiesto: {manifest_exc}",
                            json.dumps(report, ensure_ascii=True),
                            run_id,
                        ),
                    )
            return report
        except Exception as exc:
            if database_committed:
                # SQLite and quarantine are already in a consistent committed
                # state. Never restore files without restoring the database.
                with self.connection() as db:
                    db.execute(
                        """
                        update evidence_retention_runs
                        set error=? where run_id=?
                        """,
                        (str(exc), run_id),
                    )
                raise
            rollback_errors: list[str] = []
            for crop_id, source, destination in reversed(moved):
                try:
                    if destination.is_file() and not source.exists():
                        self._move_with_retry(destination, source)
                    with self.connection() as db:
                        db.execute(
                            """
                            update evidence_retention_items
                            set state='restored',updated_at=?
                            where run_id=? and face_crop_id=?
                            """,
                            (utc_now(), run_id, crop_id),
                        )
                except Exception as rollback_exc:
                    rollback_errors.append(f"{crop_id}: {rollback_exc}")
            error_text = str(exc)
            if rollback_errors:
                error_text += " | rollback: " + "; ".join(rollback_errors)
            with self.connection() as db:
                db.execute(
                    """
                    update evidence_retention_runs
                    set status='rolled_back',error=?,completed_at=?
                    where run_id=?
                    """,
                    (error_text, utc_now(), run_id),
                )
            manifest["status"] = "rolled_back"
            manifest["error"] = error_text
            self._write_manifest(manifest_path, manifest)
            raise

    def _recover_incomplete_retention_runs(self) -> None:
        with self.connection() as db:
            runs = [
                str(row["run_id"])
                for row in db.execute(
                    """
                    select run_id from evidence_retention_runs
                    where status in ('staging','moving')
                    order by created_at
                    """
                )
            ]
        for run_id in runs:
            errors: list[str] = []
            with self.connection() as db:
                items = [
                    dict(row)
                    for row in db.execute(
                        """
                        select * from evidence_retention_items
                        where run_id=? and state='moved'
                        order by face_crop_id desc
                        """,
                        (run_id,),
                    )
                ]
            for item in items:
                source = Path(str(item["source_path"])).resolve()
                quarantine = Path(str(item["quarantine_path"])).resolve()
                try:
                    if quarantine.is_file() and not source.exists():
                        self._move_with_retry(quarantine, source)
                    with self.connection() as db:
                        db.execute(
                            """
                            update evidence_retention_items
                            set state='restored',updated_at=?
                            where run_id=? and face_crop_id=?
                            """,
                            (utc_now(), run_id, int(item["face_crop_id"])),
                        )
                except Exception as exc:
                    errors.append(f"{item['face_crop_id']}: {exc}")
            with self.connection() as db:
                db.execute(
                    """
                    update evidence_retention_runs
                    set status=?,error=?,completed_at=?
                    where run_id=?
                    """,
                    (
                        "recovery_failed" if errors else "rolled_back",
                        "; ".join(errors),
                        utc_now(),
                        run_id,
                    ),
                )

    def purge_retention_quarantine(
        self,
        *,
        run_at: datetime | None = None,
    ) -> dict:
        local_now = run_at or datetime.now().astimezone()
        if local_now.tzinfo is None:
            local_now = local_now.astimezone()
        trash_root = (self.data_dir / "retention-trash").resolve()
        with self.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    """
                    select item.run_id,item.face_crop_id,item.quarantine_path,
                           item.file_bytes,run.purge_after
                    from evidence_retention_items item
                    join evidence_retention_runs run on run.run_id=item.run_id
                    where run.status='committed'
                      and item.state='committed'
                      and run.purge_after<>''
                    order by item.run_id,item.face_crop_id
                    """
                )
            ]
        items = []
        for row in rows:
            try:
                purge_after = datetime.fromisoformat(
                    str(row["purge_after"])
                )
                if purge_after.tzinfo is None:
                    purge_after = purge_after.astimezone()
            except ValueError:
                continue
            if purge_after <= local_now:
                items.append(row)
        purged = 0
        purged_bytes = 0
        errors: list[str] = []
        for item in items:
            path = Path(str(item["quarantine_path"])).resolve()
            try:
                path.relative_to(trash_root)
                if path.is_file():
                    path.unlink()
                with self.connection() as db:
                    db.execute(
                        """
                        update evidence_retention_items
                        set state='purged',updated_at=?
                        where run_id=? and face_crop_id=?
                        """,
                        (
                            utc_now(),
                            str(item["run_id"]),
                            int(item["face_crop_id"]),
                        ),
                    )
                purged += 1
                purged_bytes += int(item["file_bytes"] or 0)
            except Exception as exc:
                errors.append(
                    f"{item['run_id']}:{item['face_crop_id']}: {exc}"
                )
        return {
            "purged": purged,
            "bytes": purged_bytes,
            "errors": errors,
        }

    def backfill_face_crops(self) -> dict[str, int]:
        """Index flat crop files created before the face_crops table existed."""
        root = self.faces_dir.resolve()
        with self.connection() as db:
            known_keys = [row[0] for row in db.execute("select person_key from people")]
            unknown_rows = list(db.execute("select subject_id,first_seen_at from unknown_subjects"))
            unknown_keys = [row["subject_id"] for row in unknown_rows]
            unknown_first_seen = [
                (int(datetime.fromisoformat(row["first_seen_at"]).timestamp() * 1000), row["subject_id"])
                for row in unknown_rows
            ]
            direct_paths = {}
            for row in db.execute(
                "select subject_key,subject_kind,best_crop_path from daily_presence where best_crop_path<>''"
            ):
                direct_paths[str(Path(row["best_crop_path"]).resolve())] = (row["subject_key"], row["subject_kind"])
            for row in db.execute(
                "select subject_id,best_crop_path from unknown_subjects where best_crop_path<>''"
            ):
                direct_paths[str(Path(row["best_crop_path"]).resolve())] = (row["subject_id"], "unknown")

        def safe_key(value: str) -> str:
            return "".join(character if character.isalnum() or character in "-_" else "_" for character in value)

        key_maps = {
            "known": {safe_key(key): key for key in known_keys},
            "unknown": {safe_key(key): key for key in unknown_keys},
        }
        indexed = 0
        skipped = 0
        with self.connection() as db:
            for path in sorted(root.glob("*/*/*.jpg")):
                if not path.is_file() or path.parent.name not in key_maps:
                    continue
                resolved = str(path.resolve())
                identity = direct_paths.get(resolved)
                stem_parts = path.stem.rsplit("_", 1)
                timestamp_ms = int(stem_parts[1]) if len(stem_parts) == 2 and stem_parts[1].isdigit() else 0
                if identity is None and len(stem_parts) == 2:
                    subject_key = key_maps[path.parent.name].get(stem_parts[0])
                    if subject_key:
                        identity = (subject_key, path.parent.name)
                if identity is None and path.parent.name == "unknown" and timestamp_ms and unknown_first_seen:
                    closest_ms, closest_key = min(unknown_first_seen, key=lambda item: abs(item[0] - timestamp_ms))
                    if abs(closest_ms - timestamp_ms) <= 1500:
                        identity = (closest_key, "unknown")
                if identity is None:
                    skipped += 1
                    continue
                seen_at = (
                    business_time(
                        datetime.fromtimestamp(
                            timestamp_ms / 1000,
                            timezone.utc,
                        )
                    ).isoformat()
                    if timestamp_ms
                    else business_time(
                        datetime.fromtimestamp(
                            path.stat().st_mtime,
                            timezone.utc,
                        )
                    ).isoformat()
                )
                cursor = db.execute(
                    """
                    insert or ignore into face_crops
                        (subject_key,subject_kind,seen_at,crop_path,similarity,quality,camera,created_at)
                    values (?,?,?,?,0,0,'',?)
                    """,
                    (identity[0], identity[1], seen_at, resolved, utc_now()),
                )
                indexed += cursor.rowcount
        return {"indexed": indexed, "skipped": skipped}

    @staticmethod
    def _encode_crop_cursor(
        *,
        kind: str,
        subject_key: str,
        scope: str,
        scope_value: str,
        seen_at: str,
        crop_id: int,
        snapshot_max_id: int,
    ) -> str:
        payload = json.dumps(
            {
                "v": 1,
                "kind": kind,
                "subject_key": subject_key,
                "scope": scope,
                "scope_value": scope_value,
                "seen_at": seen_at,
                "crop_id": int(crop_id),
                "snapshot_max_id": int(snapshot_max_id),
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_crop_cursor(
        cursor: str,
        *,
        kind: str,
        subject_key: str,
        scope: str,
        scope_value: str,
    ) -> tuple[str, int, int]:
        try:
            encoded = cursor.encode("ascii")
            padding = "=" * (-len(cursor) % 4)
            decoded = base64.b64decode(encoded + padding.encode("ascii"), altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != cursor:
                raise ValueError
            payload = json.loads(decoded.decode("utf-8"))
            expected_keys = {
                "v",
                "kind",
                "subject_key",
                "scope",
                "scope_value",
                "seen_at",
                "crop_id",
                "snapshot_max_id",
            }
            if not isinstance(payload, dict) or set(payload) != expected_keys:
                raise ValueError
            if (
                type(payload["v"]) is not int
                or payload["v"] != 1
                or type(payload["kind"]) is not str
                or type(payload["subject_key"]) is not str
                or type(payload["scope"]) is not str
                or type(payload["scope_value"]) is not str
                or type(payload["seen_at"]) is not str
                or type(payload["crop_id"]) is not int
                or type(payload["snapshot_max_id"]) is not int
            ):
                raise ValueError
            if (
                payload["kind"] != kind
                or payload["subject_key"] != subject_key
                or payload["scope"] != scope
                or payload["scope_value"] != scope_value
            ):
                raise ValueError("El cursor no corresponde a esta identidad o periodo.")
            seen_at = payload["seen_at"]
            crop_id = payload["crop_id"]
            snapshot_max_id = payload["snapshot_max_id"]
            if not seen_at or crop_id < 1 or snapshot_max_id < crop_id:
                raise ValueError
            datetime.fromisoformat(seen_at)
            return seen_at, crop_id, snapshot_max_id
        except (binascii.Error, TypeError, ValueError, UnicodeDecodeError, UnicodeEncodeError, json.JSONDecodeError) as exc:
            if isinstance(exc, ValueError) and str(exc).startswith("El cursor no corresponde"):
                raise
            raise ValueError("Cursor de recortes no valido.") from exc

    def detection_detail(
        self,
        kind: str,
        subject_key: str,
        selected_date: str | None = None,
        *,
        selected_month: str | None = None,
        cursor: str | None = None,
        limit: int = 36,
        include_all_crops: bool = False,
    ) -> dict:
        if kind not in {"known", "unknown"}:
            raise ValueError("Tipo de deteccion no valido.")
        if selected_date and selected_month:
            raise ValueError("Selecciona una fecha o un mes, no ambos.")
        if selected_month:
            try:
                range_start = datetime.strptime(selected_month, "%Y-%m").date().replace(day=1)
            except ValueError as exc:
                raise ValueError("Mes no valido.") from exc
            range_end = (
                range_start.replace(year=range_start.year + 1, month=1)
                if range_start.month == 12
                else range_start.replace(month=range_start.month + 1)
            )
            scope = "month"
            scope_value = selected_month
        else:
            selected_date = selected_date or datetime.now(
                BUSINESS_TIME_ZONE
            ).date().isoformat()
            try:
                range_start = datetime.strptime(selected_date, "%Y-%m-%d").date()
            except ValueError as exc:
                raise ValueError("Fecha no valida.") from exc
            range_end = range_start + timedelta(days=1)
            scope = "day"
            scope_value = selected_date
        safe_limit = max(1, min(int(limit), 100))
        full_unknown_catalog = bool(include_all_crops and kind == "unknown")
        selected_crop_filter = (
            "" if full_unknown_catalog else "and evidence_selected=1"
        )
        range_params = (subject_key, kind, range_start.isoformat(), range_end.isoformat())
        with self.connection() as db:
            if kind == "known":
                subject = db.execute(
                    "select person_key as subject_key,name,person_type,group_name,team_name from people where person_key=?",
                    (subject_key,),
                ).fetchone()
            else:
                subject_key = self._canonical_unknown_id(db, subject_key)
                subject = db.execute(
                    """
                    select unknown_subject.subject_id as subject_key,
                           coalesce(linked_person.name,unknown_subject.temporary_name,unknown_subject.subject_id) as name,
                           coalesce(linked_person.person_type,'unknown') as person_type,
                           coalesce(linked_person.group_name,'') as group_name,
                           coalesce(linked_person.team_name,'') as team_name,
                           unknown_subject.status,unknown_subject.linked_person_key
                    from unknown_subjects unknown_subject
                    left join people linked_person
                      on linked_person.person_key=unknown_subject.linked_person_key
                    where unknown_subject.subject_id=?
                    """,
                    (subject_key,),
                ).fetchone()
            if not subject:
                raise LookupError(subject_key)
            crop_cursor = (
                self._decode_crop_cursor(
                    cursor,
                    kind=kind,
                    subject_key=subject_key,
                    scope=scope,
                    scope_value=scope_value,
                )
                if cursor
                else None
            )
            range_params = (subject_key, kind, range_start.isoformat(), range_end.isoformat())
            if crop_cursor:
                snapshot_max_id = crop_cursor[2]
            else:
                snapshot_max_id = int(
                    db.execute(
                        f"""
                        select coalesce(max(id),0)
                        from face_crops
                        where subject_key=? and subject_kind=?
                          and seen_at>=? and seen_at<?
                          {selected_crop_filter}
                        """,
                        range_params,
                    ).fetchone()[0]
                    or 0
                )
            crop_range_params = (*range_params, snapshot_max_id)
            presence_days = [
                dict(row)
                for row in db.execute(
                    """
                    select presence_date as date,
                           coalesce(sum(detection_count),0) as detections,
                           count(*) as sessions,
                           min(first_seen_at) as first_seen_at,
                           max(last_seen_at) as last_seen_at
                    from daily_presence
                    where subject_key=? and subject_kind=?
                      and presence_date>=? and presence_date<?
                    group by presence_date
                    order by presence_date desc
                    """,
                    range_params,
                )
            ]
            stats_days = [
                dict(row)
                for row in db.execute(
                    """
                    select evidence_date as date,detection_count as detections,
                           first_seen_at,last_seen_at,retained_count
                    from daily_detection_stats
                    where subject_key=? and subject_kind=?
                      and evidence_date>=? and evidence_date<?
                    order by evidence_date desc
                    """,
                    range_params,
                )
            ]
            crop_days = [
                dict(row)
                for row in db.execute(
                    f"""
                    select substr(seen_at,1,10) as date,
                           count(*) as crops,
                           min(seen_at) as first_seen_at,
                           max(seen_at) as last_seen_at
                    from face_crops
                    where subject_key=? and subject_kind=?
                      and seen_at>=? and seen_at<?
                      and id<=?
                      {selected_crop_filter}
                    group by substr(seen_at,1,10)
                    order by date desc
                    """,
                    crop_range_params,
                )
            ]
            page_where = f"""
                subject_key=? and subject_kind=?
                and seen_at>=? and seen_at<?
                and id<=?
                {selected_crop_filter}
            """
            page_params: tuple[object, ...] = crop_range_params
            if crop_cursor:
                page_where += " and (seen_at<? or (seen_at=? and id<?))"
                page_params = (*page_params, crop_cursor[0], crop_cursor[0], crop_cursor[1])
            crops = [
                dict(row)
                for row in db.execute(
                    f"""
                    select id,seen_at,substr(seen_at,1,10) as date,
                           similarity,quality,camera,quality_pass,
                           evidence_selected,evidence_reason
                    from face_crops
                    where {page_where}
                    order by seen_at desc,id desc
                    limit ?
                    """,
                    (*page_params, safe_limit + 1),
                )
            ]

        has_more = len(crops) > safe_limit
        crops = crops[:safe_limit]
        next_cursor = (
            self._encode_crop_cursor(
                kind=kind,
                subject_key=subject_key,
                scope=scope,
                scope_value=scope_value,
                seen_at=crops[-1]["seen_at"],
                crop_id=crops[-1]["id"],
                snapshot_max_id=snapshot_max_id,
            )
            if has_more and crops
            else None
        )
        days_by_date: dict[str, dict] = {}
        for row in presence_days:
            days_by_date[row["date"]] = {
                "date": row["date"],
                "detections": int(row["detections"] or 0),
                "sessions": int(row["sessions"] or 0),
                "crops": 0,
                "first_seen_at": row["first_seen_at"] or "",
                "last_seen_at": row["last_seen_at"] or "",
            }
        for row in stats_days:
            day = days_by_date.setdefault(
                row["date"],
                {
                    "date": row["date"],
                    "detections": 0,
                    "sessions": 0,
                    "crops": 0,
                    "first_seen_at": "",
                    "last_seen_at": "",
                },
            )
            day["detections"] = max(
                int(day["detections"] or 0),
                int(row["detections"] or 0),
            )
            first_seen_values = [
                value
                for value in (day["first_seen_at"], row["first_seen_at"])
                if value
            ]
            last_seen_values = [
                value
                for value in (day["last_seen_at"], row["last_seen_at"])
                if value
            ]
            day["first_seen_at"] = (
                min(first_seen_values) if first_seen_values else ""
            )
            day["last_seen_at"] = (
                max(last_seen_values) if last_seen_values else ""
            )
        for row in crop_days:
            day = days_by_date.setdefault(
                row["date"],
                {
                    "date": row["date"],
                    "detections": 0,
                    "sessions": 0,
                    "crops": 0,
                    "first_seen_at": "",
                    "last_seen_at": "",
                },
            )
            day["crops"] = int(row["crops"] or 0)
            day["detections"] = max(day["detections"], day["crops"])
            first_seen_values = [value for value in (day["first_seen_at"], row["first_seen_at"]) if value]
            last_seen_values = [value for value in (day["last_seen_at"], row["last_seen_at"]) if value]
            day["first_seen_at"] = min(first_seen_values) if first_seen_values else ""
            day["last_seen_at"] = max(last_seen_values) if last_seen_values else ""
        days = sorted(days_by_date.values(), key=lambda row: row["date"], reverse=True)
        total_crops = sum(int(row["crops"] or 0) for row in crop_days)
        first_seen_values = [row["first_seen_at"] for row in days if row["first_seen_at"]]
        last_seen_values = [row["last_seen_at"] for row in days if row["last_seen_at"]]
        result = {
            "scope": scope,
            "value": scope_value,
            "subject": dict(subject),
            "summary": {
                "detections": sum(int(row["detections"] or 0) for row in days),
                "attendance_days": len(presence_days),
                "sessions": sum(int(row["sessions"] or 0) for row in presence_days),
                "first_seen_at": min(first_seen_values) if first_seen_values else "",
                "last_seen_at": max(last_seen_values) if last_seen_values else "",
                "crops": total_crops,
            },
            "days": days,
            "crops": crops,
            "total_crops": total_crops,
            "next_cursor": next_cursor,
            "limit": safe_limit,
            "snapshot_max_id": snapshot_max_id,
            "evidence_policy": {
                "daily_limit": 30,
                "curated": bool(stats_days),
                "full_catalog": full_unknown_catalog,
            },
        }
        if scope == "day":
            result["date"] = scope_value
        else:
            result["month"] = scope_value
        return result

    def reject_unknown_crop(
        self,
        crop_id: int,
        reason: str = "",
    ) -> dict:
        """Invalidate one unknown crop without deleting its audit file.

        A manual rejection is durable across nightly reprocessing. The crop is
        removed from the matching gallery and can no longer support presence.
        """
        safe_reason = str(reason or "").strip()[:240]
        rejected_at = utc_now()
        with self.connection(immediate=True) as db:
            crop = db.execute(
                """
                select crop.*,subject.status,subject.linked_person_key,
                       subject.detection_count as subject_detection_count,
                       subject.quality_json as subject_quality_json
                from face_crops crop
                join unknown_subjects subject
                  on crop.subject_kind='unknown'
                 and subject.subject_id=crop.subject_key
                where crop.id=?
                """,
                (int(crop_id),),
            ).fetchone()
            if not crop:
                raise LookupError(crop_id)
            if str(crop["evidence_reason"]) == "manual_rejected":
                return {
                    "crop_id": int(crop_id),
                    "subject_id": str(crop["subject_key"]),
                    "date": str(crop["seen_at"])[:10],
                    "status": "already_rejected",
                    "attendance_removed": False,
                    "attendance_rows_removed": 0,
                }
            if str(crop["status"]) not in {"candidate", "consolidated"}:
                raise ValueError(
                    "Solo se pueden rechazar recortes de desconocidos no vinculados."
                )

            subject_id = str(crop["subject_key"])
            evidence_date = str(crop["seen_at"])[:10]
            crop_path = str(crop["crop_path"])
            db.execute(
                """
                update face_crops
                set evidence_selected=0,evidence_reason='manual_rejected',
                    evidence_score=0,evidence_curated_at=?,quality_pass=0
                where id=?
                """,
                (rejected_at, int(crop_id)),
            )
            removed_references = int(
                db.execute(
                    """
                    delete from unknown_references
                    where subject_id=? and crop_path=?
                    """,
                    (subject_id, crop_path),
                ).rowcount
            )

            remaining_rows = [
                dict(row)
                for row in db.execute(
                    """
                    select id,seen_at,crop_path,similarity,quality,quality_pass,
                           quality_json,analysis_version,embedding
                    from face_crops
                    where subject_key=? and subject_kind='unknown'
                      and evidence_reason<>'manual_rejected'
                    order by seen_at,id
                    """,
                    (subject_id,),
                )
            ]
            reference_rows = [
                dict(row)
                for row in db.execute(
                    """
                    select * from unknown_references
                    where subject_id=?
                    order by quality desc,id
                    """,
                    (subject_id,),
                )
            ]
            reference_embeddings = [
                blob_embedding(row.get("embedding"))
                for row in reference_rows
            ]
            valid_reference_pairs = [
                (row, embedding)
                for row, embedding in zip(reference_rows, reference_embeddings)
                if embedding is not None
            ]
            reference_rows = [pair[0] for pair in valid_reference_pairs]
            reference_embeddings = [pair[1] for pair in valid_reference_pairs]

            centroid_rows = reference_rows
            centroid_embeddings = reference_embeddings
            if not centroid_embeddings:
                remaining_pairs = [
                    (row, blob_embedding(row.get("embedding")))
                    for row in remaining_rows
                ]
                valid_remaining_pairs = [
                    (row, embedding)
                    for row, embedding in remaining_pairs
                    if embedding is not None
                ]
                centroid_rows = [pair[0] for pair in valid_remaining_pairs]
                centroid_embeddings = [pair[1] for pair in valid_remaining_pairs]
            centroid = self._unknown_reference_centroid(
                centroid_rows,
                centroid_embeddings,
            )

            best_reference = reference_rows[0] if reference_rows else None
            best_remaining = (
                max(
                    remaining_rows,
                    key=lambda row: (
                        int(row.get("quality_pass") or 0),
                        float(row.get("quality") or 0.0),
                        float(row.get("similarity") or 0.0),
                        str(row.get("seen_at") or ""),
                    ),
                )
                if remaining_rows
                else None
            )
            if not remaining_rows:
                next_status = "quarantined"
            elif reference_rows:
                next_status = "consolidated"
            else:
                next_status = "candidate"
            best_source = best_reference or (
                best_remaining if next_status == "consolidated" else None
            )
            best_crop_path = str((best_source or {}).get("crop_path") or "")
            best_quality = float((best_source or {}).get("quality") or 0.0)
            best_quality_json = str(
                (best_source or {}).get("quality_json") or "{}"
            )
            best_analysis_version = str(
                (best_source or {}).get("analysis_version") or ""
            )
            subject_payload = {}
            try:
                subject_payload = json.loads(
                    str(crop["subject_quality_json"] or "{}")
                )
            except (TypeError, ValueError, json.JSONDecodeError):
                subject_payload = {}
            subject_payload["manual_rejection"] = {
                "crop_id": int(crop_id),
                "rejected_at": rejected_at,
                "reason": safe_reason,
            }
            db.execute(
                """
                update unknown_subjects
                set status=?,centroid=coalesce(?,centroid),
                    best_crop_path=?,best_quality=?,quality_hits=?,
                    quality_version=?,quality_json=?,detection_count=?,
                    updated_at=?
                where subject_id=?
                """,
                (
                    next_status,
                    embedding_blob(centroid) if centroid is not None else None,
                    best_crop_path,
                    best_quality,
                    len(reference_rows),
                    best_analysis_version,
                    (
                        best_quality_json
                        if best_source
                        else json.dumps(subject_payload, ensure_ascii=True)
                    ),
                    max(
                        0,
                        int(crop["subject_detection_count"] or 0) - 1,
                    ),
                    rejected_at,
                    subject_id,
                ),
            )

            active_day_rows = [
                dict(row)
                for row in db.execute(
                    """
                    select id,seen_at,crop_path,similarity,evidence_selected
                    from face_crops
                    where subject_key=? and subject_kind='unknown'
                      and substr(seen_at,1,10)=?
                      and evidence_reason<>'manual_rejected'
                    order by seen_at,id
                    """,
                    (subject_id, evidence_date),
                )
            ]
            attendance_rows_removed = 0
            if not reference_rows:
                attendance_rows_removed = int(
                    db.execute(
                        """
                        delete from daily_presence
                        where subject_key=? and subject_kind='unknown'
                        """,
                        (subject_id,),
                    ).rowcount
                )
            elif not active_day_rows:
                attendance_rows_removed = int(
                    db.execute(
                        """
                        delete from daily_presence
                        where subject_key=? and subject_kind='unknown'
                          and presence_date=?
                        """,
                        (subject_id, evidence_date),
                    ).rowcount
                )
            else:
                best_day_row = max(
                    active_day_rows,
                    key=lambda row: (
                        float(row.get("similarity") or 0.0),
                        str(row.get("seen_at") or ""),
                    ),
                )
                presence = db.execute(
                    """
                    select coalesce(sum(detection_count),0) as detections
                    from daily_presence
                    where subject_key=? and subject_kind='unknown'
                      and presence_date=?
                    """,
                    (subject_id, evidence_date),
                ).fetchone()
                adjusted_detections = max(
                    len(active_day_rows),
                    max(0, int(presence["detections"] or 0) - 1),
                )
                db.execute(
                    """
                    update daily_presence
                    set first_seen_at=?,last_seen_at=?,detection_count=?,
                        best_similarity=?,best_crop_path=?,synced=0
                    where subject_key=? and subject_kind='unknown'
                      and presence_date=?
                    """,
                    (
                        str(active_day_rows[0]["seen_at"]),
                        str(active_day_rows[-1]["seen_at"]),
                        adjusted_detections,
                        float(best_day_row.get("similarity") or 0.0),
                        str(best_day_row.get("crop_path") or ""),
                        subject_id,
                        evidence_date,
                    ),
                )

            if not active_day_rows:
                db.execute(
                    """
                    delete from daily_detection_stats
                    where subject_key=? and subject_kind='unknown'
                      and evidence_date=?
                    """,
                    (subject_id, evidence_date),
                )
            else:
                stats = db.execute(
                    """
                    select detection_count from daily_detection_stats
                    where subject_key=? and subject_kind='unknown'
                      and evidence_date=?
                    """,
                    (subject_id, evidence_date),
                ).fetchone()
                adjusted_stats = max(
                    len(active_day_rows),
                    max(
                        0,
                        int(stats["detection_count"] or 0) - 1,
                    )
                    if stats
                    else len(active_day_rows),
                )
                db.execute(
                    """
                    update daily_detection_stats
                    set detection_count=?,first_seen_at=?,last_seen_at=?,
                        retained_count=?,curated_at=?
                    where subject_key=? and subject_kind='unknown'
                      and evidence_date=?
                    """,
                    (
                        adjusted_stats,
                        str(active_day_rows[0]["seen_at"]),
                        str(active_day_rows[-1]["seen_at"]),
                        sum(
                            int(row.get("evidence_selected") or 0)
                            for row in active_day_rows
                        ),
                        rejected_at,
                        subject_id,
                        evidence_date,
                    ),
                )

        return {
            "crop_id": int(crop_id),
            "subject_id": subject_id,
            "date": evidence_date,
            "status": "rejected",
            "subject_status": next_status,
            "remaining_crops": len(remaining_rows),
            "remaining_references": len(reference_rows),
            "references_removed": removed_references,
            "attendance_removed": attendance_rows_removed > 0,
            "attendance_rows_removed": attendance_rows_removed,
        }

    def unknown_registration_crops(self, subject_id: str) -> dict:
        with self.connection() as db:
            subject_id = self._canonical_unknown_id(db, subject_id)
            subject = db.execute(
                """
                select subject_id,temporary_name,status,best_crop_path
                from unknown_subjects where subject_id=?
                """,
                (subject_id,),
            ).fetchone()
            if not subject:
                raise LookupError(subject_id)
            crops = [
                dict(row)
                for row in db.execute(
                    """
                    select id,seen_at,similarity,quality,quality_pass,camera,
                           case when crop_path=? then 1 else 0 end as is_subject_best
                    from face_crops
                    where subject_key=? and subject_kind='unknown'
                      and evidence_reason<>'manual_rejected'
                    order by quality_pass desc,quality desc,is_subject_best desc,
                             similarity desc,seen_at desc,id desc
                    """,
                    (subject["best_crop_path"], subject_id),
                )
            ]
        suggested_crop_id = crops[0]["id"] if crops else None
        return {
            "subject": dict(subject),
            "suggested_crop_id": suggested_crop_id,
            "crops": crops,
        }

    def unknown_registration_crop(self, subject_id: str, crop_id: int) -> dict:
        with self.connection() as db:
            subject_id = self._canonical_unknown_id(db, subject_id)
            row = db.execute(
                """
                select * from face_crops
                where id=? and subject_key=? and subject_kind='unknown'
                  and evidence_reason<>'manual_rejected'
                """,
                (int(crop_id), subject_id),
            ).fetchone()
        if not row:
            raise LookupError(crop_id)
        result = dict(row)
        result["embedding"] = blob_embedding(result.get("embedding"))
        path = Path(result["crop_path"]).resolve()
        try:
            path.relative_to(self.faces_dir.resolve())
        except ValueError as exc:
            raise ValueError("El recorte seleccionado no pertenece al archivo facial local.") from exc
        if not path.is_file():
            raise ValueError("El recorte seleccionado ya no esta disponible.")
        result["crop_path"] = str(path)
        return result

    def register_person_from_unknown(
        self,
        subject_id: str,
        crop_id: int,
        person: dict,
        embedding: np.ndarray,
        remote_subject_id: str | None,
        session_by_presence: dict[str, int],
        *,
        expected_person_type: str,
    ) -> dict:
        if expected_person_type not in {"student", "collaborator"}:
            raise ValueError("El tipo de persona no es valido.")
        person_key = str(person.get("key") or "").strip()
        if not person_key.startswith(f"{expected_person_type}:"):
            raise ValueError("La respuesta remota no contiene una persona valida.")
        with self.connection() as db:
            subject_id = self._canonical_unknown_id(db, subject_id)
            subject = db.execute(
                "select * from unknown_subjects where subject_id=?",
                (subject_id,),
            ).fetchone()
            crop = db.execute(
                """
                select * from face_crops
                where id=? and subject_key=? and subject_kind='unknown'
                """,
                (int(crop_id), subject_id),
            ).fetchone()
            if not subject or not crop:
                raise LookupError(subject_id)
            if subject["status"] == "linked" and subject["linked_person_key"] != person_key:
                raise ValueError("El rostro ya esta vinculado a otra persona.")

            now = utc_now()
            db.execute(
                """
                insert into people
                    (person_key,person_type,remote_id,name,group_name,team_name,
                     photo_url,photo_path,reference_version,reference_available,
                     embedding,active,updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,1,?)
                on conflict(person_key) do update set
                    person_type=excluded.person_type,
                    remote_id=excluded.remote_id,
                    name=excluded.name,
                    group_name=excluded.group_name,
                    team_name=excluded.team_name,
                    photo_url=excluded.photo_url,
                    photo_path=excluded.photo_path,
                    reference_version=excluded.reference_version,
                    reference_available=1,
                    embedding=excluded.embedding,
                    active=1,
                    updated_at=excluded.updated_at
                """,
                (
                    person_key,
                    expected_person_type,
                    int(person["id"]),
                    str(person["name"]),
                    str(person.get("group_name") or ""),
                    str(person.get("team_name") or ""),
                    str(person.get("photo_url") or ""),
                    str(crop["crop_path"]),
                    str(person.get("reference_version") or ""),
                    1,
                    embedding_blob(embedding),
                    now,
                ),
            )
            self._promote_unknown_references_to_known(
                db,
                subject_id,
                person_key,
                pinned_crop_path=str(crop["crop_path"]),
                pinned_embedding=embedding,
                pinned_quality=float(crop["quality"] or 0.0),
                pinned_captured_at=str(crop["seen_at"] or now),
                pinned_quality_json=str(crop["quality_json"] or "{}"),
            )

            presence_rows = list(
                db.execute(
                    """
                    select * from daily_presence
                    where subject_key=? and subject_kind='unknown'
                    order by presence_date,session_id
                    """,
                    (subject_id,),
                )
            )
            for presence in presence_rows:
                presence_key = f"{presence['presence_date']}:{presence['session_id']}"
                session_id = int(session_by_presence.get(presence_key, -1) or -1)
                db.execute(
                    """
                    insert into daily_presence
                        (subject_key,presence_date,subject_kind,first_seen_at,last_seen_at,
                         detection_count,best_similarity,best_crop_path,session_id,synced)
                    values (?,?,'known',?,?,?,?,?,?,?)
                    on conflict(subject_key,presence_date,session_id) do update set
                        subject_kind='known',
                        first_seen_at=min(daily_presence.first_seen_at,excluded.first_seen_at),
                        last_seen_at=max(daily_presence.last_seen_at,excluded.last_seen_at),
                        detection_count=daily_presence.detection_count + excluded.detection_count,
                        best_crop_path=case
                            when excluded.best_similarity >= daily_presence.best_similarity
                                 and excluded.best_crop_path <> ''
                            then excluded.best_crop_path else daily_presence.best_crop_path end,
                        best_similarity=max(daily_presence.best_similarity,excluded.best_similarity),
                        synced=max(daily_presence.synced,excluded.synced)
                    """,
                    (
                        person_key,
                        presence["presence_date"],
                        presence["first_seen_at"],
                        presence["last_seen_at"],
                        int(presence["detection_count"] or 0),
                        float(presence["best_similarity"] or 0.0),
                        str(presence["best_crop_path"] or ""),
                        session_id,
                        int(session_id != -1),
                    ),
                )
                if session_id != -1 and expected_person_type == "student":
                    session = db.execute(
                        "select roster_json from sessions where remote_id=?",
                        (session_id,),
                    ).fetchone()
                    if session:
                        roster = json.loads(session["roster_json"] or "[]")
                        if person_key not in roster:
                            roster.append(person_key)
                            db.execute(
                                "update sessions set roster_json=?,updated_at=? where remote_id=?",
                                (json.dumps(roster), now, session_id),
                            )

            db.execute(
                """
                delete from daily_presence
                where subject_key=? and subject_kind='unknown'
                """,
                (subject_id,),
            )
            stats_rows = list(
                db.execute(
                    """
                    select * from daily_detection_stats
                    where subject_key=? and subject_kind='unknown'
                    order by evidence_date
                    """,
                    (subject_id,),
                )
            )
            for stats in stats_rows:
                db.execute(
                    """
                    insert into daily_detection_stats
                        (subject_key,subject_kind,evidence_date,detection_count,
                         first_seen_at,last_seen_at,retained_count,curated_at)
                    values (?,'known',?,?,?,?,?,?)
                    on conflict(subject_key,subject_kind,evidence_date) do update set
                        detection_count=daily_detection_stats.detection_count
                            + excluded.detection_count,
                        first_seen_at=case
                            when daily_detection_stats.first_seen_at=''
                            then excluded.first_seen_at
                            when excluded.first_seen_at=''
                            then daily_detection_stats.first_seen_at
                            else min(
                                daily_detection_stats.first_seen_at,
                                excluded.first_seen_at
                            )
                        end,
                        last_seen_at=max(
                            daily_detection_stats.last_seen_at,
                            excluded.last_seen_at
                        ),
                        retained_count=daily_detection_stats.retained_count
                            + excluded.retained_count,
                        curated_at=excluded.curated_at
                    """,
                    (
                        person_key,
                        stats["evidence_date"],
                        int(stats["detection_count"] or 0),
                        str(stats["first_seen_at"] or ""),
                        str(stats["last_seen_at"] or ""),
                        int(stats["retained_count"] or 0),
                        now,
                    ),
                )
            db.execute(
                """
                delete from daily_detection_stats
                where subject_key=? and subject_kind='unknown'
                """,
                (subject_id,),
            )
            db.execute(
                """
                update face_crops
                set subject_key=?,subject_kind='known',
                    evidence_selected=1,evidence_reason='uncurated',
                    evidence_score=0,evidence_curated_at=''
                where subject_key=? and subject_kind='unknown'
                """,
                (person_key, subject_id),
            )
            db.execute(
                """
                update unknown_subjects
                set status='linked',linked_person_key=?,remote_subject_id=?,
                    best_crop_path=?,updated_at=?
                where subject_id=?
                """,
                (
                    person_key,
                    remote_subject_id,
                    str(crop["crop_path"]),
                    now,
                    subject_id,
                ),
            )
        return self.get_person(person_key) or {}

    def register_student_from_unknown(
        self,
        subject_id: str,
        crop_id: int,
        person: dict,
        embedding: np.ndarray,
        remote_subject_id: str | None,
        session_by_presence: dict[str, int],
    ) -> dict:
        return self.register_person_from_unknown(
            subject_id,
            crop_id,
            person,
            embedding,
            remote_subject_id,
            session_by_presence,
            expected_person_type="student",
        )

    def crop_image_path(self, crop_id: int) -> Path | None:
        with self.connection() as db:
            row = db.execute("select crop_path from face_crops where id=?", (int(crop_id),)).fetchone()
        if not row or not row[0]:
            return None
        path = Path(row[0]).resolve()
        try:
            path.relative_to(self.faces_dir.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None

    def unknown_occurrences(self, subject_id: str) -> list[dict]:
        with self.connection() as db:
            subject_id = self._canonical_unknown_id(db, subject_id)
            return [dict(row) for row in db.execute(
                "select * from daily_presence where subject_key=? order by presence_date", (subject_id,)
            )]

    @staticmethod
    def _normalized_scheduled_match(
        item: dict,
        *,
        default_source: str,
    ) -> dict:
        match_date = str(item.get("match_date") or "").strip()
        start_value = str(
            item.get("starts_at")
            or item.get("start_time")
            or ""
        ).strip()
        if not match_date:
            raise ValueError("Cada partido programado necesita fecha.")
        try:
            parsed_date = datetime.strptime(match_date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError(
                f"Fecha de partido no valida: {match_date}."
            ) from exc

        try:
            if "T" in start_value:
                starts_at = business_time(
                    datetime.fromisoformat(start_value)
                )
            else:
                parsed_time = datetime_time.fromisoformat(start_value)
                starts_at = datetime.combine(
                    parsed_date,
                    parsed_time,
                    tzinfo=BUSINESS_TIME_ZONE,
                )
        except ValueError as exc:
            raise ValueError(
                f"Hora de partido no valida: {start_value}."
            ) from exc

        if starts_at.date() != parsed_date:
            raise ValueError(
                "La fecha y la hora del partido no corresponden."
            )

        duration = max(
            1,
            int(
                item.get("expected_duration_minutes")
                or MATCH_WINDOW_MINUTES
            ),
        )
        tolerance = max(
            0,
            int(
                item.get("tolerance_minutes")
                if item.get("tolerance_minutes") is not None
                else MATCH_SCHEDULE_TOLERANCE_MINUTES
            ),
        )
        if duration < 30 or duration > 120:
            raise ValueError(
                "La duracion esperada debe estar entre 30 y 120 minutos."
            )
        if tolerance > 20:
            raise ValueError(
                "La tolerancia no puede superar 20 minutos."
            )

        ends_at = starts_at + timedelta(minutes=duration)
        return {
            "match_date": match_date,
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
            "expected_duration_minutes": duration,
            "tolerance_minutes": tolerance,
            "tournament": str(
                item.get("tournament") or ""
            ).strip()[:120],
            "home_team": str(
                item.get("home_team") or ""
            ).strip()[:160],
            "away_team": str(
                item.get("away_team") or ""
            ).strip()[:160],
            "referee": str(item.get("referee") or "").strip()[:120],
            "source": str(
                item.get("source") or default_source or "manual"
            ).strip()[:120],
        }

    @staticmethod
    def _recurring_match_schedule(parsed_date) -> list[dict]:
        day_slots = MATCH_WEEKLY_SCHEDULE.get(parsed_date.weekday(), ())
        date_text = parsed_date.isoformat()
        date_number = int(parsed_date.strftime("%Y%m%d"))
        items = []
        for index, (start_text, duration, tournament) in enumerate(
            day_slots,
            start=1,
        ):
            starts_at = datetime.combine(
                parsed_date,
                datetime_time.fromisoformat(start_text),
                tzinfo=BUSINESS_TIME_ZONE,
            )
            ends_at = starts_at + timedelta(minutes=int(duration))
            items.append({
                "id": -(date_number * 100 + index),
                "match_date": date_text,
                "starts_at": starts_at.isoformat(),
                "ends_at": ends_at.isoformat(),
                "expected_duration_minutes": int(duration),
                "tolerance_minutes": MATCH_SCHEDULE_TOLERANCE_MINUTES,
                "tournament": tournament,
                "home_team": "",
                "away_team": "",
                "referee": "",
                "source": "weekly-template",
                "created_at": "",
                "updated_at": "",
            })
        return items

    @classmethod
    def _merge_match_schedule_for_date(
        cls,
        parsed_date,
        explicit_items: list[dict],
    ) -> list[dict]:
        by_start = {
            datetime.fromisoformat(item["starts_at"]).strftime("%H:%M"):
                item
            for item in cls._recurring_match_schedule(parsed_date)
        }
        for raw_item in explicit_items:
            item = dict(raw_item)
            starts_at = business_time(
                datetime.fromisoformat(str(item["starts_at"]))
            )
            item["tolerance_minutes"] = max(
                MATCH_SCHEDULE_TOLERANCE_MINUTES,
                int(item.get("tolerance_minutes") or 0),
            )
            by_start[starts_at.strftime("%H:%M")] = item
        return sorted(
            by_start.values(),
            key=lambda item: (str(item["starts_at"]), int(item["id"])),
        )

    def upsert_match_schedule(
        self,
        items: list[dict],
        *,
        source: str = "manual",
    ) -> dict:
        if not isinstance(items, list) or not items:
            raise ValueError("Agrega al menos un partido programado.")
        normalized = [
            self._normalized_scheduled_match(
                item,
                default_source=source,
            )
            for item in items
        ]
        now = utc_now()
        affected_dates = sorted(
            {item["match_date"] for item in normalized}
        )

        with self.connection(immediate=True) as db:
            for item in normalized:
                db.execute(
                    """
                    insert into match_schedule
                        (match_date,starts_at,ends_at,
                         expected_duration_minutes,tolerance_minutes,
                         tournament,home_team,away_team,referee,source,
                         created_at,updated_at)
                    values (?,?,?,?,?,?,?,?,?,?,?,?)
                    on conflict(
                        match_date,starts_at,home_team,away_team
                    ) do update set
                        ends_at=excluded.ends_at,
                        expected_duration_minutes=
                            excluded.expected_duration_minutes,
                        tolerance_minutes=excluded.tolerance_minutes,
                        tournament=excluded.tournament,
                        referee=excluded.referee,
                        source=excluded.source,
                        updated_at=excluded.updated_at
                    """,
                    (
                        item["match_date"],
                        item["starts_at"],
                        item["ends_at"],
                        item["expected_duration_minutes"],
                        item["tolerance_minutes"],
                        item["tournament"],
                        item["home_team"],
                        item["away_team"],
                        item["referee"],
                        item["source"],
                        now,
                        now,
                    ),
                )
            placeholders = ",".join("?" for _ in affected_dates)
            db.execute(
                f"""
                delete from match_analysis_days
                where analysis_date in ({placeholders})
                """,
                affected_dates,
            )

        return {
            "upserted": len(normalized),
            "dates": affected_dates,
            "items": normalized,
        }

    def match_schedule(
        self,
        *,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d").date()
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError("Rango de calendario no valido.") from exc
        if end < start:
            raise ValueError(
                "El final del calendario no puede ser anterior al inicio."
            )
        if (end - start).days > 62:
            raise ValueError(
                "Consulta como maximo 63 dias de calendario."
            )
        with self.connection() as db:
            window_rows = [
                dict(row)
                for row in db.execute(
                    """
                    select * from match_analysis_windows
                    where analysis_date>=? and analysis_date<=?
                      and window_type='scheduled'
                    order by analysis_date,window_index
                    """,
                    (start.isoformat(), end.isoformat()),
                )
            ]
        windows_by_key = {}
        for window in window_rows:
            windows_by_key[
                (
                    str(window["analysis_date"]),
                    str(window.get("scheduled_starts_at") or ""),
                )
            ] = window

        items = []
        current = start
        while current <= end:
            for scheduled in self._match_schedule_for_date(
                current.isoformat()
            ):
                item = dict(scheduled)
                window = windows_by_key.get(
                    (
                        current.isoformat(),
                        str(item["starts_at"]),
                    )
                )
                item.update({
                    "analysis_window_id": int(
                        window["id"] if window else 0
                    ),
                    "analysis_status": str(
                        window["window_status"]
                        if window else "pending_analysis"
                    ),
                    "participant_count": int(
                        window["participant_count"] if window else 0
                    ),
                    "known_count": int(
                        window["known_count"] if window else 0
                    ),
                    "unknown_count": int(
                        window["unknown_count"] if window else 0
                    ),
                    "evidence_starts_at": str(
                        window["evidence_starts_at"] if window else ""
                    ),
                    "evidence_ends_at": str(
                        window["evidence_ends_at"] if window else ""
                    ),
                })
                items.append(item)
            current += timedelta(days=1)
        return items

    def _match_schedule_for_date(
        self,
        analysis_date: str,
    ) -> list[dict]:
        try:
            parsed_date = datetime.strptime(
                analysis_date,
                "%Y-%m-%d",
            ).date()
        except ValueError as exc:
            raise ValueError("Fecha de calendario no valida.") from exc
        with self.connection() as db:
            explicit_items = [
                dict(row)
                for row in db.execute(
                    """
                    select * from match_schedule
                    where match_date=?
                    order by starts_at,id
                    """,
                    (analysis_date,),
                )
            ]
        return self._merge_match_schedule_for_date(
            parsed_date,
            explicit_items,
        )

    def match_analysis_status(self) -> dict:
        with self._match_analysis_state_lock:
            state = dict(self._match_analysis_state)
        return {
            **state,
            "window_minutes": MATCH_WINDOW_MINUTES,
            "minimum_unique_people": MATCH_MIN_UNIQUE_PEOPLE,
            "schedule_tolerance_minutes": (
                MATCH_SCHEDULE_TOLERANCE_MINUTES
            ),
            "analysis_version": MATCH_ANALYSIS_VERSION,
        }

    def start_match_analysis(self, *, force: bool = False) -> dict:
        with self._match_analysis_state_lock:
            if self._match_analysis_state["running"] or self._match_analysis_guard.locked():
                return {"started": False, **self.match_analysis_status()}
            self._match_analysis_state.update({
                "running": True,
                "force": bool(force),
                "started_at": utc_now(),
                "finished_at": "",
                "current_date": "",
                "processed_days": 0,
                "total_days": 0,
                "last_error": "",
            })
        Thread(
            target=self.analyze_match_history,
            kwargs={"force": bool(force)},
            name="futsi-match-analysis",
            daemon=True,
        ).start()
        return {"started": True, **self.match_analysis_status()}

    def analyze_match_history(self, *, force: bool = False) -> dict:
        if not self._match_analysis_guard.acquire(blocking=False):
            return {"started": False, **self.match_analysis_status()}
        with self._match_analysis_state_lock:
            self._match_analysis_state.update({
                "running": True,
                "force": bool(force),
                "started_at": self._match_analysis_state["started_at"] or utc_now(),
                "finished_at": "",
                "current_date": "",
                "processed_days": 0,
                "last_error": "",
            })
        try:
            sources = self._match_source_dates()
            with self._match_analysis_state_lock:
                self._match_analysis_state["total_days"] = len(sources)
            with self.connection() as db:
                stored = {
                    row["analysis_date"]: dict(row)
                    for row in db.execute(
                        """
                        select analysis_date,status,source_queue_count,
                               source_schedule_count,
                               unresolved_queue_count,analysis_version
                        from match_analysis_days
                        """
                    )
                }
            processed_days = 0
            for source in sources:
                analysis_date = source["analysis_date"]
                with self._match_analysis_state_lock:
                    self._match_analysis_state["current_date"] = analysis_date
                unresolved = int(source["unresolved_queue_count"] or 0)
                previous = stored.get(analysis_date)
                if unresolved > 0:
                    self._mark_match_day_processing(source)
                else:
                    should_analyze = (
                        bool(force)
                        or previous is None
                        or previous["analysis_version"] != MATCH_ANALYSIS_VERSION
                        or int(previous["source_queue_count"] or 0)
                        != int(source["source_queue_count"] or 0)
                        or int(previous["source_schedule_count"] or 0)
                        != int(source["source_schedule_count"] or 0)
                        or int(previous["unresolved_queue_count"] or 0) != 0
                        or previous["status"] != "complete"
                    )
                    if should_analyze:
                        self._analyze_match_date(analysis_date, source)
                processed_days += 1
                with self._match_analysis_state_lock:
                    self._match_analysis_state["processed_days"] = processed_days
            return {"started": True, **self.match_analysis_status()}
        except Exception as exc:
            with self._match_analysis_state_lock:
                self._match_analysis_state["last_error"] = str(exc)[:1000]
            raise
        finally:
            with self._match_analysis_state_lock:
                self._match_analysis_state.update({
                    "running": False,
                    "finished_at": utc_now(),
                    "current_date": "",
                })
            self._match_analysis_guard.release()

    def _match_source_dates(self) -> list[dict]:
        with self.connection() as db:
            queue_rows = list(db.execute(
                """
                select capture_date as analysis_date,
                       coalesce(sum(item_count),0) as source_queue_count,
                       coalesce(sum(
                           case when status in ('pending','processing','error')
                                then item_count else 0 end
                       ),0) as unresolved_queue_count
                from crop_processing_stats
                group by capture_date
                """
            ))
            presence_dates = {
                str(row["presence_date"])
                for row in db.execute(
                    "select distinct presence_date from daily_presence"
                )
            }
            schedule_rows = list(db.execute(
                """
                select distinct match_date as analysis_date
                from match_schedule
                """
            ))
        by_date = {
            str(row["analysis_date"]): {
                "analysis_date": str(row["analysis_date"]),
                "source_queue_count": int(row["source_queue_count"] or 0),
                "source_schedule_count": 0,
                "unresolved_queue_count": int(row["unresolved_queue_count"] or 0),
            }
            for row in queue_rows
            if row["analysis_date"]
        }
        for analysis_date in presence_dates:
            by_date.setdefault(analysis_date, {
                "analysis_date": analysis_date,
                "source_queue_count": 0,
                "source_schedule_count": 0,
                "unresolved_queue_count": 0,
            })
        for row in schedule_rows:
            analysis_date = str(row["analysis_date"])
            by_date.setdefault(analysis_date, {
                "analysis_date": analysis_date,
                "source_queue_count": 0,
                "source_schedule_count": 0,
                "unresolved_queue_count": 0,
            })
        for analysis_date, source in by_date.items():
            source["source_schedule_count"] = len(
                self._match_schedule_for_date(analysis_date)
            )
        return [by_date[key] for key in sorted(by_date)]

    def _mark_match_day_processing(self, source: dict) -> None:
        now = utc_now()
        with self.connection(immediate=True) as db:
            db.execute(
                """
                insert into match_analysis_days
                    (analysis_date,status,match_detected,window_count,
                     scheduled_count,scheduled_confirmed_count,
                     unscheduled_count,max_unique_people,source_crop_count,
                     source_queue_count,source_schedule_count,
                     unresolved_queue_count,analysis_version,analyzed_at)
                values (?,'processing',0,0,0,0,0,0,0,?,?,?,?,?)
                on conflict(analysis_date) do update set
                    status='processing',
                    source_queue_count=excluded.source_queue_count,
                    source_schedule_count=excluded.source_schedule_count,
                    unresolved_queue_count=excluded.unresolved_queue_count,
                    analysis_version=excluded.analysis_version,
                    analyzed_at=excluded.analyzed_at
                """,
                (
                    source["analysis_date"],
                    int(source["source_queue_count"] or 0),
                    int(source["source_schedule_count"] or 0),
                    int(source["unresolved_queue_count"] or 0),
                    MATCH_ANALYSIS_VERSION,
                    now,
                ),
            )

    def _read_match_events(self, analysis_date: str) -> list[dict]:
        uri = f"file:{self.db_path.as_posix()}?mode=ro"
        with sqlite3.connect(uri, uri=True, timeout=30) as db:
            db.row_factory = sqlite3.Row
            db.execute("pragma query_only=on")
            db.execute("pragma busy_timeout=30000")
            return [dict(row) for row in db.execute(
                """
                select c.id,c.seen_at,c.crop_path,c.quality,c.quality_pass,
                       c.evidence_selected,c.evidence_score,c.camera,
                       case
                           when c.subject_kind='known'
                                or unknown_subject.linked_person_key is not null
                           then 'known' else 'unknown'
                       end as identity_kind,
                       case
                           when c.subject_kind='known' then c.subject_key
                           when unknown_subject.linked_person_key is not null
                           then unknown_subject.linked_person_key
                           else c.subject_key
                       end as identity_key,
                       case
                           when c.subject_kind='known'
                           then coalesce(person.name,c.subject_key)
                           when unknown_subject.linked_person_key is not null
                           then coalesce(
                               linked_person.name,
                               unknown_subject.temporary_name,
                               c.subject_key
                           )
                           else coalesce(
                               unknown_subject.temporary_name,
                               c.subject_key
                           )
                       end as name,
                       coalesce(
                           person.person_type,
                           linked_person.person_type,
                           'unknown'
                       ) as person_type
                from face_crops c
                left join people person
                  on c.subject_kind='known'
                 and person.person_key=c.subject_key
                left join unknown_subjects unknown_subject
                  on c.subject_kind='unknown'
                 and unknown_subject.subject_id=c.subject_key
                left join people linked_person
                  on unknown_subject.linked_person_key=linked_person.person_key
                where substr(c.seen_at,1,10)=?
                  and (
                      c.subject_kind='known'
                      or coalesce(unknown_subject.status,'')
                         in ('consolidated','linked')
                  )
                  and coalesce(
                      person.person_type,
                      linked_person.person_type,
                      'unknown'
                  )<>'collaborator'
                order by c.seen_at,c.id
                """,
                (analysis_date,),
            )]

    @staticmethod
    def _update_match_participant(
        participants: dict[str, dict],
        event: dict,
    ) -> None:
        identity = f"{event['identity_kind']}:{event['identity_key']}"
        seen_at = str(event["seen_at"])
        evidence_score = (
            float(event.get("quality_pass") or 0) * 1_000_000
            + float(event.get("evidence_selected") or 0) * 10_000
            + float(event.get("evidence_score") or 0) * 100
            + float(event.get("quality") or 0)
        )
        participant = participants.get(identity)
        if participant is None:
            participants[identity] = {
                "kind": str(event["identity_kind"]),
                "key": str(event["identity_key"]),
                "name": str(event.get("name") or event["identity_key"]),
                "person_type": str(event.get("person_type") or "unknown"),
                "first_seen_at": seen_at,
                "last_seen_at": seen_at,
                "detection_count": 1,
                "best_crop_id": int(event["id"]),
                "best_crop_seen_at": seen_at,
                "best_quality": float(event.get("quality") or 0.0),
                "camera": str(event.get("camera") or ""),
                "_evidence_score": evidence_score,
            }
            return
        participant["first_seen_at"] = min(
            str(participant["first_seen_at"]),
            seen_at,
        )
        participant["last_seen_at"] = max(
            str(participant["last_seen_at"]),
            seen_at,
        )
        participant["detection_count"] = int(
            participant["detection_count"]
        ) + 1
        if evidence_score > float(participant["_evidence_score"]):
            participant.update({
                "best_crop_id": int(event["id"]),
                "best_crop_seen_at": seen_at,
                "best_quality": float(event.get("quality") or 0.0),
                "camera": str(event.get("camera") or ""),
                "_evidence_score": evidence_score,
            })

    @classmethod
    def _match_participants(
        cls,
        events: list[dict],
    ) -> list[dict]:
        participants_by_identity = {}
        for event in events:
            cls._update_match_participant(
                participants_by_identity,
                event,
            )

        participants = list(participants_by_identity.values())
        for participant in participants:
            participant.pop("_evidence_score", None)
        participants.sort(
            key=lambda item: (
                0 if item["kind"] == "known" else 1,
                str(item["name"]).lower(),
            )
        )
        return participants

    @classmethod
    def _scheduled_match_windows(
        cls,
        events: list[dict],
        schedule: list[dict],
        *,
        minimum_unique_people: int = MATCH_MIN_UNIQUE_PEOPLE,
    ) -> tuple[list[dict], set[int]]:
        if not schedule:
            return [], set()
        slots = []
        assigned_by_schedule = {}
        for item in schedule:
            starts_at = datetime.fromisoformat(str(item["starts_at"]))
            ends_at = datetime.fromisoformat(str(item["ends_at"]))
            tolerance = max(
                0,
                int(item.get("tolerance_minutes") or 0),
            )
            schedule_id = int(item["id"])
            slots.append(
                {
                    "item": item,
                    "starts_at": starts_at,
                    "ends_at": ends_at,
                    "authorized_starts_at": starts_at
                    - timedelta(minutes=tolerance),
                    "authorized_ends_at": ends_at
                    + timedelta(minutes=tolerance),
                    "midpoint": starts_at + (ends_at - starts_at) / 2,
                }
            )
            assigned_by_schedule[schedule_id] = []

        def identity_for(event: dict) -> str:
            return (
                f"{event['identity_kind']}:"
                f"{event['identity_key']}"
            )

        # Una deteccion cercana al cambio de partido puede caer dentro de dos
        # tolerancias. La identidad completa vota por el bloque donde tuvo mas
        # apariciones reales; esto conserva una llegada anticipada con el
        # partido en el que la persona permanecio.
        core_counts = {
            int(slot["item"]["id"]): Counter()
            for slot in slots
        }
        compatible_counts = {
            int(slot["item"]["id"]): Counter()
            for slot in slots
        }
        for event in events:
            observed_at = datetime.fromisoformat(str(event["seen_at"]))
            identity = identity_for(event)
            for slot in slots:
                schedule_id = int(slot["item"]["id"])
                if (
                    slot["authorized_starts_at"]
                    <= observed_at
                    <= slot["authorized_ends_at"]
                ):
                    compatible_counts[schedule_id][identity] += 1
                if slot["starts_at"] <= observed_at < slot["ends_at"]:
                    core_counts[schedule_id][identity] += 1

        assigned_event_ids = set()
        for event in events:
            observed_at = datetime.fromisoformat(str(event["seen_at"]))
            identity = identity_for(event)
            candidates = [
                slot
                for slot in slots
                if slot["authorized_starts_at"]
                <= observed_at
                <= slot["authorized_ends_at"]
            ]
            if not candidates:
                continue
            selected = max(
                candidates,
                key=lambda slot: (
                    core_counts[int(slot["item"]["id"])][identity],
                    compatible_counts[
                        int(slot["item"]["id"])
                    ][identity],
                    int(
                        slot["starts_at"]
                        <= observed_at
                        < slot["ends_at"]
                    ),
                    -abs(
                        (
                            observed_at
                            - slot["midpoint"]
                        ).total_seconds()
                    ),
                    slot["starts_at"].timestamp(),
                ),
            )
            schedule_id = int(selected["item"]["id"])
            assigned_by_schedule[schedule_id].append(event)
            assigned_event_ids.add(int(event["id"]))

        now = business_time(datetime.now(timezone.utc))
        windows = []
        for slot in slots:
            item = slot["item"]
            schedule_id = int(item["id"])
            assigned_events = assigned_by_schedule[schedule_id]
            participants = cls._match_participants(assigned_events)
            _, max_unique_people = cls._detect_match_windows(
                assigned_events,
                window_minutes=MATCH_WINDOW_MINUTES,
                minimum_unique_people=minimum_unique_people,
            )
            known_count = sum(
                1
                for participant in participants
                if participant["kind"] == "known"
            )
            if max_unique_people >= max(1, int(minimum_unique_people)):
                window_status = "scheduled_with_evidence"
            elif slot["authorized_ends_at"] >= now:
                window_status = "scheduled"
            elif participants:
                window_status = "scheduled_insufficient_evidence"
            else:
                window_status = "scheduled_no_evidence"
            evidence_times = sorted(
                str(event["seen_at"])
                for event in assigned_events
            )

            windows.append(
                {
                    "starts_at": slot["starts_at"].isoformat(),
                    "ends_at": slot["ends_at"].isoformat(),
                    "duration_minutes": int(
                        item["expected_duration_minutes"]
                        or MATCH_WINDOW_MINUTES
                    ),
                    "max_unique_people": int(max_unique_people),
                    "participant_count": len(participants),
                    "known_count": known_count,
                    "unknown_count": len(participants) - known_count,
                    "participants": participants,
                    "window_type": "scheduled",
                    "window_status": window_status,
                    "schedule_id": schedule_id,
                    "tournament": str(item.get("tournament") or ""),
                    "home_team": str(item.get("home_team") or ""),
                    "away_team": str(item.get("away_team") or ""),
                    "scheduled_starts_at": slot["starts_at"].isoformat(),
                    "scheduled_ends_at": slot["ends_at"].isoformat(),
                    "evidence_starts_at": (
                        evidence_times[0] if evidence_times else ""
                    ),
                    "evidence_ends_at": (
                        evidence_times[-1] if evidence_times else ""
                    ),
                    "tolerance_minutes": int(
                        item.get("tolerance_minutes") or 0
                    ),
                }
            )
        return windows, assigned_event_ids

    @classmethod
    def _detect_match_windows(
        cls,
        events: list[dict],
        *,
        window_minutes: int = MATCH_WINDOW_MINUTES,
        minimum_unique_people: int = MATCH_MIN_UNIQUE_PEOPLE,
    ) -> tuple[list[dict], int]:
        threshold = max(1, int(minimum_unique_people))
        fixed_minutes = max(1, int(window_minutes))
        span = timedelta(minutes=fixed_minutes)
        timed_events = [
            (
                datetime.fromisoformat(str(event["seen_at"])),
                f"{event['identity_kind']}:{event['identity_key']}",
                event,
            )
            for event in events
        ]
        timed_events.sort(
            key=lambda item: (
                item[0],
                item[1],
                int(item[2].get("id") or 0),
            )
        )
        if not timed_events:
            return [], 0

        daily_counts = Counter()
        daily_max_unique = 0
        daily_end = 0
        for starts_at, identity, _ in timed_events:
            window_end = starts_at + span
            while (
                daily_end < len(timed_events)
                and timed_events[daily_end][0] <= window_end
            ):
                daily_counts[timed_events[daily_end][1]] += 1
                daily_end += 1
            daily_max_unique = max(
                daily_max_unique,
                len(daily_counts),
            )
            daily_counts[identity] -= 1
            if daily_counts[identity] <= 0:
                daily_counts.pop(identity, None)

        detected_windows: list[dict] = []
        identity_counts: Counter[str] = Counter()
        start_index = 0
        end_index = 0
        while start_index < len(timed_events):
            starts_at = timed_events[start_index][0]
            ends_at = starts_at + span
            while (
                end_index < len(timed_events)
                and timed_events[end_index][0] <= ends_at
            ):
                identity_counts[timed_events[end_index][1]] += 1
                end_index += 1
            if len(identity_counts) < threshold:
                expired_identity = timed_events[start_index][1]
                identity_counts[expired_identity] -= 1
                if identity_counts[expired_identity] <= 0:
                    identity_counts.pop(expired_identity, None)
                start_index += 1
                continue

            window_events = [
                item[2]
                for item in timed_events[start_index:end_index]
            ]
            participants = cls._match_participants(window_events)
            known_count = sum(
                1
                for participant in participants
                if participant["kind"] == "known"
            )
            evidence_times = [
                str(event["seen_at"])
                for event in window_events
            ]

            detected_windows.append(
                {
                    "starts_at": starts_at.isoformat(),
                    "ends_at": ends_at.isoformat(),
                    "duration_minutes": fixed_minutes,
                    "max_unique_people": len(participants),
                    "participant_count": len(participants),
                    "known_count": known_count,
                    "unknown_count": len(participants) - known_count,
                    "participants": participants,
                    "window_type": "unscheduled",
                    "window_status": "outside_schedule",
                    "schedule_id": None,
                    "tournament": "",
                    "home_team": "",
                    "away_team": "",
                    "scheduled_starts_at": "",
                    "scheduled_ends_at": "",
                    "evidence_starts_at": (
                        min(evidence_times) if evidence_times else ""
                    ),
                    "evidence_ends_at": (
                        max(evidence_times) if evidence_times else ""
                    ),
                    "tolerance_minutes": 0,
                }
            )
            start_index = end_index
            identity_counts.clear()
        return detected_windows, daily_max_unique


    def _analyze_match_date(self, analysis_date: str, source: dict) -> dict:
        events = self._read_match_events(analysis_date)
        schedule = self._match_schedule_for_date(analysis_date)
        scheduled_windows, assigned_event_ids = self._scheduled_match_windows(
            events,
            schedule,
        )
        unscheduled_events = [
            event
            for event in events
            if int(event["id"]) not in assigned_event_ids
        ]
        unscheduled_windows, unscheduled_max_unique = self._detect_match_windows(
            unscheduled_events
        )
        windows = sorted(
            [*scheduled_windows, *unscheduled_windows],
            key=lambda window: (
                str(window["starts_at"]),
                0 if window["window_type"] == "scheduled" else 1,
            ),
        )
        scheduled_confirmed_count = sum(
            1
            for window in scheduled_windows
            if window["window_status"] == "scheduled_with_evidence"
        )
        unscheduled_count = len(unscheduled_windows)
        confirmed_count = (
            scheduled_confirmed_count + unscheduled_count
        )
        max_unique_people = max(
            [
                int(unscheduled_max_unique),
                *[
                    int(window["participant_count"])
                    for window in scheduled_windows
                ],
            ]
        )

        now = utc_now()
        first_seen_at = str(events[0]["seen_at"]) if events else ""
        last_seen_at = str(events[-1]["seen_at"]) if events else ""
        with self.connection(immediate=True) as db:
            db.execute(
                """
                insert into match_analysis_days
                    (analysis_date,status,match_detected,window_count,
                     scheduled_count,scheduled_confirmed_count,
                     unscheduled_count,max_unique_people,
                     source_crop_count,source_queue_count,
                     source_schedule_count,unresolved_queue_count,
                     first_seen_at,last_seen_at,analysis_version,analyzed_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                on conflict(analysis_date) do update set
                    status='complete',
                    match_detected=excluded.match_detected,
                    window_count=excluded.window_count,
                    scheduled_count=excluded.scheduled_count,
                    scheduled_confirmed_count=
                        excluded.scheduled_confirmed_count,
                    unscheduled_count=excluded.unscheduled_count,
                    max_unique_people=excluded.max_unique_people,
                    source_crop_count=excluded.source_crop_count,
                    source_queue_count=excluded.source_queue_count,
                    source_schedule_count=
                        excluded.source_schedule_count,
                    unresolved_queue_count=0,
                    first_seen_at=excluded.first_seen_at,
                    last_seen_at=excluded.last_seen_at,
                    analysis_version=excluded.analysis_version,
                    analyzed_at=excluded.analyzed_at
                """,
                (
                    analysis_date,
                    "complete",
                    int(confirmed_count > 0),
                    confirmed_count,
                    len(scheduled_windows),
                    scheduled_confirmed_count,
                    unscheduled_count,
                    int(max_unique_people),
                    len(events),
                    int(source["source_queue_count"] or 0),
                    int(source["source_schedule_count"] or 0),
                    0,
                    first_seen_at,
                    last_seen_at,
                    MATCH_ANALYSIS_VERSION,
                    now,
                ),
            )
            db.execute(
                "delete from match_analysis_windows where analysis_date=?",
                (analysis_date,),
            )
            for index, window in enumerate(windows, start=1):
                db.execute(
                    """
                    insert into match_analysis_windows
                        (analysis_date,window_index,starts_at,ends_at,
                         duration_minutes,max_unique_people,participant_count,
                         known_count,unknown_count,participants_json,
                         window_type,window_status,schedule_id,tournament,
                         home_team,away_team,scheduled_starts_at,
                         scheduled_ends_at,evidence_starts_at,
                         evidence_ends_at,tolerance_minutes,created_at)
                    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        analysis_date,
                        index,
                        window["starts_at"],
                        window["ends_at"],
                        int(window["duration_minutes"]),
                        int(window["max_unique_people"]),
                        int(window["participant_count"]),
                        int(window["known_count"]),
                        int(window["unknown_count"]),
                        json.dumps(
                            window["participants"],
                            ensure_ascii=False,
                        ),
                        window["window_type"],
                        window["window_status"],
                        window["schedule_id"],
                        window["tournament"],
                        window["home_team"],
                        window["away_team"],
                        window["scheduled_starts_at"],
                        window["scheduled_ends_at"],
                        window["evidence_starts_at"],
                        window["evidence_ends_at"],
                        int(window["tolerance_minutes"]),
                        now,
                    ),
                )
        return {
            "analysis_date": analysis_date,
            "match_detected": confirmed_count > 0,
            "window_count": confirmed_count,
            "scheduled_count": len(scheduled_windows),
            "scheduled_confirmed_count": scheduled_confirmed_count,
            "unscheduled_count": unscheduled_count,
            "max_unique_people": int(max_unique_people),
            "source_crop_count": len(events),
        }

    def match_history(
        self,
        *,
        status: str = "all",
        offset: int = 0,
        limit: int = 31,
    ) -> dict:
        if status not in {
            "all",
            "detected",
            "scheduled",
            "outside",
            "clear",
            "processing",
        }:
            raise ValueError("Estado de partidos no valido.")
        safe_offset = max(0, int(offset))
        safe_limit = max(1, min(int(limit), 100))
        where = ""
        if status == "detected":
            where = "where match_detected=1"
        elif status == "scheduled":
            where = "where scheduled_count>0"
        elif status == "outside":
            where = "where unscheduled_count>0"
        elif status == "clear":
            where = (
                "where status='complete' and match_detected=0"
            )
        elif status == "processing":
            where = "where status<>'complete'"
        with self.connection() as db:
            summary_row = db.execute(
                """
                select count(*) as total_days,
                       coalesce(sum(match_detected),0) as detected_days,
                       coalesce(sum(
                           case when status='complete' and match_detected=0
                                then 1 else 0 end
                       ),0) as clear_days,
                       coalesce(sum(
                           case when status<>'complete' then 1 else 0 end
                       ),0) as processing_days,
                       coalesce(sum(window_count),0) as total_windows,
                       coalesce(sum(scheduled_count),0)
                           as scheduled_matches,
                       coalesce(sum(scheduled_confirmed_count),0)
                           as scheduled_confirmed,
                       coalesce(sum(
                           scheduled_count-scheduled_confirmed_count
                       ),0) as scheduled_unconfirmed,
                       coalesce(sum(unscheduled_count),0)
                           as unscheduled_matches,
                       min(analysis_date) as first_date,
                       max(analysis_date) as last_date
                from match_analysis_days
                """
            ).fetchone()
            total = int(db.execute(
                f"select count(*) from match_analysis_days {where}"
            ).fetchone()[0])
            day_rows = [
                dict(row)
                for row in db.execute(
                    f"""
                    select * from match_analysis_days
                    {where}
                    order by analysis_date desc
                    limit ? offset ?
                    """,
                    (safe_limit, safe_offset),
                )
            ]
            windows_by_date: dict[str, list[dict]] = {
                row["analysis_date"]: [] for row in day_rows
            }
            if windows_by_date:
                placeholders = ",".join("?" for _ in windows_by_date)
                for row in db.execute(
                    f"""
                    select * from match_analysis_windows
                    where analysis_date in ({placeholders})
                    order by analysis_date desc,window_index
                    """,
                    tuple(windows_by_date),
                ):
                    item = dict(row)
                    item.pop("participants_json", None)
                    item["participants"] = []
                    windows_by_date[item["analysis_date"]].append(item)
        for row in day_rows:
            row["windows"] = windows_by_date.get(
                row["analysis_date"],
                [],
            )
        summary = {
            "total_days": int(summary_row["total_days"] or 0),
            "detected_days": int(summary_row["detected_days"] or 0),
            "clear_days": int(summary_row["clear_days"] or 0),
            "processing_days": int(summary_row["processing_days"] or 0),
            "total_windows": int(summary_row["total_windows"] or 0),
            "scheduled_matches": int(
                summary_row["scheduled_matches"] or 0
            ),
            "scheduled_confirmed": int(
                summary_row["scheduled_confirmed"] or 0
            ),
            "scheduled_unconfirmed": int(
                summary_row["scheduled_unconfirmed"] or 0
            ),
            "unscheduled_matches": int(
                summary_row["unscheduled_matches"] or 0
            ),
            "first_date": str(summary_row["first_date"] or ""),
            "last_date": str(summary_row["last_date"] or ""),
        }
        return {
            "items": day_rows,
            "offset": safe_offset,
            "limit": safe_limit,
            "total": total,
            "summary": summary,
            "analysis": self.match_analysis_status(),
        }

    def match_window_participants(self, window_id: int) -> dict | None:
        with self.connection() as db:
            row = db.execute(
                """
                select id,analysis_date,participant_count,participants_json
                from match_analysis_windows
                where id=?
                """,
                (int(window_id),),
            ).fetchone()
            if row is None:
                return None
            try:
                participants = json.loads(
                    row["participants_json"] or "[]"
                )
            except (TypeError, json.JSONDecodeError):
                participants = []
            crop_ids = sorted({
                int(participant["best_crop_id"])
                for participant in participants
                if participant.get("best_crop_id") is not None
            })
            crop_times = {}
            if crop_ids:
                placeholders = ",".join("?" for _ in crop_ids)
                crop_times = {
                    int(crop["id"]): str(crop["seen_at"] or "")
                    for crop in db.execute(
                        f"""
                        select id,seen_at from face_crops
                        where id in ({placeholders})
                        """,
                        crop_ids,
                    )
                }
        for participant in participants:
            crop_id = participant.get("best_crop_id")
            participant["best_crop_seen_at"] = (
                str(
                    crop_times.get(int(crop_id), "")
                    if crop_id is not None
                    else ""
                )
                or str(participant.get("best_crop_seen_at") or "")
                or str(participant.get("first_seen_at") or "")
            )
        return {
            "window_id": int(row["id"]),
            "analysis_date": str(row["analysis_date"]),
            "total": int(row["participant_count"] or len(participants)),
            "items": participants,
        }

    def monthly_attendance(
        self,
        selected_month: str,
        query: str = "",
        kind: str = "all",
        offset: int = 0,
        limit: int = 48,
        *,
        monthly_fee_amount: float = 1000.0,
        revenue_min_days: int = MONTHLY_REVENUE_MIN_DAYS,
        registered_revenue_min_days: int = MONTHLY_REGISTERED_REVENUE_MIN_DAYS,
        revenue_only: bool = False,
    ) -> dict:
        try:
            month_start = datetime.strptime(selected_month, "%Y-%m").date().replace(day=1)
        except ValueError as exc:
            raise ValueError("Mes no valido.") from exc
        if kind not in {"all", "known", "unknown"}:
            raise ValueError("Tipo de identidad no valido.")
        month_end = (
            month_start.replace(year=month_start.year + 1, month=1)
            if month_start.month == 12
            else month_start.replace(month=month_start.month + 1)
        )
        normalized_query = str(query or "").strip().lower()
        search = f"%{normalized_query}%"
        safe_offset = max(0, int(offset))
        safe_limit = max(1, min(int(limit), 100))
        safe_monthly_fee = round(max(0.0, float(monthly_fee_amount)), 2)
        safe_revenue_min_days = max(1, int(revenue_min_days))
        safe_registered_revenue_min_days = max(
            1,
            int(registered_revenue_min_days),
        )
        cte = """
            with monthly_presence as (
                select subject_key,subject_kind,
                       count(distinct presence_date) as attendance_days,
                       count(*) as session_count,
                       sum(detection_count) as detection_count,
                       min(presence_date) as first_date,
                       max(presence_date) as last_date,
                       min(first_seen_at) as first_seen_at,
                       max(last_seen_at) as last_seen_at,
                       max(best_similarity) as best_similarity
                from daily_presence
                where presence_date>=? and presence_date<?
                group by subject_key,subject_kind
            ),
            identity_base as (
                select monthly_presence.*,
                       case
                           when monthly_presence.subject_kind='known' then coalesce(person.name,monthly_presence.subject_key)
                           when unknown_subject.linked_person_key is not null then coalesce(linked_person.name,unknown_subject.temporary_name,monthly_presence.subject_key)
                           else coalesce(unknown_subject.temporary_name,monthly_presence.subject_key)
                       end as name,
                       coalesce(person.person_type,linked_person.person_type,'unknown') as person_type,
                       coalesce(person.group_name,linked_person.group_name,'') as group_name,
                       coalesce(person.team_name,linked_person.team_name,'') as team_name,
                       coalesce(unknown_subject.status,case when monthly_presence.subject_kind='known' then 'known' else '' end) as status,
                       unknown_subject.linked_person_key,
                       case
                           when coalesce(person.person_type,linked_person.person_type,'')='student'
                           then 1 else 0
                       end as payment_applicable,
                       case
                           when coalesce(person.person_type,linked_person.person_type,'')='collaborator'
                           then 0 else 1
                       end as expected_fee_applicable,
                       case
                           when coalesce(person.person_type,linked_person.person_type,'')='student'
                                and coalesce(monthly_payment.payment_count,0)>0
                           then 1 else 0
                       end as payment_registered,
                       coalesce(monthly_payment.payment_count,0) as payment_count,
                       coalesce(monthly_payment.amount,0) as payment_amount,
                       coalesce(monthly_payment.last_paid_at,'') as last_paid_at,
                       case
                           when monthly_presence.subject_kind='known'
                                or unknown_subject.linked_person_key is not null
                           then ?
                           else ?
                       end as expected_fee_minimum_days
                from monthly_presence
                left join people person
                  on monthly_presence.subject_kind='known' and person.person_key=monthly_presence.subject_key
                left join unknown_subjects unknown_subject
                  on monthly_presence.subject_kind='unknown' and unknown_subject.subject_id=monthly_presence.subject_key
                left join people linked_person
                  on unknown_subject.linked_person_key=linked_person.person_key
                left join monthly_payments monthly_payment
                  on monthly_payment.person_key=case
                      when monthly_presence.subject_kind='known'
                      then monthly_presence.subject_key
                      else unknown_subject.linked_person_key
                  end
                 and monthly_payment.payment_month=?
                where (?='all' or monthly_presence.subject_kind=?)
                  and (
                      monthly_presence.subject_kind<>'unknown'
                      or coalesce(unknown_subject.status,'') not in ('ignored','quarantined')
                  )
                  and (
                      ?='' or lower(
                          coalesce(person.name,'') || ' ' ||
                          coalesce(person.group_name,'') || ' ' ||
                          coalesce(person.team_name,'') || ' ' ||
                          coalesce(unknown_subject.temporary_name,'') || ' ' ||
                          coalesce(linked_person.name,'')
                      ) like ?
                  )
            ),
            resolved as (
                select identity_base.*,
                       case
                           when expected_fee_applicable=1
                                and attendance_days>=expected_fee_minimum_days
                           then 1 else 0
                       end as expected_fee_eligible,
                       case
                           when expected_fee_applicable=1
                                and attendance_days>=expected_fee_minimum_days
                           then ? else 0
                       end as expected_monthly_amount
                from identity_base
            )
        """
        revenue_scope = (
            " where expected_fee_applicable=1"
            if revenue_only
            else ""
        )
        params = (
            month_start.isoformat(),
            month_end.isoformat(),
            safe_registered_revenue_min_days,
            safe_revenue_min_days,
            selected_month,
            kind,
            kind,
            normalized_query,
            search,
            safe_monthly_fee,
        )
        with self.connection() as db:
            summary_row = db.execute(
                cte
                + """
                    select count(*) as people,
                           sum(case when subject_kind='known' then 1 else 0 end) as known,
                           sum(case when subject_kind='unknown' then 1 else 0 end) as unknown,
                           coalesce(sum(attendance_days),0) as attendance_days,
                           coalesce(sum(session_count),0) as sessions,
                           coalesce(sum(detection_count),0) as detections,
                           coalesce(sum(expected_fee_eligible),0) as expected_payers,
                           coalesce(sum(expected_monthly_amount),0) as expected_revenue,
                           coalesce(sum(payment_registered),0) as payment_registered,
                           coalesce(sum(
                               case
                                   when payment_applicable=1
                                        and payment_registered=0
                                   then 1 else 0
                               end
                           ),0) as payment_missing
                    from resolved
                """
                + revenue_scope,
                params,
            ).fetchone()
            rows = [dict(row) for row in db.execute(
                cte
                + """
                    select * from resolved
                """
                + revenue_scope
                + """
                    order by attendance_days desc,last_date desc,name collate nocase
                    limit ? offset ?
                """,
                (*params, safe_limit, safe_offset),
            )]
        summary = {
            "people": int(summary_row["people"] or 0),
            "known": int(summary_row["known"] or 0),
            "unknown": int(summary_row["unknown"] or 0),
            "attendance_days": int(summary_row["attendance_days"] or 0),
            "sessions": int(summary_row["sessions"] or 0),
            "detections": int(summary_row["detections"] or 0),
            "expected_payers": int(
                summary_row["expected_payers"] or 0
            ),
            "expected_revenue": float(
                summary_row["expected_revenue"] or 0.0
            ),
            "payment_registered": int(
                summary_row["payment_registered"] or 0
            ),
            "payment_missing": int(summary_row["payment_missing"] or 0),
        }
        return {
            "month": selected_month,
            "items": rows,
            "offset": safe_offset,
            "limit": safe_limit,
            "total": summary["people"],
            "summary": summary,
            "revenue_policy": {
                "monthly_fee_amount": safe_monthly_fee,
                "minimum_attendance_days": safe_revenue_min_days,
                "registered_minimum_attendance_days": (
                    safe_registered_revenue_min_days
                ),
                "unknown_minimum_attendance_days": safe_revenue_min_days,
            },
        }

    def dashboard(self, selected_date: str) -> dict:
        with self.connection() as db:
            presence = [dict(row) for row in db.execute(
                """
                select presence.*,
                       coalesce(
                           (
                               select crop.id
                               from face_crops crop
                               where crop.subject_kind=presence.subject_kind
                                 and crop.subject_key=presence.subject_key
                                 and substr(crop.seen_at,1,10)=presence.presence_date
                                 and crop.crop_path=presence.best_crop_path
                                 and crop.quality_pass=1
                                 and crop.evidence_reason<>'manual_rejected'
                               order by crop.id desc
                               limit 1
                           ),
                           (
                               select crop.id
                               from face_crops crop
                               where crop.subject_kind=presence.subject_kind
                                 and crop.subject_key=presence.subject_key
                                 and substr(crop.seen_at,1,10)=presence.presence_date
                                 and crop.quality_pass=1
                                 and crop.evidence_reason<>'manual_rejected'
                               order by
                                   crop.quality desc,
                                   crop.seen_at desc,
                                   crop.id desc
                               limit 1
                           )
                       ) as best_crop_id
                from daily_presence presence
                where presence_date=?
                order by last_seen_at desc
                """,
                (selected_date,),
            )]
            people = {
                row["person_key"]: dict(row)
                for row in db.execute(
                    """
                    select person_key,person_type,remote_id,name,group_name,team_name,photo_url,
                           photo_path,reference_version,reference_available,active,updated_at
                    from people where active=1
                    """
                )
            }
            unknowns = {
                row["subject_id"]: dict(row)
                for row in db.execute(
                    """
                    select subject_id,temporary_name,status,best_crop_path,best_quality,
                           first_seen_at,last_seen_at,detection_count,linked_person_key,
                           remote_subject_id,quality_hits,quality_version,quality_json,
                           merged_into,updated_at
                    from unknown_subjects
                    where status not in ('ignored','quarantined')
                    """
                )
            }
            sessions = {
                row["remote_id"]: dict(row)
                for row in db.execute("select remote_id,label from sessions")
            }
            pending = db.execute("select count(*) from sync_queue where status='pending'").fetchone()[0]
        known_results, unknown_results = [], []
        for item in presence:
            session = sessions.get(item["session_id"])
            item["session_label"] = session["label"] if session else "Sin sesion programada"
            if item["subject_kind"] == "known" and item["subject_key"] in people:
                known_results.append({**item, **people[item["subject_key"]]})
            elif item["subject_key"] in unknowns:
                unknown = unknowns[item["subject_key"]]
                unknown_results.append({**unknown, **item})
        return {"date": selected_date, "known": known_results, "unknown": unknown_results, "people": list(people.values()), "pending_sync": pending}

    def image_path(self, kind: str, identifier: str) -> Path | None:
        with self.connection() as db:
            if kind == "person":
                row = db.execute("select photo_path from people where person_key=?", (identifier,)).fetchone()
            elif kind == "unknown":
                identifier = self._canonical_unknown_id(db, identifier)
                subject = db.execute(
                    "select best_crop_path,status from unknown_subjects where subject_id=?",
                    (identifier,),
                ).fetchone()
                row = subject
                # Candidates intentionally have no approved reference yet, but
                # recent detections still need a visible thumbnail. Keep the
                # quality-approved best crop as the first choice and fall back
                # to their latest stored crop for this local-only view. The
                # crop remains ineligible for evidence and references.
                if not row or not row[0]:
                    quality_clause = "" if subject and subject["status"] == "candidate" else "and quality_pass=1"
                    row = db.execute(
                        f"""
                        select crop_path from face_crops
                        where subject_kind='unknown' and subject_key=?
                          {quality_clause}
                          and evidence_reason<>'manual_rejected'
                        order by seen_at desc,id desc limit 1
                        """,
                        (identifier,),
                    ).fetchone()
            else:
                row = db.execute(
                    """
                    select crop_path from face_crops
                    where subject_kind='known' and subject_key=?
                      and quality_pass=1
                      and evidence_reason<>'manual_rejected'
                    order by quality desc,seen_at desc,id desc limit 1
                    """,
                    (identifier,),
                ).fetchone()
        if not row or not row[0]:
            return None
        authorized_roots = (
            (self.faces_dir, self.references_dir)
            if kind == "person"
            else (self.faces_dir,)
        )
        return self._authorized_file_path(row[0], *authorized_roots)
