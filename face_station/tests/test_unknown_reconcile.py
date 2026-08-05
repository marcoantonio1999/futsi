from __future__ import annotations

import json
from math import cos, radians, sin

import numpy as np
import pytest

from face_station.app.unknown_reconcile import (
    ReconciliationConfig,
    plan_unknown_reconciliation,
)


def unit(values) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


def portraits(anchor: np.ndarray, count: int, seed: int) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    results = []
    for _ in range(count):
        noise = rng.normal(size=anchor.shape).astype(np.float32)
        noise -= float(noise @ anchor) * anchor
        noise /= np.linalg.norm(noise)
        results.append(unit(0.95 * anchor + 0.312 * noise))
    return results


def build_snapshot(specifications):
    identities = []
    centroids = []
    reference_rows = []
    references = []
    for index, specification in enumerate(specifications):
        subject_id, name, anchor, reference_count, detections, quality = specification
        gallery = portraits(anchor, reference_count, 100 + index)
        identities.append(
            {
                "subject_id": subject_id,
                "temporary_name": name,
                "status": "consolidated",
                "detection_count": detections,
                "best_quality": quality,
            }
        )
        centroids.append(unit(np.mean(gallery, axis=0)) if gallery else anchor)
        for reference_index, embedding in enumerate(gallery):
            reference_rows.append(
                {
                    "subject_id": subject_id,
                    "reference_id": f"{subject_id}:{reference_index}",
                    "quality": quality - reference_index / 1000,
                }
            )
            references.append(embedding)
    return (
        identities,
        np.vstack(centroids),
        reference_rows,
        np.vstack(references),
    )


def test_current_cohort_is_one_complete_link_plan_and_13768_stays_isolated():
    rng = np.random.default_rng(42)
    person = unit(rng.normal(size=64))
    false_face = rng.normal(size=64)
    false_face -= float(false_face @ person) * person
    false_face = unit(false_face)

    specifications = []
    cohort_names = [
        "13896",
        "13898",
        "13929",
        "13930",
        "13937",
        "13958",
        "13959",
        "13963",
        "13964",
        "13977",
        "13978",
        "13996",
        "14003",
        "14047",
        "14053",
    ]
    gallery_sizes = [10, 10, 10, 2, 10, 10, 5, 10, 3, 1, 10, 4, 2, 10, 10]
    for index, (name, gallery_size) in enumerate(
        zip(cohort_names, gallery_sizes)
    ):
        identity_anchor = portraits(person, 1, 1000 + index)[0]
        specifications.append(
            (
                f"id-{name}",
                f"Desconocido {name}",
                identity_anchor,
                gallery_size,
                20_000 - index,
                0.90 - index / 1000,
            )
        )
    specifications.append(
        (
            "id-13768",
            "Desconocido 13768",
            false_face,
            1,
            12,
            0.71,
        )
    )

    snapshot = build_snapshot(specifications)
    plan = plan_unknown_reconciliation(*snapshot)

    assert plan.mode == "dry_run"
    assert len(plan.merge_proposals) == 1
    proposal = plan.merge_proposals[0]
    assert set(proposal.member_subject_ids) == {
        f"id-{name}" for name in cohort_names
    }
    assert proposal.target_subject_id == "id-13896"
    assert proposal.robust_anchor_count == 9
    assert proposal.pair_count == 105
    assert "id-13768" not in proposal.member_subject_ids
    assert "id-13768" in plan.isolated_subject_ids
    assert plan.supported_pair_count == 105


def test_complete_link_never_merges_an_unsafe_similarity_chain():
    angle = lambda degrees: unit(
        [cos(radians(degrees)), sin(radians(degrees)), 0.0]
    )
    anchors = {"a": angle(0), "b": angle(30), "c": angle(60)}
    identities = [
        {
            "subject_id": subject_id,
            "temporary_name": subject_id.upper(),
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        }
        for subject_id in anchors
    ]
    reference_rows = []
    references = []
    for subject_id, anchor in anchors.items():
        for index, direction in enumerate((-1.0, 1.0)):
            reference_rows.append(
                {
                    "subject_id": subject_id,
                    "quality": 0.8 - index / 100,
                }
            )
            references.append(
                unit(0.98 * anchor + np.asarray([0.0, 0.0, 0.20 * direction]))
            )
    snapshot = (
        identities,
        np.vstack(list(anchors.values())),
        reference_rows,
        np.vstack(references),
    )
    config = ReconciliationConfig(
        preferred_gallery_min=2,
        minimum_robust_anchors=2,
    )

    plan = plan_unknown_reconciliation(*snapshot, config=config)

    assert all(
        len(proposal.member_subject_ids) == 2
        for proposal in plan.merge_proposals
    )
    assert not any(
        set(proposal.member_subject_ids) == {"a", "b", "c"}
        for proposal in plan.merge_proposals
    )
    assert any(
        item.reason
        == "supported_pair_without_enough_robust_complete_link_anchors"
        for item in plan.review_items
    )


