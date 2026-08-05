from __future__ import annotations

from dataclasses import asdict, dataclass
from itertools import combinations
from typing import Mapping, Sequence

import numpy as np

from .unknown_gallery import select_retained_reference_indices


_EPSILON = 1e-12


def _normalized_matrix(
    values,
    name: str,
    *,
    expected_width: int | None = None,
) -> np.ndarray:
    matrix = np.asarray(values, dtype=np.float32)
    if matrix.size == 0:
        width = int(expected_width or 0)
        return np.empty((0, width), dtype=np.float32)
    if matrix.ndim == 1:
        matrix = matrix.reshape(1, -1)
    if matrix.ndim != 2 or matrix.shape[1] == 0:
        raise ValueError(f"{name} debe ser una matriz bidimensional no vacia.")
    if expected_width is not None and matrix.shape[1] != expected_width:
        raise ValueError(
            f"{name} debe tener embeddings de dimension "
            f"{expected_width}, no {matrix.shape[1]}."
        )
    if not np.all(np.isfinite(matrix)):
        raise ValueError(f"{name} contiene valores no finitos.")
    norms = np.linalg.norm(matrix, axis=1)
    if np.any(norms <= _EPSILON):
        raise ValueError(f"{name} contiene un embedding sin norma.")
    return (matrix / norms[:, None]).astype(np.float32)


def _subject_id(row: Mapping, name: str) -> str:
    subject_id = str(row.get("subject_id") or "").strip()
    if not subject_id:
        raise ValueError(f"{name} no contiene subject_id.")
    return subject_id


@dataclass(frozen=True, slots=True)
class ReconciliationConfig:
    """Conservative thresholds for a read-only unknown-identity audit.

    Eight to twelve retained portraits are the preferred mature gallery, not
    a hard gate. Galleries with at least four portraits may seed a merge when
    their reciprocal evidence clears the stricter adaptive thresholds. Truly
    sparse historical galleries may only join an already supported group.
    """

    preferred_gallery_min: int = 8
    adaptive_gallery_min: int = 4
    max_gallery_size: int = 12
    review_centroid_threshold: float = 0.55
    merge_centroid_threshold: float = 0.60
    reference_support_threshold: float = 0.50
    minimum_reference_median: float = 0.52
    minimum_top_reference: float = 0.58
    minimum_directional_coverage: float = 0.50
    adaptive_merge_centroid_threshold: float = 0.75
    adaptive_minimum_reference_median: float = 0.65
    adaptive_minimum_top_reference: float = 0.70
    adaptive_minimum_directional_coverage: float = 0.90
    adaptive_minimum_pair_confidence: float = 0.70
    hard_reference_threshold: float = 0.80
    hard_reference_internal_support_threshold: float = 0.50
    hard_reference_candidate_block_size: int = 512
    minimum_robust_anchors: int = 2
    group_assignment_margin: float = 0.02

    def __post_init__(self) -> None:
        if not 2 <= int(self.preferred_gallery_min) <= 12:
            raise ValueError("preferred_gallery_min debe estar entre 2 y 12.")
        if not 2 <= int(self.adaptive_gallery_min) <= 12:
            raise ValueError("adaptive_gallery_min debe estar entre 2 y 12.")
        if not int(self.preferred_gallery_min) <= int(self.max_gallery_size) <= 12:
            raise ValueError(
                "max_gallery_size debe estar entre preferred_gallery_min y 12."
            )
        for field_name in (
            "review_centroid_threshold",
            "merge_centroid_threshold",
            "reference_support_threshold",
            "minimum_reference_median",
            "minimum_top_reference",
            "adaptive_merge_centroid_threshold",
            "adaptive_minimum_reference_median",
            "adaptive_minimum_top_reference",
            "adaptive_minimum_pair_confidence",
            "hard_reference_threshold",
            "hard_reference_internal_support_threshold",
        ):
            value = float(getattr(self, field_name))
            if not -1.0 <= value <= 1.0:
                raise ValueError(f"{field_name} debe estar entre -1 y 1.")
        if self.review_centroid_threshold > self.merge_centroid_threshold:
            raise ValueError(
                "review_centroid_threshold no puede superar "
                "merge_centroid_threshold."
            )
        if not 0.0 <= float(self.minimum_directional_coverage) <= 1.0:
            raise ValueError(
                "minimum_directional_coverage debe estar entre 0 y 1."
            )
        if not 0.0 <= float(
            self.adaptive_minimum_directional_coverage
        ) <= 1.0:
            raise ValueError(
                "adaptive_minimum_directional_coverage debe estar entre 0 y 1."
            )
        if int(self.minimum_robust_anchors) < 2:
            raise ValueError("minimum_robust_anchors debe ser al menos 2.")
        if int(self.hard_reference_candidate_block_size) < 32:
            raise ValueError(
                "hard_reference_candidate_block_size debe ser al menos 32."
            )
        if not 0.0 <= float(self.group_assignment_margin) <= 2.0:
            raise ValueError("group_assignment_margin debe estar entre 0 y 2.")


