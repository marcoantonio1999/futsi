from __future__ import annotations

from dataclasses import dataclass

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


def get_whatsapp_assistant_profile(business_address: str) -> WhatsAppAssistantProfile:
    record = None
    if business_address:
        try:
            record = WhatsAppAutomationSettings.objects.filter(
                business_address=business_address,
            ).first()
        except (OperationalError, ProgrammingError):
            # Keep the webhook usable while the shared settings migration deploys.
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
    )
