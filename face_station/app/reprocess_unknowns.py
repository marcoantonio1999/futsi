from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

import cv2
import numpy as np

from .config import ConfigManager
from .face_quality import FaceQualityEvaluator, FaceQualityResult, FaceQualityThresholds
from .recognition import FaceEngine
from .store import LocalStore, embedding_blob, utc_now
from .time_utils import BUSINESS_TIME_ZONE, business_time
from .unknown_gallery import (
    UNKNOWN_COHERENCE_THRESHOLD,
    UNKNOWN_DUPLICATE_THRESHOLD,
    UNKNOWN_REFERENCE_LIMIT,
    robust_reference_centroid,
    select_retained_reference_indices,
)


ANALYSIS_VERSION = "mediapipe-face-landmarker-v2"


@dataclass
class CropAnalysis:
    crop_id: int
    old_subject_key: str
    path: Path
    seen_at: datetime
    camera: str
    quality: FaceQualityResult
    embedding: np.ndarray | None
    known_person: dict | None = None
    known_similarity: float = 0.0
    assignment_kind: str = "candidate"
    assignment_key: str = ""


@dataclass
class UnknownCluster:
    samples: list[CropAnalysis] = field(default_factory=list)
    centroid: np.ndarray | None = None
    raw_count: int = 0
    temporal_evidence: int = 0
    consensus_median: float = 0.0
    consensus_min: float = 0.0

    def add(self, sample: CropAnalysis) -> None:
        self.samples.append(sample)
        embeddings = [item.embedding for item in self.samples if item.embedding is not None]
        centroid = np.mean(np.vstack(embeddings), axis=0)
        self.centroid = centroid / max(float(np.linalg.norm(centroid)), 1e-12)

    @property
    def accepted(self) -> list[CropAnalysis]:
        return [item for item in self.samples if item.quality.accepted]


def curated_reference_samples(samples: list[CropAnalysis]) -> list[CropAnalysis]:
    usable = [sample for sample in samples if sample.embedding is not None]
    if not usable:
        return []
    retained = select_retained_reference_indices(
        [sample.embedding for sample in usable],
        [float(sample.quality.score) for sample in usable],
        limit=UNKNOWN_REFERENCE_LIMIT,
        duplicate_threshold=UNKNOWN_DUPLICATE_THRESHOLD,
        coherence_threshold=UNKNOWN_COHERENCE_THRESHOLD,
    )
    return [usable[index] for index in retained]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_seen_at(value: str, path: Path) -> datetime:
    try:
        return business_time(datetime.fromisoformat(value))
    except (TypeError, ValueError):
        try:
            stamp = int(path.stem.rsplit("_", 1)[1]) / 1000
            return business_time(
                datetime.fromtimestamp(stamp, timezone.utc)
            )
        except (IndexError, ValueError):
            return datetime.now(BUSINESS_TIME_ZONE)


def nearest_cluster(sample: CropAnalysis, clusters: list[UnknownCluster], threshold: float) -> tuple[UnknownCluster | None, float, float]:
    if sample.embedding is None or not clusters:
        return None, 0.0, 0.0
    scores = np.asarray([float(cluster.centroid @ sample.embedding) for cluster in clusters], dtype=np.float32)
    best_index = int(np.argmax(scores))
    best = float(scores[best_index])
    second = float(np.partition(scores, -2)[-2]) if len(scores) > 1 else -1.0
    if best < threshold:
        return None, best, best - second
    return clusters[best_index], best, best - second


def build_unknown_clusters(samples: list[CropAnalysis]) -> list[UnknownCluster]:
    seeds = sorted(
        [item for item in samples if item.embedding is not None and item.quality.accepted and item.assignment_kind == "candidate"],
        key=lambda item: item.quality.score,
        reverse=True,
    )
    clusters: list[UnknownCluster] = []
    for sample in seeds:
        cluster, score, margin = nearest_cluster(sample, clusters, threshold=0.58)
        if cluster is None or (len(clusters) > 1 and margin < 0.04):
            cluster = UnknownCluster()
            clusters.append(cluster)
        cluster.add(sample)

    seed_ids = {item.crop_id for cluster in clusters for item in cluster.samples}
    remaining = [
        item
        for item in samples
        if item.crop_id not in seed_ids and item.embedding is not None and item.assignment_kind == "candidate"
    ]
    for sample in remaining:
        cluster, _score, margin = nearest_cluster(sample, clusters, threshold=0.50)
        if cluster is not None and (len(clusters) == 1 or margin >= 0.03):
            cluster.add(sample)
    return clusters