def test_single_representative_portrait_pair_can_seed_a_hard_merge():
    anchor = unit([1.0, 0.0, 0.0, 0.0])
    snapshot = build_snapshot(
        [
            ("sparse-a", "Sparse A", anchor, 1, 20, 0.8),
            ("sparse-b", "Sparse B", anchor, 1, 10, 0.7),
        ]
    )

    plan = plan_unknown_reconciliation(*snapshot)

    assert len(plan.merge_proposals) == 1
    assert plan.merge_proposals[0].hard_reference_edge_count == 1
    assert plan.review_items == ()


def test_four_reference_gallery_can_seed_a_strong_adaptive_merge():
    anchor = unit([1.0] + [0.0] * 63)
    snapshot = build_snapshot(
        [
            ("mature", "Mature", anchor, 10, 30, 0.8),
            ("adaptive", "Adaptive", anchor, 4, 20, 0.7),
        ]
    )

    plan = plan_unknown_reconciliation(
        *snapshot,
        config=ReconciliationConfig(hard_reference_threshold=0.99),
    )

    assert len(plan.merge_proposals) == 1
    proposal = plan.merge_proposals[0]
    assert set(proposal.member_subject_ids) == {"mature", "adaptive"}
    assert proposal.robust_anchor_count == 1
    assert proposal.adaptive_anchor_count == 1
    assert proposal.seed_anchor_count == 2
    assert plan.review_items == ()


def test_four_reference_gallery_stays_in_review_when_evidence_is_borderline():
    angle = lambda degrees: unit(
        [cos(radians(degrees)), sin(radians(degrees)), 0.0, 0.0]
    )
    snapshot = build_snapshot(
        [
            ("mature", "Mature", angle(0), 10, 30, 0.8),
            ("adaptive", "Adaptive", angle(45), 4, 20, 0.7),
        ]
    )

    plan = plan_unknown_reconciliation(
        *snapshot,
        config=ReconciliationConfig(hard_reference_threshold=0.99),
    )

    assert plan.merge_proposals == ()
    assert len(plan.review_items) == 1
    assert plan.review_items[0].pair_evidence is not None
    assert plan.review_items[0].pair_evidence.decision == "supported"
    assert (
        plan.review_items[0].reason
        == "supported_pair_without_enough_robust_complete_link_anchors"
    )


def test_representative_hard_reference_can_rescue_bad_centroids():
    left_reference = unit([1.0, 0.0, 0.0, 0.0])
    right_reference = unit([0.82, 0.5724, 0.0, 0.0])
    identities = [
        {
            "subject_id": "left",
            "temporary_name": "Left",
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        },
        {
            "subject_id": "right",
            "temporary_name": "Right",
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        },
    ]
    centroids = np.vstack(
        [unit([1.0, 0.0, 0.0, 0.0]), unit([0.0, 1.0, 0.0, 0.0])]
    )
    reference_rows = [
        {"subject_id": "left", "quality": 0.8},
        {"subject_id": "right", "quality": 0.8},
    ]
    references = np.vstack([left_reference, right_reference])

    plan = plan_unknown_reconciliation(
        identities,
        centroids,
        reference_rows,
        references,
    )

    assert plan.vectorized_candidate_count == 1
    assert len(plan.merge_proposals) == 1
    proposal = plan.merge_proposals[0]
    assert set(proposal.member_subject_ids) == {"left", "right"}
    assert proposal.hard_reference_edge_count == 1
    assert proposal.robust_anchor_count == 0
    assert proposal.seed_anchor_count == 2


def test_hard_reference_outlier_cannot_merge_a_contaminated_gallery():
    matching_reference = unit([1.0, 0.0, 0.0, 0.0])
    other_identity = unit([0.0, 1.0, 0.0, 0.0])
    identities = [
        {
            "subject_id": "contaminated",
            "temporary_name": "Contaminated",
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        },
        {
            "subject_id": "match",
            "temporary_name": "Match",
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        },
    ]
    centroids = np.vstack([other_identity, matching_reference])
    reference_rows = [
        {"subject_id": "contaminated", "quality": 0.8},
        {"subject_id": "contaminated", "quality": 0.7},
        {"subject_id": "match", "quality": 0.8},
    ]
    references = np.vstack(
        [matching_reference, other_identity, matching_reference]
    )

    plan = plan_unknown_reconciliation(
        identities,
        centroids,
        reference_rows,
        references,
    )

    assert plan.merge_proposals == ()
    assert len(plan.review_items) == 1
    evidence = plan.review_items[0].pair_evidence
    assert evidence is not None
    assert evidence.top_reference_similarity == pytest.approx(1.0)
    assert evidence.hard_reference_match is False
    assert "left_hard_reference_not_representative" in evidence.reasons


