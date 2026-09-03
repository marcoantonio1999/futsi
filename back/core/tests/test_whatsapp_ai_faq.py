import json
from unittest.mock import patch

import pytest
from django.test import override_settings

from core.models import WhatsAppConversation
from core.whatsapp.ai_faq import FOLLOW_UP_MARKER, answer_faq


pytestmark = [pytest.mark.api, pytest.mark.django_db]


class FakeOpenAIResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def _conversation():
    return WhatsAppConversation.objects.create(
        contact_phone="+525500000123",
        from_address="whatsapp:+525500000123",
        to_address="whatsapp:+15550001111",
        current_step="faq",
        context={"kind": "faq"},
    )


@override_settings(
    OPENAI_API_KEY="sk-test-futsi-whatsapp",
    OPENAI_WHATSAPP_MODEL="gpt-5.6-luna",
    OPENAI_WHATSAPP_FAQ_ENABLED=True,
    OPENAI_WHATSAPP_TIMEOUT_SECONDS=20,
)
def test_openai_faq_uses_responses_api_and_strips_internal_follow_up_marker():
    conversation = _conversation()
    api_result = {
        "model": "gpt-5.6-luna-2026-08-01",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": (
                            "No tengo ese dato confirmado. Una persona puede ayudarte 😊 "
                            + FOLLOW_UP_MARKER
                        ),
                    }
                ],
            }
        ],
        "usage": {"input_tokens": 120, "output_tokens": 25, "total_tokens": 145},
    }

    with patch(
        "core.whatsapp.ai_faq.urlopen",
        return_value=FakeOpenAIResponse(api_result),
    ) as open_url:
        answer = answer_faq(
            conversation=conversation,
            user_message="¿Cuánto cuesta la mensualidad?",
        )

    request = open_url.call_args.args[0]
    payload = json.loads(request.data.decode("utf-8"))
    assert request.full_url == "https://api.openai.com/v1/responses"
    assert payload["model"] == "gpt-5.6-luna"
    assert payload["store"] is False
    assert payload["input"][-1] == {
        "role": "user",
        "content": "¿Cuánto cuesta la mensualidad?",
    }
    assert len(payload["safety_identifier"]) == 64
    assert "No inventes precios" in payload["instructions"]
    assert "niños y niñas" in payload["instructions"]
    assert answer.needs_human is True
    assert FOLLOW_UP_MARKER not in answer.text
    assert answer.usage["total_tokens"] == 145
    assert answer.model == "gpt-5.6-luna-2026-08-01"


@override_settings(
    OPENAI_API_KEY="sk-test-futsi-whatsapp",
    OPENAI_WHATSAPP_MODEL="gpt-5.6-luna",
    OPENAI_WHATSAPP_FAQ_ENABLED=True,
    OPENAI_WHATSAPP_TIMEOUT_SECONDS=20,
)
def test_openai_faq_removes_unexpected_non_latin_words_but_keeps_emojis():
    api_result = {
        "model": "gpt-5.6-luna",
        "output_text": "¡Claro! Información sobre la academia ⚽ конусан",
        "usage": {"input_tokens": 20, "output_tokens": 10, "total_tokens": 30},
    }

    with patch(
        "core.whatsapp.ai_faq.urlopen",
        return_value=FakeOpenAIResponse(api_result),
    ):
        answer = answer_faq(
            conversation=_conversation(),
            user_message="Quiero información",
        )

    assert answer.text == "¡Claro! Información sobre la academia ⚽"
    assert "конусан" not in answer.text


@override_settings(
    OPENAI_API_KEY="",
    OPENAI_WHATSAPP_MODEL="gpt-5.6-luna",
    OPENAI_WHATSAPP_FAQ_ENABLED=True,
)
def test_openai_faq_has_warm_local_fallback_when_api_is_unavailable():
    answer = answer_faq(
        conversation=_conversation(),
        user_message="¿Qué edades reciben?",
    )

    assert "4 a 14 años" in answer.text
    assert "👧👦" in answer.text
    assert answer.needs_human is False


@override_settings(
    OPENAI_API_KEY="",
    OPENAI_WHATSAPP_MODEL="gpt-5.6-luna",
    OPENAI_WHATSAPP_FAQ_ENABLED=True,
)
def test_local_fallback_uses_business_tournament_answers():
    answer = answer_faq(
        conversation=_conversation(),
        user_message="¿Es Fut 7 o Fut 11?",
    )

    assert "Fut 8" in answer.text
    assert "⚽" in answer.text
    assert answer.needs_human is False
