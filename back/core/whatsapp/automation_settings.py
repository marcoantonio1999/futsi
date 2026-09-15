from __future__ import annotations

from dataclasses import dataclass

from django.db import OperationalError, ProgrammingError

from core.models import WhatsAppAutomationSettings
from core.whatsapp.defaults import (
    DEFAULT_WHATSAPP_ASSISTANT_INSTRUCTIONS,
    DEFAULT_WHATSAPP_WELCOME_MESSAGE,
)


def is_bot_enabled(business_address: str) -> bool:
    if not business_address:
        return False
    try:
        enabled = WhatsAppAutomationSettings.objects.filter(
            business_address=business_address,
        ).values_list("bot_enabled", flat=True).first()
        return True if enabled is None else enabled
    except (OperationalError, ProgrammingError):
        return False


def cancel_pending_bot_replies(business_address: str) -> None:
    """Caller owns a transaction. Keep history and permanent human takeovers."""
    from core.models import WhatsAppConversation, WhatsAppMessage, WhatsAppOutboundDispatch
    from django.utils import timezone

    for conversation in WhatsAppConversation.objects.select_for_update().filter(
        to_address=business_address, context__has_key="human_response_wait",
    ):
        context = dict(conversation.context or {})
        context.pop("human_response_wait", None)
        conversation.context = context
        conversation.save(update_fields=["context", "updated_at"])
    inbound_ids = WhatsAppMessage.objects.filter(
        conversation__to_address=business_address, direction="inbound",
    ).values("provider_sid")
    WhatsAppOutboundDispatch.objects.filter(
        conversation__to_address=business_address,
        status="reserved", in_reply_to_sid__in=inbound_ids,
    ).update(status="failed", error_message="Automatic reply cancelled: chatbot switch changed.", updated_at=timezone.now())


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
