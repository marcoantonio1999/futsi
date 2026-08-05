from __future__ import annotations

import math
from dataclasses import FrozenInstanceError

import numpy as np
import pytest

import face_station.app.unknown_gallery as unknown_gallery_module
from face_station.app.unknown_gallery import (
    match_prepared_unknown_gallery,
    match_unknown_gallery,
    prepare_unknown_gallery,
    robust_reference_centroid,
    select_retained_reference_indices,
)


DIMENSIONS = 32


def basis(index: int) -> np.ndarray:
    value = np.zeros(DIMENSIONS, dtype=np.float32)
    value[index] = 1.0
    return value


def cosine_variant(anchor_index: int, orthogonal_index: int, cosine: float) -> np.ndarray:
    value = (
        float(cosine) * basis(anchor_index)
        + math.sqrt(1.0 - float(cosine) ** 2) * basis(orthogonal_index)
    )
    return value.astype(np.float32)


def test_retained_gallery_caps_twelve_and_excludes_duplicate_and_isolated_outlier():
    anchor = basis(0)
    duplicate = cosine_variant(0, 20, 0.99)
    coherent = [
        cosine_variant(0, index, 0.90)
        for index in range(1, 12)
    ]
    outlier = basis(31)
    embeddings = np.vstack([anchor, duplicate, *coherent, outlier])
    qualities = [0.96, 0.70, *np.linspace(0.90, 0.75, len(coherent)), 1.0]

    retained = select_retained_reference_indices(embeddings, qualities)

    assert len(retained) == 12
    assert 0 in retained
    assert 1 not in retained
    assert len(embeddings) - 1 not in retained
    assert len(set(retained)) == len(retained)
    assert all(float(embeddings[index] @ anchor) >= 0.50 for index in retained)


def test_duplicate_representative_is_the_highest_quality_sample():
    anchor = basis(0)
    better_duplicate = cosine_variant(0, 1, 0.99)
    different = cosine_variant(0, 2, 0.80)

    retained = select_retained_reference_indices(
        np.vstack([anchor, better_duplicate, different]),
        [0.70, 0.95, 0.80],
    )

    assert 0 not in retained
    assert retained == [1, 2]


def test_robust_centroid_ignores_even_a_high_quality_isolated_outlier():
    coherent = [
        basis(0),
        cosine_variant(0, 1, 0.92),
        cosine_variant(0, 2, 0.90),
        cosine_variant(0, 3, 0.88),
    ]
    outlier = basis(31)

    centroid = robust_reference_centroid(
        np.vstack([*coherent, outlier]),
        [0.90, 0.85, 0.80, 0.75, 10.0],
    )

    assert np.linalg.norm(centroid) == pytest.approx(1.0, abs=1e-6)
    assert float(centroid @ basis(0)) > 0.97
    assert float(centroid @ outlier) == pytest.approx(0.0, abs=1e-6)


def test_robust_centroid_supports_a_single_legacy_reference():
    reference = cosine_variant(0, 1, 0.73)

    centroid = robust_reference_centroid([reference], [0.40])

    assert np.allclose(centroid, reference)


def test_single_reference_gallery_preserves_legacy_threshold():
    query = cosine_variant(0, 1, 0.56)
    identity_rows = [{"subject_id": "legacy-one"}]
    reference_rows = [{"id": 1, "subject_id": "legacy-one", "quality": 0.9}]

    row, score, metadata = match_unknown_gallery(
        query,
        identity_rows,
        np.vstack([basis(0)]),
        reference_rows,
        np.vstack([basis(0)]),
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )

    assert row == identity_rows[0]
    assert score == pytest.approx(0.56, abs=1e-6)
    assert metadata["gallery_size"] == 1
    assert metadata["support_count"] == 1
    assert metadata["matched"] is True


def test_centroid_only_legacy_identity_remains_matchable():
    query = cosine_variant(0, 1, 0.60)

    row, score, metadata = match_unknown_gallery(
        query,
        [{"subject_id": "centroid-only"}],
        np.vstack([basis(0)]),
        [],
        np.empty((0, DIMENSIONS), dtype=np.float32),
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )

    assert row["subject_id"] == "centroid-only"
    assert score == pytest.approx(0.60, abs=1e-6)
    assert metadata["gallery_size"] == 1


