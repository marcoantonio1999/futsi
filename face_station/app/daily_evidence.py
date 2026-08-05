from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Hashable, Mapping, Sequence

import numpy as np


DEFAULT_DAILY_EVIDENCE_LIMIT = 30
DEFAULT_TEMPORAL_BUCKET_MINUTES = 60
_EPSILON = 1e-12


@dataclass(frozen=True, slots=True)
class EvidenceCandidate:
    """One already-accepted face crop eligible for daily evidence retention."""

    candidate_id: Hashable
    captured_at: datetime | str
    camera_key: str
    quality: float
    embedding: object | None = None


@dataclass(frozen=True, slots=True)
class EvidenceDecision:
    candidate_id: Hashable
    retained: bool
    reason: str
    quality: float
    captured_at: datetime
    camera_key: str
    embedding_available: bool
    selection_score: float | None


@dataclass(frozen=True, slots=True)
class EvidenceSelectionSummary:
    candidate_count: int
    eligible_count: int
    target_count: int
    retained_count: int
    discarded_count: int
    camera_count: int
    retained_camera_count: int
    temporal_bucket_count: int
    retained_temporal_bucket_count: int
    embedding_count: int
    retained_embedding_count: int
    retained_quality_min: float | None
    retained_quality_mean: float | None
    retained_quality_max: float | None
    reason_counts: Mapping[str, int]

    def as_dict(self) -> dict:
        return {
            "candidate_count": self.candidate_count,
            "eligible_count": self.eligible_count,
            "target_count": self.target_count,
            "retained_count": self.retained_count,
            "discarded_count": self.discarded_count,
            "camera_count": self.camera_count,
            "retained_camera_count": self.retained_camera_count,
            "temporal_bucket_count": self.temporal_bucket_count,
            "retained_temporal_bucket_count": self.retained_temporal_bucket_count,
            "embedding_count": self.embedding_count,
            "retained_embedding_count": self.retained_embedding_count,
            "retained_quality_min": self.retained_quality_min,
            "retained_quality_mean": self.retained_quality_mean,
            "retained_quality_max": self.retained_quality_max,
            "reason_counts": dict(self.reason_counts),
        }


@dataclass(frozen=True, slots=True)
class EvidenceSelectionResult:
    """Deterministic, read-only selection result.

    ``retained_ids`` is chronological for convenient display. ``reasons``
    includes every input candidate, not only retained candidates, so a cleanup
    or audit can explain every decision before any file is removed.
    """

    retained_ids: tuple[Hashable, ...]
    reasons: Mapping[Hashable, str]
    decisions: tuple[EvidenceDecision, ...]
    summary: EvidenceSelectionSummary

    @property
    def discarded_ids(self) -> tuple[Hashable, ...]:
        retained = set(self.retained_ids)
        return tuple(
            decision.candidate_id
            for decision in self.decisions
            if decision.candidate_id not in retained
        )


@dataclass(slots=True)
class _PreparedCandidate:
    candidate_id: Hashable
    captured_at: datetime
    camera_key: str
    quality: float
    embedding: np.ndarray | None
    seconds_of_day: float
    temporal_bucket: int
    stable_id: tuple[str, str]
    eligible: bool
    quality_utility: float = 0.0

    @property
    def chronological_key(self) -> tuple:
        return (
            self.captured_at.date().isoformat(),
            self.seconds_of_day,
            self.stable_id,
        )


def _mapping_value(row: Mapping, *keys: str, default=None):
    for key in keys:
        if key in row:
            return row[key]
    return default


