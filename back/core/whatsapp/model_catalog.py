"""Read-only OpenAI model discovery. Never send prompts or expose credentials."""
import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


class ModelCatalogError(Exception):
    pass


def supports_assistant(model_id):
    # /models exposes IDs, not endpoint capabilities. Only enable known text
    # Responses families; do not infer support for unknown/specialist models.
    base = model_id.split(":")[1] if model_id.startswith("ft:") and ":" in model_id else model_id
    if any(part in base for part in ("audio", "realtime", "transcribe", "tts", "search", "deep-research", "codex")):
        return False
    return bool(re.fullmatch(
        r"(?:gpt-(?:4o|4\.1|4\.5|5(?:\.\d+)?|6(?:\.\d+)?)|o[134])(?:-[a-z0-9.]+)*",
        base,
    ))


def list_models():
    key = str(getattr(settings, "OPENAI_API_KEY", "") or "").strip()
    if not key:
        raise ModelCatalogError("No hay una clave de OpenAI configurada en este servidor.")
    request = Request("https://api.openai.com/v1/models",
                      headers={"Authorization": f"Bearer {key}"}, method="GET")
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise ValueError("Invalid catalog")
        ids = sorted({row["id"] for row in payload["data"]
                      if isinstance(row, dict) and isinstance(row.get("id"), str)
                      and 0 < len(row["id"]) <= 120})
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise ModelCatalogError("OpenAI no permitió consultar los modelos. Revisa la clave y sus permisos en el servidor.") from None
        raise ModelCatalogError("OpenAI no pudo devolver el catálogo. Intenta actualizarlo en unos momentos.") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ModelCatalogError("No fue posible consultar los modelos de OpenAI. Intenta de nuevo.") from None
    return {"models": [{"id": model, "selectable": supports_assistant(model)} for model in ids],
            "source": "openai",
            "note": "Modelos visibles para la clave configurada. Se habilitan las familias de texto compatibles conocidas; la disponibilidad no garantiza cuota ni saldo."}
