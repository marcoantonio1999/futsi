import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from django.conf import settings
from core.whatsapp.meta_api import MetaWhatsAppError, configured_business_address, _access_token
from core.whatsapp.template_catalog import list_templates


def catalog_for_channel(address, after=""):
    # Use an explicitly configured local connection when available. Otherwise the
    # standalone service owns the credentials and validates the selected number.
    if address == configured_business_address() and _access_token() and settings.DUALHOOK_WABA_ID:
        return list_templates(address, after)
    base = str(settings.WHATSAPP_SERVICE_URL or "").rstrip("/")
    if not base:
        return list_templates(address, after)
    if not base.startswith("https://") or not settings.WHATSAPP_SERVICE_TOKEN:
        raise MetaWhatsAppError("Falta configurar el acceso seguro al servicio de WhatsApp.")
    request = Request(base + "/api/internal/templates/?" + urlencode({"business_address": address, "after": after}),
        headers={"Authorization": f"Bearer {settings.WHATSAPP_SERVICE_TOKEN}"}, method="GET")
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise MetaWhatsAppError(f"El servicio no pudo consultar este catálogo (HTTP {exc.code}). Verifica que esté actualizado y conectado a este número.") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise MetaWhatsAppError("No fue posible consultar las plantillas del servicio de WhatsApp.") from None
    if not isinstance(payload, dict) or payload.get("business_address") != address or not isinstance(payload.get("templates"), list):
        raise MetaWhatsAppError("La respuesta del catálogo no corresponde al número seleccionado.")
    return payload


def mutate_template_for_channel(address, *, method, payload):
    base = str(settings.WHATSAPP_SERVICE_URL or "").rstrip("/")
    if not base.startswith("https://") or not settings.WHATSAPP_SERVICE_TOKEN:
        raise MetaWhatsAppError("Falta configurar el acceso seguro para administrar plantillas.")
    request = Request(
        base + "/api/internal/templates/",
        headers={"Authorization": f"Bearer {settings.WHATSAPP_SERVICE_TOKEN}", "Content-Type": "application/json"},
        data=json.dumps({"business_address": address, **payload}, ensure_ascii=False).encode("utf-8"),
        method=method,
    )
    try:
        with urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = "El servicio de WhatsApp rechazó la operación de plantilla."
        if exc.code == 400:
            try:
                parsed = json.loads(exc.read(8192).decode("utf-8"))
                if isinstance(parsed, dict) and isinstance(parsed.get("detail"), str):
                    detail = parsed["detail"][:500]
            except (ValueError, UnicodeDecodeError):
                pass
        raise MetaWhatsAppError(detail, delivery_uncertain=exc.code >= 500) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise MetaWhatsAppError("No fue posible confirmar la operación de plantilla.", delivery_uncertain=True) from None
    if not isinstance(result, dict) or result.get("business_address") != address:
        raise MetaWhatsAppError("La respuesta de la operación no corresponde al número seleccionado.", delivery_uncertain=True)
    return result
