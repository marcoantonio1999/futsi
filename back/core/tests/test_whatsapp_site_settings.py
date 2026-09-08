import json
from unittest.mock import patch
from urllib.parse import urlencode

import pytest
from django.test import override_settings
from core.models import AuditLog, WhatsAppAutomationSettings, WhatsAppConversation
from core.tests.factories import make_site
from core.whatsapp.ai_faq import answer_faq, _instructions

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def url(address):
    return "/api/whatsapp-automation-settings/current/?" + urlencode({"business_address": address})


def test_save_reload_two_sites_without_cross_over(auth_client):
    client, _, _ = auth_client()
    first, second = make_site(), make_site()
    for site, phone, model, instructions in [
        (first, "whatsapp:+525500000101", "gpt-5.6-luna", "Costo confirmado: 101 pesos."),
        (second, "whatsapp:+525500000102", "gpt-5.6-sol", "Costo confirmado: 202 pesos."),
    ]:
        response = client.patch(url(phone), {
            "site": site.pk, "openai_model": model,
            "assistant_instructions": instructions, "welcome_message": "Hola desde " + site.name,
            "business_days": [1, 3], "business_hours_start": "10:00", "business_hours_end": "17:00",
            "human_response_delay_seconds": 600,
        }, format="json")
        assert response.status_code == 200, response.content
        saved = client.get(url(phone)).json()
        assert saved["site"] == site.pk
        assert saved["effective_model"] == model
        assert saved["assistant_instructions"] == instructions
        assert saved["business_days"] == [1, 3]
        assert saved["business_hours_start"] == "10:00"
    rows = client.get("/api/whatsapp-automation-settings/").json()
    assert {r["site"] for r in rows if r["id"]} == {first.pk, second.pk}
    assert AuditLog.objects.filter(action="whatsapp_automation_settings_updated").count() == 2


def test_new_channel_requires_mapping_and_does_not_inherit_location(auth_client):
    client, _, _ = auth_client()
    phone = "whatsapp:+525500000199"
    response = client.get(url(phone))
    assert response.status_code == 200
    assert "Lomas Verdes" not in response.json()["assistant_instructions"]
    assert WhatsAppAutomationSettings.objects.count() == 0
    assert client.patch(url(phone), {"business_days": [1]}, format="json").status_code == 400
    assert WhatsAppAutomationSettings.objects.count() == 0


def test_settings_permissions_and_invalid_model(auth_client, api_client):
    path = url("whatsapp:+525500000199")
    assert api_client.get(path).status_code in (401, 403)
    coordinator, _, _ = auth_client(role="site_coordinator")
    assert coordinator.get(path).status_code == 403
    assert coordinator.patch(path, {}, format="json").status_code == 403
    client, _, _ = auth_client()
    site = make_site()
    for model in ("sk-secret", "bad model"):
        assert client.patch(path, {"site": site.pk, "openai_model": model}, format="json").status_code == 400
    assert WhatsAppAutomationSettings.objects.count() == 0


@override_settings(OPENAI_API_KEY="test-only", OPENAI_WHATSAPP_MODEL="legacy-model", OPENAI_WHATSAPP_FAQ_ENABLED=True)
def test_runtime_reads_saved_model_and_scoped_context():
    a, b = make_site(), make_site()
    for site, phone, model, context in [
        (a, "whatsapp:+525500000101", "model-a", "Contexto EXCLUSIVO_A"),
        (b, "whatsapp:+525500000102", "model-b", "Contexto EXCLUSIVO_B"),
    ]:
        WhatsAppAutomationSettings.objects.create(site=site, business_address=phone, openai_model=model,
            assistant_instructions=context, welcome_message="Hola de esta sede")
        conversation = WhatsAppConversation.objects.create(contact_phone="+525511112222",
            from_address="whatsapp:+525511112222", to_address=phone, current_step="faq")
        with patch("core.whatsapp.ai_faq.urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value = json.dumps({"output_text": "Respuesta"}).encode()
            answer_faq(conversation=conversation, user_message="Qué horarios hay?")
            payload = json.loads(request.call_args.args[0].data)
        assert payload["model"] == model
        assert context in payload["instructions"]
        assert ("EXCLUSIVO_B" if site == a else "EXCLUSIVO_A") not in payload["instructions"]
        assert "UVM Lomas Verdes" not in payload["instructions"]
        with override_settings(OPENAI_API_KEY=""):
            result = answer_faq(conversation=conversation, user_message="Qué edades aceptan?")
        assert result.needs_human
        assert "años" not in result.text