def test_reference_below_hard_threshold_does_not_rescue_bad_centroids():
    identities = [
        {
            "subject_id": "left",
            "temporary_name": "Left",
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        },
        {
            "subject_id": "right",
            "temporary_name": "Right",
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        },
    ]
    centroids = np.vstack(
        [unit([1.0, 0.0, 0.0, 0.0]), unit([0.0, 1.0, 0.0, 0.0])]
    )
    reference_rows = [
        {"subject_id": "left", "quality": 0.8},
        {"subject_id": "right", "quality": 0.8},
    ]
    references = np.vstack(
        [
            unit([1.0, 0.0, 0.0, 0.0]),
            unit([0.79, 0.6132, 0.0, 0.0]),
        ]
    )

    plan = plan_unknown_reconciliation(
        identities,
        centroids,
        reference_rows,
        references,
    )

    assert plan.vectorized_candidate_count == 0
    assert plan.merge_proposals == ()
    assert plan.review_items == ()


def test_sparse_portraits_attach_independently_to_robust_core_without_chaining():
    angle = lambda degrees: unit(
        [cos(radians(degrees)), sin(radians(degrees)), 0.0]
    )
    identities = [
        {
            "subject_id": subject_id,
            "temporary_name": subject_id,
            "status": "consolidated",
            "detection_count": 10,
            "best_quality": 0.8,
        }
        for subject_id in ("robust-a", "robust-b", "sparse-left", "sparse-right")
    ]
    centroids = np.vstack(
        [angle(0), angle(0), angle(-45), angle(45)]
    )
    reference_rows = []
    references = []
    for subject_id in ("robust-a", "robust-b"):
        for direction in (-1.0, 1.0):
            reference_rows.append(
                {"subject_id": subject_id, "quality": 0.8}
            )
            references.append(
                unit(
                    0.98 * angle(0)
                    + np.asarray([0.0, 0.0, 0.20 * direction])
                )
            )
    for subject_id, embedding in (
        ("sparse-left", angle(-45)),
        ("sparse-right", angle(45)),
    ):
        reference_rows.append({"subject_id": subject_id, "quality": 0.7})
        references.append(embedding)

    plan = plan_unknown_reconciliation(
        identities,
        centroids,
        reference_rows,
        np.vstack(references),
        config=ReconciliationConfig(
            preferred_gallery_min=2,
            minimum_robust_anchors=2,
        ),
    )

    assert len(plan.merge_proposals) == 1
    proposal = plan.merge_proposals[0]
    assert set(proposal.member_subject_ids) == {
        "robust-a",
        "robust-b",
        "sparse-left",
        "sparse-right",
    }
    assert proposal.robust_anchor_count == 2
    assert proposal.contextual_sparse_pair_count == 1
    assert proposal.pair_count == proposal.expected_pair_count - 1


def test_linked_and_ignored_identities_are_protected_from_reconciliation():
    anchor = unit([1.0, 0.0, 0.0, 0.0])
    identities, centroids, reference_rows, references = build_snapshot(
        [
            ("free", "Free", anchor, 8, 20, 0.8),
            ("linked", "Linked", anchor, 8, 20, 0.8),
            ("ignored", "Ignored", anchor, 8, 20, 0.8),
        ]
    )
    identities[1]["status"] = "linked"
    identities[1]["linked_person_key"] = "student:1"
    identities[2]["status"] = "ignored"

    plan = plan_unknown_reconciliation(
        identities,
        centroids,
        reference_rows,
        references,
    )

    assert plan.eligible_identity_count == 1
    assert {item.subject_id for item in plan.excluded_identities} == {
        "linked",
        "ignored",
    }
    assert plan.merge_proposals == ()


def test_plan_is_explainable_json_and_does_not_mutate_inputs():
    anchor = unit([1.0] + [0.0] * 63)
    identities, centroids, reference_rows, references = build_snapshot(
        [
            ("a", "A", anchor, 8, 20, 0.8),
            ("b", "B", anchor, 8, 10, 0.7),
        ]
    )
    original_centroids = centroids.copy()
    original_references = references.copy()

    plan = plan_unknown_reconciliation(
        identities,
        centroids,
        reference_rows,
        references,
    )
    serialized = plan.to_dict()

    assert json.loads(json.dumps(serialized))["mode"] == "dry_run"
    assert serialized["merge_proposals"][0]["explanation"].startswith(
        "Nucleo de enlace completo"
    )
    assert np.array_equal(centroids, original_centroids)
    assert np.array_equal(references, original_references)


def test_invalid_alignment_fails_closed():
    with pytest.raises(ValueError, match="misma longitud"):
        plan_unknown_reconciliation(
            [{"subject_id": "a"}],
            np.vstack([unit([1, 0]), unit([0, 1])]),
            [],
            np.empty((0, 2), dtype=np.float32),
        )
