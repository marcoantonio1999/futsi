from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

import face_station.app.store as store_module
from face_station.app.store import LocalStore, embedding_blob


def normalized(seed: int) -> np.ndarray:
    values = np.random.default_rng(seed).normal(size=512).astype(np.float32)
    return values / np.linalg.norm(values)


def coherent_variant(anchor: np.ndarray, seed: int, similarity: float) -> np.ndarray:
    noise = normalized(seed)
    noise = noise - float(noise @ anchor) * anchor
    noise /= np.linalg.norm(noise)
    result = similarity * anchor + np.sqrt(1.0 - similarity**2) * noise
    return (result / np.linalg.norm(result)).astype(np.float32)


def add_person(store: LocalStore, person_key: str = "student:1") -> np.ndarray:
    embedding = normalized(1)
    now = datetime(2026, 7, 1, 12, tzinfo=timezone.utc).isoformat()
    with store.connection() as db:
        db.execute(
            """
            insert into people
                (person_key,person_type,remote_id,name,reference_available,
                 embedding,active,updated_at)
            values (?,'student',1,'Persona Uno',1,?,1,?)
            """,
            (person_key, embedding_blob(embedding), now),
        )
    return embedding


def add_crops(
    store: LocalStore,
    *,
    person_key: str,
    start: datetime,
    count: int,
) -> list[Path]:
    paths = []
    anchor = normalized(10)
    for index in range(count):
        path = store.faces_dir / "known" / f"{start.date()}-{index}.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"crop-{index}".encode())
        store.record_crop(
            person_key,
            "known",
            start + timedelta(minutes=index * 11),
            str(path),
            0.82,
            0.30 + (index % 20) / 30,
            "Raspberry" if index % 2 else "Dahua",
            embedding=coherent_variant(anchor, 100 + index, 0.82),
            quality_pass=True,
            quality_payload={"accepted": True, "index": index},
        )
        paths.append(path.resolve())
    return paths


def test_daily_curation_keeps_thirty_and_preserves_detection_total(tmp_path):
    store = LocalStore(tmp_path)
    add_person(store)
    day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    add_crops(store, person_key="student:1", start=day, count=45)

    report = store.curate_daily_evidence("2026-07-10", limit=30)
    detail = store.detection_detail("known", "student:1", "2026-07-10")
    recent = store.recent_detections("2026-07-10")

    assert report["candidates"] == 45
    assert report["selected"] == 30
    assert report["redundant"] == 15
    assert detail["total_crops"] == 30
    assert detail["summary"]["crops"] == 30
    assert detail["summary"]["detections"] == 45
    assert recent[0]["detection_count"] == 45


def test_reference_path_is_protected_even_when_its_quality_is_low(tmp_path):
    store = LocalStore(tmp_path)
    add_person(store)
    day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    paths = add_crops(store, person_key="student:1", start=day, count=45)
    protected = paths[0]
    store.save_known_observation_reference(
        "student:1",
        str(protected),
        normalized(300),
        0.01,
        day,
        {"accepted": True, "protected_test": True},
    )

    report = store.curate_daily_evidence("2026-07-10", limit=30)
    with store.connection() as db:
        row = db.execute(
            """
            select evidence_selected,evidence_reason
            from face_crops where crop_path=?
            """,
            (str(protected),),
        ).fetchone()

    assert report["protected"] >= 1
    assert row["evidence_selected"] == 1
    assert row["evidence_reason"] == "protected_reference"


def test_daily_curation_never_reintroduces_rejected_profile_as_diversity(tmp_path):
    store = LocalStore(tmp_path)
    add_person(store)
    day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    valid_path = store.faces_dir / "known" / "valid-frontal.jpg"
    profile_path = store.faces_dir / "known" / "rejected-profile.jpg"
    valid_path.parent.mkdir(parents=True, exist_ok=True)
    valid_path.write_bytes(b"valid")
    profile_path.write_bytes(b"profile")
    store.record_crop(
        "student:1",
        "known",
        day,
        str(valid_path),
        0.82,
        0.78,
        "Raspberry",
        embedding=normalized(701),
        quality_pass=True,
        quality_payload={"accepted": True, "yaw": 2.0, "reasons": []},
    )
    store.record_crop(
        "student:1",
        "known",
        day + timedelta(minutes=5),
        str(profile_path),
        0.72,
        0.34,
        "Raspberry",
        embedding=normalized(702),
        quality_pass=False,
        quality_payload={
            "accepted": False,
            "yaw": 48.0,
            "reasons": ["rostro_de_lado"],
        },
    )
    store.save_known_observation_reference(
        "student:1",
        str(profile_path),
        normalized(702),
        0.34,
        day + timedelta(minutes=5),
        {"accepted": False, "yaw": 48.0},
    )

    report = store.curate_daily_evidence("2026-07-10", limit=30)

    with store.connection() as db:
        profile = db.execute(
            """
            select quality_pass,evidence_selected,evidence_reason
            from face_crops where crop_path=?
            """,
            (str(profile_path.resolve()),),
        ).fetchone()
        valid = db.execute(
            """
            select evidence_selected,evidence_reason
            from face_crops where crop_path=?
            """,
            (str(valid_path.resolve()),),
        ).fetchone()
    assert report["quality_rejected"] == 1
    assert profile["quality_pass"] == 0
    assert profile["evidence_selected"] == 0
    assert profile["evidence_reason"] == "quality_rejected"
    assert valid["evidence_selected"] == 1


