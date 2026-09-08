import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from django.conf import settings
from core.whatsapp.meta_api import MetaWhatsAppError, configured_business_address, _access_token, _base_payload, _post_message


def send_template_payload(address, phone, template):
    if address == configured_business_address() and _access_token():
        return _post_message({**_base_payload(phone), "type": "template", "template": template})
    base = str(settings.WHATSAPP_SERVICE_URL or "").rstrip("/")
    if not base.startswith("https://") or not settings.WHATSAPP_SERVICE_TOKEN:
        raise MetaWhatsAppError("No hay un servicio de envío configurado para este número.")
    request = Request(base + "/api/internal/template-send/", method="POST",
        headers={"Authorization": f"Bearer {settings.WHATSAPP_SERVICE_TOKEN}", "Content-Type": "application/json"},
        data=json.dumps({"business_address": address, "to_phone": phone, "template": template}).encode())
    try:
        with urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode())
        if not isinstance(result, dict) or not result.get("message_id"):
            raise ValueError("Missing message id")
        return str(result["message_id"])
    except HTTPError as exc:
        raise MetaWhatsAppError(f"El servicio rechazó el envío (HTTP {exc.code}).", delivery_uncertain=exc.code >= 500) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise MetaWhatsAppError("No se pudo confirmar el resultado. Revisa el historial antes de reintentar.", delivery_uncertain=True) from None
