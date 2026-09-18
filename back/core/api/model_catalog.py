import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from core.whatsapp.model_catalog import list_models, ModelCatalogError


def assistant_models():
    if str(getattr(settings, "OPENAI_API_KEY", "") or "").strip():
        return list_models()
    base = str(getattr(settings, "WHATSAPP_SERVICE_URL", "") or "").rstrip("/")
    token = str(getattr(settings, "WHATSAPP_SERVICE_TOKEN", "") or "")
    if not base.startswith("https://") or not token:
        raise ModelCatalogError("Configura OpenAI en el servidor o la conexión segura con el servicio de WhatsApp para consultar sus modelos.")
    request = Request(base + "/api/internal/openai-models/",
                      headers={"Authorization": f"Bearer {token}"}, method="GET")
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("models"), list):
            raise ValueError("Invalid catalog")
        # Forward only catalog fields, never upstream credentials or errors.
        return {"models": [{"id": row["id"], "selectable": row.get("selectable") is True}
                           for row in payload["models"] if isinstance(row, dict)
                           and isinstance(row.get("id"), str)],
                "source": "whatsapp-service"}
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        raise ModelCatalogError("No se pudo consultar el catálogo del servicio de WhatsApp. Revisa su configuración y que esté actualizado.") from None
