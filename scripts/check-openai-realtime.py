"""Live probe for the exact OpenAI Realtime path used by the voice demo.

Credentials are read only from the process environment. Error output is limited
to status, type, and code so the API key can never be echoed.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from urllib.parse import quote

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus


class ProbeError(RuntimeError):
    pass


async def receive_event(websocket, *, timeout: float = 20.0) -> dict:
    raw_event = await asyncio.wait_for(websocket.recv(), timeout=timeout)
    if isinstance(raw_event, bytes):
        raw_event = raw_event.decode("utf-8")
    event = json.loads(raw_event)
    if event.get("type") == "error":
        error = event.get("error") or {}
        error_type = str(error.get("type") or "realtime_error")[:80]
        error_code = str(error.get("code") or "unknown")[:80]
        raise ProbeError(f"OpenAI Realtime error type={error_type} code={error_code}")
    return event


async def wait_for_event(websocket, expected_type: str) -> dict:
    for _attempt in range(100):
        event = await receive_event(websocket)
        if event.get("type") == expected_type:
            return event
    raise ProbeError(f"OpenAI Realtime did not emit {expected_type}")


async def run_probe() -> None:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    model = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
    transcription_model = os.environ.get(
        "OPENAI_TRANSCRIPTION_MODEL",
        "gpt-realtime-whisper",
    )
    voice = os.environ.get("OPENAI_REALTIME_VOICE", "cedar")
    vad_threshold = float(os.environ.get("OPENAI_REALTIME_VAD_THRESHOLD", "0.75"))
    vad_prefix_padding_ms = int(
        os.environ.get("OPENAI_REALTIME_VAD_PREFIX_PADDING_MS", "400")
    )
    vad_silence_duration_ms = int(
        os.environ.get("OPENAI_REALTIME_VAD_SILENCE_DURATION_MS", "700")
    )
    if not api_key.startswith("sk-") or len(api_key) < 20:
        raise ProbeError("OPENAI_API_KEY is missing or malformed")

    url = f"wss://api.openai.com/v1/realtime?model={quote(model, safe='-._')}"
    async with connect(
        url,
        additional_headers={"Authorization": f"Bearer {api_key}"},
        open_timeout=20,
        close_timeout=5,
        ping_interval=20,
        ping_timeout=20,
        max_size=8 * 1024 * 1024,
    ) as websocket:
        await wait_for_event(websocket, "session.created")
        await websocket.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "type": "realtime",
                        "model": model,
                        "output_modalities": ["audio"],
                        "instructions": (
                            "Esta es una comprobación técnica. Responde de forma breve."
                        ),
                        "audio": {
                            "input": {
                                "format": {"type": "audio/pcmu"},
                                "transcription": {
                                    "model": transcription_model,
                                    "language": "es",
                                },
                                "turn_detection": {
                                    "type": "server_vad",
                                    "threshold": vad_threshold,
                                    "prefix_padding_ms": vad_prefix_padding_ms,
                                    "silence_duration_ms": vad_silence_duration_ms,
                                    "create_response": True,
                                    "interrupt_response": True,
                                },
                            },
                            "output": {
                                "format": {"type": "audio/pcmu"},
                                "voice": voice,
                            },
                        },
                    },
                },
                ensure_ascii=False,
            )
        )
        await wait_for_event(websocket, "session.updated")
        await websocket.send(
            json.dumps(
                {
                    "type": "response.create",
                    "response": {"instructions": "Di únicamente: listo."},
                },
                ensure_ascii=False,
            )
        )

        received_audio = False
        for _attempt in range(200):
            event = await receive_event(websocket)
            event_type = event.get("type")
            if event_type == "response.output_audio.delta" and event.get("delta"):
                received_audio = True
            if event_type == "response.done":
                response = event.get("response") or {}
                if response.get("status") != "completed":
                    raise ProbeError(
                        "OpenAI Realtime response did not complete successfully"
                    )
                if not received_audio:
                    raise ProbeError("OpenAI Realtime completed without audio output")
                return
        raise ProbeError("OpenAI Realtime response did not finish")


def main() -> int:
    try:
        asyncio.run(asyncio.wait_for(run_probe(), timeout=45))
    except InvalidStatus as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", "unknown")
        print(f"OPENAI_REALTIME_ERROR status={status_code}", file=sys.stderr)
        return 1
    except asyncio.TimeoutError:
        print("OPENAI_REALTIME_ERROR timeout", file=sys.stderr)
        return 1
    except ProbeError as exc:
        print(f"OPENAI_REALTIME_ERROR {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(
            f"OPENAI_REALTIME_ERROR exception={type(exc).__name__}",
            file=sys.stderr,
        )
        return 1

    print("OPENAI_REALTIME_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
