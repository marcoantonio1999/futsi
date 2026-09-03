import asyncio
import hashlib

import pytest
from django.test import override_settings
from django.utils import timezone

from core.models import VoiceCall
from core.voice.realtime import _claim_stream


ACCOUNT_SID = "AC" + ("1" * 32)


@pytest.mark.django_db(transaction=True)
@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    VOICE_MAX_CONCURRENT_STREAMS=1,
    VOICE_MAX_CALL_SECONDS=900,
)
def test_atomic_stream_claim_preserves_token_when_capacity_is_full():
    VoiceCall.objects.create(
        call_sid="CA" + ("1" * 32),
        stream_sid="MZ-existing",
        from_number="+525500000001",
        to_number="+14014090000",
        consent_granted=True,
        consent_granted_at=timezone.now(),
        started_at=timezone.now(),
        extracted_data={"stream_token_used_at": timezone.now().isoformat()},
    )
    token = "single-use-stream-token"
    target = VoiceCall.objects.create(
        call_sid="CA" + ("2" * 32),
        from_number="+525500000002",
        to_number="+14014090000",
        consent_granted=True,
        consent_granted_at=timezone.now(),
        started_at=timezone.now(),
        extracted_data={
            "stream_token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest()
        },
    )

    with pytest.raises(PermissionError, match="capacity"):
        asyncio.run(
            _claim_stream(
                call_sid=target.call_sid,
                account_sid=ACCOUNT_SID,
                stream_sid="MZ-new",
                stream_token=token,
            )
        )

    target.refresh_from_db()
    assert target.stream_sid == ""
    assert target.extracted_data["stream_token_hash"]


@pytest.mark.django_db(transaction=True)
@override_settings(
    TWILIO_ACCOUNT_SID=ACCOUNT_SID,
    VOICE_MAX_CONCURRENT_STREAMS=1,
    VOICE_MAX_CALL_SECONDS=900,
)
def test_status_callback_sid_without_a_consumed_token_does_not_block_the_winner():
    VoiceCall.objects.create(
        call_sid="CA" + ("3" * 32),
        stream_sid="MZ-status-only",
        from_number="+525500000003",
        to_number="+14014090000",
        consent_granted=True,
        consent_granted_at=timezone.now(),
        started_at=timezone.now(),
        extracted_data={"stream_token_hash": "not-consumed-yet"},
    )
    token = "winning-stream-token"
    target = VoiceCall.objects.create(
        call_sid="CA" + ("4" * 32),
        from_number="+525500000004",
        to_number="+14014090000",
        consent_granted=True,
        consent_granted_at=timezone.now(),
        started_at=timezone.now(),
        extracted_data={
            "stream_token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest()
        },
    )

    claimed_call_id, _sequence = asyncio.run(
        _claim_stream(
            call_sid=target.call_sid,
            account_sid=ACCOUNT_SID,
            stream_sid="MZ-winner",
            stream_token=token,
        )
    )

    assert claimed_call_id == target.id
    target.refresh_from_db()
    assert target.stream_sid == "MZ-winner"
    assert "stream_token_hash" not in target.extracted_data
    assert target.extracted_data["stream_token_used_at"]
