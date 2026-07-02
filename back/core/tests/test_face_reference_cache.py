from types import SimpleNamespace

import numpy as np
import pytest
from django.test import override_settings
from django.utils import timezone

from core.services import face_insight


pytestmark = pytest.mark.api


def test_build_student_database_uses_cached_reference_embedding(tmp_path, monkeypatch):
    student = SimpleNamespace(
        id=1,
        full_name="Alumno Cache",
        photo=None,
        photo_url="https://example.test/alumno-cache.jpg",
        updated_at=timezone.now(),
    )
    progress = []

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("cached references must not call image loading or detection")

    with override_settings(MEDIA_ROOT=tmp_path):
        face_insight.save_reference_embedding_to_cache(student, np.ones(512, dtype=np.float32) * 3)
        monkeypatch.setattr(face_insight, "student_reference_path", fail_if_called)
        monkeypatch.setattr(face_insight, "detect_embeddings", fail_if_called)

        enrolled, matrix, skipped = face_insight.build_student_database(
            [student],
            providers_key="CPUExecutionProvider",
            progress_callback=lambda done, total, name, cached: progress.append((done, total, name, cached)),
        )

    assert enrolled == [student]
    assert skipped == []
    assert matrix.shape == (1, 512)
    assert np.isclose(np.linalg.norm(matrix[0]), 1.0)
    assert progress == [(1, 1, "Alumno Cache", True)]
