from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
from datetime import timedelta
from typing import Any
from urllib.parse import quote

from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from twilio.request_validator import RequestValidator
from websockets.asyncio.client import connect as websocket_connect
from websockets.exceptions import ConnectionClosed

from core.models import (
    CallOutcome,
    CallTranscriptSegment,
    TranscriptSpeaker,
    VoiceCall,
)
from core.voice.prompt import build_voice_agent_instructions, realtime_tools
from core.voice.limits import (
    lock_voice_stream_capacity,
    voice_stream_capacity_available,
)
from core.voice.scheduling import (
    SchedulingError,
    book_two_trial_visits,
    list_trial_availability,
    record_unsuccessful_outcome,
    withdraw_voice_consent,
)


logger = logging.getLogger(__name__)


def realtime_turn_detection_config() -> dict[str, Any]:
    return {
        "type": "server_vad",
        "threshold": settings.OPENAI_REALTIME_VAD_THRESHOLD,
        "prefix_padding_ms": settings.OPENAI_REALTIME_VAD_PREFIX_PADDING_MS,
        "silence_duration_ms": settings.OPENAI_REALTIME_VAD_SILENCE_DURATION_MS,
        "create_response": True,
        "interrupt_response": True,
    }


def _header(scope: dict, name: bytes) -> str:
    for key, value in scope.get("headers", []):
        if key.lower() == name.lower():
            return value.decode("latin-1")
    return ""


def _websocket_signature_valid(scope: dict) -> bool:
    if not settings.TWILIO_VALIDATE_SIGNATURES:
        return bool(settings.DEBUG)
    signature = _header(scope, b"x-twilio-signature")
    if not signature or not settings.TWILIO_AUTH_TOKEN:
        return False
    return RequestValidator(settings.TWILIO_AUTH_TOKEN).validate(
        settings.TWILIO_STREAM_URL,
        {},
        signature,
    )


@sync_to_async(thread_sensitive=True)
def _build_session_context(voice_call_id: int) -> tuple[str, list[dict], str]:
    call = VoiceCall.objects.only("from_number").get(id=voice_call_id)
    normalized_caller = "".join(
        character for character in str(call.from_number or "") if character.isdigit()
    )
    if len(normalized_caller) < 7:
        normalized_caller = f"anonymous-call-{call.id}"
    safety_identifier = hmac.new(
        str(settings.SECRET_KEY).encode("utf-8"),
        f"futsi-voice:{normalized_caller}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return (
        build_voice_agent_instructions(),
        realtime_tools(),
        safety_identifier,
    )


@sync_to_async(thread_sensitive=True)
def _claim_stream(
    *,
    call_sid: str,
    account_sid: str,
    stream_sid: str,
    stream_token: str,
) -> tuple[int, int]:
    if not settings.TWILIO_ACCOUNT_SID or not hmac.compare_digest(
        str(settings.TWILIO_ACCOUNT_SID),
        str(account_sid),
    ):
        raise PermissionError("Unexpected Twilio account")
    with transaction.atomic():
        lock_voice_stream_capacity()
        call = VoiceCall.objects.select_for_update().get(call_sid=call_sid)
        if not call.consent_granted:
            raise PermissionError("Consent has not been granted")
        extracted_data = dict(call.extracted_data or {})
        expected_hash = str(extracted_data.get("stream_token_hash") or "")
        received_hash = hashlib.sha256(stream_token.encode("utf-8")).hexdigest()
        if not expected_hash or not hmac.compare_digest(expected_hash, received_hash):
            raise PermissionError("Invalid or already-used stream token")
        if not voice_stream_capacity_available(exclude_call_id=call.id):
            raise PermissionError("Voice stream capacity reached")
        extracted_data.pop("stream_token_hash", None)
        extracted_data["stream_token_used_at"] = timezone.now().isoformat()
        call.extracted_data = extracted_data
        call.stream_sid = str(stream_sid)[:80]
        if call.started_at is None:
            call.started_at = timezone.now()
        call.save(
            update_fields=[
                "extracted_data",
                "stream_sid",
                "started_at",
                "updated_at",
            ]
        )
        sequence = (
            call.transcript_segments.aggregate(max_sequence=Max("sequence"))["max_sequence"]
            or 0
        )
        return call.id, sequence


