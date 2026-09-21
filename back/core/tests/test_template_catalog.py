import json
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError

import pytest
from django.test import override_settings

from core.models import AuditLog, WhatsAppAutomationSettings
from core.tests.factories import make_site
from core.whatsapp.template_catalog import list_templates
from core.whatsapp.meta_api import MetaWhatsAppError
from core.api.template_catalog import catalog_for_channel, mutate_template_for_channel, template_mutation_available

A = "whatsapp:+525500000101"
URL = "/api/whatsapp-conversations/templates/"
CONFIG = dict(META_WHATSAPP_DISPLAY_NUMBER="+525500000101", META_WHATSAPP_PROVIDER="dualhook",
              DUALHOOK_WABA_ID="1234", DUALHOOK_API_KEY="secret-only-in-header", DUALHOOK_API_BASE_URL="https://api.dualhook.com", META_WHATSAPP_GRAPH_VERSION="v25.0")


@override_settings(**CONFIG)
def test_catalog_is_read_only_sanitized_and_uses_cursor_not_next_url():
    payload = {"data": [{"id": "1", "name": "aviso", "status": "APPROVED", "language": "es_MX", "category": "UTILITY",
                         "components": [{"type": "BODY", "text": "Hola {{1}}", "example": {"private": "sample"}}]}],
               "paging": {"next": "https://attacker.test/?access_token=secret", "cursors": {"after": "page-2"}}}
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
    with patch("core.whatsapp.template_catalog.urlopen", return_value=response) as fetch:
        result = list_templates(A, "page-1")
    request = fetch.call_args.args[0]
    assert request.method == "GET"
    assert request.full_url.startswith("https://api.dualhook.com/v25.0/1234/message_templates?")
    assert "after=page-1" in request.full_url
    assert request.get_header("Authorization") == "Bearer secret-only-in-header"
    assert result["next_cursor"] == "page-2"
    assert "secret" not in json.dumps(result) and "example" not in json.dumps(result)
    assert result["templates"][0]["components"][0]["text"] == "Hola {{1}}"


@override_settings(**CONFIG)
def test_other_phone_does_not_use_current_credentials():
    with patch("core.whatsapp.template_catalog.urlopen") as fetch, pytest.raises(MetaWhatsAppError):
        list_templates("whatsapp:+525500000102")
    fetch.assert_not_called()


@override_settings(**CONFIG)
def test_provider_failure_is_not_an_empty_catalog_or_leaked_response():
    with patch("core.whatsapp.template_catalog.urlopen", side_effect=HTTPError("url", 403, "private", {}, None)):
        with pytest.raises(MetaWhatsAppError, match="HTTP 403") as error:
            list_templates(A)
    assert "private" not in str(error.value)


@pytest.mark.django_db
def test_catalog_requires_authorized_channel(auth_client, api_client):
    north, south = make_site(), make_site()
    WhatsAppAutomationSettings.objects.create(business_address=A, site=north)
    WhatsAppAutomationSettings.objects.create(business_address="whatsapp:+525500000102", site=south)
    client, _, _ = auth_client(role="site_coordinator", primary_site=north)
    with patch("core.api.template_catalog.catalog_for_channel", return_value={"templates": [], "business_address": A}) as fetch:
        assert client.get(URL, {"business_address": A}).status_code == 200
        assert client.get(URL, {"business_address": "whatsapp:+525500000102"}).status_code == 404
        assert client.get(URL).status_code == 400
        assert client.get(URL, {"business_address": A, "after": "x" * 2049}).status_code == 400
        assert fetch.call_count == 1
    assert api_client.get(URL, {"business_address": A}).status_code in (401, 403)


@override_settings(WHATSAPP_SERVICE_URL="https://service.example.test", WHATSAPP_SERVICE_TOKEN="private", DUALHOOK_API_KEY="", META_WHATSAPP_ACCESS_TOKEN="")
def test_service_proxy_rejects_wrong_number_and_keeps_token_server_side():
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps({"business_address": "other", "templates": []}).encode()
    with patch("core.api.template_catalog.urlopen", return_value=response) as fetch:
        with pytest.raises(MetaWhatsAppError, match="no corresponde"):
            catalog_for_channel(A)
    assert "private" not in fetch.call_args.args[0].full_url
    assert fetch.call_args.args[0].method == "GET"


@override_settings(WHATSAPP_SERVICE_URL="https://service.example.test", WHATSAPP_SERVICE_TOKEN="private",
                   DUALHOOK_API_KEY="", META_WHATSAPP_ACCESS_TOKEN="", DUALHOOK_WABA_ID="")
def test_service_mutation_proxy_uses_server_token_and_exact_channel():
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps({"business_address": A, "id": "77", "status": "PENDING"}).encode()
    with patch("core.api.template_catalog.urlopen", return_value=response) as send:
        result = mutate_template_for_channel(A, method="POST", payload={"template": {"name": "prueba"}})
    request = send.call_args.args[0]
    assert request.method == "POST"
    assert request.full_url == "https://service.example.test/api/internal/templates/"
    assert request.get_header("Authorization") == "Bearer private"
    assert json.loads(request.data)["business_address"] == A
    assert result["id"] == "77"


@override_settings(**CONFIG, WHATSAPP_SERVICE_URL="", WHATSAPP_SERVICE_TOKEN="")
def test_template_mutation_requires_the_secure_service_even_with_direct_catalog_credentials():
    assert template_mutation_available(A) is False
    assert template_mutation_available("meta:other") is False


@override_settings(WHATSAPP_SERVICE_URL="https://service.example.test", WHATSAPP_SERVICE_TOKEN="private",
                   DUALHOOK_API_KEY="", META_WHATSAPP_ACCESS_TOKEN="", DUALHOOK_WABA_ID="")
def test_template_mutation_capability_accepts_secure_service_channels():
    assert template_mutation_available("meta:other") is True


@pytest.mark.django_db
def test_authorized_coordinator_can_create_and_delete_template(auth_client):
    site = make_site()
    WhatsAppAutomationSettings.objects.create(business_address=A, site=site)
    client, _, user = auth_client(role="site_coordinator", primary_site=site)
    created = {"business_address": A, "id": "77", "name": "prueba_futsi", "status": "PENDING", "language": "es_MX", "category": "MARKETING"}
    with patch("core.api.template_catalog.mutate_template_for_channel", return_value=created) as mutate:
        response = client.post(URL, {"business_address": A, "template": {"name": "prueba_futsi"}}, format="json")
        assert response.status_code == 201
        mutate.assert_called_once_with(A, method="POST", payload={"template": {"name": "prueba_futsi"}})
    assert AuditLog.objects.filter(actor=user, action="whatsapp_template_created").exists()
    with patch("core.api.template_catalog.mutate_template_for_channel", return_value={"business_address": A, "name": "prueba_futsi", "deleted": True}) as mutate:
        response = client.delete(URL, {"business_address": A, "name": "prueba_futsi"}, format="json")
        assert response.status_code == 200
        mutate.assert_called_once_with(A, method="DELETE", payload={"name": "prueba_futsi"})
    assert AuditLog.objects.filter(actor=user, action="whatsapp_template_deleted").exists()
