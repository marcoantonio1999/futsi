import json
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import pytest
from django.test import override_settings
from core.whatsapp.model_catalog import list_models, supports_assistant, ModelCatalogError
from core.api.model_catalog import assistant_models


@pytest.mark.parametrize("model,expected", [
    ("gpt-4o-mini", True), ("gpt-4.1-2025-04-14", True),
    ("gpt-5.6-luna", True), ("gpt-6-astra", True), ("o3-mini", True),
    ("ft:gpt-4.1:org:custom:id", True),
    ("gpt-image-1", False), ("gpt-4o-audio-preview", False),
    ("gpt-4o-search-preview", False), ("o3-deep-research", False),
    ("gpt-5-codex", False), ("gpt-3.5-turbo-instruct", False),
    ("text-embedding-3-small", False), ("unknown", False),
])
def test_supported_families(model, expected):
    assert supports_assistant(model) is expected


def upstream(payload):
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
    return response


@override_settings(OPENAI_API_KEY="secret-test-key")
def test_catalog_reads_only_ids_and_never_generates():
    with patch("core.whatsapp.model_catalog.urlopen", return_value=upstream({"data": [
        {"id": "gpt-4.1", "owned_by": "private"}, {"id": "gpt-image-1"},
        {"id": "gpt-4.1"}, {"id": None}, "invalid",
    ]})) as read:
        result = list_models()
    assert result["models"] == [{"id": "gpt-4.1", "selectable": True}, {"id": "gpt-image-1", "selectable": False}]
    request = read.call_args.args[0]
    assert request.full_url == "https://api.openai.com/v1/models"
    assert request.method == "GET"
    assert request.data is None
    assert "secret-test-key" not in json.dumps(result)
    assert "private" not in json.dumps(result)


@override_settings(OPENAI_API_KEY="")
def test_missing_key_does_not_call_provider():
    with patch("core.whatsapp.model_catalog.urlopen") as read:
        with pytest.raises(ModelCatalogError):
            list_models()
        read.assert_not_called()


@pytest.mark.parametrize("error", [
    HTTPError("https://api.openai.com", 401, "secret-provider-error", {}, None),
    HTTPError("https://api.openai.com", 429, "secret-provider-error", {}, None),
    URLError("secret-provider-error"), ValueError("secret-provider-error"),
])
@override_settings(OPENAI_API_KEY="test")
def test_errors_are_safe(error):
    with patch("core.whatsapp.model_catalog.urlopen", side_effect=error):
        with pytest.raises(ModelCatalogError) as caught:
            list_models()
    assert "secret-provider-error" not in str(caught.value)


@override_settings(OPENAI_API_KEY="")
def test_malformed_response():
    with override_settings(OPENAI_API_KEY="test"), patch("core.whatsapp.model_catalog.urlopen", return_value=upstream({"error": "private"})):
        with pytest.raises(ModelCatalogError):
            list_models()


@override_settings(OPENAI_API_KEY="", WHATSAPP_SERVICE_URL="https://service.example", WHATSAPP_SERVICE_TOKEN="internal-test")
def test_remote_fallback_is_authenticated():
    with patch("core.api.model_catalog.urlopen", return_value=upstream({"models": [
        {"id": "gpt-4.1", "selectable": True, "secret": "never-forward"}
    ]})) as read:
        result = assistant_models()
    assert read.call_args.args[0].full_url == "https://service.example/api/internal/openai-models/"
    assert read.call_args.args[0].get_header("Authorization") == "Bearer internal-test"
    assert result == {"models": [{"id": "gpt-4.1", "selectable": True}], "source": "whatsapp-service"}


@pytest.mark.django_db
def test_endpoint_is_admin_only_and_read_only(auth_client, api_client):
    path = "/api/whatsapp-automation-settings/models/"
    with patch("core.api.model_catalog.assistant_models", return_value={"models": []}) as read:
        assert api_client.get(path).status_code in (401, 403)
        coordinator, _, _ = auth_client(role="site_coordinator")
        assert coordinator.get(path).status_code == 403
        read.assert_not_called()
        client, _, _ = auth_client()
        assert client.get(path).json() == {"models": []}
        assert client.patch(path, {}, format="json").status_code == 405
    with patch("core.api.model_catalog.assistant_models", side_effect=ModelCatalogError("Reintenta")):
        assert client.get(path).status_code == 503
