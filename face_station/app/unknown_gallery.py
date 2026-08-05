from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations
from types import MappingProxyType
from typing import Mapping, Sequence

import numpy as np


_EPSILON = 1e-12
UNKNOWN_REFERENCE_LIMIT = 12
UNKNOWN_DUPLICATE_THRESHOLD = 0.97
UNKNOWN_COHERENCE_THRESHOLD = 0.50


def _validate_threshold(value: float, name: str) -> float:
    result = float(value)
    if not -1.0 <= result <= 1.0:
        raise ValueError(f"{name} debe estar entre -1 y 1.")
    return result


def _normalized_matrix(values, name: str, expected_width: int | None = None) -> np.ndarray:
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
            f"{name} debe tener embeddings de dimension {expected_width}, no {matrix.shape[1]}."
        )
    if not np.all(np.isfinite(matrix)):
        raise ValueError(f"{name} contiene valores no finitos.")
    norms = np.linalg.norm(matrix, axis=1)
    if np.any(norms <= _EPSILON):
        raise ValueError(f"{name} contiene un embedding sin norma.")
    return (matrix / norms[:, None]).astype(np.float32)


def _normalized_vector(value, name: str) -> np.ndarray:
    vector = np.asarray(value, dtype=np.float32)
    if vector.ndim != 1 or vector.size == 0:
        raise ValueError(f"{name} debe ser un vector no vacio.")
    if not np.all(np.isfinite(vector)):
        raise ValueError(f"{name} contiene valores no finitos.")
    norm = float(np.linalg.norm(vector))
    if norm <= _EPSILON:
        raise ValueError(f"{name} no puede tener norma cero.")
    return (vector / norm).astype(np.float32)


def _quality_values(qualities: Sequence[float], expected: int) -> np.ndarray:
    values = np.asarray(qualities, dtype=np.float32)
    if values.ndim != 1 or len(values) != expected:
        raise ValueError("qualities debe tener un valor por cada embedding.")
    if not np.all(np.isfinite(values)):
        raise ValueError("qualities contiene valores no finitos.")
    return values


def _coherent_medoid_index(
    matrix: np.ndarray,
    qualities: np.ndarray,
    candidate_indices: Sequence[int],
    coherence_threshold: float,
) -> int:
    candidates = list(candidate_indices)
    similarities = matrix[candidates] @ matrix[candidates].T
    ranking = []
    for local_index, original_index in enumerate(candidates):
        coherent_scores = similarities[local_index][
            similarities[local_index] >= coherence_threshold
        ]
        ranking.append(
            (
                len(coherent_scores),
                float(np.median(coherent_scores)),
                float(qualities[original_index]),
                -int(original_index),
                int(original_index),
            )
        )
    return max(ranking)[-1]