def test_multi_reference_gallery_requires_two_distinct_confirmations():
    references = np.vstack(
        [
            basis(0),
            cosine_variant(0, 1, 0.60),
        ]
    )
    centroid = robust_reference_centroid(references, [0.9, 0.8])

    row, _score, metadata = match_unknown_gallery(
        basis(0),
        [{"subject_id": "needs-confirmation"}],
        np.vstack([centroid]),
        [
            {"id": 1, "subject_id": "needs-confirmation", "quality": 0.9},
            {"id": 2, "subject_id": "needs-confirmation", "quality": 0.8},
        ],
        references,
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )

    assert row is None
    assert metadata["gallery_size"] == 2
    assert metadata["support_count"] == 0
    assert metadata["reason"] == "insufficient_confirmation"


def test_multi_reference_gallery_aggregates_confirming_pair_and_centroid():
    references = np.vstack(
        [
            basis(0),
            cosine_variant(0, 1, 0.80),
            cosine_variant(0, 2, 0.75),
        ]
    )
    centroid = robust_reference_centroid(references, [0.9, 0.85, 0.8])

    row, score, metadata = match_unknown_gallery(
        basis(0),
        [{"subject_id": "confirmed"}],
        np.vstack([centroid]),
        [
            {"id": 1, "subject_id": "confirmed", "quality": 0.9},
            {"id": 2, "subject_id": "confirmed", "quality": 0.85},
            {"id": 3, "subject_id": "confirmed", "quality": 0.8},
        ],
        references,
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )

    expected = (1.0 + 0.80 + float(centroid @ basis(0))) / 3.0
    assert row["subject_id"] == "confirmed"
    assert score == pytest.approx(expected, abs=1e-6)
    assert metadata["support_count"] == 3
    assert metadata["second_reference_score"] == pytest.approx(0.80, abs=1e-6)


def test_near_duplicate_rows_do_not_create_false_multi_reference_confirmation():
    references = np.vstack([basis(0), cosine_variant(0, 1, 0.99)])

    row, score, metadata = match_unknown_gallery(
        basis(0),
        [{"subject_id": "deduplicated"}],
        np.vstack([basis(0)]),
        [
            {"id": 1, "subject_id": "deduplicated", "quality": 0.9},
            {"id": 2, "subject_id": "deduplicated", "quality": 0.8},
        ],
        references,
        threshold=0.55,
        confirmation_threshold=0.95,
        min_margin=0.03,
    )

    assert row["subject_id"] == "deduplicated"
    assert score == pytest.approx(1.0, abs=1e-6)
    assert metadata["gallery_size"] == 1
    assert metadata["support_count"] == 1


def test_reference_scores_are_grouped_before_identity_margin():
    identity_rows = [
        {"subject_id": "alpha"},
        {"subject_id": "beta"},
    ]
    alpha_references = [
        basis(0),
        cosine_variant(0, 1, 0.83),
    ]
    beta_references = [
        cosine_variant(0, 2, 0.80),
        cosine_variant(0, 3, 0.75),
    ]
    reference_rows = [
        {"id": 1, "subject_id": "alpha", "quality": 0.9},
        {"id": 2, "subject_id": "alpha", "quality": 0.8},
        {"id": 3, "subject_id": "beta", "quality": 0.9},
        {"id": 4, "subject_id": "beta", "quality": 0.8},
    ]
    alpha_centroid = robust_reference_centroid(alpha_references, [0.9, 0.8])
    beta_centroid = robust_reference_centroid(beta_references, [0.9, 0.8])

    row, _score, metadata = match_unknown_gallery(
        basis(0),
        identity_rows,
        np.vstack([alpha_centroid, beta_centroid]),
        reference_rows,
        np.vstack([*alpha_references, *beta_references]),
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )

    assert row["subject_id"] == "alpha"
    assert metadata["runner_up_score"] is not None
    assert metadata["margin"] >= 0.03