@dataclass(frozen=True, slots=True)
class GalleryProfile:
    subject_id: str
    name: str
    status: str
    supplied_reference_count: int
    retained_reference_count: int
    preferred_gallery_ready: bool
    median_quality: float
    detection_count: int
    best_quality: float


@dataclass(frozen=True, slots=True)
class ExcludedIdentity:
    subject_id: str
    name: str
    reason: str


@dataclass(frozen=True, slots=True)
class PairEvidence:
    left_subject_id: str
    right_subject_id: str
    left_name: str
    right_name: str
    decision: str
    centroid_similarity: float
    pair_confidence: float
    top_reference_similarity: float | None
    left_reference_count: int
    right_reference_count: int
    left_supported_references: int
    right_supported_references: int
    left_coverage: float
    right_coverage: float
    left_best_median: float | None
    right_best_median: float | None
    mutual_nearest_pairs: int
    hard_reference_match: bool
    left_top_internal_support: float | None
    right_top_internal_support: float | None
    reasons: tuple[str, ...]

    @property
    def key(self) -> tuple[str, str]:
        return tuple(
            sorted((self.left_subject_id, self.right_subject_id))
        )


@dataclass(frozen=True, slots=True)
class MergeProposal:
    target_subject_id: str
    target_name: str
    source_subject_ids: tuple[str, ...]
    source_names: tuple[str, ...]
    member_subject_ids: tuple[str, ...]
    member_names: tuple[str, ...]
    robust_anchor_count: int
    adaptive_anchor_count: int
    seed_anchor_count: int
    hard_reference_edge_count: int
    weakest_pair_confidence: float
    weakest_pair: tuple[str, str]
    pair_count: int
    expected_pair_count: int
    contextual_sparse_pair_count: int
    contextual_sparse_pair_evidence: tuple[PairEvidence, ...]
    explanation: str


@dataclass(frozen=True, slots=True)
class ReviewItem:
    subject_ids: tuple[str, ...]
    names: tuple[str, ...]
    reason: str
    pair_evidence: PairEvidence | None = None


@dataclass(frozen=True, slots=True)
class ReconciliationPlan:
    """An explainable plan. Creating it never writes to SQLite or files."""

    mode: str
    identity_count: int
    eligible_identity_count: int
    supplied_reference_count: int
    retained_reference_count: int
    vectorized_candidate_count: int
    supported_pair_count: int
    gallery_profiles: tuple[GalleryProfile, ...]
    excluded_identities: tuple[ExcludedIdentity, ...]
    merge_proposals: tuple[MergeProposal, ...]
    review_items: tuple[ReviewItem, ...]
    isolated_subject_ids: tuple[str, ...]
    config: ReconciliationConfig

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class _PreparedIdentity:
    row: dict
    centroid: np.ndarray
    supplied_gallery: np.ndarray
    gallery: np.ndarray
    qualities: np.ndarray
    profile: GalleryProfile