def qualify_known_matches(samples: list[CropAnalysis], known_threshold: float) -> set[str]:
    by_person: dict[str, list[CropAnalysis]] = defaultdict(list)
    for sample in samples:
        if sample.known_person:
            by_person[sample.known_person["person_key"]].append(sample)
    qualified = set()
    for person_key, matches in by_person.items():
        if len(matches) >= 2 or any(
            item.quality.accepted and item.known_similarity >= known_threshold + 0.10
            for item in matches
        ):
            qualified.add(person_key)
    return qualified


def create_backup(db_path: Path, backup_path: Path) -> None:
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(db_path)
    target = sqlite3.connect(backup_path)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()


def preflight(store: LocalStore, target_date: str) -> list[str]:
    with store.connection() as db:
        target_ids = {
            row[0]
            for row in db.execute(
                """
                select subject_key from daily_presence
                where presence_date=? and subject_kind='unknown'
                """,
                (target_date,),
            )
        }
        if not target_ids:
            raise RuntimeError(f"No hay desconocidos para reprocesar el {target_date}.")
        placeholders = ",".join("?" for _ in target_ids)
        cross_date = list(
            db.execute(
                f"""
                select distinct subject_key,presence_date from daily_presence
                where subject_kind='unknown' and subject_key in ({placeholders}) and presence_date<>?
                """,
                (*target_ids, target_date),
            )
        )
        if cross_date:
            raise RuntimeError("Hay identidades objetivo usadas en otras fechas; se cancelo para no alterar historial.")
        linked = list(
            db.execute(
                f"""
                select subject_id from unknown_subjects
                where subject_id in ({placeholders})
                  and (linked_person_key is not null or remote_subject_id is not null)
                """,
                tuple(target_ids),
            )
        )
        if linked:
            raise RuntimeError("Hay desconocidos vinculados o sincronizados; se cancelo el reproceso.")
        queue_payloads = [row[0] for row in db.execute("select payload_json from sync_queue")]
        if any(subject_id in payload for subject_id in target_ids for payload in queue_payloads):
            raise RuntimeError("Hay eventos de sincronizacion que hacen referencia a los desconocidos objetivo.")
    return sorted(target_ids)


def load_crop_rows(store: LocalStore, target_date: str) -> list[dict]:
    store.backfill_face_crops()
    with store.connection() as db:
        rows = [
            dict(row)
            for row in db.execute(
                """
                select id,subject_key,subject_kind,seen_at,crop_path,camera
                from face_crops
                where seen_at like ? and subject_kind='unknown'
                order by seen_at,id
                """,
                (f"{target_date}%",),
            )
        ]
    return [row for row in rows if Path(row["crop_path"]).is_file()]


def analyze_crops(
    rows: list[dict],
    quality_evaluator: FaceQualityEvaluator,
    engine: FaceEngine,
) -> tuple[list[CropAnalysis], Counter]:
    analyses: list[CropAnalysis] = []
    failures: Counter = Counter()
    for index, row in enumerate(rows, 1):
        path = Path(row["crop_path"]).resolve()
        image = cv2.imread(str(path))
        if image is None:
            failures["imagen_ilegible"] += 1
            continue
        quality = quality_evaluator.analyze(image)
        failures.update(quality.reasons)
        try:
            embedding = engine.embedding_from_reference(path)
        except (RuntimeError, ValueError):
            embedding = None
            failures["embedding_no_disponible"] += 1
        analyses.append(
            CropAnalysis(
                crop_id=int(row["id"]),
                old_subject_key=str(row["subject_key"]),
                path=path,
                seen_at=parse_seen_at(row["seen_at"], path),
                camera=str(row.get("camera") or "Camara local"),
                quality=quality,
                embedding=embedding,
                assignment_key=str(row["subject_key"]),
            )
        )
        if index % 100 == 0:
            accepted = sum(1 for item in analyses if item.quality.accepted)
            print(f"Analizados {index}/{len(rows)}; referencias de calidad: {accepted}", flush=True)
    return analyses, failures


