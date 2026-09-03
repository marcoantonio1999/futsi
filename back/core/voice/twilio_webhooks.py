from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from urllib.parse import urljoin

from django.conf import settings
from django.db import transaction
from django.http import HttpRequest, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, Stream, VoiceResponse

from core.models import CallOutcome, VoiceCall, VoiceCallTechnicalStatus
from core.voice.limits import (
    caller_hourly_limit_reached,
    lock_caller_hourly_limit,
    voice_stream_capacity_available,
)


logger = logging.getLogger(__name__)
CALL_SID_PATTERN = re.compile(r"^CA[a-fA-F0-9]{32}$")
VALID_TECHNICAL_STATUSES = {choice for choice, _label in VoiceCallTechnicalStatus.choices}


def _public_url(path: str) -> str:
    base = str(settings.TWILIO_PUBLIC_BASE_URL or "").rstrip("/") + "/"
    return urljoin(base, path.lstrip("/"))


def _request_signature_url(request: HttpRequest) -> str:
    base = str(settings.TWILIO_PUBLIC_BASE_URL or "").rstrip("/")
    if base:
        url = f"{base}{request.path}"
        if request.META.get("QUERY_STRING"):
            url += f"?{request.META['QUERY_STRING']}"
        return url
    return request.build_absolute_uri()


def _signature_is_valid(request: HttpRequest) -> bool:
    if not settings.TWILIO_VALIDATE_SIGNATURES:
        return bool(settings.DEBUG)
    auth_token = str(settings.TWILIO_AUTH_TOKEN or "")
    signature = request.headers.get("X-Twilio-Signature", "")
    if not auth_token or not signature:
        return False
    return RequestValidator(auth_token).validate(
        _request_signature_url(request),
        request.POST,
        signature,
    )


def _valid_twilio_request(request: HttpRequest) -> bool:
    if not _signature_is_valid(request):
        logger.warning("Rejected Twilio request with an invalid signature at %s", request.path)
        return False
    configured_sid = str(settings.TWILIO_ACCOUNT_SID or "")
    received_sid = request.POST.get("AccountSid", "")
    if configured_sid and not hmac.compare_digest(configured_sid, received_sid):
        logger.warning("Rejected Twilio request with an unexpected account SID")
        return False
    return True


def _xml(response: VoiceResponse, *, status: int = 200) -> HttpResponse:
    return HttpResponse(str(response), status=status, content_type="text/xml; charset=utf-8")


def _spoken_unavailable() -> HttpResponse:
    response = VoiceResponse()
    response.say(
        "Por el momento no podemos atender llamadas. Por favor intenta más tarde.",
        language="es-MX",
    )
    response.hangup()
    return _xml(response)


def _spoken_rate_limited() -> HttpResponse:
    response = VoiceResponse()
    response.say(
        "Hemos recibido varias llamadas recientes desde este número. "
        "Por favor intenta nuevamente dentro de una hora.",
        language="es-MX",
    )
    response.hangup()
    return _xml(response)


def _configured_for_voice() -> bool:
    return all(
        (
            settings.TWILIO_ACCOUNT_SID,
            settings.TWILIO_AUTH_TOKEN,
            settings.TWILIO_PHONE_NUMBER,
            settings.TWILIO_PUBLIC_BASE_URL,
            settings.TWILIO_STREAM_URL,
            settings.OPENAI_API_KEY,
        )
    )


def _stream_response(call: VoiceCall) -> HttpResponse:
    if not voice_stream_capacity_available(exclude_call_id=call.id):
        return _manual_follow_up(
            call,
            failure_reason="El agente alcanzó temporalmente el límite de llamadas simultáneas.",
            spoken_message=(
                "En este momento todas nuestras líneas virtuales están ocupadas. "
                "Una persona de FUTSI podrá dar seguimiento. Hasta luego."
            ),
            summary="Llamada sin reserva por límite temporal de capacidad del agente.",
        )
    # The plaintext token exists only long enough to build this TwiML response.
    # The bridge atomically consumes the hash on the first WebSocket claim.
    stream_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(stream_token.encode("utf-8")).hexdigest()
    extracted_data = dict(call.extracted_data or {})
    extracted_data.pop("requires_manual_follow_up", None)
    extracted_data.pop("privacy_blocked", None)
    extracted_data.pop("age_band", None)
    extracted_data["stream_token_hash"] = token_hash
    call.extracted_data = extracted_data
    call.save(update_fields=["extracted_data", "updated_at"])

    response = VoiceResponse()
    connect = Connect()
    stream = Stream(
        url=settings.TWILIO_STREAM_URL,
        status_callback=_public_url("/api/voice/twilio/stream-status/"),
        status_callback_method="POST",
    )
    stream.parameter(name="callSid", value=call.call_sid)
    stream.parameter(name="streamToken", value=stream_token)
    connect.append(stream)
    response.append(connect)
    response.hangup()
    return _xml(response)


