"""Read-only, connection-scoped provider template catalog."""
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from django.conf import settings
from django.utils import timezone
from core.whatsapp.meta_api import MetaWhatsAppError, configured_business_address, _access_token


def list_templates(address, after=""):
    if not address or address != configured_business_address():
        raise MetaWhatsAppError("No hay conexión de catálogo configurada para este número.")
    waba = str(getattr(settings, "DUALHOOK_WABA_ID", "") or "").strip()
    version = str(settings.META_WHATSAPP_GRAPH_VERSION or "").strip()
    provider = str(settings.META_WHATSAPP_PROVIDER or "meta").lower()
    base = str(settings.DUALHOOK_API_BASE_URL).rstrip("/") if provider == "dualhook" else "https://graph.facebook.com"
    if not re.fullmatch(r"[0-9]+", waba) or not re.fullmatch(r"v[0-9]+\.[0-9]+", version) or not _access_token():
        raise MetaWhatsAppError("Falta configurar la WABA o las credenciales del catálogo.")
    if not base.startswith("https://") or len(after) > 2048:
        raise MetaWhatsAppError("Configuración o paginación inválida.")
    query = {"fields": "id,name,language,status,category,rejected_reason,components", "limit": "100"}
    if after:
        query["after"] = after
    # Never follow provider-supplied next URLs: credentials stay on the configured host.
    request = Request(f"{base}/{version}/{waba}/message_templates?{urlencode(query)}",
                      headers={"Authorization": f"Bearer {_access_token()}"}, method="GET")
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise MetaWhatsAppError(f"No se pudo consultar el catálogo (HTTP {exc.code}). Revisa los permisos de la conexión.") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise MetaWhatsAppError("No se pudo conectar con el catálogo de plantillas.") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise MetaWhatsAppError("El proveedor devolvió un catálogo incompleto.")
    rows = []
    for item in payload["data"]:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        # Exclude sample data and remote media URLs; return display-only fields.
        components = []
        for component in item.get("components", []) if isinstance(item.get("components"), list) else []:
            if not isinstance(component, dict):
                continue
            components.append({
                "type": str(component.get("type", ""))[:50],
                "format": str(component.get("format", ""))[:50],
                "text": str(component.get("text", ""))[:10000],
                "buttons": [{"type": str(b.get("type", ""))[:50], "text": str(b.get("text", ""))[:200]}
                            for b in component.get("buttons", []) if isinstance(b, dict)]
                           if isinstance(component.get("buttons"), list) else [],
            })
        rows.append({**{key: str(item.get(key) or "")[:1000] for key in
                        ("id", "name", "language", "status", "category", "rejected_reason")},
                     "components": components})
    paging = payload.get("paging") if isinstance(payload.get("paging"), dict) else {}
    cursors = paging.get("cursors") if isinstance(paging.get("cursors"), dict) else {}
    cursor = str(cursors.get("after") or "")[:2048] if paging.get("next") else ""
    return {"business_address": address, "waba_id": waba, "provider": provider,
            "fetched_at": timezone.now().isoformat(), "templates": rows, "next_cursor": cursor}