def match_known(samples: list[CropAnalysis], engine: FaceEngine, known_threshold: float) -> int:
    for sample in samples:
        if sample.embedding is None:
            continue
        result = engine.match_known(sample.embedding)
        if result.matched:
            sample.known_person = result.person
            sample.known_similarity = result.similarity
    qualified = qualify_known_matches(samples, known_threshold)
    matched = 0
    for sample in samples:
        if sample.known_person and sample.known_person["person_key"] in qualified:
            sample.assignment_kind = "known"
            sample.assignment_key = sample.known_person["person_key"]
            matched += 1
    return matched


def promote_clusters(clusters: list[UnknownCluster], target_date: str) -> list[UnknownCluster]:
    promoted = []
    for cluster in clusters:
        cluster.raw_count = len(cluster.samples)
        usable = [item for item in cluster.samples if item.embedding is not None]
        accepted = [item for item in usable if item.quality.accepted]
        if not accepted:
            continue

        # One reference-quality frontal crop is sufficient. It becomes the
        # anchor; rejected side/downward views may be attached only when their
        # embeddings are still coherent, and never influence the centroid.
        best = max(accepted, key=lambda item: item.quality.score)
        similarities = np.asarray(
            [float(item.embedding @ best.embedding) for item in usable],
            dtype=np.float32,
        )
        coherent = [item for item, score in zip(usable, similarities) if float(score) >= 0.50]
        coherent_scores = np.asarray(
            [float(item.embedding @ best.embedding) for item in coherent],
            dtype=np.float32,
        )
        accepted = [item for item in coherent if item.quality.accepted]
        if not accepted:
            continue

        evidence_times: list[datetime] = []
        for sample in sorted(coherent, key=lambda item: item.seen_at):
            if not evidence_times or (sample.seen_at - evidence_times[-1]).total_seconds() >= 1.0:
                evidence_times.append(sample.seen_at)
        cluster.temporal_evidence = len(evidence_times)
        cluster.consensus_median = float(np.median(coherent_scores))
        cluster.consensus_min = float(np.min(coherent_scores))

        reference_samples = curated_reference_samples(accepted)
        centroid = robust_reference_centroid(
            [item.embedding for item in reference_samples],
            [float(item.quality.score) for item in reference_samples],
            coherence_threshold=UNKNOWN_COHERENCE_THRESHOLD,
        )
        cluster.samples = coherent
        stable_key = str(uuid5(NAMESPACE_URL, f"futsi:{ANALYSIS_VERSION}:{target_date}:{best.path.name}"))
        for sample in cluster.samples:
            sample.assignment_kind = "unknown"
            sample.assignment_key = stable_key
        cluster.centroid = centroid
        promoted.append(cluster)
    return promoted


def report_payload(
    *,
    target_date: str,
    rows: list[dict],
    samples: list[CropAnalysis],
    promoted: list[UnknownCluster],
    failures: Counter,
    elapsed: float,
) -> dict:
    assignments = Counter(item.assignment_kind for item in samples)
    with_embeddings = sum(1 for item in samples if item.embedding is not None)
    accepted = sum(1 for item in samples if item.quality.accepted)
    return {
        "date": target_date,
        "analysis_version": ANALYSIS_VERSION,
        "physical_crops": len(rows),
        "analyzed_crops": len(samples),
        "embeddings": with_embeddings,
        "quality_pass": accepted,
        "known_crops": assignments.get("known", 0),
        "consolidated_unknown_crops": assignments.get("unknown", 0),
        "candidate_crops": assignments.get("candidate", 0),
        "consolidated_unknowns": len(promoted),
        "consolidated_clusters": [
            {
                "samples": len(cluster.samples),
                "raw_samples": cluster.raw_count,
                "quality_samples": len(cluster.accepted),
                "temporal_evidence": cluster.temporal_evidence,
                "consensus_median": round(cluster.consensus_median, 4),
                "consensus_min": round(cluster.consensus_min, 4),
            }
            for cluster in promoted
        ],
        "rejection_reasons": dict(failures),
        "elapsed_seconds": round(elapsed, 2),
    }


