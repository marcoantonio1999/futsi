from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import patch

import pytest
from django.db import connection
from core.services.whatsapp_quality_report import QualityAudit
from core.models import WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppMessage
from core.tests.factories import make_site

pytestmark = [pytest.mark.api, pytest.mark.django_db(transaction=True)]
NOW = datetime(2026, 10, 9, 20, tzinfo=ZoneInfo("America/Mexico_City"))
URL = "/api/whatsapp-conversations/quality-audit/?scope=all&week_start=2026-10-05"


@pytest.fixture(autouse=True)
def private_table():
    with connection.schema_editor() as editor:
        editor.create_model(QualityAudit)
    yield
    with connection.schema_editor() as editor:
        editor.delete_model(QualityAudit)


def audited_chat(site, address):
    WhatsAppAutomationSettings.objects.create(site=site, business_address=address)
    chat = WhatsAppConversation.objects.create(site=site, to_address=address, contact_phone="+525500000001", from_address="whatsapp:+525500000001")
    message = WhatsAppMessage.objects.create(conversation=chat, direction="inbound", body="Informes")
    WhatsAppMessage.objects.filter(pk=message.pk).update(created_at=NOW-timedelta(hours=1))
    QualityAudit.objects.create(conversation_id=chat.pk, channel=address, period_end=NOW,
        rubric="commercial_v2", status="completed", model="gpt-6-luna", usage={},
        result={"commercial_initiative": "proactiva", "useful_response": "completa", "reasoning_effort": "high"})
    return chat


def test_admin_sees_all_scoped_sites_and_current_partial_week(auth_client):
    a, b = make_site(), make_site()
    audited_chat(a, "meta:123456789")
    audited_chat(b, "meta:987654321")
    client, _, _ = auth_client(role="admin")
    with patch("core.services.whatsapp_quality_report.timezone.now", return_value=NOW):
        response = client.get(URL)
    assert response.status_code == 200, response.content
    assert response.json()["total"] == 2
    assert response.json()["eligible"] == 2
    assert response.json()["provisional"] is True
    assert response.json()["model"] == ["gpt-6-luna"]
    assert response.json()["sites"][0]["proactive"] == 1
    assert not response.json()["outcomes_verified"]


def test_coordinator_cannot_read_other_sites(auth_client):
    own, other = make_site(), make_site()
    mine = audited_chat(own, "meta:123456789")
    audited_chat(other, "meta:987654321")
    client, _, _ = auth_client(role="site_coordinator", primary_site=own)
    response = client.get(URL)
    assert response.status_code == 200, response.content
    assert [row["conversation_id"] for row in response.json()["results"]] == [mine.pk]
    assert client.get(URL + f"&site={other.pk}").json()["total"] == 0


def test_restricted_coordinator_can_read_only_assigned_channel_audits(auth_client):
    own, other = make_site(), make_site()
    mine = audited_chat(own, "meta:123456789")
    audited_chat(own, "meta:987654321")
    audited_chat(other, "meta:112233445")
    client, _, _ = auth_client(role="site_coordinator", primary_site=own,
        section_permissions=["court_communications_only", "whatsapp_channel:meta:123456789"])
    response = client.get(URL + f"&site={own.pk}")
    assert response.status_code == 200, response.content
    assert [row["conversation_id"] for row in response.json()["results"]] == [mine.pk]
    assert client.get(URL + f"&site={other.pk}").json()["total"] == 0
    assert client.get(URL + "&business_address=meta:987654321").json()["total"] == 0


def test_invalid_page_and_anonymous_denied(auth_client, api_client):
    assert api_client.get(URL).status_code in [401, 403]
    client, _, _ = auth_client(role="admin")
    assert client.get(URL + "&offset=-1").status_code == 400


def test_newest_snapshot_replaces_earlier_display_without_double_count(auth_client):
    chat = audited_chat(make_site(), "meta:123456789")
    QualityAudit.objects.create(conversation_id=chat.pk, channel=chat.to_address,
        period_end=NOW.replace(hour=19), rubric="commercial_v2", status="completed",
        model="gpt-5.6-luna", result={}, usage={})
    client, _, _ = auth_client(role="admin")
    response = client.get(URL)
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["model"] == ["gpt-6-luna"]


def test_scores_exclude_non_applicable_and_keep_legacy_courtesy_unknown(auth_client):
    chat = audited_chat(make_site(), "meta:123456789")
    row = QualityAudit.objects.get(conversation_id=chat.pk)
    row.result.update(segment="prospecto", concrete_next_step="propuesto_sin_concretar", follow_up="no_necesario")
    row.usage = {"input_tokens": 1000, "output_tokens": 1000, "input_tokens_details": {"cached_tokens": 100}}
    row.save()
    client, _, _ = auth_client(role="admin")
    data = client.get(URL).json()
    assert data["scores"]["seller"]["score"] == 75
    assert data["scores"]["courtesy"]["score"] is None
    assert data["scores"]["follow_up"]["evaluated"] == 0
    assert data["cost"]["estimated_usd"] == .000591
    assert client.get(URL + "&segment=cliente_actual").json()["total"] == 0
    assert client.get(URL + "&segment=invalid").status_code == 400


def test_v3_is_preferred_and_evidence_cannot_leak_other_chats(auth_client):
    own, other = make_site(), make_site()
    mine = audited_chat(own, "meta:123456789")
    theirs = audited_chat(other, "meta:987654321")
    own_message = WhatsAppMessage.objects.get(conversation=mine)
    foreign_message = WhatsAppMessage.objects.get(conversation=theirs)
    own_message.body = "Contacto persona@example.com +525512345678"
    own_message.save()
    QualityAudit.objects.create(conversation_id=mine.pk, channel=mine.to_address, period_end=NOW,
        rubric="commercial_v3", status="completed", model="gpt-6-luna", usage={}, result={
            "courtesy": "respetuosa", "evidence_message_ids": [own_message.pk, foreign_message.pk]})
    client, _, _ = auth_client(role="site_coordinator", primary_site=own,
        section_permissions=["court_communications_only", "whatsapp_channel:meta:123456789"])
    data = client.get(URL + f"&conversation_id={mine.pk}").json()
    assert data["total"] == 1
    assert data["rubric"] == "commercial_v3"
    assert data["scores"]["courtesy"]["score"] == 100
    assert [message["id"] for message in data["evidence"]["messages"]] == [own_message.pk]
    assert "persona@example.com" not in data["evidence"]["messages"][0]["text"]
    assert "5512345678" not in data["evidence"]["messages"][0]["text"]
    assert client.get(URL + f"&conversation_id={theirs.pk}").json()["evidence"] is None
    assert client.get(URL + "&conversation_id=oops").status_code == 400