def _prepare_identities(
    identity_rows: Sequence[Mapping],
    centroid_matrix,
    reference_rows: Sequence[Mapping],
    reference_matrix,
    config: ReconciliationConfig,
) -> tuple[list[_PreparedIdentity], list[ExcludedIdentity], int]:
    rows = [dict(row) for row in identity_rows]
    centroids = _normalized_matrix(centroid_matrix, "centroid_matrix")
    if len(rows) != len(centroids):
        raise ValueError(
            "identity_rows y centroid_matrix deben tener la misma longitud."
        )

    references = [dict(row) for row in reference_rows]
    reference_embeddings = _normalized_matrix(
        reference_matrix,
        "reference_matrix",
        expected_width=centroids.shape[1] if len(centroids) else None,
    )
    if len(references) != len(reference_embeddings):
        raise ValueError(
            "reference_rows y reference_matrix deben tener la misma longitud."
        )

    identities_by_id: dict[str, tuple[dict, np.ndarray]] = {}
    for row, centroid in zip(rows, centroids):
        subject_id = _subject_id(row, "identity_rows")
        if subject_id in identities_by_id:
            raise ValueError(
                f"identity_rows contiene subject_id duplicado: {subject_id}."
            )
        identities_by_id[subject_id] = (row, centroid)

    reference_indexes: dict[str, list[int]] = {
        subject_id: [] for subject_id in identities_by_id
    }
    for index, row in enumerate(references):
        subject_id = _subject_id(row, "reference_rows")
        if subject_id in reference_indexes:
            reference_indexes[subject_id].append(index)

    prepared: list[_PreparedIdentity] = []
    excluded: list[ExcludedIdentity] = []
    for subject_id in sorted(identities_by_id):
        row, centroid = identities_by_id[subject_id]
        name = str(row.get("temporary_name") or subject_id)
        status = str(row.get("status") or "consolidated").strip().lower()
        if status != "consolidated":
            excluded.append(
                ExcludedIdentity(
                    subject_id=subject_id,
                    name=name,
                    reason=f"status_protegido:{status}",
                )
            )
            continue
        if str(row.get("linked_person_key") or "").strip():
            excluded.append(
                ExcludedIdentity(
                    subject_id=subject_id,
                    name=name,
                    reason="identidad_vinculada",
                )
            )
            continue

        indexes = reference_indexes[subject_id]
        supplied_gallery = reference_embeddings[indexes]
        supplied_qualities = np.asarray(
            [
                float(references[index].get("quality", 0.0) or 0.0)
                for index in indexes
            ],
            dtype=np.float32,
        )
        if len(supplied_gallery):
            retained_local = select_retained_reference_indices(
                supplied_gallery,
                supplied_qualities,
                limit=config.max_gallery_size,
            )
            gallery = supplied_gallery[retained_local]
            qualities = supplied_qualities[retained_local]
        else:
            gallery = np.empty((0, centroids.shape[1]), dtype=np.float32)
            qualities = np.empty((0,), dtype=np.float32)

        profile = GalleryProfile(
            subject_id=subject_id,
            name=name,
            status=status,
            supplied_reference_count=len(indexes),
            retained_reference_count=len(gallery),
            preferred_gallery_ready=(
                len(gallery) >= config.preferred_gallery_min
            ),
            median_quality=(
                float(np.median(qualities)) if len(qualities) else 0.0
            ),
            detection_count=int(row.get("detection_count", 0) or 0),
            best_quality=float(row.get("best_quality", 0.0) or 0.0),
        )
        prepared.append(
            _PreparedIdentity(
                row=row,
                centroid=centroid,
                supplied_gallery=supplied_gallery,
                gallery=gallery,
                qualities=qualities,
                profile=profile,
            )
        )

    return prepared, excluded, len(references)