def apply_results(
    store: LocalStore,
    target_date: str,
    target_ids: list[str],
    samples: list[CropAnalysis],
    promoted: list[UnknownCluster],
    report: dict,
) -> tuple[str, Path]:
    run_id = str(uuid4())
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = store.data_dir / "backups" / f"station-before-quality-reprocess-{target_date}-{stamp}.sqlite3"
    create_backup(store.db_path, backup_path)
    now = utc_now()
    promoted_by_key = {cluster.samples[0].assignment_key: cluster for cluster in promoted}
    by_known: dict[str, list[CropAnalysis]] = defaultdict(list)
    by_unknown: dict[str, list[CropAnalysis]] = defaultdict(list)
    by_candidate: dict[str, list[CropAnalysis]] = defaultdict(list)
    replacements_by_old: dict[str, Counter] = defaultdict(Counter)
    for sample in samples:
        if sample.assignment_kind == "known":
            by_known[sample.assignment_key].append(sample)
            replacements_by_old[sample.old_subject_key][sample.assignment_key] += 1
        elif sample.assignment_kind == "unknown":
            by_unknown[sample.assignment_key].append(sample)
            replacements_by_old[sample.old_subject_key][sample.assignment_key] += 1
        else:
            by_candidate[sample.assignment_key].append(sample)

    with store.connection() as db:
        db.execute("begin immediate")
        db.execute(
            """
            insert into reprocess_runs
                (run_id,target_date,analysis_version,status,backup_path,report_json,created_at,completed_at)
            values (?,?,?,?,?,?,?,?)
            """,
            (run_id, target_date, ANALYSIS_VERSION, "completed", str(backup_path), json.dumps(report), now, now),
        )
        placeholders = ",".join("?" for _ in target_ids)
        db.execute(
            "delete from daily_presence where presence_date=? and subject_kind='unknown'",
            (target_date,),
        )
        db.execute(
            f"delete from unknown_references where subject_id in ({placeholders})",
            tuple(target_ids),
        )
        db.execute(
            f"""
            update unknown_subjects
            set status='candidate',quality_hits=0,quality_version=?,quality_json='{{}}',merged_into=null,updated_at=?
            where subject_id in ({placeholders})
            """,
            (ANALYSIS_VERSION, now, *target_ids),
        )

        for sample in samples:
            payload = sample.quality.as_dict()
            db.execute(
                """
                update face_crops set subject_kind=?,subject_key=?,embedding=?,analysis_version=?,
                    quality_pass=?,quality=?,quality_json=? where id=?
                """,
                (
                    sample.assignment_kind if sample.assignment_kind != "candidate" else "unknown",
                    sample.assignment_key,
                    embedding_blob(sample.embedding) if sample.embedding is not None else None,
                    ANALYSIS_VERSION,
                    int(sample.quality.accepted),
                    sample.quality.score,
                    json.dumps(payload, ensure_ascii=True),
                    sample.crop_id,
                ),
            )

        for subject_id, cluster_samples in by_unknown.items():
            cluster = promoted_by_key[subject_id]
            best = max(cluster.accepted, key=lambda item: item.quality.score)
            first_seen = min(item.seen_at for item in cluster_samples)
            last_seen = max(item.seen_at for item in cluster_samples)
            temporary_name = f"Desconocido Q{subject_id.replace('-', '')[:6].upper()}"
            db.execute(
                """
                insert into unknown_subjects
                    (subject_id,temporary_name,status,centroid,best_crop_path,best_quality,
                     first_seen_at,last_seen_at,detection_count,quality_hits,quality_version,
                     quality_json,updated_at)
                values (?,?, 'consolidated',?,?,?,?,?,?,?,?,?,?)
                on conflict(subject_id) do update set
                    status='consolidated',centroid=excluded.centroid,best_crop_path=excluded.best_crop_path,
                    best_quality=excluded.best_quality,first_seen_at=excluded.first_seen_at,
                    last_seen_at=excluded.last_seen_at,detection_count=excluded.detection_count,
                    quality_hits=excluded.quality_hits,quality_version=excluded.quality_version,
                    quality_json=excluded.quality_json,updated_at=excluded.updated_at
                """,
                (
                    subject_id,
                    temporary_name,
                    embedding_blob(cluster.centroid),
                    str(best.path),
                    best.quality.score,
                    first_seen.isoformat(),
                    last_seen.isoformat(),
                    len(cluster_samples),
                    len(cluster.accepted),
                    ANALYSIS_VERSION,
                    json.dumps(best.quality.as_dict(), ensure_ascii=True),
                    now,
                ),
            )
            references = curated_reference_samples(cluster.accepted)
            for reference in references:
                LocalStore._save_unknown_reference(
                    db,
                    subject_id,
                    str(reference.path),
                    reference.embedding,
                    reference.quality.score,
                    reference.seen_at,
                    reference.quality.as_dict(),
                )
            db.execute(
                """
                insert into daily_presence
                    (subject_key,presence_date,subject_kind,first_seen_at,last_seen_at,
                     detection_count,best_similarity,best_crop_path,session_id,synced)
                values (?,?, 'unknown',?,?,?,?,?,-1,0)
                on conflict(subject_key,presence_date,session_id) do update set
                    subject_kind='unknown',first_seen_at=excluded.first_seen_at,
                    last_seen_at=excluded.last_seen_at,detection_count=excluded.detection_count,
                    best_similarity=excluded.best_similarity,best_crop_path=excluded.best_crop_path,synced=0
                """,
                (
                    subject_id,
                    target_date,
                    first_seen.isoformat(),
                    last_seen.isoformat(),
                    len(cluster_samples),
                    best.quality.score,
                    str(best.path),
                ),
            )

        for subject_id, candidate_samples in by_candidate.items():
            embeddings = [item.embedding for item in candidate_samples if item.embedding is not None]
            accepted = [item for item in candidate_samples if item.quality.accepted and item.embedding is not None]
            first_seen = min(item.seen_at for item in candidate_samples)
            last_seen = max(item.seen_at for item in candidate_samples)
            if embeddings:
                centroid = np.mean(np.vstack(embeddings), axis=0)
                centroid /= max(float(np.linalg.norm(centroid)), 1e-12)
            else:
                centroid = None
            best = max(accepted, key=lambda item: item.quality.score) if accepted else None
            db.execute(
                """
                update unknown_subjects set status='candidate',centroid=coalesce(?,centroid),
                    best_crop_path=?,best_quality=?,first_seen_at=?,last_seen_at=?,detection_count=?,
                    quality_hits=?,quality_version=?,quality_json=?,merged_into=null,updated_at=?
                where subject_id=?
                """,
                (
                    embedding_blob(centroid) if centroid is not None else None,
                    str(best.path) if best else "",
                    best.quality.score if best else 0.0,
                    first_seen.isoformat(),
                    last_seen.isoformat(),
                    len(candidate_samples),
                    len(accepted),
                    ANALYSIS_VERSION,
                    json.dumps(best.quality.as_dict(), ensure_ascii=True) if best else "{}",
                    now,
                    subject_id,
                ),
            )
            if best:
                for reference in curated_reference_samples(accepted):
                    LocalStore._save_unknown_reference(
                        db,
                        subject_id,
                        str(reference.path),
                        reference.embedding,
                        reference.quality.score,
                        reference.seen_at,
                        reference.quality.as_dict(),
                    )
        for person_key, known_samples in by_known.items():
            first_seen = min(item.seen_at for item in known_samples)
            last_seen = max(item.seen_at for item in known_samples)
            best = max(known_samples, key=lambda item: item.known_similarity)
            db.execute(
                """
                insert into daily_presence
                    (subject_key,presence_date,subject_kind,first_seen_at,last_seen_at,
                     detection_count,best_similarity,best_crop_path,session_id,synced)
                values (?,?, 'known',?,?,?,?,?,-1,0)
                on conflict(subject_key,presence_date,session_id) do update set
                    subject_kind='known',first_seen_at=min(first_seen_at,excluded.first_seen_at),
                    last_seen_at=max(last_seen_at,excluded.last_seen_at),
                    detection_count=max(detection_count,excluded.detection_count),
                    best_similarity=max(best_similarity,excluded.best_similarity),
                    best_crop_path=case when excluded.best_similarity>=best_similarity then excluded.best_crop_path else best_crop_path end
                """,
                (
                    person_key,
                    target_date,
                    first_seen.isoformat(),
                    last_seen.isoformat(),
                    len(known_samples),
                    best.known_similarity,
                    str(best.path),
                ),
            )

        for subject_id in target_ids:
            remaining = db.execute(
                "select count(*) from face_crops where subject_kind='unknown' and subject_key=?",
                (subject_id,),
            ).fetchone()[0]
            if not remaining:
                replacement = replacements_by_old.get(subject_id, Counter()).most_common(1)
                db.execute(
                    "update unknown_subjects set status='archived',merged_into=?,updated_at=? where subject_id=?",
                    (replacement[0][0] if replacement else None, now, subject_id),
                )
        integrity = db.execute("pragma integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite reporto integridad invalida: {integrity}")
    return run_id, backup_path