def test_strict_historical_policy_quarantines_profile_only_unknown_without_deleting_file(
    tmp_path,
):
    store = LocalStore(tmp_path)
    day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    crop_path = store.faces_dir / "unknown" / "borderline-profile.jpg"
    crop_path.parent.mkdir(parents=True, exist_ok=True)
    crop_path.write_bytes(b"profile")
    embedding = normalized(710)
    subject = store.create_unknown(
        embedding,
        day,
        str(crop_path),
        0.62,
        subject_id="profile-only",
        temporary_name="Desconocido Perfil",
        quality_pass=True,
        quality_payload={
            "accepted": True,
            "yaw": 19.2,
            "reasons": [],
            "complete_face": True,
        },
    )
    store.record_crop(
        subject["subject_id"],
        "unknown",
        day,
        str(crop_path),
        0.71,
        0.62,
        "Raspberry",
        embedding=embedding,
        quality_pass=True,
        quality_payload={
            "accepted": True,
            "yaw": 19.2,
            "reasons": [],
            "complete_face": True,
        },
    )

    report = store.enforce_strict_face_evidence_policy(
        max_yaw=15.0,
        recurate=False,
    )

    with store.connection() as db:
        crop = db.execute(
            "select * from face_crops where subject_key='profile-only'"
        ).fetchone()
        reference_count = db.execute(
            "select count(*) from unknown_references where subject_id='profile-only'"
        ).fetchone()[0]
        presence_count = db.execute(
            "select count(*) from daily_presence where subject_key='profile-only'"
        ).fetchone()[0]
    assert report["tightened_pose"] == 1
    assert report["unknown_references_removed"] == 1
    assert report["identities_quarantined"] == 1
    assert crop["quality_pass"] == 0
    assert crop["evidence_selected"] == 0
    assert crop["evidence_reason"] == "quality_rejected"
    assert reference_count == 0
    assert presence_count == 0
    assert store.get_unknown("profile-only")["status"] == "quarantined"
    assert crop_path.is_file()


def test_recurating_new_day_does_not_change_previous_day(tmp_path):
    store = LocalStore(tmp_path)
    add_person(store)
    first = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    second = datetime(2026, 7, 11, 9, tzinfo=timezone.utc)
    add_crops(store, person_key="student:1", start=first, count=40)
    store.curate_daily_evidence("2026-07-10", limit=30)
    with store.connection() as db:
        first_ids = {
            int(row["id"])
            for row in db.execute(
                """
                select id from face_crops
                where substr(seen_at,1,10)='2026-07-10'
                  and evidence_selected=1
                """
            )
        }

    add_crops(store, person_key="student:1", start=second, count=41)
    store.curate_daily_evidence("2026-07-11", limit=30)
    with store.connection() as db:
        first_ids_after = {
            int(row["id"])
            for row in db.execute(
                """
                select id from face_crops
                where substr(seen_at,1,10)='2026-07-10'
                  and evidence_selected=1
                """
            )
        }

    assert first_ids_after == first_ids
    assert len(first_ids_after) == 30


def test_pruning_quarantines_only_old_redundant_evidence(tmp_path):
    store = LocalStore(tmp_path)
    add_person(store)
    old_day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    boundary_day = datetime(2026, 7, 13, 9, tzinfo=timezone.utc)
    old_paths = add_crops(
        store,
        person_key="student:1",
        start=old_day,
        count=45,
    )
    boundary_paths = add_crops(
        store,
        person_key="student:1",
        start=boundary_day,
        count=35,
    )
    store.curate_daily_evidence("2026-07-10", limit=30)
    store.curate_daily_evidence("2026-07-13", limit=30)
    run_at = datetime(2026, 7, 20, 1, tzinfo=timezone.utc)

    preview = store.prune_redundant_evidence(
        safety_days=7,
        run_at=run_at,
        dry_run=True,
    )
    assert preview["crops"] == 15
    assert all(path.is_file() for path in old_paths + boundary_paths)

    result = store.prune_redundant_evidence(
        safety_days=7,
        run_at=run_at,
    )
    detail = store.detection_detail("known", "student:1", "2026-07-10")
    with store.connection() as db:
        remaining_old = db.execute(
            """
            select count(*) from face_crops
            where substr(seen_at,1,10)='2026-07-10'
            """
        ).fetchone()[0]
        remaining_boundary = db.execute(
            """
            select count(*) from face_crops
            where substr(seen_at,1,10)='2026-07-13'
            """
        ).fetchone()[0]

    assert result["status"] == "committed"
    assert result["crops"] == 15
    assert remaining_old == 30
    assert remaining_boundary == 35
    assert detail["summary"]["detections"] == 45
    assert detail["summary"]["crops"] == 30
    assert all(path.is_file() for path in boundary_paths)
    assert Path(result["backup_path"]).is_file()
    assert Path(result["manifest_path"]).is_file()
    assert len(list(Path(result["quarantine_path"]).rglob("*.jpg"))) == 15


