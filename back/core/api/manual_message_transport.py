import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from django.conf import settings

from core.whatsapp.meta_api import (
    MetaWhatsAppError,
    _access_token,
    configured_business_address,
    send_text,
)


def _service_configuration() -> tuple[str, str] | None:
    base = str(settings.WHATSAPP_SERVICE_URL or "").rstrip("/")
    token = str(settings.WHATSAPP_SERVICE_TOKEN or "").strip()
    parsed = urlsplit(base)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not token
    ):
        return None
    return base, token


def channel_can_send_text(address: str) -> bool:
    address = str(address or "").strip()
    if not address:
        return False
    if address == configured_business_address():
        return True
    return _service_configuration() is not None


def send_text_for_channel(*, address: str, to_phone: str, body: str) -> str:
    address = str(address or "").strip()
    if address == configured_business_address() and _access_token():
        return send_text(to_phone=to_phone, body=body)

    service = _service_configuration()
    if service is None:
        raise MetaWhatsAppError("No hay un servicio de envío configurado para este número.")
    base, token = service
    request = Request(
        base + "/api/internal/text-send/",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        data=json.dumps(
            {
                "business_address": address,
                "to_phone": to_phone,
                "body": body,
            },
            ensure_ascii=False,
        ).encode("utf-8"),
    )
    try:
        with urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))
        message_id = result.get("message_id") if isinstance(result, dict) else None
        if not message_id:
            raise ValueError("Missing message id")
        return str(message_id)[:255]
    except HTTPError as exc:
        detail = "El servicio rechazó el envío."
        try:
            payload = json.loads(exc.read(8192))
            if isinstance(payload, dict) and isinstance(payload.get("detail"), str):
                detail = payload["detail"][:500]
        except (ValueError, AttributeError):
            pass
        raise MetaWhatsAppError(detail, delivery_uncertain=exc.code >= 500) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise MetaWhatsAppError(
            "No se pudo confirmar el resultado. Revisa el historial antes de reintentar.",
            delivery_uncertain=True,
        ) from None
