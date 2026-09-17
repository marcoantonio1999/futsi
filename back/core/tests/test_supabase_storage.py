from io import BytesIO
from urllib.error import HTTPError, URLError
from unittest.mock import patch

import pytest

from core.services.supabase_storage import delete_private_file


pytestmark = pytest.mark.django_db


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


def test_delete_private_file_retries_transient_connection_errors(monkeypatch):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-secret")
    with patch(
        "core.services.supabase_storage.urlopen",
        side_effect=[URLError("temporary DNS failure"), Response()],
    ) as request, patch("core.services.supabase_storage.time.sleep") as sleep:
        assert delete_private_file("student-private-photos", "academy/photo.jpg") is True
    assert request.call_count == 2
    sleep.assert_called_once_with(0.25)


def test_delete_private_file_treats_missing_object_as_already_clean(monkeypatch):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-secret")
    missing = HTTPError("https://example.invalid", 404, "Not found", {}, BytesIO())
    with patch("core.services.supabase_storage.urlopen", side_effect=missing):
        assert delete_private_file("student-private-photos", "academy/missing.jpg") is False