def test_move_failure_restores_files_and_database_rows(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    add_person(store)
    old_day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    paths = add_crops(store, person_key="student:1", start=old_day, count=34)
    store.curate_daily_evidence("2026-07-10", limit=30)
    original_move = LocalStore._move_with_retry
    calls = 0

    def fail_second_move(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise PermissionError("fallo inyectado")
        original_move(source, destination)

    monkeypatch.setattr(
        LocalStore,
        "_move_with_retry",
        staticmethod(fail_second_move),
    )

    with pytest.raises(PermissionError, match="fallo inyectado"):
        store.prune_redundant_evidence(
            safety_days=7,
            run_at=datetime(2026, 7, 20, 1, tzinfo=timezone.utc),
        )

    with store.connection() as db:
        crop_count = db.execute("select count(*) from face_crops").fetchone()[0]
        run = db.execute(
            """
            select status from evidence_retention_runs
            order by created_at desc limit 1
            """
        ).fetchone()
    assert crop_count == 34
    assert run["status"] == "rolled_back"
    assert all(path.is_file() for path in paths)


def test_chunked_retention_delete_exceeds_sqlite_variable_limit():
    db = sqlite3.connect(":memory:")
    db.execute("create table face_crops (id integer primary key)")
    crop_ids = list(range(1, 33_018))
    db.executemany(
        "insert into face_crops(id) values (?)",
        ((crop_id,) for crop_id in crop_ids),
    )
    db.commit()
    db.execute("begin immediate")
    try:
        deleted = LocalStore._delete_face_crops_by_ids(db, crop_ids)
        db.commit()
    except Exception:
        db.rollback()
        raise

    assert deleted == len(crop_ids)
    assert db.execute("select count(*) from face_crops").fetchone()[0] == 0
    db.close()


def test_chunked_delete_failure_rolls_back_database_and_restores_files(
    tmp_path,
    monkeypatch,
):
    store = LocalStore(tmp_path)
    add_person(store)
    old_day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    paths = add_crops(store, person_key="student:1", start=old_day, count=34)
    store.curate_daily_evidence("2026-07-10", limit=30)
    with store.connection() as db:
        candidates = store._retention_candidates(
            db,
            cutoff_date="2026-07-13",
        )
        assert len(candidates) == 4
        fail_id = int(candidates[2]["id"])
        db.execute(
            f"""
            create trigger fail_retention_delete
            before delete on face_crops
            when old.id={fail_id}
            begin
                select raise(abort,'fallo de delete inyectado');
            end
            """
        )
    monkeypatch.setattr(store_module, "RETENTION_DELETE_BATCH_SIZE", 2)

    with pytest.raises(sqlite3.IntegrityError, match="fallo de delete inyectado"):
        store.prune_redundant_evidence(
            safety_days=7,
            run_at=datetime(2026, 7, 20, 1, tzinfo=timezone.utc),
        )

    with store.connection() as db:
        crop_count = db.execute("select count(*) from face_crops").fetchone()[0]
        run = db.execute(
            """
            select run_id,status from evidence_retention_runs
            order by created_at desc limit 1
            """
        ).fetchone()
        states = {
            str(row["state"]): int(row["items"])
            for row in db.execute(
                """
                select state,count(*) as items
                from evidence_retention_items where run_id=? group by state
                """,
                (run["run_id"],),
            )
        }
    assert crop_count == 34
    assert run["status"] == "rolled_back"
    assert states == {"restored": 4}
    assert all(path.is_file() for path in paths)


def test_known_gallery_is_capped_and_authoritative_embedding_stays_stable(tmp_path):
    store = LocalStore(tmp_path)
    original = add_person(store)
    portrait = store.references_dir / "student-1.jpg"
    portrait.write_bytes(b"portrait")
    store.save_person_embedding("student:1", portrait, original)
    day = datetime(2026, 7, 10, 9, tzinfo=timezone.utc)
    for index in range(20):
        store.save_known_observation_reference(
            "student:1",
            str(store.faces_dir / "known" / f"reference-{index}.jpg"),
            coherent_variant(original, 500 + index, 0.84),
            0.70 + index / 100,
            day + timedelta(hours=index),
            {"accepted": True, "index": index},
        )

    rows, matrix = store.known_reference_database("student:1")
    with store.connection() as db:
        authoritative = db.execute(
            "select embedding from people where person_key='student:1'"
        ).fetchone()[0]

    assert len(rows) == 12
    assert matrix.shape == (12, 512)
    assert any(row["pinned"] and row["crop_path"] == str(portrait) for row in rows)
    assert np.allclose(np.frombuffer(authoritative, dtype=np.float32), original)
