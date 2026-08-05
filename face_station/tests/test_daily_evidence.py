from __future__ import annotations

from datetime import datetime, timedelta
from random import Random

import numpy as np
import pytest

from face_station.app.daily_evidence import (
    DEFAULT_DAILY_EVIDENCE_LIMIT,
    EvidenceCandidate,
    select_daily_evidence,
)


BASE_TIME = datetime(2026, 7, 26, 9, 0, 0)


def _candidate(
    candidate_id,
    *,
    hour=9,
    minute=0,
    camera="raspberry",
    quality=0.70,
    embedding=None,
):
    return EvidenceCandidate(
        candidate_id=candidate_id,
        captured_at=BASE_TIME.replace(hour=hour, minute=minute),
        camera_key=camera,
        quality=quality,
        embedding=embedding,
    )


def test_defaults_to_thirty_and_keeps_best_quality_anchor():
    candidates = [
        _candidate(
            index,
            hour=9 + index // 10,
            minute=index % 10,
            quality=0.50 + index / 1000,
        )
        for index in range(50)
    ]
    candidates.append(
        _candidate("best", hour=12, minute=30, quality=0.99)
    )

    result = select_daily_evidence(candidates)

    assert result.summary.target_count == DEFAULT_DAILY_EVIDENCE_LIMIT == 30
    assert result.summary.retained_count == 30
    assert "best" in result.retained_ids
    assert result.reasons["best"] == "best_quality_anchor"
    assert result.summary.reason_counts["redundant_or_lower_value"] == 21


def test_covers_each_camera_when_capacity_allows():
    candidates = [
        _candidate("raspberry-best", camera="raspberry", quality=0.99),
        _candidate("raspberry-extra", camera="raspberry", quality=0.98),
        _candidate("dahua", camera="dahua", quality=0.61),
        _candidate("entrada", camera="entrada", quality=0.60),
    ]

    result = select_daily_evidence(candidates, limit=3)

    assert set(result.retained_ids) == {
        "raspberry-best",
        "dahua",
        "entrada",
    }
    assert result.reasons["dahua"] == "camera_coverage"
    assert result.reasons["entrada"] == "camera_coverage"
    assert result.summary.camera_count == 3
    assert result.summary.retained_camera_count == 3


def test_covers_distinct_hours_before_redundant_frames():
    candidates = [
        _candidate("nine-best", hour=9, minute=1, quality=0.99),
        _candidate("nine-repeat", hour=9, minute=2, quality=0.98),
        _candidate("noon", hour=12, quality=0.60),
        _candidate("evening", hour=20, quality=0.59),
    ]

    result = select_daily_evidence(candidates, limit=3)

    assert set(result.retained_ids) == {"nine-best", "noon", "evening"}
    assert result.reasons["noon"] == "temporal_coverage"
    assert result.reasons["evening"] == "temporal_coverage"
    assert result.reasons["nine-repeat"] == "redundant_or_lower_value"
    assert result.summary.temporal_bucket_count == 3
    assert result.summary.retained_temporal_bucket_count == 3


def test_tight_capacity_spreads_selection_across_day():
    candidates = [
        _candidate("anchor", hour=12, quality=1.0),
        _candidate("early", hour=9, quality=0.70),
        _candidate("near", hour=13, quality=0.95),
        _candidate("late", hour=22, quality=0.69),
    ]

    result = select_daily_evidence(candidates, limit=2)

    assert set(result.retained_ids) == {"anchor", "late"}


def test_embedding_diversity_beats_a_near_duplicate_when_quality_is_close():
    anchor = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    near_duplicate = np.array([0.999, 0.001, 0.0], dtype=np.float32)
    different_pose = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    candidates = [
        _candidate(
            "anchor",
            quality=1.0,
            embedding=anchor,
        ),
        _candidate(
            "duplicate",
            quality=0.99,
            embedding=near_duplicate,
        ),
        _candidate(
            "different",
            quality=0.98,
            embedding=different_pose,
        ),
    ]

    result = select_daily_evidence(candidates, limit=2)

    assert set(result.retained_ids) == {"anchor", "different"}
    assert result.reasons["different"] == "quality_diversity_fill"
    assert result.reasons["duplicate"] == "redundant_or_lower_value"


