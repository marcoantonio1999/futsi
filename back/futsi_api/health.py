import os
import re
from urllib.parse import urlparse

from django.conf import settings
from django.db import DatabaseError
from django.db import connection
from django.db.models import Q
from django.http import JsonResponse


RELEASE_MARKER = "faceguard-collaborator-20260724-v4"


def index(request):
    return JsonResponse(
        {
            "name": "Futsi API",
            "status": "ok",
            "health": "/health/",
            "voice_health": "/health/voice/",
            "whatsapp_health": "/health/whatsapp/",
            "meta_whatsapp_health": "/health/whatsapp/meta/",
            "api": "/api/",
        }
    )


def health(request):
    return JsonResponse(
        {
            "status": "ok",
            "release": RELEASE_MARKER,
            "commit": os.getenv("RENDER_GIT_COMMIT", ""),
        }
    )


def db_health(request):
    with connection.cursor() as cursor:
        cursor.execute("select 1")
        cursor.fetchone()
    return JsonResponse(
        {
            "status": "ok",
            "database": "ok",
            "release": RELEASE_MARKER,
            "commit": os.getenv("RENDER_GIT_COMMIT", ""),
        }
    )


def voice_health(request):
    """Expose readiness booleans without returning credentials or provider IDs."""

    public_url = urlparse(str(settings.TWILIO_PUBLIC_BASE_URL or ""))
    stream_url = urlparse(str(settings.TWILIO_STREAM_URL or ""))
    secure_transport = bool(
        public_url.scheme == "https"
        and public_url.netloc
        and public_url.path in {"", "/"}
        and not public_url.params
        and not public_url.query
        and not public_url.fragment
        and not public_url.username
        and stream_url.scheme == "wss"
        and stream_url.netloc
        and stream_url.path == "/ws/voice/twilio/"
        and not stream_url.params
        and not stream_url.query
        and not stream_url.fragment
        and not stream_url.username
        and stream_url.hostname == public_url.hostname
    )
    configured = bool(
        all(
            (
                settings.OPENAI_API_KEY,
                settings.TWILIO_ACCOUNT_SID,
                settings.TWILIO_AUTH_TOKEN,
                settings.TWILIO_PHONE_NUMBER,
                settings.TWILIO_PUBLIC_BASE_URL,
                settings.TWILIO_STREAM_URL,
            )
        )
        and str(settings.OPENAI_API_KEY).startswith("sk-")
        and len(str(settings.OPENAI_API_KEY)) >= 20
        and re.fullmatch(r"AC[a-fA-F0-9]{32}", str(settings.TWILIO_ACCOUNT_SID))
        and re.fullmatch(r"[a-fA-F0-9]{32}", str(settings.TWILIO_AUTH_TOKEN))
        and re.fullmatch(r"\+[1-9]\d{7,14}", str(settings.TWILIO_PHONE_NUMBER))
    )
    try:
        from core.models import TrialAvailabilityRule

        active_rules = TrialAvailabilityRule.objects.filter(
            is_active=True,
            site__is_active=True,
        ).filter(Q(court__isnull=True) | Q(court__is_active=True)).count()
        database_available = True
    except DatabaseError:
        active_rules = None
        database_available = False

    ready = bool(
        configured
        and secure_transport
        and settings.TWILIO_VALIDATE_SIGNATURES
        and database_available
        and active_rules
    )
    return JsonResponse(
        {
            "status": "ready" if ready else "not_ready",
            "configured": configured,
            "secure_transport": secure_transport,
            "signature_validation": bool(settings.TWILIO_VALIDATE_SIGNATURES),
            "database": database_available,
            "active_availability_rules": active_rules,
        },
        status=200 if ready else 503,
    )