def select_retained_reference_indices(
    embeddings,
    qualities,
    limit: int = UNKNOWN_REFERENCE_LIMIT,
    duplicate_threshold: float = UNKNOWN_DUPLICATE_THRESHOLD,
    coherence_threshold: float = UNKNOWN_COHERENCE_THRESHOLD,
) -> list[int]:
    """Choose a coherent, quality-weighted and diverse reference gallery.

    Near-duplicate embeddings compete on quality before the coherent core is
    selected. Isolated high-quality samples cannot displace a larger coherent
    group. Returned indexes always refer to the original input order.
    """

    safe_limit = int(limit)
    if safe_limit < 1:
        raise ValueError("limit debe ser al menos 1.")
    duplicate_threshold = _validate_threshold(
        duplicate_threshold, "duplicate_threshold"
    )
    coherence_threshold = _validate_threshold(
        coherence_threshold, "coherence_threshold"
    )
    if duplicate_threshold < coherence_threshold:
        raise ValueError(
            "duplicate_threshold debe ser mayor o igual que coherence_threshold."
        )

    matrix = _normalized_matrix(embeddings, "embeddings")
    if len(matrix) == 0:
        if len(qualities) != 0:
            raise ValueError("qualities debe estar vacio cuando embeddings esta vacio.")
        return []
    quality_values = _quality_values(qualities, len(matrix))

    # The highest-quality representative wins inside each near-duplicate set.
    quality_order = sorted(
        range(len(matrix)),
        key=lambda index: (-float(quality_values[index]), index),
    )
    deduplicated: list[int] = []
    for index in quality_order:
        if any(
            float(matrix[index] @ matrix[kept]) >= duplicate_threshold
            for kept in deduplicated
        ):
            continue
        deduplicated.append(index)

    medoid_index = _coherent_medoid_index(
        matrix,
        quality_values,
        deduplicated,
        coherence_threshold,
    )
    core = [
        index
        for index in deduplicated
        if float(matrix[index] @ matrix[medoid_index]) >= coherence_threshold
    ]
    if len(core) <= safe_limit:
        return sorted(
            core,
            key=lambda index: (-float(quality_values[index]), index),
        )

    # Keep the strongest portrait and the medoid, then balance portrait quality
    # with novelty so ten nearly identical frames do not crowd out pose coverage.
    best_quality_index = max(
        core,
        key=lambda index: (float(quality_values[index]), -index),
    )
    selected = [best_quality_index]
    if medoid_index != best_quality_index and safe_limit > 1:
        selected.append(medoid_index)

    core_qualities = quality_values[core]
    quality_min = float(np.min(core_qualities))
    quality_span = float(np.max(core_qualities) - quality_min)

    while len(selected) < safe_limit:
        remaining = [index for index in core if index not in selected]
        if not remaining:
            break

        def selection_rank(index: int) -> tuple[float, float, float, int]:
            normalized_quality = (
                (float(quality_values[index]) - quality_min) / quality_span
                if quality_span > _EPSILON
                else 1.0
            )
            maximum_similarity = max(
                float(matrix[index] @ matrix[kept]) for kept in selected
            )
            diversity = max(0.0, min(1.0, 1.0 - maximum_similarity))
            combined = 0.65 * normalized_quality + 0.35 * diversity
            return (
                combined,
                diversity,
                float(quality_values[index]),
                -index,
            )

        selected.append(max(remaining, key=selection_rank))
    return selected


def robust_reference_centroid(
    embeddings,
    qualities,
    coherence_threshold: float = UNKNOWN_COHERENCE_THRESHOLD,
) -> np.ndarray:
    """Return a normalized quality-weighted centroid of the coherent core."""

    matrix = _normalized_matrix(embeddings, "embeddings")
    if len(matrix) == 0:
        raise ValueError("Se requiere al menos un embedding para calcular el centroide.")
    quality_values = _quality_values(qualities, len(matrix))
    retained = select_retained_reference_indices(
        matrix,
        quality_values,
        limit=len(matrix),
        duplicate_threshold=UNKNOWN_DUPLICATE_THRESHOLD,
        coherence_threshold=coherence_threshold,
    )
    retained_matrix = matrix[retained]
    weights = np.maximum(quality_values[retained], 0.05)
    centroid = np.average(retained_matrix, axis=0, weights=weights)
    norm = float(np.linalg.norm(centroid))
    if norm <= _EPSILON:
        raise ValueError("El nucleo coherente no produjo un centroide valido.")
    return (centroid / norm).astype(np.float32)


def _subject_id(row: dict, row_name: str) -> str:
    value = str(row.get("subject_id") or "").strip()
    if not value:
        raise ValueError(f"{row_name} no contiene subject_id.")
    return value


def _immutable_array(values: np.ndarray) -> np.ndarray:
    """Copy an array onto a bytes-backed buffer that stays read-only."""

    contiguous = np.ascontiguousarray(values)
    return np.frombuffer(
        contiguous.tobytes(order="C"),
        dtype=contiguous.dtype,
    ).reshape(contiguous.shape)


@dataclass(frozen=True, slots=True)
class PreparedUnknownGallery:
    """Immutable database-side index for repeated unknown-face matching."""

    _identity_rows: tuple[Mapping, ...]
    _subject_ids: tuple[str, ...]
    _score_matrix: np.ndarray
    _gallery_offsets: tuple[tuple[int, int], ...]
    _coherent_pairs: tuple[tuple[tuple[int, int], ...], ...]
    coherence_threshold: float

    @property
    def identity_count(self) -> int:
        return len(self._identity_rows)

    @property
    def reference_count(self) -> int:
        return int(self._score_matrix.shape[0] - self.identity_count)

    @property
    def embedding_dimension(self) -> int:
        return int(self._score_matrix.shape[1])


def _empty_match_metadata(reason: str) -> dict:
    return {
        "matched": False,
        "reason": reason,
        "subject_id": None,
        "gallery_size": 0,
        "support_count": 0,
        "best_reference_score": 0.0,
        "second_reference_score": None,
        "centroid_score": 0.0,
        "runner_up_score": None,
        "margin": 0.0,
        "candidate_count": 0,
    }


