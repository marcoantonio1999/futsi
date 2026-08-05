from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


TEMPORARY_NAME_ERROR = (
    "UNIQUE constraint failed: unknown_subjects.temporary_name"
)

BROKEN_CANDIDATES_SQL = """
select
    u.subject_id,
    q.id as queue_id,
    f.id as face_crop_id,
    q.crop_path as old_spool_path,
    f.crop_path as recovery_path,
    q.captured_at,
    q.camera_key,
    q.file_bytes
from unknown_subjects u
join crop_processing_queue q
  on q.status='processed'
 and q.result_kind='unknown'
 and q.result_key=u.subject_id
 and q.captured_at=u.first_seen_at
join face_crops f
  on f.subject_kind='unknown'
 and f.subject_key=u.subject_id
 and f.seen_at=u.first_seen_at
where u.status='candidate'
  and u.detection_count=1
  and u.quality_hits=0
  and coalesce(u.best_crop_path,'')=''
  and u.merged_into is null
  and u.linked_person_key is null
  and coalesce(u.remote_subject_id,'')=''
  and (julianday(q.processed_at)-julianday(q.captured_at))*1440 > ?
  and not exists (
      select 1 from unknown_references r where r.subject_id=u.subject_id
  )
  and not exists (
      select 1 from daily_presence d
      where d.subject_kind='unknown' and d.subject_key=u.subject_id
  )
order by q.captured_at,q.id
"""