def test_identity_level_margin_rejects_ambiguous_galleries():
    query = (basis(0) + basis(1)) / math.sqrt(2.0)
    alpha_references = [
        basis(0),
        cosine_variant(0, 2, 0.90),
    ]
    beta_references = [
        basis(1),
        cosine_variant(1, 3, 0.90),
    ]

    row, score, metadata = match_unknown_gallery(
        query,
        [{"subject_id": "alpha"}, {"subject_id": "beta"}],
        np.vstack(
            [
                robust_reference_centroid(alpha_references, [0.9, 0.8]),
                robust_reference_centroid(beta_references, [0.9, 0.8]),
            ]
        ),
        [
            {"id": 1, "subject_id": "alpha", "quality": 0.9},
            {"id": 2, "subject_id": "alpha", "quality": 0.8},
            {"id": 3, "subject_id": "beta", "quality": 0.9},
            {"id": 4, "subject_id": "beta", "quality": 0.8},
        ],
        np.vstack([*alpha_references, *beta_references]),
        threshold=0.55,
        confirmation_threshold=0.60,
        min_margin=0.03,
    )

    assert row is None
    assert score > 0.55
    assert metadata["reason"] == "ambiguous_margin"
    assert metadata["margin"] == pytest.approx(0.0, abs=1e-6)


def test_isolated_wrong_reference_cannot_override_larger_coherent_core():
    correct_references = [
        basis(0),
        cosine_variant(0, 1, 0.82),
    ]
    wrong_core = [
        basis(5),
        cosine_variant(5, 6, 0.85),
        cosine_variant(5, 7, 0.82),
    ]
    isolated_wrong_reference = basis(0)
    reference_rows = [
        {"id": 1, "subject_id": "correct", "quality": 0.9},
        {"id": 2, "subject_id": "correct", "quality": 0.8},
        {"id": 3, "subject_id": "wrong", "quality": 0.9},
        {"id": 4, "subject_id": "wrong", "quality": 0.8},
        {"id": 5, "subject_id": "wrong", "quality": 0.7},
        {"id": 6, "subject_id": "wrong", "quality": 1.0},
    ]

    row, _score, metadata = match_unknown_gallery(
        basis(0),
        [{"subject_id": "correct"}, {"subject_id": "wrong"}],
        np.vstack(
            [
                robust_reference_centroid(correct_references, [0.9, 0.8]),
                robust_reference_centroid(wrong_core, [0.9, 0.8, 0.7]),
            ]
        ),
        reference_rows,
        np.vstack(
            [
                *correct_references,
                *wrong_core,
                isolated_wrong_reference,
            ]
        ),
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )

    assert row["subject_id"] == "correct"
    assert metadata["matched"] is True


def test_invalid_gallery_inputs_fail_closed():
    with pytest.raises(ValueError, match="qualities"):
        select_retained_reference_indices([basis(0)], [])

    with pytest.raises(ValueError, match="misma longitud"):
        match_unknown_gallery(
            basis(0),
            [{"subject_id": "one"}],
            np.empty((0, DIMENSIONS), dtype=np.float32),
            [],
            np.empty((0, DIMENSIONS), dtype=np.float32),
            threshold=0.55,
            confirmation_threshold=0.50,
            min_margin=0.03,
        )


def assert_match_results_equivalent(left, right):
    left_row, left_score, left_metadata = left
    right_row, right_score, right_metadata = right
    assert left_row == right_row
    assert left_score == pytest.approx(right_score, abs=1e-6)
    assert left_metadata.keys() == right_metadata.keys()
    for key, left_value in left_metadata.items():
        right_value = right_metadata[key]
        if isinstance(left_value, float) and right_value is not None:
            assert left_value == pytest.approx(right_value, abs=1e-6)
        else:
            assert left_value == right_value


@pytest.mark.parametrize(
    "query",
    [
        basis(0),
        cosine_variant(0, 4, 0.72),
        basis(5),
        basis(31),
    ],
)
def test_prepared_api_is_equivalent_to_compatibility_wrapper(query):
    alpha_references = [
        basis(0),
        cosine_variant(0, 1, 0.84),
        cosine_variant(0, 2, 0.99),
    ]
    beta_references = [
        basis(5),
        cosine_variant(5, 6, 0.82),
    ]
    identity_rows = [
        {"subject_id": "alpha", "name": "Alpha"},
        {"subject_id": "beta", "name": "Beta"},
        {"subject_id": "centroid-only", "name": "Legacy"},
    ]
    centroid_matrix = np.vstack(
        [
            robust_reference_centroid(alpha_references, [0.9, 0.8, 0.7]),
            robust_reference_centroid(beta_references, [0.9, 0.8]),
            basis(31),
        ]
    )
    reference_rows = [
        {"id": 1, "subject_id": "alpha", "quality": 0.9},
        {"id": 2, "subject_id": "alpha", "quality": 0.8},
        {"id": 3, "subject_id": "alpha", "quality": 0.7},
        {"id": 4, "subject_id": "beta", "quality": 0.9},
        {"id": 5, "subject_id": "beta", "quality": 0.8},
    ]
    reference_matrix = np.vstack([*alpha_references, *beta_references])
    prepared = prepare_unknown_gallery(
        identity_rows,
        centroid_matrix,
        reference_rows,
        reference_matrix,
    )

    prepared_result = match_prepared_unknown_gallery(
        query,
        prepared,
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )
    wrapper_result = match_unknown_gallery(
        query,
        identity_rows,
        centroid_matrix,
        reference_rows,
        reference_matrix,
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )

    assert_match_results_equivalent(prepared_result, wrapper_result)


