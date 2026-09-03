from __future__ import annotations

import json
import logging
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


logger = logging.getLogger(__name__)
MAX_LIST_OPTIONS = 10
MAX_REPLY_BUTTONS = 3


class MetaWhatsAppError(RuntimeError):
    """Raised when the Meta WhatsApp API cannot accept a message."""


def configured_business_address() -> str:
    """Return the stable inbox address for the configured WhatsApp number."""

    display_digits = "".join(
        character
        for character in str(settings.META_WHATSAPP_DISPLAY_NUMBER or "")
        if character.isdigit()
    )
    if display_digits:
        return f"whatsapp:+{display_digits}"
    phone_number_id = str(settings.META_WHATSAPP_PHONE_NUMBER_ID or "").strip()
    return f"meta:{phone_number_id}" if phone_number_id else ""


def _messages_url() -> str:
    version = str(settings.META_WHATSAPP_GRAPH_VERSION or "").strip()
    phone_number_id = str(settings.META_WHATSAPP_PHONE_NUMBER_ID or "").strip()
    if not version or not phone_number_id:
        raise MetaWhatsAppError("Falta configurar el número de WhatsApp Cloud API.")
    if str(settings.META_WHATSAPP_PROVIDER or "meta").strip().lower() == "dualhook":
        base_url = str(settings.DUALHOOK_API_BASE_URL or "").strip().rstrip("/")
        if not base_url.startswith("https://"):
            raise MetaWhatsAppError("La URL de Dualhook no es válida.")
        return f"{base_url}/{version}/{phone_number_id}/messages"
    return f"https://graph.facebook.com/{version}/{phone_number_id}/messages"


def _access_token() -> str:
    provider = str(settings.META_WHATSAPP_PROVIDER or "meta").strip().lower()
    if provider == "dualhook":
        return str(settings.DUALHOOK_API_KEY or "").strip()
    return str(settings.META_WHATSAPP_ACCESS_TOKEN or "").strip()


def _post_message(payload: dict) -> str:
    token = _access_token()
    if not token:
        raise MetaWhatsAppError("Falta configurar el token del proveedor de WhatsApp.")
    request = Request(
        _messages_url(),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        logger.warning("WhatsApp provider rejected a message with HTTP %s", exc.code)
        raise MetaWhatsAppError(
            f"El proveedor rechazó el mensaje de WhatsApp (HTTP {exc.code})."
        ) from exc
    except (URLError, TimeoutError, ValueError, OSError) as exc:
        raise MetaWhatsAppError(
            "No fue posible conectar con el proveedor de WhatsApp."
        ) from exc
    messages = result.get("messages") if isinstance(result, dict) else None
    message_id = messages[0].get("id") if messages and isinstance(messages[0], dict) else ""
    if not message_id:
        raise MetaWhatsAppError("El proveedor no devolvió el identificador del mensaje.")
    return str(message_id)[:255]


def _base_payload(to_phone: str) -> dict:
    digits = "".join(character for character in str(to_phone) if character.isdigit())
    # WhatsApp can still report Mexican mobile wa_ids with the legacy +521
    # prefix. Meta's test-recipient allowlist stores the current +52 format,
    # so outbound messages must remove that obsolete mobile marker.
    if len(digits) == 13 and digits.startswith("521"):
        digits = "52" + digits[3:]
    if not 8 <= len(digits) <= 15:
        raise MetaWhatsAppError("El contacto no tiene un teléfono válido para WhatsApp.")
    return {"messaging_product": "whatsapp", "recipient_type": "individual", "to": digits}


def send_text(*, to_phone: str, body: str) -> str:
    payload = _base_payload(to_phone)
    payload.update(
        {
            "type": "text",
            "text": {"preview_url": False, "body": str(body)[:4096]},
        }
    )
    return _post_message(payload)


def send_location(
    *,
    to_phone: str,
    latitude: Decimal | float | str,
    longitude: Decimal | float | str,
    name: str,
    address: str,
) -> str:
    try:
        latitude_value = float(latitude)
        longitude_value = float(longitude)
    except (TypeError, ValueError) as exc:
        raise MetaWhatsAppError("La ubicación no tiene coordenadas válidas.") from exc
    if not -90 <= latitude_value <= 90 or not -180 <= longitude_value <= 180:
        raise MetaWhatsAppError("La ubicación está fuera del rango permitido.")
    payload = _base_payload(to_phone)
    payload.update(
        {
            "type": "location",
            "location": {
                "latitude": latitude_value,
                "longitude": longitude_value,
                "name": str(name)[:1000],
                "address": str(address)[:1000],
            },
        }
    )
    return _post_message(payload)


def send_list(
    *,
    to_phone: str,
    body: str,
    button: str,
    options: list[dict[str, str]],
) -> str:
    if not 1 <= len(options) <= MAX_LIST_OPTIONS:
        raise MetaWhatsAppError("La lista debe tener entre 1 y 10 opciones.")
    payload = _base_payload(to_phone)
    rows = [
        {
            "id": str(option["id"])[:200],
            "title": str(option["title"])[:24],
            "description": str(option.get("description") or "")[:72],
        }
        for option in options
    ]
    payload.update(
        {
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": str(body)[:1024]},
                "action": {
                    "button": str(button)[:20],
                    "sections": [{"title": "Opciones disponibles", "rows": rows}],
                },
            },
        }
    )
    return _post_message(payload)


def send_buttons(
    *,
    to_phone: str,
    body: str,
    buttons: list[dict[str, str]],
) -> str:
    if not 1 <= len(buttons) <= MAX_REPLY_BUTTONS:
        raise MetaWhatsAppError("El mensaje debe tener entre 1 y 3 botones.")
    payload = _base_payload(to_phone)
    payload.update(
        {
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": str(body)[:1024]},
                "action": {
                    "buttons": [
                        {
                            "type": "reply",
                            "reply": {
                                "id": str(button["id"])[:200],
                                "title": str(button["title"])[:20],
                            },
                        }
                        for button in buttons
                    ]
                },
            },
        }
    )
    return _post_message(payload)


def send_payment_reminder(
    *,
    to_phone: str,
    payer_name: str,
    subject_name: str,
    concept: str,
    balance: Decimal | str,
    due_date: str,
) -> str:
    template_name = str(settings.META_WHATSAPP_PAYMENT_TEMPLATE or "").strip()
    language = str(settings.META_WHATSAPP_TEMPLATE_LANGUAGE or "").strip()
    if not template_name or not language:
        raise MetaWhatsAppError("Falta configurar la plantilla de recordatorio de pago.")
    payload = _base_payload(to_phone)
    values = [payer_name, subject_name, concept, str(balance), due_date]
    payload.update(
        {
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language},
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {"type": "text", "text": str(value)[:1024]}
                            for value in values
                        ],
                    }
                ],
            },
        }
    )
    return _post_message(payload)
