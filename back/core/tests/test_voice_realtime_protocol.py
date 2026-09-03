from __future__ import annotations

import asyncio
import base64
import json

from core.voice import realtime as realtime_module
from core.voice.realtime import RealtimeBridge


def test_turn_detection_uses_noise_resistant_server_vad(settings):
    settings.OPENAI_REALTIME_VAD_THRESHOLD = 0.75
    settings.OPENAI_REALTIME_VAD_PREFIX_PADDING_MS = 400
    settings.OPENAI_REALTIME_VAD_SILENCE_DURATION_MS = 700

    assert realtime_module.realtime_turn_detection_config() == {
        "type": "server_vad",
        "threshold": 0.75,
        "prefix_padding_ms": 400,
        "silence_duration_ms": 700,
        "create_response": True,
        "interrupt_response": True,
    }


def test_conversation_item_sequences_are_reserved_before_transcripts_finish():
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=7,
    )

    assert bridge.reserve_item_sequence("caller-first") == 8
    assert bridge.reserve_item_sequence("caller-second") == 9
    assert bridge.reserve_item_sequence("caller-first") == 8
    assert bridge.sequence == 9


def test_session_configuration_is_confirmed_before_the_first_response():
    bridge = RealtimeBridge(
        voice_call_id=42,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    sent_events = []

    class FakeOpenAIWebSocket:
        def __init__(self):
            self.events = iter(
                [
                    json.dumps({"type": "session.created"}),
                    json.dumps({"type": "session.updated"}),
                ]
            )

        async def recv(self):
            return next(self.events)

    async def capture_openai(payload):
        sent_events.append(payload)

    bridge.openai_ws = FakeOpenAIWebSocket()
    bridge.send_openai = capture_openai
    asyncio.run(
        bridge.configure_openai_session(
            {"type": "realtime", "model": "gpt-realtime-2.1"}
        )
    )

    assert sent_events == [
        {
            "event_id": "futsi-session-42",
            "type": "session.update",
            "session": {
                "type": "realtime",
                "model": "gpt-realtime-2.1",
            },
        }
    ]


def test_twilio_marks_bound_realtime_audio_truncation(monkeypatch):
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    twilio_events = []
    openai_events = []

    async def capture_twilio(payload):
        twilio_events.append(payload)
        return True

    async def capture_openai(payload):
        openai_events.append(payload)

    async def ignore_transcript_update(**_kwargs):
        return None

    monkeypatch.setattr(
        realtime_module,
        "_mark_assistant_transcript_interrupted",
        ignore_transcript_update,
    )
    bridge.send_twilio = capture_twilio
    bridge.send_openai = capture_openai
    audio_delta = base64.b64encode(b"\xff" * 800).decode("ascii")

    asyncio.run(
        bridge.forward_audio_delta(
            {
                "type": "response.output_audio.delta",
                "item_id": "item-audio-1",
                "content_index": 0,
                "delta": audio_delta,
            }
        )
    )
    first_mark = twilio_events[-1]["mark"]["name"]
    bridge.acknowledge_twilio_mark(first_mark)

    asyncio.run(
        bridge.forward_audio_delta(
            {
                "type": "response.output_audio.delta",
                "item_id": "item-audio-1",
                "content_index": 0,
                "delta": audio_delta,
            }
        )
    )
    asyncio.run(bridge.interrupt_assistant_audio())

    assert twilio_events[-1] == {
        "event": "clear",
        "streamSid": "MZ-test-stream",
    }
    assert openai_events[-1] == {
        "type": "conversation.item.truncate",
        "item_id": "item-audio-1",
        "content_index": 0,
        "audio_end_ms": 100,
    }
    assert bridge.pending_marks == {}


def test_fully_played_audio_is_not_truncated_on_the_next_caller_turn(monkeypatch):
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    twilio_events = []
    openai_events = []

    async def capture_twilio(payload):
        twilio_events.append(payload)
        return True

    async def capture_openai(payload):
        openai_events.append(payload)

    async def ignore_transcript_update(**_kwargs):
        return None

    monkeypatch.setattr(
        realtime_module,
        "_mark_assistant_transcript_interrupted",
        ignore_transcript_update,
    )
    bridge.send_twilio = capture_twilio
    bridge.send_openai = capture_openai
    audio_delta = base64.b64encode(b"\xff" * 800).decode("ascii")

    asyncio.run(
        bridge.forward_audio_delta(
            {
                "type": "response.output_audio.delta",
                "item_id": "item-complete",
                "content_index": 0,
                "delta": audio_delta,
            }
        )
    )
    mark_name = twilio_events[-1]["mark"]["name"]
    bridge.mark_audio_generation_done("item-complete")
    bridge.acknowledge_twilio_mark(mark_name)
    events_before_next_turn = list(twilio_events)

    asyncio.run(bridge.interrupt_assistant_audio())

    assert bridge.last_audio_item_id == ""
    assert twilio_events == events_before_next_turn
    assert openai_events == []
    assert bridge.truncated_item_ids == set()


def test_tools_run_only_after_a_completed_response_done_event():
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    handled_calls = []
    openai_events = []

    class FakeOpenAIWebSocket:
        async def __aiter__(self):
            events = [
                {
                    "type": "response.function_call_arguments.done",
                    "name": "book_trial",
                    "call_id": "call-too-early",
                    "arguments": "{}",
                },
                {
                    "type": "response.done",
                    "response": {
                        "status": "cancelled",
                        "output": [
                            {
                                "type": "function_call",
                                "status": "completed",
                                "name": "book_trial",
                                "call_id": "call-cancelled",
                                "arguments": "{}",
                            }
                        ],
                    },
                },
                {
                    "type": "response.done",
                    "response": {
                        "status": "completed",
                        "output": [
                            {
                                "type": "function_call",
                                "status": "completed",
                                "name": "book_trial",
                                "call_id": "call-ready",
                                "arguments": "{}",
                            },
                            {
                                "type": "function_call",
                                "status": "incomplete",
                                "name": "record_call_outcome",
                                "call_id": "call-incomplete",
                                "arguments": "{}",
                            },
                        ],
                    },
                },
            ]
            for event in events:
                yield json.dumps(event)

    async def capture_tool(event):
        handled_calls.append(event["call_id"])
        return True

    async def capture_openai(payload):
        openai_events.append(payload)

    bridge.openai_ws = FakeOpenAIWebSocket()
    bridge.handle_tool_event = capture_tool
    bridge.send_openai = capture_openai

    asyncio.run(bridge.openai_to_twilio())

    assert handled_calls == ["call-ready"]
    assert openai_events == [{"type": "response.create"}]


def test_successful_booking_confirms_then_closes_after_audio_playback():
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    openai_events = []
    playback_waited = []

    class FakeOpenAIWebSocket:
        async def __aiter__(self):
            events = [
                {
                    "type": "response.done",
                    "response": {
                        "status": "completed",
                        "output": [
                            {
                                "type": "function_call",
                                "status": "completed",
                                "name": "book_trial",
                                "call_id": "call-booking",
                                "arguments": "{}",
                            }
                        ],
                    },
                },
                {
                    "type": "response.done",
                    "response": {
                        "status": "completed",
                        "output": [],
                    },
                },
            ]
            for event in events:
                yield json.dumps(event)

    async def successful_tool(**_kwargs):
        return {"ok": True, "booking_id": 5}

    async def capture_openai(payload):
        openai_events.append(payload)

    async def capture_playback_wait():
        playback_waited.append(True)

    bridge.openai_ws = FakeOpenAIWebSocket()
    bridge.execute_tool = successful_tool
    bridge.send_openai = capture_openai
    bridge.wait_for_audio_playback = capture_playback_wait

    asyncio.run(bridge.openai_to_twilio())

    assert openai_events[0]["type"] == "conversation.item.create"
    assert openai_events[1]["type"] == "response.create"
    assert "despídete" in openai_events[1]["response"]["instructions"]
    assert playback_waited == [True]
    assert bridge.shutdown_requested is True
    assert bridge.call_ending is True


def test_short_pcmu_deltas_use_accumulated_bytes_for_playback_duration():
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    twilio_events = []

    async def capture_twilio(payload):
        twilio_events.append(payload)
        return True

    bridge.send_twilio = capture_twilio
    short_delta = base64.b64encode(b"\xff" * 5).decode("ascii")

    async def forward_both():
        for _ in range(2):
            await bridge.forward_audio_delta(
                {
                    "type": "response.output_audio.delta",
                    "item_id": "item-short",
                    "content_index": 0,
                    "delta": short_delta,
                }
            )

    asyncio.run(forward_both())

    assert bridge.audio_items["item-short"]["sent_bytes"] == 10
    assert bridge.audio_items["item-short"]["sent_ms"] == 1
    mark_names = [
        event["mark"]["name"] for event in twilio_events if event["event"] == "mark"
    ]
    assert bridge.pending_marks[mark_names[0]] == ("item-short", 0)
    assert bridge.pending_marks[mark_names[1]] == ("item-short", 1)


def test_concurrent_transcript_writes_receive_distinct_sequences(monkeypatch):
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=10,
    )
    writes = []

    async def capture_transcript(**kwargs):
        await asyncio.sleep(0)
        writes.append(kwargs)
        return True

    monkeypatch.setattr(
        realtime_module,
        "_persist_transcript",
        capture_transcript,
    )

    async def persist_together():
        await asyncio.gather(
            bridge.persist_segment(speaker="system", text="Primero"),
            bridge.persist_segment(speaker="system", text="Segundo"),
        )

    asyncio.run(persist_together())

    assert [write["sequence"] for write in writes] == [11, 12]
    assert bridge.sequence == 12