def _candidate_pairs(
    prepared: Sequence[_PreparedIdentity],
    config: ReconciliationConfig,
) -> tuple[np.ndarray, list[tuple[int, int]]]:
    if not prepared:
        return np.empty((0, 0), dtype=np.float32), []
    centroids = np.vstack([identity.centroid for identity in prepared])
    similarities = centroids @ centroids.T
    candidate_mask = np.triu(
        similarities >= config.review_centroid_threshold,
        k=1,
    )
    pairs = {
        (int(left), int(right))
        for left, right in np.argwhere(candidate_mask)
    }
    pairs |= _hard_reference_candidate_pairs(prepared, config)
    return similarities, sorted(pairs)


def _hard_reference_candidate_pairs(
    prepared: Sequence[_PreparedIdentity],
    config: ReconciliationConfig,
) -> set[tuple[int, int]]:
    """Find cross-identity portrait matches without allocating a full matrix.

    A strong portrait can rescue identities whose centroids were polluted by
    old low-quality crops. The blocked matrix multiplication bounds temporary
    memory while keeping the expensive work vectorized for the nightly run.
    """

    gallery_parts = []
    owner_parts = []
    for owner_index, identity in enumerate(prepared):
        if not len(identity.gallery):
            continue
        gallery_parts.append(identity.gallery)
        owner_parts.append(
            np.full(len(identity.gallery), owner_index, dtype=np.int32)
        )
    if not gallery_parts:
        return set()

    galleries = np.vstack(gallery_parts)
    owners = np.concatenate(owner_parts)
    pairs: set[tuple[int, int]] = set()
    block_size = int(config.hard_reference_candidate_block_size)
    for start in range(0, len(galleries), block_size):
        stop = min(start + block_size, len(galleries))
        scores = galleries[start:stop] @ galleries.T
        for local_index, matched_indexes in enumerate(
            scores >= config.hard_reference_threshold
        ):
            left_owner = int(owners[start + local_index])
            for matched_index in np.flatnonzero(matched_indexes):
                right_owner = int(owners[matched_index])
                if left_owner == right_owner:
                    continue
                pairs.add(tuple(sorted((left_owner, right_owner))))
    return pairs


