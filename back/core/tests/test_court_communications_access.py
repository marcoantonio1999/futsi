from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.response import Response

from core.models import WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppHumanResponseEvent, WhatsAppMessage
from core.tests.factories import make_site


pytestmark = [pytest.mark.api, pytest.mark.django_db]
BASE = "/api/whatsapp-conversations/"
FRANCO_ACADEMY = "meta:105039749242267"
FRANCO_LEAGUE = "meta:1187630384444567"
UVM = "whatsapp:+525574858165"


def conversation(address, site):
    return WhatsAppConversation.objects.create(
        to_address=address,
        site=site,
        contact_phone="+525511110000",
        from_address="whatsapp:+525511110000",
        current_step="faq",
        last_message_at=timezone.now(),
    )


def restricted_client(auth_client, site, channel):
    return auth_client(
        role="site_coordinator",
        primary_site=site,
        section_permissions=[
            "communications",
            "court_communications_only",
            f"whatsapp_channel:{channel}",
        ],
    )[0]


def test_restricted_coordinator_sees_only_the_assigned_number(auth_client):
    franco, uvm = make_site(name="Colegio Franco"), make_site(name="UVM")
    for address, label, site in (
        (FRANCO_ACADEMY, "Franco Academia", franco),
        (FRANCO_LEAGUE, "Liga Franco", franco),
        (UVM, "UVM", uvm),
    ):
        WhatsAppAutomationSettings.objects.create(
            business_address=address,
            channel_label=label,
            site=site,
        )
    academy = conversation(FRANCO_ACADEMY, franco)
    league = conversation(FRANCO_LEAGUE, franco)
    conversation(UVM, uvm)
    client = restricted_client(auth_client, franco, FRANCO_ACADEMY)

    assert client.get("/api/auth/me/").status_code == 200
    assert [row["id"] for row in client.get(BASE, {"scope": "all"}).json()] == [academy.id]
    assert [row["business_address"] for row in client.get(BASE + "channels/").json()] == [FRANCO_ACADEMY]
    assert client.get(BASE + f"{academy.id}/?scope=all").status_code == 200
    assert client.get(BASE + f"{league.id}/?scope=all").status_code == 404
    assert client.get(BASE, {"scope": "all", "business_address": FRANCO_LEAGUE}).json() == []
    assert [row["id"] for row in client.get("/api/sites/").json()] == [franco.id]


def test_restricted_coordinator_can_read_but_not_mutate_templates(auth_client):
    franco = make_site(name="Colegio Franco")
    WhatsAppAutomationSettings.objects.create(
        business_address=FRANCO_ACADEMY,
        channel_label="Franco Academia",
        site=franco,
    )
    client = restricted_client(auth_client, franco, FRANCO_ACADEMY)

    with patch(
        "core.api.template_catalog.catalog_for_channel",
        return_value={"business_address": FRANCO_ACADEMY, "templates": []},
    ) as catalog:
        response = client.get(BASE + "templates/", {"business_address": FRANCO_ACADEMY})
    assert response.status_code == 200
    catalog.assert_called_once()
    assert client.get(BASE + "templates/", {"business_address": FRANCO_LEAGUE}).status_code == 404
    assert client.post(
        BASE + "templates/",
        {"business_address": FRANCO_ACADEMY, "template": {"name": "forbidden"}},
        format="json",
    ).status_code == 403
    assert client.delete(
        BASE + "templates/",
        {"business_address": FRANCO_ACADEMY, "name": "forbidden"},
        format="json",
    ).status_code == 403


@pytest.mark.parametrize(
    "method,path",
    (
        ("get", "/api/users/"),
        ("get", "/api/dashboard/summary/"),
        ("get", "/api/veronica/inbox/"),
        ("get", "/api/trial-bookings/"),
        ("get", BASE + "export/"),
    ),
)
def test_restricted_coordinator_cannot_reach_other_sections(auth_client, method, path):
    site = make_site()
    client = restricted_client(auth_client, site, UVM)
    assert getattr(client, method)(path).status_code == 403


