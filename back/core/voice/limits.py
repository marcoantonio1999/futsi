from __future__ import annotations

import hashlib
from datetime import timedelta

from django.conf import settings
from django.db import connection
from django.utils import timezone

from core.models import VoiceCall


VOICE_CAPACITY_ADVISORY_LOCK_ID = 731_942_617
VOICE_CALLER_RATE_ADVISORY_LOCK_NAMESPACE = 731_942_618


def _max_concurrent_streams() -> int:
    return max(
        1,
        min(int(getattr(settings, "VOICE_MAX_CONCURRENT_STREAMS", 5)), 100),
    )


def _calls_per_number_per_hour() -> int:
    return max(
        1,
        min(int(getattr(settings, "VOICE_CALLS_PER_NUMBER_PER_HOUR", 5)), 100),
    )


def caller_hourly_limit_reached(*, call_sid: str, from_number: str) -> bool:
    """Rate-limit new calls while allowing Twilio retries for the same Call SID."""

    if VoiceCall.objects.filter(call_sid=call_sid).exists():
        return False
    normalized_digits = "".join(
        character for character in str(from_number or "") if character.isdigit()
    )
    if len(normalized_digits) < 7:
        return False
    cutoff = timezone.now() - timedelta(hours=1)
    return (
        VoiceCall.objects.filter(
            from_number=from_number,
            created_at__gte=cutoff,
        ).count()
        >= _calls_per_number_per_hour()
    )


def lock_caller_hourly_limit(*, from_number: str) -> None:
    """Serialize a caller's hourly check and insert on production PostgreSQL."""

    if connection.vendor != "postgresql":
        return
    normalized_digits = "".join(
        character for character in str(from_number or "") if character.isdigit()
    )
    caller_key = int.from_bytes(
        hashlib.sha256(normalized_digits.encode("utf-8")).digest()[:4],
        byteorder="big",
        signed=True,
    )
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(%s, %s)",
            [VOICE_CALLER_RATE_ADVISORY_LOCK_NAMESPACE, caller_key],
        )


def active_voice_stream_count(*, exclude_call_id: int | None = None) -> int:
    stale_cutoff = timezone.now() - timedelta(
        seconds=int(getattr(settings, "VOICE_MAX_CALL_SECONDS", 900)) + 120
    )
    queryset = VoiceCall.objects.filter(
        ended_at__isnull=True,
        started_at__gte=stale_cutoff,
        extracted_data__has_key="stream_token_used_at",
    ).exclude(stream_sid="")
    if exclude_call_id is not None:
        queryset = queryset.exclude(id=exclude_call_id)
    return queryset.count()


def voice_stream_capacity_available(*, exclude_call_id: int | None = None) -> bool:
    return (
        active_voice_stream_count(exclude_call_id=exclude_call_id)
        < _max_concurrent_streams()
    )


def lock_voice_stream_capacity() -> None:
    """Serialize capacity claims across production workers on PostgreSQL."""

    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(%s)",
            [VOICE_CAPACITY_ADVISORY_LOCK_ID],
        )