def _manual_follow_up(
    call: VoiceCall,
    *,
    failure_reason: str,
    spoken_message: str,
    summary: str = "",
) -> HttpResponse:
    extracted_data = dict(call.extracted_data or {})
    extracted_data.pop("stream_token_hash", None)
    extracted_data.pop("age_band", None)
    extracted_data.pop("privacy_blocked", None)
    extracted_data["requires_manual_follow_up"] = True
    call.extracted_data = extracted_data
    call.ai_outcome = CallOutcome.UNSUCCESSFUL
    call.failure_reason = failure_reason
    call.summary = summary or (
        "La llamada requiere seguimiento manual; no se abrió una sesión de OpenAI."
    )
    call.save(
        update_fields=[
            "extracted_data",
            "ai_outcome",
            "failure_reason",
            "summary",
            "updated_at",
        ]
    )

    response = VoiceResponse()
    response.say(spoken_message, language="es-MX")
    response.hangup()
    return _xml(response)


def _mark_unsuccessful_if_pending(
    call: VoiceCall,
    *,
    failure_reason: str,
    summary: str,
) -> None:
    if call.booking_id or call.ai_outcome != CallOutcome.PENDING:
        return
    call.ai_outcome = CallOutcome.UNSUCCESSFUL
    call.failure_reason = failure_reason
    if not call.summary:
        call.summary = summary
    call.save(
        update_fields=[
            "ai_outcome",
            "failure_reason",
            "summary",
            "updated_at",
        ]
    )


@csrf_exempt
@require_POST
def incoming_call(request: HttpRequest) -> HttpResponse:
    if not _valid_twilio_request(request):
        return HttpResponse(status=403)
    if not _configured_for_voice():
        logger.error("Voice webhook is not fully configured")
        return _spoken_unavailable()

    call_sid = request.POST.get("CallSid", "")
    from_number = request.POST.get("From", "")[:32]
    to_number = request.POST.get("To", "")[:32]
    if not CALL_SID_PATTERN.fullmatch(call_sid):
        return HttpResponse(status=400)
    expected_to = "".join(ch for ch in str(settings.TWILIO_PHONE_NUMBER) if ch.isdigit())
    received_to = "".join(ch for ch in to_number if ch.isdigit())
    if expected_to and not hmac.compare_digest(expected_to, received_to):
        logger.warning("Rejected Twilio request for an unexpected destination number")
        return HttpResponse(status=403)
    call: VoiceCall | None = None
    rate_limited = False
    with transaction.atomic():
        lock_caller_hourly_limit(from_number=from_number)
        if caller_hourly_limit_reached(
            call_sid=call_sid,
            from_number=from_number,
        ):
            rate_limited = True
        else:
            call, _created = VoiceCall.objects.get_or_create(
                call_sid=call_sid,
                defaults={
                    "from_number": from_number,
                    "to_number": to_number,
                    "technical_status": VoiceCallTechnicalStatus.IN_PROGRESS,
                    "started_at": timezone.now(),
                },
            )
            changed_fields: list[str] = []
            if call.from_number != from_number:
                call.from_number = from_number
                changed_fields.append("from_number")
            if call.to_number != to_number:
                call.to_number = to_number
                changed_fields.append("to_number")
            if call.technical_status != VoiceCallTechnicalStatus.IN_PROGRESS:
                call.technical_status = VoiceCallTechnicalStatus.IN_PROGRESS
                changed_fields.append("technical_status")
            if call.started_at is None:
                call.started_at = timezone.now()
                changed_fields.append("started_at")
            if changed_fields:
                call.save(update_fields=[*changed_fields, "updated_at"])

    if rate_limited:
        logger.warning("Rate-limited repeated inbound voice calls")
        return _spoken_rate_limited()
    if call is None:  # Defensive guard; both branches above assign a terminal state.
        return _spoken_unavailable()

    if not call.consent_granted:
        call.consent_granted = True
        call.consent_granted_at = timezone.now()
        call.save(
            update_fields=[
                "consent_granted",
                "consent_granted_at",
                "updated_at",
            ]
        )
    return _stream_response(call)