def _match_unknown_gallery_unprepared(
    embedding,
    identity_rows,
    centroid_matrix,
    reference_rows,
    reference_matrix,
    threshold,
    confirmation_threshold,
    min_margin,
    coherence_threshold: float = UNKNOWN_COHERENCE_THRESHOLD,
) -> tuple[dict | None, float, dict]:
    """Match an embedding against unknown identities using grouped galleries.

    An effective one-reference gallery retains the legacy threshold behavior.
    Multi-reference galleries require two distinct, mutually coherent
    references above ``confirmation_threshold``. Ranking and ambiguity margins
    are calculated between identities, never between two references belonging
    to the same identity.
    """

    query = _normalized_vector(embedding, "embedding")
    threshold = _validate_threshold(threshold, "threshold")
    confirmation_threshold = _validate_threshold(
        confirmation_threshold, "confirmation_threshold"
    )
    coherence_threshold = _validate_threshold(
        coherence_threshold, "coherence_threshold"
    )
    safe_margin = float(min_margin)
    if not 0.0 <= safe_margin <= 2.0:
        raise ValueError("min_margin debe estar entre 0 y 2.")

    identities = [dict(row) for row in identity_rows]
    centroids = _normalized_matrix(
        centroid_matrix,
        "centroid_matrix",
        expected_width=len(query),
    )
    if len(identities) != len(centroids):
        raise ValueError("identity_rows y centroid_matrix deben tener la misma longitud.")
    if not identities:
        return None, 0.0, _empty_match_metadata("empty_database")

    references = [dict(row) for row in reference_rows]
    reference_embeddings = _normalized_matrix(
        reference_matrix,
        "reference_matrix",
        expected_width=len(query),
    )
    if len(references) != len(reference_embeddings):
        raise ValueError("reference_rows y reference_matrix deben tener la misma longitud.")

    identity_by_subject: dict[str, tuple[dict, np.ndarray]] = {}
    for row, centroid in zip(identities, centroids):
        subject_id = _subject_id(row, "identity_rows")
        if subject_id in identity_by_subject:
            raise ValueError(f"identity_rows contiene subject_id duplicado: {subject_id}.")
        identity_by_subject[subject_id] = (row, centroid)

    reference_indexes_by_subject: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(references):
        subject_id = _subject_id(row, "reference_rows")
        if subject_id in identity_by_subject:
            reference_indexes_by_subject[subject_id].append(index)

    candidates = []
    for subject_id, (row, supplied_centroid) in identity_by_subject.items():
        centroid_score = float(supplied_centroid @ query)
        reference_indexes = reference_indexes_by_subject.get(subject_id, [])
        gallery_matrix = np.empty((0, len(query)), dtype=np.float32)
        gallery_scores = np.empty((0,), dtype=np.float32)
        if reference_indexes:
            subject_matrix = reference_embeddings[reference_indexes]
            qualities = [
                float(references[index].get("quality", 1.0) or 0.0)
                for index in reference_indexes
            ]
            retained_local = select_retained_reference_indices(
                subject_matrix,
                qualities,
                limit=UNKNOWN_REFERENCE_LIMIT,
                duplicate_threshold=UNKNOWN_DUPLICATE_THRESHOLD,
                coherence_threshold=coherence_threshold,
            )
            gallery_matrix = subject_matrix[retained_local]
            gallery_scores = gallery_matrix @ query

        gallery_size = len(gallery_matrix)
        best_reference_score = (
            float(np.max(gallery_scores)) if gallery_size else centroid_score
        )
        second_reference_score = None
        support_count = 1 if gallery_size <= 1 else 0
        eligible = False
        reason = "below_threshold"

        if gallery_size <= 1:
            # Centroid-only legacy rows and true one-reference galleries remain
            # matchable at the existing threshold.
            identity_score = max(centroid_score, best_reference_score)
            eligible = identity_score >= threshold
        else:
            confirming_pairs = []
            for first, second in combinations(range(gallery_size), 2):
                first_score = float(gallery_scores[first])
                second_score = float(gallery_scores[second])
                if (
                    first_score < confirmation_threshold
                    or second_score < confirmation_threshold
                    or float(gallery_matrix[first] @ gallery_matrix[second])
                    < coherence_threshold
                ):
                    continue
                confirming_pairs.append(
                    (
                        (first_score + second_score) / 2.0,
                        max(first_score, second_score),
                        min(first_score, second_score),
                        first,
                        second,
                    )
                )

            sorted_reference_scores = sorted(
                (float(value) for value in gallery_scores),
                reverse=True,
            )
            provisional_second = (
                sorted_reference_scores[1]
                if len(sorted_reference_scores) > 1
                else None
            )
            identity_score = (
                best_reference_score
                + (provisional_second if provisional_second is not None else best_reference_score)
                + centroid_score
            ) / 3.0
            if confirming_pairs:
                best_pair = max(confirming_pairs)
                best_reference_score = best_pair[1]
                second_reference_score = best_pair[2]
                support_count = sum(
                    1
                    for score in gallery_scores
                    if float(score) >= confirmation_threshold
                )
                identity_score = (
                    best_reference_score
                    + second_reference_score
                    + centroid_score
                ) / 3.0
                eligible = identity_score >= threshold
            else:
                second_reference_score = provisional_second
                reason = "insufficient_confirmation"

        candidates.append(
            {
                "row": row,
                "subject_id": subject_id,
                "score": float(identity_score),
                "eligible": bool(eligible),
                "reason": reason,
                "gallery_size": int(gallery_size or 1),
                "support_count": int(support_count),
                "best_reference_score": float(best_reference_score),
                "second_reference_score": (
                    float(second_reference_score)
                    if second_reference_score is not None
                    else None
                ),
                "centroid_score": float(centroid_score),
            }
        )

    candidates.sort(key=lambda item: (-item["score"], item["subject_id"]))
    eligible_candidates = [item for item in candidates if item["eligible"]]
    examined = eligible_candidates[0] if eligible_candidates else candidates[0]
    runner_scores = [
        item["score"]
        for item in candidates
        if item["subject_id"] != examined["subject_id"]
    ]
    runner_up_score = max(runner_scores) if runner_scores else -1.0
    margin = float(examined["score"] - runner_up_score)

    metadata = {
        "matched": False,
        "reason": examined["reason"],
        "subject_id": examined["subject_id"],
        "gallery_size": examined["gallery_size"],
        "support_count": examined["support_count"],
        "best_reference_score": examined["best_reference_score"],
        "second_reference_score": examined["second_reference_score"],
        "centroid_score": examined["centroid_score"],
        "runner_up_score": (
            float(runner_up_score) if runner_scores else None
        ),
        "margin": margin,
        "candidate_count": len(candidates),
    }
    if not eligible_candidates:
        return None, float(examined["score"]), metadata
    if margin < safe_margin:
        metadata["reason"] = "ambiguous_margin"
        return None, float(examined["score"]), metadata

    metadata["matched"] = True
    metadata["reason"] = "matched"
    return examined["row"], float(examined["score"]), metadata