def run(args: argparse.Namespace) -> dict:
    started = time.perf_counter()
    data_dir = Path(args.data_dir).resolve()
    store = LocalStore(data_dir)
    target_ids = preflight(store, args.date)
    rows = load_crop_rows(store, args.date)
    if not rows:
        raise RuntimeError("No se encontraron recortes fisicos indexados para la fecha.")
    config_manager = ConfigManager(data_dir)
    config = config_manager.config
    engine = FaceEngine(config)
    print("Cargando InsightFace y la base local...", flush=True)
    engine.load()
    people, known_matrix = store.known_database()
    engine.set_known_database(people, known_matrix)
    thresholds = FaceQualityThresholds(
        max_yaw=config.quality_max_yaw,
        max_pitch=config.quality_max_pitch,
        max_roll=config.quality_max_roll,
        min_face_width=config.quality_min_face_width,
        min_face_height=config.quality_min_face_height,
        min_interocular=config.quality_min_interocular,
        min_sharpness=config.quality_min_sharpness,
    )
    model_path = Path(args.model or config.quality_model_path or data_dir / "models" / "face_landmarker.task")
    with FaceQualityEvaluator(model_path, thresholds) as evaluator:
        samples, failures = analyze_crops(rows, evaluator, engine)
    matched_known = match_known(samples, engine, config.known_threshold)
    clusters = build_unknown_clusters(samples)
    promoted = promote_clusters(clusters, args.date)
    report = report_payload(
        target_date=args.date,
        rows=rows,
        samples=samples,
        promoted=promoted,
        failures=failures,
        elapsed=time.perf_counter() - started,
    )
    report["known_matches_before_consensus"] = matched_known
    report["input_detection_count"] = sum(
        int(row.get("detection_count") or 0)
        for row in store.dashboard(args.date).get("unknown", [])
    )
    report["unrecoverable_detection_gap"] = max(0, report["input_detection_count"] - len(rows))
    if args.apply:
        run_id, backup_path = apply_results(store, args.date, target_ids, samples, promoted, report)
        report["run_id"] = run_id
        report["backup_path"] = str(backup_path)
        report_path = data_dir / "logs" / f"quality-reprocess-{args.date}-{run_id}.json"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        report["report_path"] = str(report_path)
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reprocesa desconocidos historicos con controles de calidad facial.")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--model", default="")
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args(argv)


def main() -> None:
    try:
        report = run(parse_args())
        print(json.dumps(report, indent=2, ensure_ascii=False))
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