def _pair_evidence(
    left: _PreparedIdentity,
    right: _PreparedIdentity,
    centroid_similarity: float,
    config: ReconciliationConfig,
) -> PairEvidence:
    left_gallery = left.gallery
    right_gallery = right.gallery
    failures: list[str] = []

    if len(left_gallery) == 0 or len(right_gallery) == 0:
        if len(left_gallery) == 0:
            failures.append("left_gallery_empty")
        if len(right_gallery) == 0:
            failures.append("right_gallery_empty")
        if centroid_similarity < config.merge_centroid_threshold:
            failures.append("centroid_below_merge_threshold")
        return PairEvidence(
            left_subject_id=left.profile.subject_id,
            right_subject_id=right.profile.subject_id,
            left_name=left.profile.name,
            right_name=right.profile.name,
            decision="review",
            centroid_similarity=float(centroid_similarity),
            pair_confidence=float(centroid_similarity),
            top_reference_similarity=None,
            left_reference_count=len(left_gallery),
            right_reference_count=len(right_gallery),
            left_supported_references=0,
            right_supported_references=0,
            left_coverage=0.0,
            right_coverage=0.0,
            left_best_median=None,
            right_best_median=None,
            mutual_nearest_pairs=0,
            hard_reference_match=False,
            left_top_internal_support=None,
            right_top_internal_support=None,
            reasons=tuple(failures),
        )

    # Every cross-gallery score for a candidate is obtained in one vectorized
    # dot-product. Directional maxima prevent one lucky portrait from proving
    # the identity for both galleries.
    cross_scores = left_gallery @ right_gallery.T
    left_best = np.max(cross_scores, axis=1)
    right_best = np.max(cross_scores, axis=0)
    left_supported = int(
        np.count_nonzero(left_best >= config.reference_support_threshold)
    )
    right_supported = int(
        np.count_nonzero(right_best >= config.reference_support_threshold)
    )
    left_coverage = left_supported / len(left_best)
    right_coverage = right_supported / len(right_best)
    left_median = float(np.median(left_best))
    right_median = float(np.median(right_best))
    top_flat_index = int(np.argmax(cross_scores))
    top_left_index, top_right_index = np.unravel_index(
        top_flat_index,
        cross_scores.shape,
    )
    top_reference = float(cross_scores[top_left_index, top_right_index])

    def internal_support(
        supplied_gallery: np.ndarray,
        reference: np.ndarray,
    ) -> float:
        if len(supplied_gallery) <= 1:
            return 1.0
        scores = supplied_gallery @ reference
        # Remove exactly one self match while preserving any independent
        # near-duplicate portraits that legitimately corroborate the crop.
        other_scores = np.delete(scores, int(np.argmax(scores)))
        return float(np.median(other_scores))

    left_top_internal_support = internal_support(
        left.supplied_gallery,
        left_gallery[int(top_left_index)],
    )
    right_top_internal_support = internal_support(
        right.supplied_gallery,
        right_gallery[int(top_right_index)],
    )
    hard_reference_match = bool(
        top_reference >= config.hard_reference_threshold
        and left_top_internal_support
        >= config.hard_reference_internal_support_threshold
        and right_top_internal_support
        >= config.hard_reference_internal_support_threshold
    )

    left_nearest = np.argmax(cross_scores, axis=1)
    right_nearest = np.argmax(cross_scores, axis=0)
    mutual_pairs = sum(
        1
        for left_index, right_index in enumerate(left_nearest)
        if (
            int(right_nearest[right_index]) == left_index
            and float(cross_scores[left_index, right_index])
            >= config.reference_support_threshold
        )
    )

    if centroid_similarity < config.merge_centroid_threshold:
        failures.append("centroid_below_merge_threshold")
    if top_reference < config.minimum_top_reference:
        failures.append("top_reference_below_threshold")
    if left_median < config.minimum_reference_median:
        failures.append("left_reference_median_below_threshold")
    if right_median < config.minimum_reference_median:
        failures.append("right_reference_median_below_threshold")
    if left_coverage < config.minimum_directional_coverage:
        failures.append("left_directional_coverage_below_threshold")
    if right_coverage < config.minimum_directional_coverage:
        failures.append("right_directional_coverage_below_threshold")
    if mutual_pairs < 1:
        failures.append("no_mutual_nearest_reference")
    if (
        top_reference >= config.hard_reference_threshold
        and not hard_reference_match
    ):
        if (
            left_top_internal_support
            < config.hard_reference_internal_support_threshold
        ):
            failures.append("left_hard_reference_not_representative")
        if (
            right_top_internal_support
            < config.hard_reference_internal_support_threshold
        ):
            failures.append("right_hard_reference_not_representative")

    pair_confidence = float(
        0.30 * centroid_similarity
        + 0.20 * top_reference
        + 0.25 * left_median
        + 0.25 * right_median
    )
    if hard_reference_match:
        pair_confidence = max(
            pair_confidence,
            float(
                0.60 * top_reference
                + 0.20 * left_top_internal_support
                + 0.20 * right_top_internal_support
            ),
        )
    return PairEvidence(
        left_subject_id=left.profile.subject_id,
        right_subject_id=right.profile.subject_id,
        left_name=left.profile.name,
        right_name=right.profile.name,
        decision=(
            "supported"
            if hard_reference_match or not failures
            else "review"
        ),
        centroid_similarity=float(centroid_similarity),
        pair_confidence=pair_confidence,
        top_reference_similarity=top_reference,
        left_reference_count=len(left_gallery),
        right_reference_count=len(right_gallery),
        left_supported_references=left_supported,
        right_supported_references=right_supported,
        left_coverage=float(left_coverage),
        right_coverage=float(right_coverage),
        left_best_median=left_median,
        right_best_median=right_median,
        mutual_nearest_pairs=int(mutual_pairs),
        hard_reference_match=hard_reference_match,
        left_top_internal_support=left_top_internal_support,
        right_top_internal_support=right_top_internal_support,
        reasons=(
            ("hard_reference_match",)
            if hard_reference_match
            else (
                tuple(failures)
                if failures
                else ("reciprocal_gallery_evidence",)
            )
        ),
    )