def test_disconnect_drain_ignores_audio_and_persists_final_transcription(monkeypatch):
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    bridge.call_ending = True
    transcript_writes = []
    twilio_writes = []

    class FakeOpenAIWebSocket:
        async def __aiter__(self):
            events = [
                {
                    "type": "response.output_audio.delta",
                    "item_id": "assistant-after-stop",
                    "content_index": 0,
                    "delta": base64.b64encode(b"\xff" * 80).decode("ascii"),
                },
                {"type": "input_audio_buffer.speech_started"},
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "item_id": "caller-final",
                    "transcript": "Quiero que me llamen mañana.",
                },
                {
                    "type": "response.output_audio_transcript.done",
                    "item_id": "assistant-after-stop",
                    "transcript": "Esta frase nunca se reprodujo.",
                },
            ]
            for event in events:
                yield json.dumps(event)

    async def capture_transcript(**kwargs):
        transcript_writes.append(kwargs)
        return True

    async def reject_twilio_send(message):
        twilio_writes.append(message)
        raise AssertionError("No debe escribirse en Twilio después del cierre")

    monkeypatch.setattr(
        realtime_module,
        "_persist_transcript",
        capture_transcript,
    )
    bridge.openai_ws = FakeOpenAIWebSocket()
    bridge.asgi_send = reject_twilio_send

    asyncio.run(bridge.openai_to_twilio())

    assert twilio_writes == []
    assert bridge.audio_items == {}
    assert [
        (write["speaker"], write["text"]) for write in transcript_writes
    ] == [
        ("caller", "Quiero que me llamen mañana."),
        ("system", "Respuesta del agente interrumpida al finalizar la llamada."),
    ]


