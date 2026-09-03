import asyncio

import pytest
from django.utils import timezone

from core.models import CallTranscriptSegment, VoiceCall
from core.voice.realtime import RealtimeBridge
from core.voice.scheduling import withdraw_voice_consent


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_withdrawing_consent_deletes_local_transcript_and_marks_call():
    call = VoiceCall.objects.create(
        call_sid="CA" + ("7" * 32),
        from_number="+525500000007",
        to_number="+14014090000",
        consent_granted=True,
        consent_granted_at=timezone.now(),
        extracted_data={"tool_results": {"private": {"child_first_name": "Leo"}}},
    )
    CallTranscriptSegment.objects.create(
        call=call,
        sequence=1,
        speaker="caller",
        text="Contenido que debe eliminarse.",
    )

    result = withdraw_voice_consent(voice_call_id=call.id)

    assert result["ok"] is True
    call.refresh_from_db()
    assert call.consent_granted is True
    assert call.consent_withdrawn_at is not None
    assert call.ai_outcome == "unsuccessful"
    assert "retiró el consentimiento" in call.failure_reason
    assert call.extracted_data == {
        "consent_withdrawn_at": call.consent_withdrawn_at.isoformat()
    }
    assert not call.transcript_segments.exists()


def test_withdraw_consent_tool_requests_shutdown_without_more_openai_output():
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    sent_openai_events = []

    async def successful_withdrawal(**_kwargs):
        return {"ok": True}

    async def capture_openai(payload):
        sent_openai_events.append(payload)

    bridge.execute_tool = successful_withdrawal
    bridge.send_openai = capture_openai

    handled = asyncio.run(
        bridge.handle_tool_event(
            {
                "name": "withdraw_consent",
                "call_id": "withdraw-1",
                "arguments": "{}",
            }
        )
    )

    assert handled is True
    assert bridge.shutdown_requested is True
    assert bridge.call_ending is True
    assert sent_openai_events == []