def test_missing_and_invalid_embeddings_remain_selectable():
    candidates = [
        _candidate("none", hour=9, quality=0.99, embedding=None),
        _candidate(
            "zero",
            hour=10,
            quality=0.90,
            embedding=np.zeros(3),
        ),
        _candidate(
            "valid",
            hour=11,
            quality=0.80,
            embedding=np.array([1.0, 0.0, 0.0]),
        ),
        _candidate(
            "wrong-dimension",
            hour=12,
            quality=0.70,
            embedding=np.array([1.0, 0.0]),
        ),
    ]

    result = select_daily_evidence(candidates, limit=4)
    decisions = {
        decision.candidate_id: decision for decision in result.decisions
    }

    assert set(result.retained_ids) == {
        "none",
        "zero",
        "valid",
        "wrong-dimension",
    }
    assert decisions["none"].embedding_available is False
    assert decisions["zero"].embedding_available is False
    assert decisions["valid"].embedding_available is True
    assert decisions["wrong-dimension"].embedding_available is False
    assert result.summary.embedding_count == 1


def test_mapping_input_aliases_and_iso_z_timestamp_are_supported():
    result = select_daily_evidence(
        [
            {
                "crop_id": 41,
                "observed_at": "2026-07-26T15:30:00Z",
                "camera": "dahua",
                "quality": 0.82,
                "embedding": None,
            }
        ]
    )

    assert result.retained_ids == (41,)
    assert result.decisions[0].captured_at.tzinfo is not None
    assert result.decisions[0].camera_key == "dahua"


def test_minimum_quality_explains_filtered_candidates():
    result = select_daily_evidence(
        [
            _candidate("acceptable", quality=0.80),
            _candidate("blurred", hour=10, quality=0.39),
        ],
        minimum_quality=0.40,
    )

    assert result.retained_ids == ("acceptable",)
    assert result.reasons["blurred"] == "below_minimum_quality"
    assert result.summary.eligible_count == 1
    assert result.summary.discarded_count == 1
    assert result.summary.reason_counts["below_minimum_quality"] == 1


def test_required_reference_is_retained_even_below_quality_floor():
    result = select_daily_evidence(
        [
            _candidate("protected", quality=0.20),
            _candidate("best", hour=10, quality=0.95),
            _candidate("other", hour=11, quality=0.90),
        ],
        limit=2,
        minimum_quality=0.50,
        required_ids=("protected",),
    )

    assert set(result.retained_ids) == {"protected", "best"}
    assert result.reasons["protected"] == "protected_reference"
    assert result.reasons["other"] == "redundant_or_lower_value"


def test_selection_is_deterministic_across_input_order():
    candidates = [
        _candidate(
            index,
            hour=9 + index // 4,
            minute=(index * 7) % 60,
            camera=("raspberry" if index % 2 else "dahua"),
            quality=0.60 + (index % 5) * 0.02,
            embedding=np.array(
                [1.0, index / 20.0, (index % 3) / 10.0],
                dtype=np.float32,
            ),
        )
        for index in range(20)
    ]
    expected = select_daily_evidence(candidates, limit=8)

    shuffled = candidates[:]
    Random(20260726).shuffle(shuffled)
    actual = select_daily_evidence(shuffled, limit=8)

    assert actual.retained_ids == expected.retained_ids
    assert dict(actual.reasons) == dict(expected.reasons)
    assert actual.summary.as_dict() == expected.summary.as_dict()


def test_retained_ids_are_chronological_and_summary_is_auditable():
    result = select_daily_evidence(
        [
            _candidate("late", hour=20, quality=0.90),
            _candidate("early", hour=9, quality=0.99),
            _candidate("middle", hour=14, quality=0.95),
        ],
        limit=3,
    )

    assert result.retained_ids == ("early", "middle", "late")
    assert result.discarded_ids == ()
    assert result.summary.retained_quality_min == pytest.approx(0.90)
    assert result.summary.retained_quality_mean == pytest.approx(
        (0.99 + 0.95 + 0.90) / 3
    )
    assert result.summary.retained_quality_max == pytest.approx(0.99)
    assert sum(result.summary.reason_counts.values()) == 3


def test_rejects_duplicate_ids_mixed_dates_and_invalid_configuration():
    duplicate = _candidate("same")
    with pytest.raises(ValueError, match="duplicado"):
        select_daily_evidence([duplicate, duplicate])

    with pytest.raises(ValueError, match="misma fecha"):
        select_daily_evidence(
            [
                _candidate("today"),
                EvidenceCandidate(
                    candidate_id="tomorrow",
                    captured_at=BASE_TIME + timedelta(days=1),
                    camera_key="raspberry",
                    quality=0.8,
                ),
            ]
        )

    with pytest.raises(ValueError, match="limit"):
        select_daily_evidence([], limit=0)

    with pytest.raises(ValueError, match="temporal_bucket_minutes"):
        select_daily_evidence([], temporal_bucket_minutes=0)