def whatsapp_health(request):
    """Confirm the local webhook can safely accept WhatsApp messages."""

    public_url = urlparse(str(settings.TWILIO_PUBLIC_BASE_URL or ""))
    secure_transport = bool(
        public_url.scheme == "https"
        and public_url.netloc
        and public_url.path in {"", "/"}
        and not public_url.params
        and not public_url.query
        and not public_url.fragment
        and not public_url.username
    )
    configured = bool(
        re.fullmatch(r"AC[a-fA-F0-9]{32}", str(settings.TWILIO_ACCOUNT_SID))
        and re.fullmatch(r"[a-fA-F0-9]{32}", str(settings.TWILIO_AUTH_TOKEN))
        and re.fullmatch(r"\+[1-9]\d{7,14}", str(settings.TWILIO_WHATSAPP_NUMBER))
    )
    try:
        from core.models import TrialAvailabilityRule

        active_rules = TrialAvailabilityRule.objects.filter(
            is_active=True,
            site__is_active=True,
        ).filter(Q(court__isnull=True) | Q(court__is_active=True)).count()
        database_available = True
    except DatabaseError:
        active_rules = None
        database_available = False

    ready = bool(
        configured
        and secure_transport
        and settings.TWILIO_VALIDATE_SIGNATURES
        and database_available
        and active_rules
    )
    return JsonResponse(
        {
            "status": "ready" if ready else "not_ready",
            "configured": configured,
            "secure_transport": secure_transport,
            "signature_validation": bool(settings.TWILIO_VALIDATE_SIGNATURES),
            "database": database_available,
            "active_availability_rules": active_rules,
            "webhook_path": "/api/whatsapp/twilio/incoming/",
        },
        status=200 if ready else 503,
    )


def meta_whatsapp_health(request):
    """Expose Meta WhatsApp readiness without returning any secret or token."""

    provider = str(settings.META_WHATSAPP_PROVIDER or "meta").strip().lower()
    phone_number_id = str(settings.META_WHATSAPP_PHONE_NUMBER_ID or "")
    graph_version = str(settings.META_WHATSAPP_GRAPH_VERSION or "")
    common_configured = bool(
        phone_number_id.isdigit()
        and settings.META_WHATSAPP_VERIFY_TOKEN
        and re.fullmatch(r"v\d+\.\d+", graph_version)
    )
    if provider == "dualhook":
        validation_mode = "dualhook_asset_ids"
        validation_ready = bool(settings.DUALHOOK_WABA_ID)
        configured = bool(
            common_configured
            and settings.DUALHOOK_API_KEY
            and settings.DUALHOOK_WABA_ID
            and str(settings.DUALHOOK_API_BASE_URL or "").startswith("https://")
        )
    else:
        validation_mode = "meta_hmac"
        validation_ready = bool(
            settings.META_WHATSAPP_VALIDATE_SIGNATURES
            and settings.META_WHATSAPP_APP_SECRET
        )
        configured = bool(
            common_configured
            and settings.META_WHATSAPP_ACCESS_TOKEN
            and settings.META_WHATSAPP_APP_SECRET
        )
    try:
        from core.models import TrialAvailabilityRule

        active_rules = TrialAvailabilityRule.objects.filter(
            is_active=True,
            site__is_active=True,
        ).filter(Q(court__isnull=True) | Q(court__is_active=True)).count()
        database_available = True
    except DatabaseError:
        active_rules = None
        database_available = False

    ready = bool(
        configured
        and validation_ready
        and database_available
        and active_rules
    )
    return JsonResponse(
        {
            "status": "ready" if ready else "not_ready",
            "configured": configured,
            "provider": provider,
            "signature_validation": validation_ready,
            "validation_mode": validation_mode,
            "database": database_available,
            "active_availability_rules": active_rules,
            "webhook_path": "/api/whatsapp/meta/webhook/",
            "payment_template_configured": bool(
                settings.META_WHATSAPP_PAYMENT_TEMPLATE
                and settings.META_WHATSAPP_TEMPLATE_LANGUAGE
            ),
            "faq_assistant_configured": bool(
                settings.OPENAI_WHATSAPP_FAQ_ENABLED
                and settings.OPENAI_API_KEY
                and settings.OPENAI_WHATSAPP_MODEL
            ),
            "faq_model": (
                settings.OPENAI_WHATSAPP_MODEL
                if settings.OPENAI_WHATSAPP_FAQ_ENABLED
                else None
            ),
        },
        status=200 if ready else 503,
    )