@sync_to_async(thread_sensitive=True)
def _persist_transcript(
    *,
    voice_call_id: int,
    sequence: int,
    speaker: str,
    text: str,
    item_id: str,
) -> bool:
    normalized = " ".join(str(text or "").strip().split())
    if not normalized:
        return False
    if item_id and CallTranscriptSegment.objects.filter(
        call_id=voice_call_id,
        speaker=speaker,
        item_id=item_id,
    ).exists():
        return False
    CallTranscriptSegment.objects.create(
        call_id=voice_call_id,
        sequence=sequence,
        speaker=speaker,
        text=normalized,
        item_id=str(item_id or "")[:128],
    )
    return True


@sync_to_async(thread_sensitive=True)
def _mark_assistant_transcript_interrupted(
    *,
    voice_call_id: int,
    item_id: str,
) -> None:
    if not item_id:
        return
    CallTranscriptSegment.objects.filter(
        call_id=voice_call_id,
        speaker=TranscriptSpeaker.ASSISTANT,
        item_id=item_id,
    ).update(
        speaker=TranscriptSpeaker.SYSTEM,
        text="Respuesta del agente interrumpida por la persona que llama.",
    )


@sync_to_async(thread_sensitive=True)
def _mark_assistant_transcripts_ended(
    *,
    voice_call_id: int,
    item_ids: list[str],
) -> None:
    if not item_ids:
        return
    CallTranscriptSegment.objects.filter(
        call_id=voice_call_id,
        speaker=TranscriptSpeaker.ASSISTANT,
        item_id__in=item_ids,
    ).update(
        speaker=TranscriptSpeaker.SYSTEM,
        text="Respuesta del agente interrumpida al finalizar la llamada.",
    )


@sync_to_async(thread_sensitive=True)
def _save_voice_error(voice_call_id: int, message: str) -> None:
    call = VoiceCall.objects.get(id=voice_call_id)
    call.sanitized_error = message
    call.save(update_fields=["sanitized_error", "updated_at"])


@sync_to_async(thread_sensitive=True)
def _accumulate_realtime_usage(voice_call_id: int, usage: dict[str, Any]) -> None:
    if not isinstance(usage, dict) or not usage:
        return

    input_details = usage.get("input_token_details") or {}
    output_details = usage.get("output_token_details") or {}
    values = {
        "total_tokens": usage.get("total_tokens"),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "input_text_tokens": input_details.get("text_tokens"),
        "input_audio_tokens": input_details.get("audio_tokens"),
        "cached_tokens": input_details.get("cached_tokens"),
        "output_text_tokens": output_details.get("text_tokens"),
        "output_audio_tokens": output_details.get("audio_tokens"),
    }

    with transaction.atomic():
        call = VoiceCall.objects.select_for_update().get(id=voice_call_id)
        extracted_data = dict(call.extracted_data or {})
        totals = dict(extracted_data.get("openai_realtime_usage") or {})
        totals["response_count"] = int(totals.get("response_count") or 0) + 1
        for key, raw_value in values.items():
            if isinstance(raw_value, bool):
                continue
            try:
                value = max(0, int(raw_value))
            except (TypeError, ValueError):
                continue
            totals[key] = int(totals.get(key) or 0) + value
        extracted_data["openai_realtime_usage"] = totals
        call.extracted_data = extracted_data
        call.save(update_fields=["extracted_data", "updated_at"])