def _edge_key(left: str, right: str) -> tuple[str, str]:
    return tuple(sorted((left, right)))


def _all_cross_edges(
    left_group: set[str],
    right_group: set[str],
    supported: Mapping[tuple[str, str], PairEvidence],
) -> list[PairEvidence] | None:
    edges = []
    for left in left_group:
        for right in right_group:
            edge = supported.get(_edge_key(left, right))
            if edge is None:
                return None
            edges.append(edge)
    return edges


def _complete_link_robust_groups(
    robust_ids: Sequence[str],
    supported: Mapping[tuple[str, str], PairEvidence],
) -> list[set[str]]:
    groups = [{subject_id} for subject_id in sorted(robust_ids)]
    while True:
        options = []
        for left_index, right_index in combinations(range(len(groups)), 2):
            edges = _all_cross_edges(
                groups[left_index],
                groups[right_index],
                supported,
            )
            if edges is None:
                continue
            options.append(
                (
                    min(edge.pair_confidence for edge in edges),
                    min(edge.centroid_similarity for edge in edges),
                    len(groups[left_index]) + len(groups[right_index]),
                    tuple(sorted(groups[left_index] | groups[right_index])),
                    left_index,
                    right_index,
                )
            )
        if not options:
            return groups
        _, _, _, _, left_index, right_index = max(options)
        groups[left_index] |= groups[right_index]
        del groups[right_index]


def _is_adaptive_seed_edge(
    evidence: PairEvidence,
    config: ReconciliationConfig,
) -> bool:
    """Require stronger evidence before a 4-7 portrait gallery seeds a merge."""

    return bool(
        evidence.decision == "supported"
        and evidence.left_reference_count >= config.adaptive_gallery_min
        and evidence.right_reference_count >= config.adaptive_gallery_min
        and evidence.centroid_similarity
        >= config.adaptive_merge_centroid_threshold
        and evidence.top_reference_similarity is not None
        and evidence.top_reference_similarity
        >= config.adaptive_minimum_top_reference
        and evidence.left_best_median is not None
        and evidence.left_best_median
        >= config.adaptive_minimum_reference_median
        and evidence.right_best_median is not None
        and evidence.right_best_median
        >= config.adaptive_minimum_reference_median
        and evidence.left_coverage
        >= config.adaptive_minimum_directional_coverage
        and evidence.right_coverage
        >= config.adaptive_minimum_directional_coverage
        and evidence.pair_confidence
        >= config.adaptive_minimum_pair_confidence
    )


def _attach_sparse_identities(
    groups: list[set[str]],
    sparse_ids: Sequence[str],
    supported: Mapping[tuple[str, str], PairEvidence],
    seed_ids: set[str],
    config: ReconciliationConfig,
) -> tuple[list[set[str]], list[ReviewItem]]:
    reviews: list[ReviewItem] = []
    for subject_id in sorted(sparse_ids):
        subject_choices = []
        for group_index, group in enumerate(groups):
            seed_group = group & seed_ids
            if len(seed_group) < config.minimum_robust_anchors:
                continue
            # A sparse historical identity is checked against every robust
            # or high-confidence adaptive anchor, never against another sparse
            # attachment. This allows two poor portraits of the same person to
            # disagree with each other without creating A-B-C chaining: both
            # still need independent, direct evidence to the supported core.
            edges = _all_cross_edges(
                {subject_id},
                seed_group,
                supported,
            )
            if edges is None:
                continue
            subject_choices.append(
                (
                    min(edge.pair_confidence for edge in edges),
                    group_index,
                    edges,
                )
            )
        subject_choices.sort(reverse=True, key=lambda item: item[0])
        if not subject_choices:
            continue
        best_score, best_group_index, _ = subject_choices[0]
        if (
            len(subject_choices) > 1
            and best_score - subject_choices[1][0]
            < config.group_assignment_margin
        ):
            reviews.append(
                ReviewItem(
                    subject_ids=(subject_id,),
                    names=(),
                    reason="ambiguous_between_complete_link_groups",
                )
            )
        else:
            groups[best_group_index].add(subject_id)

    return groups, reviews