def _coerce_candidate(
    value: EvidenceCandidate | Mapping,
) -> EvidenceCandidate:
    if isinstance(value, EvidenceCandidate):
        return value
    if not isinstance(value, Mapping):
        raise TypeError(
            "Cada candidato debe ser EvidenceCandidate o un Mapping."
        )
    candidate_id = _mapping_value(value, "candidate_id", "id", "crop_id")
    if candidate_id is None:
        raise ValueError("El candidato no contiene candidate_id, id o crop_id.")
    captured_at = _mapping_value(value, "captured_at", "observed_at")
    if captured_at is None:
        raise ValueError(f"El candidato {candidate_id!r} no contiene captured_at.")
    return EvidenceCandidate(
        candidate_id=candidate_id,
        captured_at=captured_at,
        camera_key=str(
            _mapping_value(value, "camera_key", "camera", default="") or ""
        ),
        quality=float(_mapping_value(value, "quality", default=0.0) or 0.0),
        embedding=_mapping_value(value, "embedding"),
    )


def _parse_datetime(value: datetime | str, candidate_id: Hashable) -> datetime:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError(
            f"El candidato {candidate_id!r} tiene captured_at vacio."
        )
    if text.endswith(("Z", "z")):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(
            f"El candidato {candidate_id!r} tiene captured_at invalido: {value!r}."
        ) from exc


def _stable_id(value: Hashable) -> tuple[str, str]:
    try:
        hash(value)
    except TypeError as exc:
        raise ValueError("candidate_id debe ser hashable.") from exc
    return type(value).__qualname__, repr(value)


def _embedding_vector(value: object | None) -> np.ndarray | None:
    if value is None:
        return None
    try:
        vector = np.asarray(value, dtype=np.float32)
    except (TypeError, ValueError):
        return None
    if (
        vector.ndim != 1
        or vector.size == 0
        or not np.all(np.isfinite(vector))
    ):
        return None
    norm = float(np.linalg.norm(vector))
    if norm <= _EPSILON:
        return None
    return (vector / norm).astype(np.float32)