@sync_to_async(thread_sensitive=True)
def _finish_call(voice_call_id: int) -> None:
    with transaction.atomic():
        call = VoiceCall.objects.select_for_update().get(id=voice_call_id)
        ended_at = timezone.now()
        call.ended_at = call.ended_at or ended_at
        if call.started_at:
            call.duration_seconds = max(
                0,
                int((call.ended_at - call.started_at).total_seconds()),
            )
        if not call.booking_id and call.ai_outcome == CallOutcome.PENDING:
            call.ai_outcome = CallOutcome.UNSUCCESSFUL
            call.failure_reason = (
                call.failure_reason
                or "La llamada terminó sin confirmar las dos visitas."
            )
        if not call.summary:
            call.summary = (
                "Prueba gratuita agendada con dos visitas."
                if call.booking_id
                else "Llamada finalizada sin una reserva confirmada."
            )
        call.save(
            update_fields=[
                "ended_at",
                "duration_seconds",
                "ai_outcome",
                "failure_reason",
                "summary",
                "updated_at",
            ]
        )


class RealtimeBridge:
    def __init__(self, *, voice_call_id: int, stream_sid: str, initial_sequence: int):
        self.voice_call_id = voice_call_id
        self.stream_sid = stream_sid
        self.sequence = initial_sequence
        self.tool_results: dict[str, dict[str, Any]] = {}
        self.audio_items: dict[str, dict[str, int]] = {}
        self.pending_marks: dict[str, tuple[str, int]] = {}
        self.item_sequences: dict[str, int] = {}
        self.truncated_item_ids: set[str] = set()
        self.ended_item_ids: set[str] = set()
        self.last_audio_item_id = ""
        self.mark_counter = 0
        self.last_activity_at = 0.0
        self.call_ending = False
        self.shutdown_requested = False
        self.finish_after_booking_response = False
        self.openai_ws = None
        self.asgi_send = None
        self.transcript_lock = asyncio.Lock()

    def reserve_item_sequence(self, item_id: str) -> int | None:
        if not item_id:
            return None
        if item_id not in self.item_sequences:
            self.sequence += 1
            self.item_sequences[item_id] = self.sequence
        return self.item_sequences[item_id]

    async def persist_segment(self, *, speaker: str, text: str, item_id: str = "") -> None:
        async with self.transcript_lock:
            if (
                speaker == TranscriptSpeaker.ASSISTANT
                and item_id in self.ended_item_ids
            ):
                speaker = TranscriptSpeaker.SYSTEM
                text = "Respuesta del agente interrumpida al finalizar la llamada."
            reserved_sequence = self.reserve_item_sequence(item_id)
            if reserved_sequence is None:
                # Allocate before the database await. This prevents the OpenAI
                # reader and timeout watchdog from selecting the same sequence.
                self.sequence += 1
                next_sequence = self.sequence
            else:
                next_sequence = reserved_sequence
            await _persist_transcript(
                voice_call_id=self.voice_call_id,
                sequence=next_sequence,
                speaker=speaker,
                text=text,
                item_id=item_id,
            )

    async def mark_call_ended_audio(self) -> None:
        incomplete_item_ids = [
            item_id
            for item_id, state in self.audio_items.items()
            if not state["generation_done"] or state["played_ms"] < state["sent_ms"]
        ]
        if not incomplete_item_ids:
            return
        async with self.transcript_lock:
            self.ended_item_ids.update(incomplete_item_ids)
            await _mark_assistant_transcripts_ended(
                voice_call_id=self.voice_call_id,
                item_ids=incomplete_item_ids,
            )

    async def send_openai(self, payload: dict[str, Any]) -> None:
        if self.openai_ws:
            await self.openai_ws.send(json.dumps(payload, ensure_ascii=False))

    async def send_twilio(self, payload: dict[str, Any]) -> bool:
        if self.call_ending or not self.asgi_send:
            return False
        try:
            await self.asgi_send(
                {
                    "type": "websocket.send",
                    "text": json.dumps(payload, ensure_ascii=False),
                }
            )
        except Exception:
            # Keep draining OpenAI long enough to persist its final caller
            # transcription even if Twilio has already closed the socket.
            self.call_ending = True
            return False
        return True

    async def forward_audio_delta(self, event: dict[str, Any]) -> None:
        delta = str(event.get("delta") or "")
        if not delta or self.call_ending:
            return
        item_id = str(event.get("item_id") or "")
        if not item_id:
            return
        try:
            audio_bytes = len(base64.b64decode(delta, validate=True))
        except (binascii.Error, ValueError, TypeError):
            return
        content_index = int(event.get("content_index") or 0)
        state = self.audio_items.setdefault(
            item_id,
            {
                "content_index": content_index,
                "sent_bytes": 0,
                "sent_ms": 0,
                "played_ms": 0,
                "generation_done": 0,
            },
        )
        sent = await self.send_twilio(
            {
                "event": "media",
                "streamSid": self.stream_sid,
                "media": {"payload": delta},
            }
        )
        if not sent:
            return
        self.touch_activity()
        state["content_index"] = content_index
        # PCMU is one byte per sample at 8 kHz. Keep the byte remainder across
        # deltas so several short chunks cannot overstate playback duration.
        state["sent_bytes"] += audio_bytes
        state["sent_ms"] = state["sent_bytes"] // 8
        self.last_audio_item_id = item_id

        self.mark_counter += 1
        mark_name = f"futsi-{self.mark_counter}"
        self.pending_marks[mark_name] = (item_id, state["sent_ms"])
        mark_sent = await self.send_twilio(
            {
                "event": "mark",
                "streamSid": self.stream_sid,
                "mark": {"name": mark_name},
            }
        )
        if not mark_sent:
            self.pending_marks.pop(mark_name, None)

    def acknowledge_twilio_mark(self, mark_name: str) -> None:
        pending = self.pending_marks.pop(mark_name, None)
        if not pending:
            return
        item_id, played_ms = pending
        state = self.audio_items.get(item_id)
        if state:
            state["played_ms"] = max(state["played_ms"], played_ms)
            self.clear_completed_audio_item(item_id)

    def mark_audio_generation_done(self, item_id: str) -> None:
        state = self.audio_items.get(item_id)
        if not state:
            return
        state["generation_done"] = 1
        self.clear_completed_audio_item(item_id)

    def clear_completed_audio_item(self, item_id: str) -> None:
        state = self.audio_items.get(item_id)
        if (
            state
            and state["generation_done"]
            and state["played_ms"] >= state["sent_ms"]
            and self.last_audio_item_id == item_id
        ):
            self.last_audio_item_id = ""

    async def wait_for_audio_playback(self, timeout_seconds: float = 15.0) -> None:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        while self.last_audio_item_id and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.05)

    async def interrupt_assistant_audio(self) -> None:
        if self.call_ending:
            return
        item_id = self.last_audio_item_id
        state = self.audio_items.get(item_id)
        if not item_id or not state:
            return
        # Twilio also returns outstanding marks after a clear. Forget them first
        # so cleared audio is never counted as audio the caller actually heard.
        self.pending_marks.clear()
        await self.send_twilio(
            {
                "event": "clear",
                "streamSid": self.stream_sid,
            }
        )
        if item_id and state:
            audio_end_ms = min(state["played_ms"], state["sent_ms"])
            await self.send_openai(
                {
                    "type": "conversation.item.truncate",
                    "item_id": item_id,
                    "content_index": state["content_index"],
                    "audio_end_ms": audio_end_ms,
                }
            )
            state["sent_ms"] = audio_end_ms
            state["sent_bytes"] = audio_end_ms * 8
            state["played_ms"] = audio_end_ms
            self.truncated_item_ids.add(item_id)
            await _mark_assistant_transcript_interrupted(
                voice_call_id=self.voice_call_id,
                item_id=item_id,
            )
        self.last_audio_item_id = ""

    async def configure_openai_session(self, session: dict[str, Any]) -> None:
        event_id = f"futsi-session-{self.voice_call_id}"
        await self.send_openai(
            {
                "event_id": event_id,
                "type": "session.update",
                "session": session,
            }
        )
        for _attempt in range(8):
            try:
                raw = await asyncio.wait_for(self.openai_ws.recv(), timeout=10)
            except asyncio.TimeoutError as exc:
                raise ConnectionError(
                    "OpenAI Realtime session configuration timed out"
                ) from exc
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue
            event_type = event.get("type")
            if event_type == "session.updated":
                return
            if event_type == "error":
                error = event.get("error") or {}
                error_type = str(error.get("type") or "configuration_error")
                raise ConnectionError(
                    f"OpenAI Realtime configuration failed ({error_type[:120]})"
                )
        raise ConnectionError("OpenAI Realtime did not confirm session configuration")

    def touch_activity(self) -> None:
        self.last_activity_at = asyncio.get_running_loop().time()

    async def idle_watchdog(self) -> None:
        timeout_seconds = int(getattr(settings, "VOICE_IDLE_TIMEOUT_SECONDS", 90))
        check_interval = max(1, min(5, timeout_seconds // 3))
        while True:
            await asyncio.sleep(check_interval)
            if (
                self.last_activity_at
                and asyncio.get_running_loop().time() - self.last_activity_at
                >= timeout_seconds
            ):
                await self.persist_segment(
                    speaker=TranscriptSpeaker.SYSTEM,
                    text="La llamada finalizó por inactividad.",
                )
                return

    async def execute_tool(
        self,
        *,
        name: str,
        call_id: str,
        arguments_text: str,
    ) -> dict[str, Any]:
        if call_id in self.tool_results:
            return self.tool_results[call_id]
        try:
            arguments = json.loads(arguments_text or "{}")
            if not isinstance(arguments, dict):
                raise SchedulingError("Los argumentos de la herramienta no son válidos.")
            if name == "check_availability":
                result = await sync_to_async(
                    list_trial_availability,
                    thread_sensitive=True,
                )(
                    site_id=arguments.get("site_id"),
                    court_id=arguments.get("court_id"),
                    start_date=arguments.get("start_date"),
                    end_date=arguments.get("end_date"),
                )
            elif name == "book_trial":
                if arguments.get("confirmed") is not True:
                    raise SchedulingError(
                        "La persona debe confirmar verbalmente ambas visitas antes de reservar."
                    )
                result = await sync_to_async(
                    book_two_trial_visits,
                    thread_sensitive=True,
                )(
                    voice_call_id=self.voice_call_id,
                    tool_call_id=call_id,
                    site_id=int(arguments["site_id"]),
                    responsible_name=arguments.get("responsible_name", ""),
                    responsible_phone=arguments.get("responsible_phone", ""),
                    responsible_email=arguments.get("responsible_email") or "",
                    child_first_name=arguments.get("child_first_name", ""),
                    child_age=arguments.get("child_age"),
                    visits=arguments.get("visits") or [],
                )
            elif name == "record_call_outcome":
                result = await sync_to_async(
                    record_unsuccessful_outcome,
                    thread_sensitive=True,
                )(
                    voice_call_id=self.voice_call_id,
                    tool_call_id=call_id,
                    reason=arguments.get("reason", ""),
                    summary=arguments.get("summary", ""),
                )
            elif name == "withdraw_consent":
                result = await sync_to_async(
                    withdraw_voice_consent,
                    thread_sensitive=True,
                )(voice_call_id=self.voice_call_id)
            else:
                result = {"ok": False, "error": "Herramienta no reconocida."}
        except (KeyError, TypeError, ValueError, SchedulingError) as exc:
            result = {"ok": False, "error": str(exc)}
        except Exception as exc:  # Do not leak provider or database details back into the call.
            await _save_voice_error(
                self.voice_call_id,
                f"Voice tool error ({type(exc).__name__})",
            )
            result = {
                "ok": False,
                "error": "No se pudo completar la operación. Consulta disponibilidad nuevamente.",
            }
        self.tool_results[call_id] = result
        return result

    async def handle_tool_event(self, event: dict[str, Any]) -> bool:
        name = str(event.get("name") or "")
        call_id = str(event.get("call_id") or "")
        if not name or not call_id:
            return False
        if call_id in self.tool_results:
            return False
        self.touch_activity()
        result = await self.execute_tool(
            name=name,
            call_id=call_id,
            arguments_text=str(event.get("arguments") or "{}"),
        )
        if name == "withdraw_consent" and result.get("ok"):
            self.shutdown_requested = True
            self.call_ending = True
            return True
        if name == "book_trial" and result.get("ok"):
            self.finish_after_booking_response = True
        await self.send_openai(
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps(result, ensure_ascii=False),
                },
            }
        )
        return True

    async def twilio_to_openai(self, asgi_receive) -> None:
        while True:
            message = await asgi_receive()
            if message["type"] == "websocket.disconnect":
                self.call_ending = True
                await self.mark_call_ended_audio()
                return
            if message["type"] != "websocket.receive":
                continue
            raw = message.get("text")
            if raw is None and message.get("bytes"):
                raw = message["bytes"].decode("utf-8")
            try:
                event = json.loads(raw or "{}")
            except json.JSONDecodeError:
                continue
            event_type = event.get("event")
            if event_type == "media":
                payload = (event.get("media") or {}).get("payload")
                if payload:
                    await self.send_openai(
                        {
                            "type": "input_audio_buffer.append",
                            "audio": payload,
                        }
                    )
            elif event_type == "mark":
                self.acknowledge_twilio_mark(
                    str((event.get("mark") or {}).get("name") or "")
                )
            elif event_type == "stop":
                self.call_ending = True
                await self.mark_call_ended_audio()
                return

    async def openai_to_twilio(self) -> None:
        try:
            async for raw in self.openai_ws:
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                event_type = event.get("type")
                if event_type == "response.output_audio.delta":
                    if not self.call_ending:
                        await self.forward_audio_delta(event)
                elif event_type == "response.output_audio.done":
                    self.mark_audio_generation_done(
                        str(event.get("item_id") or "")
                    )
                elif event_type in {"conversation.item.added", "conversation.item.created"}:
                    item = event.get("item") or {}
                    if (
                        item.get("type") == "message"
                        and item.get("role") in {"user", "assistant"}
                    ):
                        self.reserve_item_sequence(str(item.get("id") or ""))
                elif event_type == "input_audio_buffer.speech_started":
                    if not self.call_ending:
                        self.touch_activity()
                        await self.interrupt_assistant_audio()
                elif event_type == "conversation.item.input_audio_transcription.completed":
                    self.touch_activity()
                    await self.persist_segment(
                        speaker=TranscriptSpeaker.CALLER,
                        text=str(event.get("transcript") or ""),
                        item_id=str(event.get("item_id") or ""),
                    )
                elif event_type == "conversation.item.input_audio_transcription.failed":
                    self.touch_activity()
                    error_type = str(
                        (event.get("error") or {}).get("type")
                        or "transcription_error"
                    )
                    await _save_voice_error(
                        self.voice_call_id,
                        f"OpenAI transcription failed ({error_type[:120]})",
                    )
                    await self.persist_segment(
                        speaker=TranscriptSpeaker.SYSTEM,
                        text="No se pudo transcribir este turno de la persona que llama.",
                        item_id=str(event.get("item_id") or ""),
                    )
                elif event_type == "response.output_audio_transcript.done":
                    item_id = str(event.get("item_id") or "")
                    audio_state = self.audio_items.get(item_id)
                    ended_before_playback = bool(
                        self.call_ending
                        and (
                            not audio_state
                            or not audio_state["generation_done"]
                            or audio_state["played_ms"] < audio_state["sent_ms"]
                        )
                    )
                    interrupted = (
                        item_id in self.truncated_item_ids
                        or item_id in self.ended_item_ids
                        or ended_before_playback
                    )
                    await self.persist_segment(
                        speaker=(
                            TranscriptSpeaker.SYSTEM
                            if interrupted
                            else TranscriptSpeaker.ASSISTANT
                        ),
                        text=(
                            (
                                "Respuesta del agente interrumpida por la persona que llama."
                                if item_id in self.truncated_item_ids
                                else "Respuesta del agente interrumpida al finalizar la llamada."
                            )
                            if interrupted
                            else str(event.get("transcript") or "")
                        ),
                        item_id=item_id,
                    )
                elif event_type == "response.done":
                    response = event.get("response") or {}
                    usage = response.get("usage") or {}
                    if usage:
                        await _accumulate_realtime_usage(self.voice_call_id, usage)
                    handled_tool = False
                    if response.get("status") == "completed" and not self.call_ending:
                        for item in response.get("output") or []:
                            if (
                                item.get("type") == "function_call"
                                and item.get("status") == "completed"
                            ):
                                handled_tool = (
                                    await self.handle_tool_event(item)
                                    or handled_tool
                                )
                    if self.shutdown_requested:
                        return
                    if handled_tool and not self.call_ending:
                        # Add every function result before asking the model to
                        # continue. A Realtime conversation permits one active
                        # response at a time.
                        create_event: dict[str, Any] = {"type": "response.create"}
                        if self.finish_after_booking_response:
                            create_event["response"] = {
                                "instructions": (
                                    "Confirma brevemente el número de reserva y las dos "
                                    "visitas, agradece la llamada y despídete. No hagas "
                                    "preguntas ni ofrezcas ayuda adicional."
                                )
                            }
                        await self.send_openai(create_event)
                    elif (
                        self.finish_after_booking_response
                        and response.get("status") == "completed"
                        and not self.call_ending
                    ):
                        await self.wait_for_audio_playback()
                        self.shutdown_requested = True
                        self.call_ending = True
                        return
                elif event_type == "error":
                    error_type = str((event.get("error") or {}).get("type") or "realtime_error")
                    await _save_voice_error(
                        self.voice_call_id,
                        f"OpenAI Realtime error ({error_type[:120]})",
                    )
        except ConnectionClosed:
            return

    async def run(self, *, asgi_receive, asgi_send) -> None:
        self.asgi_send = asgi_send
        instructions, tools, safety_identifier = await _build_session_context(
            self.voice_call_id
        )
        url = (
            "wss://api.openai.com/v1/realtime?model="
            f"{quote(settings.OPENAI_REALTIME_MODEL, safe='-._')}"
        )
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "OpenAI-Safety-Identifier": safety_identifier,
        }
        async with websocket_connect(
            url,
            additional_headers=headers,
            max_size=8 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=10,
        ) as openai_ws:
            self.openai_ws = openai_ws
            self.touch_activity()
            await self.configure_openai_session(
                {
                    "type": "realtime",
                    "model": settings.OPENAI_REALTIME_MODEL,
                    "output_modalities": ["audio"],
                    "instructions": instructions,
                    "audio": {
                        "input": {
                            "format": {"type": "audio/pcmu"},
                            "transcription": {
                                "model": settings.OPENAI_TRANSCRIPTION_MODEL,
                                "language": "es",
                            },
                            "turn_detection": realtime_turn_detection_config(),
                        },
                        "output": {
                            "format": {"type": "audio/pcmu"},
                            "voice": settings.OPENAI_REALTIME_VOICE,
                        },
                    },
                    "tools": tools,
                    "tool_choice": "auto",
                    "parallel_tool_calls": False,
                }
            )
            await self.send_openai(
                {
                    "type": "response.create",
                    "response": {
                        "instructions": (
                            "Saluda ahora, identifícate como asistente virtual de FUTSI "
                            "y pregunta en qué sede desea realizar sus dos visitas."
                        )
                    },
                }
            )

            twilio_task = asyncio.create_task(self.twilio_to_openai(asgi_receive))
            openai_task = asyncio.create_task(self.openai_to_twilio())
            idle_task = asyncio.create_task(self.idle_watchdog())
            tasks = {twilio_task, openai_task, idle_task}
            done: set[asyncio.Task] = set()
            try:
                done, pending = await asyncio.wait(
                    tasks,
                    timeout=int(settings.VOICE_MAX_CALL_SECONDS),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    self.call_ending = True
                    await self.persist_segment(
                        speaker=TranscriptSpeaker.SYSTEM,
                        text="La llamada alcanzó el límite máximo de duración.",
                    )
                elif twilio_task in done and openai_task in pending:
                    # The final transcription event can trail Twilio's stop
                    # event. Drain briefly, but never emit audio or execute
                    # side-effecting tools after hangup.
                    self.call_ending = True
                    try:
                        await asyncio.wait_for(
                            asyncio.shield(openai_task),
                            timeout=1.5,
                        )
                    except asyncio.TimeoutError:
                        pass
                for task in done:
                    exception = task.exception()
                    if exception:
                        raise exception
            finally:
                self.call_ending = True
                await self.mark_call_ended_audio()
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)


