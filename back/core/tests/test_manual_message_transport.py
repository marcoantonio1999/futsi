import json
from unittest.mock import MagicMock, patch

import pytest
from django.test import override_settings

from core.api.manual_message_transport import send_text_for_channel


pytestmark = pytest.mark.django_db


@override_settings(
    META_WHATSAPP_DISPLAY_NUMBER="+525500000101",
    WHATSAPP_SERVICE_URL="https://service.example",
    WHATSAPP_SERVICE_TOKEN="internal-only",
)
def test_remote_text_transport_keeps_channel_and_token_server_side():
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps(
        {"message_id": "wamid.remote"}
    ).encode()
    with patch("core.api.manual_message_transport.urlopen", return_value=response) as fetch:
        result = send_text_for_channel(
            address="meta:105039749242267",
            to_phone="+525511110000",
            body="Respuesta desde la bandeja",
        )

    assert result == "wamid.remote"
    request = fetch.call_args.args[0]
    assert request.full_url == "https://service.example/api/internal/text-send/"
    assert request.get_header("Authorization") == "Bearer internal-only"
    assert json.loads(request.data) == {
        "business_address": "meta:105039749242267",
        "to_phone": "+525511110000",
        "body": "Respuesta desde la bandeja",
    }
    assert "internal-only" not in request.full_url