def test_prepared_index_is_immutable_and_returns_fresh_rows():
    identities = [{"subject_id": "stable", "name": "Original"}]
    centroids = np.vstack([basis(0)])
    references = [{"id": 1, "subject_id": "stable", "quality": 0.9}]
    reference_matrix = np.vstack([basis(0)])
    prepared = prepare_unknown_gallery(
        identities,
        centroids,
        references,
        reference_matrix,
    )

    identities[0]["name"] = "Mutated input"
    centroids[0] = basis(1)
    reference_matrix[0] = basis(1)

    first_row, _score, _metadata = match_prepared_unknown_gallery(
        basis(0),
        prepared,
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )
    assert first_row["name"] == "Original"
    first_row["name"] = "Mutated result"
    second_row, _score, _metadata = match_prepared_unknown_gallery(
        basis(0),
        prepared,
        threshold=0.55,
        confirmation_threshold=0.70,
        min_margin=0.03,
    )
    assert second_row["name"] == "Original"

    with pytest.raises(TypeError):
        prepared._identity_rows[0]["name"] = "Forbidden"
    with pytest.raises(ValueError):
        prepared._score_matrix[0, 0] = 0.0
    with pytest.raises(ValueError):
        prepared._score_matrix.setflags(write=True)
    with pytest.raises(FrozenInstanceError):
        prepared.coherence_threshold = 0.60


def test_prepared_hot_path_benchmark_never_rebuilds_galleries(monkeypatch):
    rng = np.random.default_rng(20260724)
    dimensions = 64
    identity_count = 53
    identities = []
    centroids = []
    reference_rows = []
    reference_embeddings = []
    queries = []
    for identity_index in range(identity_count):
        anchor = rng.normal(size=dimensions).astype(np.float32)
        anchor /= np.linalg.norm(anchor)
        orthogonal = rng.normal(size=dimensions).astype(np.float32)
        orthogonal -= float(orthogonal @ anchor) * anchor
        orthogonal /= np.linalg.norm(orthogonal)
        companion = 0.85 * anchor + math.sqrt(1.0 - 0.85**2) * orthogonal
        subject_id = f"subject-{identity_index:03d}"
        identities.append({"subject_id": subject_id})
        centroids.append(
            robust_reference_centroid([anchor, companion], [0.9, 0.8])
        )
        reference_rows.extend(
            [
                {
                    "id": identity_index * 2,
                    "subject_id": subject_id,
                    "quality": 0.9,
                },
                {
                    "id": identity_index * 2 + 1,
                    "subject_id": subject_id,
                    "quality": 0.8,
                },
            ]
        )
        reference_embeddings.extend([anchor, companion])
        if identity_index < 8:
            queries.append(anchor)

    selector_calls = 0
    original_selector = unknown_gallery_module.select_retained_reference_indices

    def counted_selector(*args, **kwargs):
        nonlocal selector_calls
        selector_calls += 1
        return original_selector(*args, **kwargs)

    monkeypatch.setattr(
        unknown_gallery_module,
        "select_retained_reference_indices",
        counted_selector,
    )
    prepared = prepare_unknown_gallery(
        identities,
        np.vstack(centroids),
        reference_rows,
        np.vstack(reference_embeddings),
    )
    calls_after_prepare = selector_calls
    assert calls_after_prepare == identity_count

    def forbidden_matrix_normalization(*_args, **_kwargs):
        raise AssertionError("El hot path no debe normalizar la base otra vez.")

    monkeypatch.setattr(
        unknown_gallery_module,
        "_normalized_matrix",
        forbidden_matrix_normalization,
    )
    for query in queries:
        match_prepared_unknown_gallery(
            query,
            prepared,
            threshold=0.55,
            confirmation_threshold=0.70,
            min_margin=0.03,
        )

    assert selector_calls == calls_after_prepare