async def _receive_twilio_start(receive) -> dict[str, Any]:
    for _attempt in range(8):
        message = await asyncio.wait_for(receive(), timeout=10)
        if message["type"] == "websocket.disconnect":
            raise ConnectionError("Twilio disconnected before the start event")
        if message["type"] != "websocket.receive":
            continue
        raw = message.get("text")
        if raw is None and message.get("bytes"):
            raw = message["bytes"].decode("utf-8")
        try:
            event = json.loads(raw or "{}")
        except json.JSONDecodeError:
            continue
        if event.get("event") == "start":
            return event
    raise ConnectionError("Twilio did not send a valid start event")


async def twilio_media_stream_application(scope, receive, send) -> None:
    if not _websocket_signature_valid(scope):
        await send({"type": "websocket.close", "code": 4403})
        return
    initial = await receive()
    if initial["type"] != "websocket.connect":
        await send({"type": "websocket.close", "code": 4400})
        return
    await send({"type": "websocket.accept"})

    voice_call_id: int | None = None
    try:
        event = await _receive_twilio_start(receive)
        start = event.get("start") or {}
        custom = start.get("customParameters") or {}
        call_sid = str(start.get("callSid") or custom.get("callSid") or "")
        stream_sid = str(start.get("streamSid") or event.get("streamSid") or "")
        account_sid = str(start.get("accountSid") or "")
        stream_token = str(custom.get("streamToken") or "")
        media_format = start.get("mediaFormat") or {}
        if (
            media_format.get("encoding") != "audio/x-mulaw"
            or int(media_format.get("sampleRate") or 0) != 8000
            or int(media_format.get("channels") or 0) != 1
        ):
            raise PermissionError("Unexpected Twilio media format")
        voice_call_id, initial_sequence = await _claim_stream(
            call_sid=call_sid,
            account_sid=account_sid,
            stream_sid=stream_sid,
            stream_token=stream_token,
        )
        bridge = RealtimeBridge(
            voice_call_id=voice_call_id,
            stream_sid=stream_sid,
            initial_sequence=initial_sequence,
        )
        await bridge.run(asgi_receive=receive, asgi_send=send)
    except (PermissionError, VoiceCall.DoesNotExist):
        if voice_call_id:
            await _save_voice_error(voice_call_id, "Rejected Twilio Media Stream")
    except Exception as exc:
        if voice_call_id:
            await _save_voice_error(
                voice_call_id,
                f"Voice bridge error ({type(exc).__name__})",
            )
        logger.error("Voice bridge stopped with %s", type(exc).__name__)
    finally:
        if voice_call_id:
            await _finish_call(voice_call_id)
        try:
            await send({"type": "websocket.close", "code": 1000})
        except Exception:
            pass