def test_restricted_coordinator_sees_only_own_channel_response_statistics(auth_client):
    franco, uvm = make_site(name="Colegio Franco"), make_site(name="UVM")
    for address, site, seconds in (
        (FRANCO_ACADEMY, franco, 60),
        (FRANCO_LEAGUE, franco, 600),
        (UVM, uvm, 1200),
    ):
        WhatsAppAutomationSettings.objects.create(business_address=address, site=site)
        chat = conversation(address, site)
        inbound = WhatsAppMessage.objects.create(conversation=chat, direction="inbound", body="Información")
        WhatsAppHumanResponseEvent.objects.create(
            conversation=chat,
            first_inbound_message=inbound,
            first_inbound_at=timezone.now(),
            responded_at=timezone.now(),
            response_seconds=seconds,
            human_attention_expected=True,
        )
    client = restricted_client(auth_client, franco, FRANCO_ACADEMY)

    response = client.get(BASE + "weekly-stats/", {"scope": "all"})
    assert response.status_code == 200
    assert response.json()["summary"]["total"] == 1
    assert response.json()["summary"]["average_response_seconds"] == 60
    assert client.get(BASE + "weekly-stats/", {"scope": "all", "site": uvm.id}).json()["summary"]["total"] == 0
    assert client.get(BASE + "weekly-stats/", {"scope": "all", "business_address": FRANCO_LEAGUE}).json()["summary"]["total"] == 0


def test_restricted_bulk_access_is_limited_to_own_channel(auth_client):
    franco = make_site(name="Colegio Franco")
    WhatsAppAutomationSettings.objects.create(business_address=FRANCO_ACADEMY, site=franco)
    WhatsAppAutomationSettings.objects.create(business_address=FRANCO_LEAGUE, site=franco)
    client = restricted_client(auth_client, franco, FRANCO_ACADEMY)

    service_channels = Response({"channels": [
        {"channel": FRANCO_ACADEMY, "label": "Franco Academia"},
        {"channel": FRANCO_LEAGUE, "label": "Liga Franco"},
        {"channel": UVM, "label": "UVM"},
    ]})
    with patch("core.api.bulk.BulkView.forward", return_value=service_channels) as forward:
        response = client.get("/api/whatsapp-bulk/channels/")
    assert response.status_code == 200
    assert [row["channel"] for row in response.json()["channels"]] == [FRANCO_ACADEMY]
    forward.assert_called_once()

    with patch("core.api.bulk.BulkView.forward", return_value=Response({"templates": []})) as forward:
        assert client.get("/api/whatsapp-bulk/catalog/", {"channel": FRANCO_ACADEMY}).status_code == 200
        assert client.get("/api/whatsapp-bulk/catalog/", {"channel": FRANCO_LEAGUE}).status_code == 403
        assert client.get("/api/veronica/bulk/channels/").status_code == 403
    assert forward.call_count == 1


def test_restricted_bulk_job_cannot_be_started_from_another_channel(auth_client):
    site = make_site()
    WhatsAppAutomationSettings.objects.create(business_address=FRANCO_ACADEMY, site=site)
    client = restricted_client(auth_client, site, FRANCO_ACADEMY)

    with patch(
        "core.api.bulk.BulkView.forward",
        return_value=Response({"id": "job-1", "channel": FRANCO_LEAGUE}),
    ) as forward:
        response = client.post("/api/whatsapp-bulk/start/", {"id": "job-1"}, format="json")
    assert response.status_code == 403
    assert forward.call_count == 1
    assert forward.call_args.args == ("academy", "detail")


def test_restricted_contact_audit_keeps_site_and_channel_scope(auth_client):
    own, other = make_site(), make_site()
    for address, site in ((FRANCO_ACADEMY, own), (FRANCO_LEAGUE, own), (UVM, other)):
        WhatsAppAutomationSettings.objects.create(business_address=address, site=site)
    client = restricted_client(auth_client, own, FRANCO_ACADEMY)
    with patch("core.services.whatsapp_contact_audit.contact_audit", return_value={}) as audit:
        assert client.get(BASE + "contact-audit/", {"scope": "all", "site": own.pk}).status_code == 200
        assert audit.call_args.args == ({FRANCO_ACADEMY},)
        assert client.get(BASE + "contact-audit/", {"scope": "all", "site": other.pk}).status_code == 200
        assert audit.call_args.args == (set(),)
        assert client.get(BASE + "contact-audit/", {"scope": "all", "business_address": FRANCO_LEAGUE}).status_code == 200
        assert audit.call_args.args == (set(),)


@pytest.mark.parametrize("operation", ["contact-audit", "quality-audit", "attention-notifications"])
def test_restricted_audits_and_notifications_are_read_only(auth_client, operation):
    client = restricted_client(auth_client, make_site(), UVM)
    assert client.post(BASE + operation + "/", {}, format="json").status_code == 403

