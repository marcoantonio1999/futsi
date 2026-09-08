from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings
from django.db import OperationalError, ProgrammingError

from core.models import WhatsAppAutomationSettings
from core.whatsapp.defaults import (
    DEFAULT_WHATSAPP_ASSISTANT_INSTRUCTIONS,
    DEFAULT_WHATSAPP_WELCOME_MESSAGE,
)


@dataclass(frozen=True)
class WhatsAppAssistantProfile:
    welcome_message: str
    assistant_instructions: str
    model: str
    site_id: int | None = None


def get_whatsapp_assistant_profile(business_address: str) -> WhatsAppAssistantProfile:
    record = None
    if business_address:
        try:
            record = WhatsAppAutomationSettings.objects.filter(
                business_address=business_address,
            ).first()
        except (OperationalError, ProgrammingError):
            # Backward-compatible startup while the owning service migrates.
            record = None
    return WhatsAppAssistantProfile(
        welcome_message=(
            str(getattr(record, "welcome_message", "") or "").strip()
            or DEFAULT_WHATSAPP_WELCOME_MESSAGE
        ),
        assistant_instructions=(
            str(getattr(record, "assistant_instructions", "") or "").strip()
            or DEFAULT_WHATSAPP_ASSISTANT_INSTRUCTIONS
        ),
        model=(
            str(getattr(record, "openai_model", "") or "").strip()
            or str(getattr(settings, "OPENAI_WHATSAPP_MODEL", "") or "").strip()
        ),
        site_id=getattr(record, "site_id", None),
    )