def _canonical_identity(
    members: set[str],
    prepared_by_id: Mapping[str, _PreparedIdentity],
) -> _PreparedIdentity:
    return max(
        (prepared_by_id[subject_id] for subject_id in members),
        key=lambda identity: (
            identity.profile.retained_reference_count,
            identity.profile.best_quality,
            identity.profile.detection_count,
            identity.profile.median_quality,
            identity.profile.subject_id,
        ),
    )


def plan_unknown_reconciliation(
    identity_rows: Sequence[Mapping],
    centroid_matrix,
    reference_rows: Sequence[Mapping],
    reference_matrix,
    *,
    config: ReconciliationConfig | None = None,
) -> ReconciliationPlan:
    """Build a conservative, read-only unknown-identity reconciliation plan.

    Candidate generation uses one vectorized centroid comparison. Each
    candidate is then verified with reciprocal cross-gallery evidence.
    Automatic groups use complete linkage: every member must have a supported
    direct edge to every other member, so transitive A-B-C chaining is never
    considered proof.
    """

    safe_config = config or ReconciliationConfig()
    prepared, excluded, supplied_reference_count = _prepare_identities(
        identity_rows,
        centroid_matrix,
        reference_rows,
        reference_matrix,
        safe_config,
    )
    similarities, candidate_indexes = _candidate_pairs(prepared, safe_config)

    evidence = []
    for left_index, right_index in candidate_indexes:
        evidence.append(
            _pair_evidence(
                prepared[left_index],
                prepared[right_index],
                float(similarities[left_index, right_index]),
                safe_config,
            )
        )
    evidence.sort(
        key=lambda item: (
            -item.pair_confidence,
            item.left_subject_id,
            item.right_subject_id,
        )
    )
    supported = {
        item.key: item for item in evidence if item.decision == "supported"
    }

    prepared_by_id = {
        identity.profile.subject_id: identity for identity in prepared
    }
    mature_ids = {
        subject_id
        for subject_id, identity in prepared_by_id.items()
        if identity.profile.preferred_gallery_ready
    }
    adaptive_eligible_ids = {
        subject_id
        for subject_id, identity in prepared_by_id.items()
        if (
            identity.profile.retained_reference_count
            >= safe_config.adaptive_gallery_min
        )
    }
    adaptive_seed_ids = {
        subject_id
        for item in supported.values()
        if _is_adaptive_seed_edge(item, safe_config)
        for subject_id in item.key
        if subject_id in adaptive_eligible_ids
    }
    hard_seed_ids = {
        subject_id
        for item in supported.values()
        if item.hard_reference_match
        for subject_id in item.key
    }
    seed_ids = mature_ids | adaptive_seed_ids | hard_seed_ids
    seed_supported = {
        key: item
        for key, item in supported.items()
        if set(key) <= seed_ids
    }
    groups = _complete_link_robust_groups(sorted(seed_ids), seed_supported)
    groups, attachment_reviews = _attach_sparse_identities(
        groups,
        sorted(set(prepared_by_id) - seed_ids),
        supported,
        seed_ids,
        safe_config,
    )

    proposal_groups = [
        group
        for group in groups
        if (
            len(group) >= 2
            and len(group & seed_ids)
            >= safe_config.minimum_robust_anchors
        )
    ]
    proposals = []
    used_edges: set[tuple[str, str]] = set()
    contextual_edges: set[tuple[str, str]] = set()
    for group in sorted(
        proposal_groups,
        key=lambda members: tuple(sorted(members)),
    ):
        expected_keys = {
            _edge_key(left, right)
            for left, right in combinations(sorted(group), 2)
        }
        group_edges = [
            supported[key]
            for key in sorted(expected_keys)
            if key in supported
        ]
        contextual_pair_evidence = tuple(
            item
            for item in evidence
            if item.key in expected_keys and item.key not in supported
        )
        missing_pair_count = len(expected_keys) - len(group_edges)
        weakest = min(
            group_edges,
            key=lambda item: (
                item.pair_confidence,
                item.centroid_similarity,
                item.key,
            ),
        )
        canonical = _canonical_identity(group, prepared_by_id)
        source_ids = tuple(
            subject_id
            for subject_id in sorted(group)
            if subject_id != canonical.profile.subject_id
        )
        proposals.append(
            MergeProposal(
                target_subject_id=canonical.profile.subject_id,
                target_name=canonical.profile.name,
                source_subject_ids=source_ids,
                source_names=tuple(
                    prepared_by_id[subject_id].profile.name
                    for subject_id in source_ids
                ),
                member_subject_ids=tuple(sorted(group)),
                member_names=tuple(
                    prepared_by_id[subject_id].profile.name
                    for subject_id in sorted(group)
                ),
                robust_anchor_count=len(group & mature_ids),
                adaptive_anchor_count=len(
                    (group & seed_ids) - mature_ids
                ),
                seed_anchor_count=len(group & seed_ids),
                hard_reference_edge_count=sum(
                    1 for item in group_edges
                    if item.hard_reference_match
                ),
                weakest_pair_confidence=float(weakest.pair_confidence),
                weakest_pair=weakest.key,
                pair_count=len(group_edges),
                expected_pair_count=len(expected_keys),
                contextual_sparse_pair_count=missing_pair_count,
                contextual_sparse_pair_evidence=contextual_pair_evidence,
                explanation=(
                    "Nucleo de enlace completo y adjuntos sin chaining: "
                    "cada identidad dispersa tiene evidencia reciproca "
                    "directa contra todos los anclajes; "
                    f"{len(group & mature_ids)} anclajes maduros aportan "
                    f"{safe_config.preferred_gallery_min}-"
                    f"{safe_config.max_gallery_size} referencias y "
                    f"{len((group & seed_ids) - mature_ids)} anclajes "
                    "adaptativos aportan al menos "
                    f"{safe_config.adaptive_gallery_min} con evidencia "
                    "reforzada; "
                    f"{sum(1 for item in group_edges if item.hard_reference_match)} "
                    "enlaces tienen una referencia fuerte y representativa "
                    f"de al menos {safe_config.hard_reference_threshold:.2f}."
                ),
            )
        )
        used_edges |= {item.key for item in group_edges}
        contextual_edges |= expected_keys - set(supported)

    reviews = list(attachment_reviews)
    for item in evidence:
        if item.key in used_edges or item.key in contextual_edges:
            continue
        if item.decision == "supported":
            reason = "supported_pair_without_enough_robust_complete_link_anchors"
        else:
            reason = ",".join(item.reasons)
        reviews.append(
            ReviewItem(
                subject_ids=item.key,
                names=(item.left_name, item.right_name),
                reason=reason,
                pair_evidence=item,
            )
        )

    candidate_subjects = {
        subject_id
        for item in evidence
        for subject_id in item.key
    }
    isolated = tuple(
        sorted(set(prepared_by_id) - candidate_subjects)
    )
    return ReconciliationPlan(
        mode="dry_run",
        identity_count=len(identity_rows),
        eligible_identity_count=len(prepared),
        supplied_reference_count=supplied_reference_count,
        retained_reference_count=sum(
            len(identity.gallery) for identity in prepared
        ),
        vectorized_candidate_count=len(candidate_indexes),
        supported_pair_count=len(supported),
        gallery_profiles=tuple(
            identity.profile for identity in prepared
        ),
        excluded_identities=tuple(excluded),
        merge_proposals=tuple(proposals),
        review_items=tuple(reviews),
        isolated_subject_ids=isolated,
        config=safe_config,
    )