@csrf_exempt
@require_POST
def consent_call(request: HttpRequest) -> HttpResponse:
    if not _valid_twilio_request(request):
        return HttpResponse(status=403)
    call_sid = request.POST.get("CallSid", "")
    if not CALL_SID_PATTERN.fullmatch(call_sid):
        return HttpResponse(status=400)
    try:
        call = VoiceCall.objects.get(call_sid=call_sid)
    except VoiceCall.DoesNotExist:
        return HttpResponse(status=404)

    response = VoiceResponse()
    if request.POST.get("Digits") != "1":
        if request.POST.get("Digits"):
            failure_reason = "La persona no otorgo consentimiento para transcribir."
            summary = "Llamada finalizada porque no se otorgo consentimiento."
        else:
            failure_reason = "La llamada termino sin confirmar el consentimiento."
            summary = "Llamada finalizada sin respuesta al aviso de consentimiento."
        _mark_unsuccessful_if_pending(
            call,
            failure_reason=failure_reason,
            summary=summary,
        )
        response.say(
            "No se otorgó autorización para transcribir. La llamada finalizará.",
            language="es-MX",
        )
        response.hangup()
        return _xml(response)

    extracted_data = dict(call.extracted_data or {})
    extracted_data.pop("stream_token_hash", None)
    extracted_data.pop("age_band", None)
    extracted_data.pop("privacy_blocked", None)
    extracted_data.pop("requires_manual_follow_up", None)
    call.consent_granted = True
    call.consent_granted_at = timezone.now()
    call.extracted_data = extracted_data
    call.save(
        update_fields=[
            "consent_granted",
            "consent_granted_at",
            "extracted_data",
            "updated_at",
        ]
    )

    return _stream_response(call)


@csrf_exempt
@require_POST
def call_status(request: HttpRequest) -> HttpResponse:
    if not _valid_twilio_request(request):
        return HttpResponse(status=403)
    call_sid = request.POST.get("CallSid", "")
    if not CALL_SID_PATTERN.fullmatch(call_sid):
        return HttpResponse(status=400)
    try:
        call = VoiceCall.objects.get(call_sid=call_sid)
    except VoiceCall.DoesNotExist:
        return HttpResponse(status=204)

    changed_fields: list[str] = []
    status_value = request.POST.get("CallStatus", "")
    if status_value in VALID_TECHNICAL_STATUSES and call.technical_status != status_value:
        call.technical_status = status_value
        changed_fields.append("technical_status")
    duration_value = request.POST.get("CallDuration") or request.POST.get("Duration")
    if duration_value and duration_value.isdigit():
        call.duration_seconds = min(int(duration_value), 24 * 60 * 60)
        changed_fields.append("duration_seconds")
    terminal_status = status_value in {
        VoiceCallTechnicalStatus.COMPLETED,
        VoiceCallTechnicalStatus.BUSY,
        VoiceCallTechnicalStatus.FAILED,
        VoiceCallTechnicalStatus.NO_ANSWER,
        VoiceCallTechnicalStatus.CANCELED,
    }
    if terminal_status and call.ended_at is None:
        call.ended_at = timezone.now()
        changed_fields.append("ended_at")
    if (
        terminal_status
        and not call.booking_id
        and call.ai_outcome == CallOutcome.PENDING
    ):
        call.ai_outcome = CallOutcome.UNSUCCESSFUL
        changed_fields.append("ai_outcome")
        if call.consent_granted:
            call.failure_reason = "La llamada termino sin una reserva confirmada."
            default_summary = "Llamada finalizada sin completar la reserva."
        else:
            call.failure_reason = "La llamada termino sin confirmar el consentimiento."
            default_summary = "Llamada finalizada sin consentimiento ni reserva."
        changed_fields.append("failure_reason")
        if not call.summary:
            call.summary = default_summary
            changed_fields.append("summary")
    if changed_fields:
        call.save(update_fields=[*set(changed_fields), "updated_at"])
    return HttpResponse(status=204)


@csrf_exempt
@require_POST
def stream_status(request: HttpRequest) -> HttpResponse:
    if not _valid_twilio_request(request):
        return HttpResponse(status=403)
    call_sid = request.POST.get("CallSid", "")
    if not CALL_SID_PATTERN.fullmatch(call_sid):
        return HttpResponse(status=400)
    try:
        call = VoiceCall.objects.get(call_sid=call_sid)
    except VoiceCall.DoesNotExist:
        return HttpResponse(status=204)
    event = request.POST.get("StreamEvent", "")
    stream_sid = request.POST.get("StreamSid", "")[:80]
    changed_fields: list[str] = []
    if stream_sid and call.stream_sid != stream_sid:
        call.stream_sid = stream_sid
        changed_fields.append("stream_sid")
    if event == "stream-error":
        call.sanitized_error = request.POST.get("StreamError", "Twilio Media Stream error")
        changed_fields.append("sanitized_error")
    if changed_fields:
        call.save(update_fields=[*changed_fields, "updated_at"])
    return HttpResponse(status=204)