def prepare_unknown_gallery(
    identity_rows,
    centroid_matrix,
    reference_rows,
    reference_matrix,
    coherence_threshold: float = UNKNOWN_COHERENCE_THRESHOLD,
) -> PreparedUnknownGallery:
    """Build an immutable index reusable across all crops in one DB snapshot."""

    coherence_threshold = _validate_threshold(
        coherence_threshold,
        "coherence_threshold",
    )
    identities = [dict(row) for row in identity_rows]
    centroids = _normalized_matrix(centroid_matrix, "centroid_matrix")
    if len(identities) != len(centroids):
        raise ValueError(
            "identity_rows y centroid_matrix deben tener la misma longitud."
        )
    if not identities:
        return PreparedUnknownGallery(
            _identity_rows=(),
            _subject_ids=(),
            _score_matrix=_immutable_array(
                np.empty((0, 0), dtype=np.float32)
            ),
            _gallery_offsets=(),
            _coherent_pairs=(),
            coherence_threshold=coherence_threshold,
        )

    references = [dict(row) for row in reference_rows]
    reference_embeddings = _normalized_matrix(
        reference_matrix,
        "reference_matrix",
        expected_width=centroids.shape[1],
    )
    if len(references) != len(reference_embeddings):
        raise ValueError(
            "reference_rows y reference_matrix deben tener la misma longitud."
        )

    subject_ids = []
    identity_by_subject = {}
    for row in identities:
        subject_id = _subject_id(row, "identity_rows")
        if subject_id in identity_by_subject:
            raise ValueError(
                f"identity_rows contiene subject_id duplicado: {subject_id}."
            )
        identity_by_subject[subject_id] = row
        subject_ids.append(subject_id)

    reference_indexes_by_subject: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(references):
        subject_id = _subject_id(row, "reference_rows")
        if subject_id in identity_by_subject:
            reference_indexes_by_subject[subject_id].append(index)

    retained_matrices = []
    gallery_offsets = []
    coherent_pairs = []
    score_offset = len(identities)
    for subject_id in subject_ids:
        reference_indexes = reference_indexes_by_subject.get(subject_id, [])
        if reference_indexes:
            subject_matrix = reference_embeddings[reference_indexes]
            qualities = [
                float(references[index].get("quality", 1.0) or 0.0)
                for index in reference_indexes
            ]
            retained_local = select_retained_reference_indices(
                subject_matrix,
                qualities,
                limit=UNKNOWN_REFERENCE_LIMIT,
                duplicate_threshold=UNKNOWN_DUPLICATE_THRESHOLD,
                coherence_threshold=coherence_threshold,
            )
            gallery_matrix = subject_matrix[retained_local]
        else:
            gallery_matrix = np.empty(
                (0, centroids.shape[1]),
                dtype=np.float32,
            )

        gallery_start = score_offset
        gallery_end = gallery_start + len(gallery_matrix)
        gallery_offsets.append((gallery_start, gallery_end))
        if len(gallery_matrix):
            retained_matrices.append(gallery_matrix)

        subject_pairs = []
        for first, second in combinations(range(len(gallery_matrix)), 2):
            if (
                float(gallery_matrix[first] @ gallery_matrix[second])
                >= coherence_threshold
            ):
                subject_pairs.append(
                    (gallery_start + first, gallery_start + second)
                )
        coherent_pairs.append(tuple(subject_pairs))
        score_offset = gallery_end

    if retained_matrices:
        retained_reference_matrix = np.vstack(retained_matrices).astype(
            np.float32,
            copy=False,
        )
        score_matrix = np.vstack([centroids, retained_reference_matrix])
    else:
        score_matrix = centroids

    return PreparedUnknownGallery(
        _identity_rows=tuple(
            MappingProxyType(dict(row))
            for row in identities
        ),
        _subject_ids=tuple(subject_ids),
        _score_matrix=_immutable_array(score_matrix),
        _gallery_offsets=tuple(gallery_offsets),
        _coherent_pairs=tuple(coherent_pairs),
        coherence_threshold=coherence_threshold,
    )