def _connect(db_path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(db_path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("pragma foreign_keys=on")
    db.execute("pragma busy_timeout=30000")
    db.execute("pragma synchronous=normal")
    return db


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_manifest(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


def _database_backup(db_path: Path, backup_path: Path) -> None:
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    source = _connect(db_path)
    target = sqlite3.connect(backup_path)
    try:
        source.backup(target)
        integrity = target.execute("pragma integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"El respaldo SQLite no es integro: {integrity}")
    finally:
        target.close()
        source.close()


def _protected_counts(db: sqlite3.Connection) -> dict[str, int]:
    return {
        "people": int(db.execute("select count(*) from people").fetchone()[0]),
        "known_queue": int(
            db.execute(
                """
                select count(*) from crop_processing_queue
                where status='processed' and result_kind='known'
                """
            ).fetchone()[0]
        ),
        "known_crops": int(
            db.execute(
                "select count(*) from face_crops where subject_kind='known'"
            ).fetchone()[0]
        ),
        "presence_rows": int(
            db.execute("select count(*) from daily_presence").fetchone()[0]
        ),
        "persistent_unknowns": int(
            db.execute(
                """
                select count(*) from unknown_subjects
                where status in ('consolidated','linked','ignored','archived')
                """
            ).fetchone()[0]
        ),
        "unknown_references": int(
            db.execute("select count(*) from unknown_references").fetchone()[0]
        ),
        "sync_rows": int(db.execute("select count(*) from sync_queue").fetchone()[0]),
    }


def inspect_repair(
    data_dir: Path,
    *,
    candidate_ttl_minutes: int = 30,
) -> dict:
    data_dir = data_dir.resolve()
    db_path = data_dir / "station.sqlite3"
    db = _connect(db_path)
    try:
        broken = [
            dict(row)
            for row in db.execute(
                BROKEN_CANDIDATES_SQL,
                (max(1, int(candidate_ttl_minutes)),),
            )
        ]
        all_name_errors = [
            dict(row)
            for row in db.execute(
                """
                select id,crop_path,captured_at,last_error
                from crop_processing_queue
                where status='error' and instr(last_error,?)>0
                order by captured_at,id
                """,
                (TEMPORARY_NAME_ERROR,),
            )
        ]
        spool_root = (data_dir / "crop-spool").resolve()
        name_errors = []
        missing_name_errors = []
        unsafe_name_errors = []
        for row in all_name_errors:
            path = Path(row["crop_path"]).resolve()
            try:
                path.relative_to(spool_root)
            except ValueError:
                unsafe_name_errors.append(row)
                continue
            if not path.is_file():
                missing_name_errors.append(row)
                continue
            name_errors.append(row)
        protected = _protected_counts(db)
    finally:
        db.close()
    return {
        "broken_candidates": broken,
        "name_errors": name_errors,
        "missing_name_errors": missing_name_errors,
        "unsafe_name_errors": unsafe_name_errors,
        "protected": protected,
    }


def repair_historical_candidates(
    data_dir: Path,
    *,
    apply: bool = False,
    candidate_ttl_minutes: int = 30,
    verify_hashes: bool = True,
) -> dict:
    data_dir = data_dir.resolve()
    db_path = data_dir / "station.sqlite3"
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    inspection = inspect_repair(
        data_dir,
        candidate_ttl_minutes=candidate_ttl_minutes,
    )
    broken = inspection["broken_candidates"]
    name_errors = inspection["name_errors"]
    summary = {
        "apply": bool(apply),
        "broken_candidates": len(broken),
        "name_errors": len(name_errors),
        "missing_name_error_files": len(inspection["missing_name_errors"]),
        "unsafe_name_error_paths": len(inspection["unsafe_name_errors"]),
        "recovered_bytes": sum(int(row["file_bytes"] or 0) for row in broken),
        "protected": inspection["protected"],
    }
    if not apply:
        return summary
    if inspection["missing_name_errors"] or inspection["unsafe_name_errors"]:
        raise RuntimeError(
            "Hay errores de nombre sin un spool recuperable y seguro; "
            "se canceló la reparación."
        )

    run_id = (
        datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        + "-"
        + uuid4().hex[:8]
    )
    backups_dir = data_dir / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backups_dir / f"historical-candidate-repair-{run_id}.sqlite3"
    manifest_path = backups_dir / f"historical-candidate-repair-{run_id}.json"
    staging_dir = data_dir / "crop-spool" / f"repair-{run_id}"
    staging_dir.mkdir(parents=True, exist_ok=False)
    _database_backup(db_path, backup_path)

    faces_root = (data_dir / "faces").resolve()
    spool_root = (data_dir / "crop-spool").resolve()
    staged_rows = []
    for row in broken:
        source = Path(row["recovery_path"]).resolve()
        try:
            source.relative_to(faces_root)
        except ValueError as exc:
            raise RuntimeError(
                f"El recorte de recuperación está fuera de faces/: {source}"
            ) from exc
        if not source.is_file():
            raise FileNotFoundError(source)
        if source.stat().st_size != int(row["file_bytes"] or 0):
            raise RuntimeError(
                f"El tamaño del recorte {source} ya no coincide con la cola."
            )
        target = (staging_dir / f"{int(row['queue_id']):09d}.jpg").resolve()
        target.relative_to(spool_root)
        shutil.copy2(source, target)
        source_hash = _sha256(source) if verify_hashes else ""
        target_hash = _sha256(target) if verify_hashes else ""
        if verify_hashes and source_hash != target_hash:
            raise RuntimeError(f"La copia de {source} no pasó la verificación SHA-256.")
        staged_rows.append(
            {
                **row,
                "staged_path": str(target),
                "sha256": source_hash,
            }
        )

    manifest = {
        "run_id": run_id,
        "status": "prepared",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database": str(db_path),
        "backup": str(backup_path),
        "staging_dir": str(staging_dir),
        "candidate_ttl_minutes": int(candidate_ttl_minutes),
        "targets": staged_rows,
        "name_error_queue_ids": [int(row["id"]) for row in name_errors],
        "protected_before": inspection["protected"],
    }
    _write_manifest(manifest_path, manifest)

    db = _connect(db_path)
    try:
        db.execute("begin immediate")
        db.execute(
            """
            create temp table repair_targets(
                queue_id integer primary key,
                subject_id text not null unique,
                face_crop_id integer not null unique,
                staged_path text not null
            )
            """
        )
        db.executemany(
            """
            insert into repair_targets(queue_id,subject_id,face_crop_id,staged_path)
            values (?,?,?,?)
            """,
            [
                (
                    int(row["queue_id"]),
                    row["subject_id"],
                    int(row["face_crop_id"]),
                    row["staged_path"],
                )
                for row in staged_rows
            ],
        )
        db.execute(
            "create temp table repair_name_errors(queue_id integer primary key)"
        )
        db.executemany(
            "insert into repair_name_errors(queue_id) values (?)",
            [(int(row["id"]),) for row in name_errors],
        )
        guarded = int(
            db.execute(
                """
                select count(*)
                from repair_targets t
                join crop_processing_queue q
                  on q.id=t.queue_id
                 and q.status='processed'
                 and q.result_kind='unknown'
                 and q.result_key=t.subject_id
                join unknown_subjects u
                  on u.subject_id=t.subject_id
                 and u.status='candidate'
                 and u.detection_count=1
                 and u.quality_hits=0
                 and coalesce(u.best_crop_path,'')=''
                 and u.merged_into is null
                 and u.linked_person_key is null
                 and coalesce(u.remote_subject_id,'')=''
                join face_crops f
                  on f.id=t.face_crop_id
                 and f.subject_kind='unknown'
                 and f.subject_key=t.subject_id
                where not exists (
                    select 1 from unknown_references r
                    where r.subject_id=t.subject_id
                )
                  and not exists (
                    select 1 from daily_presence d
                    where d.subject_kind='unknown'
                      and d.subject_key=t.subject_id
                )
                """
            ).fetchone()[0]
        )
        if guarded != len(staged_rows):
            raise RuntimeError(
                "La base cambió durante la preparación; se canceló la reparación."
            )
        logical_conflicts = int(
            db.execute(
                """
                with face_counts as (
                    select f.subject_key,count(*) as item_count
                    from face_crops f
                    join repair_targets t on t.subject_id=f.subject_key
                    where f.subject_kind='unknown'
                    group by f.subject_key
                ),
                queue_counts as (
                    select q.result_key,count(*) as item_count
                    from crop_processing_queue q
                    join repair_targets t on t.subject_id=q.result_key
                    where q.result_kind='unknown'
                    group by q.result_key
                ),
                incoming_merges as (
                    select child.merged_into as subject_id,count(*) as item_count
                    from unknown_subjects child
                    join repair_targets t on t.subject_id=child.merged_into
                    group by child.merged_into
                ),
                sync_mentions as (
                    select t.subject_id,count(*) as item_count
                    from repair_targets t
                    join sync_queue event on instr(event.payload_json,t.subject_id)>0
                    group by t.subject_id
                )
                select count(*)
                from repair_targets t
                left join face_counts on face_counts.subject_key=t.subject_id
                left join queue_counts on queue_counts.result_key=t.subject_id
                left join incoming_merges on incoming_merges.subject_id=t.subject_id
                left join sync_mentions on sync_mentions.subject_id=t.subject_id
                where coalesce(face_counts.item_count,0) <> 1
                   or coalesce(queue_counts.item_count,0) <> 1
                   or coalesce(incoming_merges.item_count,0) <> 0
                   or coalesce(sync_mentions.item_count,0) <> 0
                """
            ).fetchone()[0]
        )
        if logical_conflicts:
            raise RuntimeError(
                f"{logical_conflicts} candidatos tienen referencias adicionales; "
                "se canceló la reparación."
            )

        cursor = db.execute(
            """
            update crop_processing_queue
            set crop_path=(
                    select staged_path from repair_targets
                    where queue_id=crop_processing_queue.id
                ),
                status='pending',
                result_kind='',
                result_key='',
                result_name='',
                similarity=0,
                last_error='',
                processed_at='',
                updated_at=?
            where id in (select queue_id from repair_targets)
            """,
            (datetime.now(timezone.utc).isoformat(),),
        )
        if cursor.rowcount != len(staged_rows):
            raise RuntimeError("No se reencolaron todos los recortes recuperados.")
        cursor = db.execute(
            "delete from face_crops where id in (select face_crop_id from repair_targets)"
        )
        if cursor.rowcount != len(staged_rows):
            raise RuntimeError("No se retiró toda la evidencia fragmentada.")
        cursor = db.execute(
            "delete from unknown_subjects where subject_id in (select subject_id from repair_targets)"
        )
        if cursor.rowcount != len(staged_rows):
            raise RuntimeError("No se retiraron todos los candidatos fragmentados.")

        if name_errors:
            cursor = db.execute(
                """
                update crop_processing_queue
                set status='pending',result_kind='',result_key='',result_name='',
                    similarity=0,last_error='',processed_at='',updated_at=?
                where status='error' and instr(last_error,?)>0
                  and id in (select queue_id from repair_name_errors)
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
                    TEMPORARY_NAME_ERROR,
                ),
            )
            if cursor.rowcount != len(name_errors):
                raise RuntimeError("No se reencolaron todos los errores de nombre.")
        protected_after = _protected_counts(db)
        if protected_after != inspection["protected"]:
            raise RuntimeError("La reparación intentó modificar registros protegidos.")
        remaining_broken = int(
            db.execute(
                f"select count(*) from ({BROKEN_CANDIDATES_SQL})",
                (max(1, int(candidate_ttl_minutes)),),
            ).fetchone()[0]
        )
        remaining_name_errors = int(
            db.execute(
                """
                select count(*) from crop_processing_queue
                where status='error' and instr(last_error,?)>0
                """,
                (TEMPORARY_NAME_ERROR,),
            ).fetchone()[0]
        )
        if remaining_broken or remaining_name_errors:
            raise RuntimeError(
                "Quedaron filas reparables antes del commit: "
                f"candidatos={remaining_broken}, nombres={remaining_name_errors}"
            )
        integrity_in_transaction = db.execute("pragma integrity_check").fetchone()[0]
        foreign_keys_in_transaction = len(
            db.execute("pragma foreign_key_check").fetchall()
        )
        if integrity_in_transaction != "ok" or foreign_keys_in_transaction:
            raise RuntimeError(
                "La base no pasó la verificación previa al commit: "
                f"integrity={integrity_in_transaction}, "
                f"fk={foreign_keys_in_transaction}"
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    verification = inspect_repair(
        data_dir,
        candidate_ttl_minutes=candidate_ttl_minutes,
    )
    db = _connect(db_path)
    try:
        integrity = db.execute("pragma integrity_check").fetchone()[0]
        foreign_key_errors = len(db.execute("pragma foreign_key_check").fetchall())
    finally:
        db.close()
    if integrity != "ok" or foreign_key_errors:
        raise RuntimeError(
            f"Verificación final fallida: integrity={integrity}, fk={foreign_key_errors}"
        )
    if verification["broken_candidates"] or verification["name_errors"]:
        raise RuntimeError("Quedaron filas reparables después de aplicar la reparación.")
    if verification["protected"] != inspection["protected"]:
        raise RuntimeError("La reparación modificó registros protegidos.")

    manifest["status"] = "applied"
    manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    manifest["protected_after"] = verification["protected"]
    manifest["integrity_check"] = integrity
    manifest["foreign_key_errors"] = foreign_key_errors
    _write_manifest(manifest_path, manifest)
    return {
        **summary,
        "run_id": run_id,
        "backup_path": str(backup_path),
        "manifest_path": str(manifest_path),
        "staging_dir": str(staging_dir),
        "integrity_check": integrity,
        "foreign_key_errors": foreign_key_errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reencola candidatos históricos fragmentados sin borrar evidencia.",
    )
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--candidate-ttl-minutes", type=int, default=30)
    parser.add_argument("--skip-hashes", action="store_true")
    arguments = parser.parse_args()
    result = repair_historical_candidates(
        arguments.data_dir,
        apply=arguments.apply,
        candidate_ttl_minutes=arguments.candidate_ttl_minutes,
        verify_hashes=not arguments.skip_hashes,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
