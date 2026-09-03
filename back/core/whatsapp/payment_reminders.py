from __future__ import annotations

import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.utils import timezone

from core.models import (
    Charge,
    WhatsAppConversation,
    WhatsAppConversationStatus,
    WhatsAppConversationStep,
    WhatsAppMessage,
    WhatsAppMessageDirection,
)
from core.serializers import charge_balance
from core.whatsapp.meta_api import MetaWhatsAppError, send_payment_reminder


E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def _normalize_phone(raw_phone: str) -> str:
    raw = str(raw_phone or "").strip()
    digits = "".join(character for character in raw if character.isdigit())
    normalized = f"+{digits}"
    if not E164_PATTERN.fullmatch(normalized):
        raise MetaWhatsAppError(
            "El responsable no tiene un teléfono válido en formato internacional."
        )
    return normalized


def _payer_details(charge: Charge) -> tuple[str, str, str]:
    if charge.student_id and charge.student and charge.student.guardian_id:
        guardian = charge.student.guardian
        return guardian.full_name, guardian.phone, charge.student.full_name
    if charge.team_id and charge.team:
        return (
            charge.team.representative_name,
            charge.team.representative_phone,
            charge.team.name,
        )
    raise MetaWhatsAppError("El cargo no tiene un responsable con teléfono.")


def _send_via_whatsapp_service(*, charge, contact_phone, payer_name, subject_name, balance):
    base_url = str(getattr(settings, "WHATSAPP_SERVICE_URL", "") or "").rstrip("/")
    token = str(getattr(settings, "WHATSAPP_SERVICE_TOKEN", "") or "")
    if not base_url:
        return None
    if not base_url.startswith("https://") or not token:
        raise MetaWhatsAppError(
            "El servicio independiente de WhatsApp no está configurado de forma segura."
        )
    due_label = charge.due_date.isoformat() if charge.due_date else "sin fecha límite"
    payload = {
        "to_phone": contact_phone,
        "payer_name": payer_name or "Responsable",
        "subject_name": subject_name or "alumno",
        "concept": charge.concept,
        "balance": str(balance),
        "due_date": due_label,
        "site_id": charge.site_id,
        "charge_id": charge.id,
    }
    request = Request(
        f"{base_url}/api/internal/payment-reminders/",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(
            request,
            timeout=int(getattr(settings, "WHATSAPP_SERVICE_TIMEOUT_SECONDS", 20)),
        ) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise MetaWhatsAppError(
            f"El servicio de WhatsApp rechazó el recordatorio (HTTP {exc.code})."
        ) from exc
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise MetaWhatsAppError(
            "No fue posible conectar con el servicio independiente de WhatsApp."
        ) from exc
    if not isinstance(result, dict) or not result.get("message_id"):
        raise MetaWhatsAppError("El servicio de WhatsApp devolvió una respuesta incompleta.")
    return result


def send_charge_payment_reminder(charge: Charge) -> dict:
    if charge.status in {"paid", "canceled"}:
        raise MetaWhatsAppError("Este cargo ya no tiene un saldo abierto.")
    balance = charge_balance(charge)
    if balance <= 0:
        raise MetaWhatsAppError("Este cargo ya no tiene saldo pendiente.")

    payer_name, raw_phone, subject_name = _payer_details(charge)
    contact_phone = _normalize_phone(raw_phone)
    remote_result = _send_via_whatsapp_service(
        charge=charge,
        contact_phone=contact_phone,
        payer_name=payer_name,
        subject_name=subject_name,
        balance=balance,
    )
    if remote_result is not None:
        return remote_result
    due_label = charge.due_date.isoformat() if charge.due_date else "sin fecha límite"
    message_id = send_payment_reminder(
        to_phone=contact_phone,
        payer_name=payer_name or "Responsable",
        subject_name=subject_name or "alumno",
        concept=charge.concept,
        balance=balance,
        due_date=due_label,
    )

    now = timezone.now()
    display_number = "".join(
        character
        for character in str(settings.META_WHATSAPP_DISPLAY_NUMBER or "")
        if character.isdigit()
    )
    conversation = WhatsAppConversation.objects.create(
        contact_phone=contact_phone,
        from_address=f"whatsapp:{contact_phone}",
        to_address=(
            f"whatsapp:+{display_number}"
            if display_number
            else f"meta:{settings.META_WHATSAPP_PHONE_NUMBER_ID}"
        ),
        status=WhatsAppConversationStatus.COMPLETED,
        current_step=WhatsAppConversationStep.FINISHED,
        site=charge.site,
        context={
            "kind": "payment_reminder",
            "charge_id": charge.id,
            "payer_name": payer_name,
            "subject_name": subject_name,
            "concept": charge.concept,
            "balance": str(balance),
            "due_date": due_label,
        },
        last_message_at=now,
    )
    visible_body = (
        f"Recordatorio de pago para {subject_name}: {charge.concept}, "
        f"saldo ${balance}, fecha límite {due_label}."
    )
    WhatsAppMessage.objects.create(
        conversation=conversation,
        provider_sid=message_id,
        direction=WhatsAppMessageDirection.OUTBOUND,
        body=visible_body,
    )
    return {
        "conversation_id": conversation.id,
        "message_id": message_id,
        "contact_phone": contact_phone,
    }