def match_prepared_unknown_gallery(
    embedding,
    prepared_gallery: PreparedUnknownGallery,
    threshold,
    confirmation_threshold,
    min_margin,
) -> tuple[dict | None, float, dict]:
    """Match one crop with only one dot-product pass and score aggregation."""

    if not isinstance(prepared_gallery, PreparedUnknownGallery):
        raise TypeError("prepared_gallery debe ser PreparedUnknownGallery.")
    query = _normalized_vector(embedding, "embedding")
    threshold = _validate_threshold(threshold, "threshold")
    confirmation_threshold = _validate_threshold(
        confirmation_threshold,
        "confirmation_threshold",
    )
    safe_margin = float(min_margin)
    if not 0.0 <= safe_margin <= 2.0:
        raise ValueError("min_margin debe estar entre 0 y 2.")
    if prepared_gallery.identity_count == 0:
        return None, 0.0, _empty_match_metadata("empty_database")
    if len(query) != prepared_gallery.embedding_dimension:
        raise ValueError(
            "embedding debe tener dimension "
            f"{prepared_gallery.embedding_dimension}, no {len(query)}."
        )

    all_scores = prepared_gallery._score_matrix @ query
    identity_scores = []
    eligible_flags = []
    reasons = []
    gallery_sizes = []
    support_counts = []
    best_reference_scores = []
    second_reference_scores = []

    for identity_index, (gallery_start, gallery_end) in enumerate(
        prepared_gallery._gallery_offsets
    ):
        centroid_score = float(all_scores[identity_index])
        gallery_scores = all_scores[gallery_start:gallery_end]
        gallery_size = len(gallery_scores)
        best_reference_score = (
            float(np.max(gallery_scores)) if gallery_size else centroid_score
        )
        second_reference_score = None
        support_count = 1 if gallery_size <= 1 else 0
        eligible = False
        reason = "below_threshold"

        if gallery_size <= 1:
            identity_score = max(centroid_score, best_reference_score)
            eligible = identity_score >= threshold
        else:
            sorted_reference_scores = sorted(
                (float(value) for value in gallery_scores),
                reverse=True,
            )
            provisional_second = sorted_reference_scores[1]
            identity_score = (
                best_reference_score + provisional_second + centroid_score
            ) / 3.0
            best_pair = None
            for first, second in prepared_gallery._coherent_pairs[identity_index]:
                first_score = float(all_scores[first])
                second_score = float(all_scores[second])
                if (
                    first_score < confirmation_threshold
                    or second_score < confirmation_threshold
                ):
                    continue
                candidate_pair = (
                    (first_score + second_score) / 2.0,
                    max(first_score, second_score),
                    min(first_score, second_score),
                    first,
                    second,
                )
                if best_pair is None or candidate_pair > best_pair:
                    best_pair = candidate_pair

            if best_pair is not None:
                best_reference_score = best_pair[1]
                second_reference_score = best_pair[2]
                support_count = sum(
                    1
                    for score in gallery_scores
                    if float(score) >= confirmation_threshold
                )
                identity_score = (
                    best_reference_score
                    + second_reference_score
                    + centroid_score
                ) / 3.0
                eligible = identity_score >= threshold
            else:
                second_reference_score = provisional_second
                reason = "insufficient_confirmation"

        identity_scores.append(float(identity_score))
        eligible_flags.append(bool(eligible))
        reasons.append(reason)
        gallery_sizes.append(int(gallery_size or 1))
        support_counts.append(int(support_count))
        best_reference_scores.append(float(best_reference_score))
        second_reference_scores.append(
            float(second_reference_score)
            if second_reference_score is not None
            else None
        )

    candidate_indexes = range(prepared_gallery.identity_count)
    eligible_indexes = [
        index for index in candidate_indexes if eligible_flags[index]
    ]
    examined_pool = (
        eligible_indexes
        if eligible_indexes
        else range(prepared_gallery.identity_count)
    )
    examined_index = min(
        examined_pool,
        key=lambda index: (
            -identity_scores[index],
            prepared_gallery._subject_ids[index],
        ),
    )
    runner_scores = [
        identity_scores[index]
        for index in range(prepared_gallery.identity_count)
        if index != examined_index
    ]
    runner_up_score = max(runner_scores) if runner_scores else -1.0
    margin = float(identity_scores[examined_index] - runner_up_score)

    metadata = {
        "matched": False,
        "reason": reasons[examined_index],
        "subject_id": prepared_gallery._subject_ids[examined_index],
        "gallery_size": gallery_sizes[examined_index],
        "support_count": support_counts[examined_index],
        "best_reference_score": best_reference_scores[examined_index],
        "second_reference_score": second_reference_scores[examined_index],
        "centroid_score": float(all_scores[examined_index]),
        "runner_up_score": (
            float(runner_up_score) if runner_scores else None
        ),
        "margin": margin,
        "candidate_count": prepared_gallery.identity_count,
    }
    if not eligible_indexes:
        return None, identity_scores[examined_index], metadata
    if margin < safe_margin:
        metadata["reason"] = "ambiguous_margin"
        return None, identity_scores[examined_index], metadata

    metadata["matched"] = True
    metadata["reason"] = "matched"
    return (
        dict(prepared_gallery._identity_rows[examined_index]),
        identity_scores[examined_index],
        metadata,
    )


def match_unknown_gallery(
    embedding,
    identity_rows,
    centroid_matrix,
    reference_rows,
    reference_matrix,
    threshold,
    confirmation_threshold,
    min_margin,
    coherence_threshold: float = UNKNOWN_COHERENCE_THRESHOLD,
) -> tuple[dict | None, float, dict]:
    """Compatibility wrapper that prepares the database and matches one crop."""

    prepared_gallery = prepare_unknown_gallery(
        identity_rows,
        centroid_matrix,
        reference_rows,
        reference_matrix,
        coherence_threshold=coherence_threshold,
    )
    return match_prepared_unknown_gallery(
        embedding,
        prepared_gallery,
        threshold=threshold,
        confirmation_threshold=confirmation_threshold,
        min_margin=min_margin,
    )