def _prepare_candidates(
    candidates: Sequence[EvidenceCandidate | Mapping],
    *,
    minimum_quality: float | None,
    temporal_bucket_minutes: int,
) -> list[_PreparedCandidate]:
    prepared: list[_PreparedCandidate] = []
    seen_ids: set[Hashable] = set()
    for raw_candidate in candidates:
        candidate = _coerce_candidate(raw_candidate)
        stable_id = _stable_id(candidate.candidate_id)
        if candidate.candidate_id in seen_ids:
            raise ValueError(
                f"candidate_id duplicado: {candidate.candidate_id!r}."
            )
        seen_ids.add(candidate.candidate_id)

        quality = float(candidate.quality)
        if not np.isfinite(quality):
            raise ValueError(
                f"El candidato {candidate.candidate_id!r} tiene quality no finita."
            )
        captured_at = _parse_datetime(
            candidate.captured_at,
            candidate.candidate_id,
        )
        seconds_of_day = (
            captured_at.hour * 3600
            + captured_at.minute * 60
            + captured_at.second
            + captured_at.microsecond / 1_000_000
        )
        bucket_seconds = temporal_bucket_minutes * 60
        prepared.append(
            _PreparedCandidate(
                candidate_id=candidate.candidate_id,
                captured_at=captured_at,
                camera_key=str(candidate.camera_key or "sin_camara"),
                quality=quality,
                embedding=_embedding_vector(candidate.embedding),
                seconds_of_day=seconds_of_day,
                temporal_bucket=int(seconds_of_day // bucket_seconds),
                stable_id=stable_id,
                eligible=(
                    minimum_quality is None or quality >= minimum_quality
                ),
            )
        )

    represented_dates = {item.captured_at.date() for item in prepared}
    if len(represented_dates) > 1:
        raise ValueError(
            "La seleccion diaria solo acepta candidatos de una misma fecha."
        )

    valid_dimensions = Counter(
        len(item.embedding)
        for item in prepared
        if item.embedding is not None
    )
    if valid_dimensions:
        # A corrupt or legacy vector with another dimension is treated like a
        # missing embedding. It remains eligible for quality/time/camera
        # evidence instead of failing the complete daily selection.
        embedding_dimension = max(
            valid_dimensions,
            key=lambda dimension: (valid_dimensions[dimension], dimension),
        )
        for item in prepared:
            if (
                item.embedding is not None
                and len(item.embedding) != embedding_dimension
            ):
                item.embedding = None

    eligible_qualities = [
        item.quality for item in prepared if item.eligible
    ]
    if eligible_qualities:
        quality_min = min(eligible_qualities)
        quality_max = max(eligible_qualities)
        bounded_scale = quality_min >= 0.0 and quality_max <= 1.0
        for item in prepared:
            if not item.eligible:
                continue
            if bounded_scale:
                item.quality_utility = item.quality
            elif quality_max - quality_min > _EPSILON:
                item.quality_utility = (
                    item.quality - quality_min
                ) / (quality_max - quality_min)
            else:
                item.quality_utility = 1.0
    return prepared


def _embedding_novelty(
    candidate: _PreparedCandidate,
    selected: Sequence[_PreparedCandidate],
) -> float:
    if candidate.embedding is None:
        return 0.0
    selected_embeddings = [
        item.embedding for item in selected if item.embedding is not None
    ]
    if not selected_embeddings:
        return 1.0
    compatible = [
        embedding
        for embedding in selected_embeddings
        if len(embedding) == len(candidate.embedding)
    ]
    if not compatible:
        return 1.0
    maximum_similarity = max(
        float(candidate.embedding @ embedding)
        for embedding in compatible
    )
    return max(0.0, min(1.0, (1.0 - maximum_similarity) / 2.0))


def _temporal_novelty(
    candidate: _PreparedCandidate,
    selected: Sequence[_PreparedCandidate],
) -> float:
    if not selected:
        return 1.0
    nearest_seconds = min(
        abs(candidate.seconds_of_day - item.seconds_of_day)
        for item in selected
    )
    # Twelve hours represents maximum useful separation within one day.
    return min(1.0, nearest_seconds / (12 * 3600))


def _score(
    candidate: _PreparedCandidate,
    selected: Sequence[_PreparedCandidate],
    *,
    quality_weight: float,
    embedding_weight: float,
    temporal_weight: float,
) -> float:
    return (
        quality_weight * candidate.quality_utility
        + embedding_weight * _embedding_novelty(candidate, selected)
        + temporal_weight * _temporal_novelty(candidate, selected)
    )


def _best_candidate(
    candidates: Sequence[_PreparedCandidate],
    selected: Sequence[_PreparedCandidate],
    *,
    quality_weight: float,
    embedding_weight: float,
    temporal_weight: float,
) -> tuple[_PreparedCandidate, float]:
    ranked = []
    for candidate in candidates:
        score = _score(
            candidate,
            selected,
            quality_weight=quality_weight,
            embedding_weight=embedding_weight,
            temporal_weight=temporal_weight,
        )
        ranked.append(
            (
                score,
                candidate.quality,
                -candidate.seconds_of_day,
                candidate.stable_id,
                candidate,
            )
        )
    # The stable ID is deliberately used in ascending order on an otherwise
    # descending rank, making ties independent of database/input row order.
    best_prefix = max(item[:3] for item in ranked)
    tied = [
        item
        for item in ranked
        if item[:3] == best_prefix
    ]
    chosen = min(tied, key=lambda item: item[3])
    return chosen[4], float(chosen[0])


def select_daily_evidence(
    candidates: Sequence[EvidenceCandidate | Mapping],
    *,
    limit: int = DEFAULT_DAILY_EVIDENCE_LIMIT,
    minimum_quality: float | None = None,
    temporal_bucket_minutes: int = DEFAULT_TEMPORAL_BUCKET_MINUTES,
    required_ids: Sequence[Hashable] = (),
) -> EvidenceSelectionResult:
    """Select compact, diverse evidence for one subject on one local date.

    Selection is performed in four deterministic stages:

    1. retain the highest-quality portrait;
    2. cover every camera when capacity permits;
    3. cover distinct time buckets, choosing the most temporally useful bucket
       first when there are more buckets than remaining slots;
    4. fill remaining capacity by quality and embedding diversity.

    No files or database rows are changed. Missing, malformed, zero-norm or
    dimension-incompatible embeddings simply do not contribute a diversity
    score; those crops can still win on quality, camera or temporal coverage.
    """

    safe_limit = int(limit)
    if safe_limit < 1:
        raise ValueError("limit debe ser al menos 1.")
    safe_bucket_minutes = int(temporal_bucket_minutes)
    if not 1 <= safe_bucket_minutes <= 24 * 60:
        raise ValueError(
            "temporal_bucket_minutes debe estar entre 1 y 1440."
        )
    if minimum_quality is not None and not np.isfinite(
        float(minimum_quality)
    ):
        raise ValueError("minimum_quality debe ser finita.")

    prepared = _prepare_candidates(
        candidates,
        minimum_quality=(
            float(minimum_quality)
            if minimum_quality is not None
            else None
        ),
        temporal_bucket_minutes=safe_bucket_minutes,
    )
    eligible = [item for item in prepared if item.eligible]
    selected: list[_PreparedCandidate] = []
    selection: dict[Hashable, tuple[str, float]] = {}
    required_set = set(required_ids)
    available_ids = {item.candidate_id for item in prepared}
    missing_required = sorted(
        required_set - available_ids,
        key=_stable_id,
    )
    if missing_required:
        raise ValueError(
            f"required_ids contiene candidatos inexistentes: {missing_required!r}."
        )
    if len(required_set) > safe_limit:
        raise ValueError("required_ids no puede superar limit.")

    def retain(
        candidate: _PreparedCandidate,
        reason: str,
        score: float,
    ) -> None:
        if candidate.candidate_id in selection or len(selected) >= safe_limit:
            return
        selected.append(candidate)
        selection[candidate.candidate_id] = (reason, float(score))

    for candidate in sorted(
        (
            item
            for item in prepared
            if item.candidate_id in required_set
        ),
        key=lambda item: item.chronological_key,
    ):
        retain(candidate, "protected_reference", 1.0)

    anchor_candidates = [
        item for item in eligible if item.candidate_id not in selection
    ]
    if anchor_candidates:
        anchor, anchor_score = _best_candidate(
            anchor_candidates,
            selected,
            quality_weight=1.0,
            embedding_weight=0.0,
            temporal_weight=0.0,
        )
        retain(anchor, "best_quality_anchor", anchor_score)

    # Camera coverage is explicit so an excellent camera/feed cannot crowd out
    # all evidence from another useful viewpoint.
    camera_choices = []
    for camera_key in sorted({item.camera_key for item in eligible}):
        if any(item.camera_key == camera_key for item in selected):
            continue
        available = [
            item
            for item in eligible
            if (
                item.camera_key == camera_key
                and item.candidate_id not in selection
            )
        ]
        if available:
            candidate, score = _best_candidate(
                available,
                selected,
                quality_weight=0.80,
                embedding_weight=0.05,
                temporal_weight=0.15,
            )
            camera_choices.append((candidate, score))
    camera_choices.sort(
        key=lambda item: (
            -item[1],
            -item[0].quality,
            item[0].camera_key,
            item[0].chronological_key,
        )
    )
    for candidate, score in camera_choices:
        retain(candidate, "camera_coverage", score)

    # Cover hourly (or configured) buckets. If capacity is tight, select the
    # bucket farthest from current evidence rather than filling morning-first.
    while len(selected) < safe_limit:
        covered_buckets = {item.temporal_bucket for item in selected}
        uncovered = {
            item.temporal_bucket
            for item in eligible
            if (
                item.temporal_bucket not in covered_buckets
                and item.candidate_id not in selection
            )
        }
        if not uncovered:
            break

        bucket_choices = []
        for bucket in sorted(uncovered):
            available = [
                item
                for item in eligible
                if (
                    item.temporal_bucket == bucket
                    and item.candidate_id not in selection
                )
            ]
            candidate, inner_score = _best_candidate(
                available,
                selected,
                quality_weight=0.70,
                embedding_weight=0.20,
                temporal_weight=0.10,
            )
            bucket_choices.append(
                (
                    _temporal_novelty(candidate, selected),
                    inner_score,
                    candidate,
                )
            )
        best_temporal = max(item[0] for item in bucket_choices)
        temporal_ties = [
            item
            for item in bucket_choices
            if abs(item[0] - best_temporal) <= _EPSILON
        ]
        best_inner = max(item[1] for item in temporal_ties)
        score_ties = [
            item
            for item in temporal_ties
            if abs(item[1] - best_inner) <= _EPSILON
        ]
        _, score, candidate = min(
            score_ties,
            key=lambda item: item[2].chronological_key,
        )
        retain(candidate, "temporal_coverage", score)

    # Extra slots retain useful variations rather than consecutive near-
    # duplicate frames. Quality remains the largest term.
    while len(selected) < min(safe_limit, len(eligible)):
        available = [
            item
            for item in eligible
            if item.candidate_id not in selection
        ]
        if not available:
            break
        candidate, score = _best_candidate(
            available,
            selected,
            quality_weight=0.55,
            embedding_weight=0.30,
            temporal_weight=0.15,
        )
        retain(candidate, "quality_diversity_fill", score)

    selected_by_id = {
        item.candidate_id: item for item in selected
    }
    chronological = sorted(
        prepared,
        key=lambda item: item.chronological_key,
    )
    reasons: dict[Hashable, str] = {}
    decisions = []
    for item in chronological:
        if item.candidate_id in selection:
            reason, score = selection[item.candidate_id]
            retained = True
        elif not item.eligible:
            reason = "below_minimum_quality"
            score = None
            retained = False
        else:
            reason = "redundant_or_lower_value"
            score = None
            retained = False
        reasons[item.candidate_id] = reason
        decisions.append(
            EvidenceDecision(
                candidate_id=item.candidate_id,
                retained=retained,
                reason=reason,
                quality=item.quality,
                captured_at=item.captured_at,
                camera_key=item.camera_key,
                embedding_available=item.embedding is not None,
                selection_score=score,
            )
        )

    retained_chronological = [
        item
        for item in chronological
        if item.candidate_id in selected_by_id
    ]
    retained_qualities = [
        item.quality for item in retained_chronological
    ]
    reason_counts = Counter(reasons.values())
    summary = EvidenceSelectionSummary(
        candidate_count=len(prepared),
        eligible_count=len(eligible),
        target_count=safe_limit,
        retained_count=len(selected),
        discarded_count=len(prepared) - len(selected),
        camera_count=len({item.camera_key for item in eligible}),
        retained_camera_count=len(
            {item.camera_key for item in retained_chronological}
        ),
        temporal_bucket_count=len(
            {item.temporal_bucket for item in eligible}
        ),
        retained_temporal_bucket_count=len(
            {item.temporal_bucket for item in retained_chronological}
        ),
        embedding_count=sum(
            item.embedding is not None for item in eligible
        ),
        retained_embedding_count=sum(
            item.embedding is not None for item in retained_chronological
        ),
        retained_quality_min=(
            float(min(retained_qualities))
            if retained_qualities
            else None
        ),
        retained_quality_mean=(
            float(np.mean(retained_qualities))
            if retained_qualities
            else None
        ),
        retained_quality_max=(
            float(max(retained_qualities))
            if retained_qualities
            else None
        ),
        reason_counts=MappingProxyType(dict(sorted(reason_counts.items()))),
    )
    return EvidenceSelectionResult(
        retained_ids=tuple(
            item.candidate_id for item in retained_chronological
        ),
        reasons=MappingProxyType(reasons),
        decisions=tuple(decisions),
        summary=summary,
    )
