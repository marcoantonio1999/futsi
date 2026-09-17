from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from core.models import WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent
from core.tests.factories import make_site

pytestmark = [pytest.mark.api, pytest.mark.django_db]
BASE = "/api/whatsapp-conversations/"
A, B, C = [f"whatsapp:+52550000010{i}" for i in (1, 2, 3)]
FRANCO_ACADEMY = "meta:105039749242267"


def conversation(address, site=None):
    return WhatsAppConversation.objects.create(to_address=address, site=site,
        contact_phone="+525511110000", from_address="whatsapp:+525511110000", current_step="faq",
        last_message_at=timezone.now())


def test_all_sites_and_explicit_number_are_not_limited_to_env(auth_client, settings):
    client, _, _ = auth_client()
    north, south = make_site(), make_site()
    settings.META_WHATSAPP_DISPLAY_NUMBER = A.replace("whatsapp:", "")
    WhatsAppAutomationSettings.objects.create(business_address=A, site=north)
    WhatsAppAutomationSettings.objects.create(business_address=B, site=south)
    first, second, unknown = conversation(A, north), conversation(B, north), conversation(C)
    rows = client.get(BASE, {"scope": "all"}).json()
    assert {row["id"] for row in rows} == {first.id, second.id, unknown.id}
    row = next(row for row in rows if row["id"] == second.id)
    assert row["business_address"] == B and row["channel_site"] == south.id
    assert row["manual_send_available"] is False
    for query, ids in [({"site": south.id}, [second.id]), ({"scope": "all", "business_address": A}, [first.id]),
                       ({"scope": "all", "site": "unassigned"}, [unknown.id]),
                       ({"scope": "all", "site": south.id, "business_address": A}, [])]:
        assert [r["id"] for r in client.get(BASE, query).json()] == ids
    assert client.get(BASE, {"business_address": "bad"}).status_code == 400
    assert client.get(BASE, {"scope": "all", "site": "bad"}).status_code == 400


def test_channels_include_empty_sites_and_enforce_coordinator_scope(auth_client, api_client):
    north, south = make_site(), make_site()
    WhatsAppAutomationSettings.objects.create(business_address=A, site=north)
    WhatsAppAutomationSettings.objects.create(business_address=B, site=south)
    WhatsAppAutomationSettings.objects.create(business_address=C, site=south)
    # A legacy wrong default must not expose the new channel to the old coordinator.
    foreign = conversation(B, north)
    own = conversation(A)
    admin, _, _ = auth_client()
    assert {r["business_address"] for r in admin.get(BASE + "channels/").json()} == {A, B, C}
    coord, _, _ = auth_client(role="site_coordinator", primary_site=north)
    assert [r["id"] for r in coord.get(BASE, {"scope": "all"}).json()] == [own.id]
    assert [r["business_address"] for r in coord.get(BASE + "channels/").json()] == [A]
    assert coord.get(BASE + f"{foreign.id}/?scope=all").status_code == 404
    assert coord.patch(BASE + f"{foreign.id}/?scope=all", {"follow_up_required": True}, format="json").status_code == 404
    assert coord.get(BASE, {"scope": "all", "site": south.id}).json() == []
    no_site, _, _ = auth_client(role="site_coordinator")
    assert no_site.get(BASE + "channels/").json() == []
    assert api_client.get(BASE + "channels/").status_code in (401, 403)


def test_channels_include_configured_number_without_history_for_admin(auth_client, settings):
    settings.META_WHATSAPP_DISPLAY_NUMBER = A.replace("whatsapp:", "")
    admin, _, _ = auth_client()

    assert admin.get(BASE + "channels/").json() == [{
        "business_address": A,
        "site": None,
        "site_name": "",
        "channel_label": "",
    }]


def test_meta_channel_can_be_linked_and_filtered_inside_one_site(auth_client):
    client, _, _ = auth_client()
    franco = make_site(name="Colegio Franco")
    WhatsAppAutomationSettings.objects.create(
        business_address=FRANCO_ACADEMY,
        channel_label="Franco Academia",
        site=franco,
    )
    chat = conversation(FRANCO_ACADEMY)
    veronica = conversation("meta:1100529023150528")
    veronica.context = {"kind": "veronica_manual"}
    veronica.save(update_fields=["context", "updated_at"])

    channels = client.get(BASE + "channels/").json()
    assert channels == [{
        "business_address": FRANCO_ACADEMY,
        "site": franco.id,
        "site_name": "Colegio Franco",
        "channel_label": "Franco Academia",
    }]
    assert [row["id"] for row in client.get(BASE, {"scope": "all"}).json()] == [chat.id]
    rows = client.get(BASE, {
        "scope": "all",
        "site": franco.id,
        "business_address": FRANCO_ACADEMY,
    }).json()
    assert [row["id"] for row in rows] == [chat.id]
    assert rows[0]["channel_site"] == franco.id
    assert rows[0]["channel_label"] == "Franco Academia"


def test_weekly_statistics_use_the_same_site_and_channel_scope(auth_client):
    client, _, _ = auth_client()
    sites = [make_site(), make_site()]
    for address, site, duration in zip((A, B), sites, (60, 600)):
        WhatsAppAutomationSettings.objects.create(business_address=address, site=site)
        chat = conversation(address, site)
        message = WhatsAppMessage.objects.create(conversation=chat, direction="inbound", body="Horario?", contact_type="prospect")
        WhatsAppHumanResponseEvent.objects.create(conversation=chat, first_inbound_message=message,
            first_inbound_at=timezone.now(), responded_at=timezone.now() + timedelta(seconds=duration), response_seconds=duration)
    total = client.get(BASE + "weekly-stats/", {"scope": "all"}).json()
    assert total["summary"]["total"] == 2 and total["summary"]["average_response_seconds"] == 330
    for site, address, duration in zip(sites, (A, B), (60, 600)):
        row = client.get(BASE + "weekly-stats/", {"scope": "all", "site": site.id, "business_address": address}).json()
        assert row["summary"]["total"] == 1
        assert row["summary"]["average_response_seconds"] == duration
        assert row["classifications"]["prospect"] == 1
    assert client.get(BASE + "weekly-stats/", {"scope": "all", "business_address": C}).json()["summary"]["total"] == 0


def test_manual_send_never_uses_another_sites_number(auth_client, settings):
    client, _, _ = auth_client()
    settings.META_WHATSAPP_DISPLAY_NUMBER = A.replace("whatsapp:", "")
    foreign = conversation(B)
    with patch("core.api.trials.send_text") as send:
        response = client.post(BASE + f"{foreign.pk}/send-message/?scope=all", {"body": "Hola"}, format="json")
    assert response.status_code == 409
    send.assert_not_called()
    assert foreign.messages.count() == 0