def test_stop_rewrites_an_already_persisted_unplayed_assistant_segment(monkeypatch):
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    bridge.audio_items["assistant-pending"] = {
        "content_index": 0,
        "sent_bytes": 800,
        "sent_ms": 100,
        "played_ms": 25,
        "generation_done": 1,
    }
    rewritten = []
    incoming = iter(
        [
            {
                "type": "websocket.receive",
                "text": json.dumps({"event": "stop"}),
            }
        ]
    )

    async def receive():
        return next(incoming)

    async def capture_rewrite(**kwargs):
        rewritten.append(kwargs)

    monkeypatch.setattr(
        realtime_module,
        "_mark_assistant_transcripts_ended",
        capture_rewrite,
    )

    asyncio.run(bridge.twilio_to_openai(receive))

    assert bridge.call_ending is True
    assert bridge.ended_item_ids == {"assistant-pending"}
    assert rewritten == [
        {
            "voice_call_id": 1,
            "item_ids": ["assistant-pending"],
        }
    ]


def test_failed_caller_transcription_is_visible_as_a_system_segment(monkeypatch):
    bridge = RealtimeBridge(
        voice_call_id=1,
        stream_sid="MZ-test-stream",
        initial_sequence=0,
    )
    transcript_writes = []
    saved_errors = []

    class FakeOpenAIWebSocket:
        async def __aiter__(self):
            yield json.dumps(
                {
                    "type": "conversation.item.added",
                    "item": {
                        "id": "caller-failed",
                        "type": "message",
                        "role": "user",
                    },
                }
            )
            yield json.dumps(
                {
                    "type": "conversation.item.input_audio_transcription.failed",
                    "item_id": "caller-failed",
                    "error": {"type": "audio_unintelligible"},
                }
            )

    async def capture_transcript(**kwargs):
        transcript_writes.append(kwargs)
        return True

    async def capture_error(call_id, message):
        saved_errors.append((call_id, message))

    monkeypatch.setattr(
        realtime_module,
        "_persist_transcript",
        capture_transcript,
    )
    monkeypatch.setattr(
        realtime_module,
        "_save_voice_error",
        capture_error,
    )
    bridge.openai_ws = FakeOpenAIWebSocket()

    asyncio.run(bridge.openai_to_twilio())

    assert transcript_writes == [
        {
            "voice_call_id": 1,
            "sequence": 1,
            "speaker": "system",
            "text": "No se pudo transcribir este turno de la persona que llama.",
            "item_id": "caller-failed",
        }
    ]
    assert saved_errors == [
        (1, "OpenAI transcription failed (audio_unintelligible)")
    ]
