from __future__ import annotations

import json
import logging
from pathlib import Path
from threading import Lock
from typing import Any

from django.conf import settings
from twilio.rest import Client


logger = logging.getLogger(__name__)
TEMPLATE_VERSION = 1
MAX_LIST_OPTIONS = 10
_cache_lock = Lock()
_memory_cache: dict[str, str] = {}


class InteractiveMessageError(RuntimeError):
    """Raised when Twilio cannot prepare or send rich WhatsApp content."""


def _cache_path() -> Path:
    return Path(settings.BASE_DIR) / ".twilio-whatsapp-content-cache.json"


def _template_key(kind: str, option_count: int | None = None) -> str:
    if kind == "list":
        return f"list_v{TEMPLATE_VERSION}_{int(option_count or 0)}"
    if kind == "age_range":
        return f"age_range_v{TEMPLATE_VERSION}"
    return f"confirm_v{TEMPLATE_VERSION}"


def _friendly_name(kind: str, option_count: int | None = None) -> str:
    if kind == "list":
        return f"futsi_list_picker_es_v{TEMPLATE_VERSION}_{int(option_count or 0):02d}"
    if kind == "age_range":
        return f"futsi_age_range_es_v{TEMPLATE_VERSION}"
    return f"futsi_trial_confirm_es_v{TEMPLATE_VERSION}"


def _client() -> Client:
    account_sid = str(settings.TWILIO_ACCOUNT_SID or "")
    auth_token = str(settings.TWILIO_AUTH_TOKEN or "")
    if not account_sid or not auth_token:
        raise InteractiveMessageError("Faltan credenciales de Twilio para mensajes interactivos.")
    return Client(account_sid, auth_token)


def _load_disk_cache() -> dict[str, str]:
    path = _cache_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return {}
    if payload.get("account_sid") != settings.TWILIO_ACCOUNT_SID:
        return {}
    templates = payload.get("templates")
    if not isinstance(templates, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in templates.items()
        if str(value).startswith("HX")
    }


def _save_disk_cache(templates: dict[str, str]) -> None:
    path = _cache_path()
    payload = {
        "account_sid": settings.TWILIO_ACCOUNT_SID,
        "template_version": TEMPLATE_VERSION,
        "templates": templates,
    }
    try:
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("Could not persist Twilio Content SID cache: %s", exc)


def _list_template_request(contents, option_count: int):
    items = []
    variables: dict[str, str] = {
        "1": "Selecciona una opción",
        "2": "Ver opciones",
    }
    text_lines = ["{{1}}"]
    for index in range(1, option_count + 1):
        title_key = str(3 + (index - 1) * 3)
        description_key = str(4 + (index - 1) * 3)
        id_key = str(5 + (index - 1) * 3)
        variables[title_key] = f"Opción {index}"
        variables[description_key] = "Selecciona esta opción"
        variables[id_key] = f"choice:{index}"
        text_lines.append(f"{index}. {{{{{title_key}}}}}")
        items.append(
            contents.ListItem(
                {
                    "item": f"{{{{{title_key}}}}}",
                    "description": f"{{{{{description_key}}}}}",
                    "id": f"{{{{{id_key}}}}}",
                }
            )
        )
    text_lines.append("Responde con el número si no ves el menú.")
    types = contents.Types(
        {
            "twilio/text": contents.TwilioText({"body": "\n".join(text_lines)}),
            "twilio/list-picker": contents.TwilioListPicker(
                {
                    "body": "{{1}}",
                    "button": "{{2}}",
                    "items": items,
                }
            ),
        }
    )
    return contents.ContentCreateRequest(
        {
            "friendly_name": _friendly_name("list", option_count),
            "language": "es",
            "variables": variables,
            "types": types,
        }
    )


def _confirmation_template_request(contents):
    types = contents.Types(
        {
            "twilio/text": contents.TwilioText(
                {
                    "body": (
                        "{{1}}\nResponde CONFIRMAR para agendar, CAMBIAR para elegir "
                        "otros horarios o CANCELAR."
                    )
                }
            ),
            "twilio/quick-reply": contents.TwilioQuickReply(
                {
                    "body": "{{1}}",
                    "actions": [
                        contents.QuickReplyAction(
                            {"title": "Confirmar", "id": "confirmar"}
                        ),
                        contents.QuickReplyAction(
                            {"title": "Cambiar horarios", "id": "cambiar"}
                        ),
                        contents.QuickReplyAction(
                            {"title": "Cancelar", "id": "cancelar"}
                        ),
                    ],
                }
            ),
        }
    )
    return contents.ContentCreateRequest(
        {
            "friendly_name": _friendly_name("confirm"),
            "language": "es",
            "variables": {"1": "Revisa los datos de tu prueba gratuita."},
            "types": types,
        }
    )


def _age_range_template_request(contents):
    body = "Selecciona el rango de edad del niño o niña."
    types = contents.Types(
        {
            "twilio/text": contents.TwilioText(
                {"body": f"{body}\nTambién puedes responder con la edad exacta."}
            ),
            "twilio/quick-reply": contents.TwilioQuickReply(
                {
                    "body": body,
                    "actions": [
                        contents.QuickReplyAction(
                            {"title": "3 a 7 años", "id": "age_range:3:7"}
                        ),
                        contents.QuickReplyAction(
                            {"title": "8 a 12 años", "id": "age_range:8:12"}
                        ),
                        contents.QuickReplyAction(
                            {"title": "13 a 17 años", "id": "age_range:13:17"}
                        ),
                    ],
                }
            ),
        }
    )
    return contents.ContentCreateRequest(
        {
            "friendly_name": _friendly_name("age_range"),
            "language": "es",
            "variables": {},
            "types": types,
        }
    )


def ensure_interactive_templates(*, max_list_options: int = 6) -> dict[str, str]:
    """Discover or create reusable in-session templates and cache their SIDs."""

    max_list_options = max(1, min(int(max_list_options), MAX_LIST_OPTIONS))
    required = {
        *(_template_key("list", count) for count in range(1, max_list_options + 1)),
        _template_key("age_range"),
        _template_key("confirm"),
    }
    with _cache_lock:
        if not _memory_cache:
            _memory_cache.update(_load_disk_cache())
        if required.issubset(_memory_cache):
            return {key: _memory_cache[key] for key in sorted(required)}

        client = _client()
        contents = client.content.v1.contents
        try:
            existing = contents.list(limit=1000)
        except Exception as exc:
            raise InteractiveMessageError(
                "No fue posible consultar las plantillas interactivas de Twilio."
            ) from exc
        sid_by_name = {
            str(item.friendly_name): str(item.sid)
            for item in existing
            if getattr(item, "friendly_name", None) and getattr(item, "sid", None)
        }

        for count in range(1, max_list_options + 1):
            key = _template_key("list", count)
            if key in _memory_cache:
                continue
            friendly_name = _friendly_name("list", count)
            sid = sid_by_name.get(friendly_name)
            if not sid:
                try:
                    sid = contents.create(_list_template_request(contents, count)).sid
                except Exception as exc:
                    raise InteractiveMessageError(
                        f"Twilio no pudo crear la lista interactiva de {count} opciones."
                    ) from exc
            _memory_cache[key] = str(sid)

        confirm_key = _template_key("confirm")
        if confirm_key not in _memory_cache:
            friendly_name = _friendly_name("confirm")
            sid = sid_by_name.get(friendly_name)
            if not sid:
                try:
                    sid = contents.create(_confirmation_template_request(contents)).sid
                except Exception as exc:
                    raise InteractiveMessageError(
                        "Twilio no pudo crear los botones de confirmación."
                    ) from exc
            _memory_cache[confirm_key] = str(sid)

        age_range_key = _template_key("age_range")
        if age_range_key not in _memory_cache:
            friendly_name = _friendly_name("age_range")
            sid = sid_by_name.get(friendly_name)
            if not sid:
                try:
                    sid = contents.create(_age_range_template_request(contents)).sid
                except Exception as exc:
                    raise InteractiveMessageError(
                        "Twilio no pudo crear los botones para elegir la edad."
                    ) from exc
            _memory_cache[age_range_key] = str(sid)

        _save_disk_cache(_memory_cache)
        return {key: _memory_cache[key] for key in sorted(required)}


def _list_variables(*, body: str, button: str, options: list[dict[str, str]]) -> str:
    values: dict[str, str] = {
        "1": str(body)[:1024],
        "2": str(button)[:20],
    }
    for index, option in enumerate(options, 1):
        values[str(3 + (index - 1) * 3)] = str(option["title"])[:24]
        values[str(4 + (index - 1) * 3)] = str(option["description"])[:72]
        values[str(5 + (index - 1) * 3)] = str(option["id"])[:200]
    return json.dumps(values, ensure_ascii=False)


def send_list_picker(
    *,
    to_address: str,
    from_address: str,
    body: str,
    button: str,
    options: list[dict[str, str]],
) -> str:
    if not 1 <= len(options) <= MAX_LIST_OPTIONS:
        raise InteractiveMessageError("La lista interactiva debe tener entre 1 y 10 opciones.")
    templates = ensure_interactive_templates(max_list_options=len(options))
    content_sid = templates[_template_key("list", len(options))]
    try:
        message = _client().messages.create(
            to=to_address,
            from_=from_address,
            content_sid=content_sid,
            content_variables=_list_variables(body=body, button=button, options=options),
        )
    except Exception as exc:
        raise InteractiveMessageError("Twilio no pudo enviar la lista interactiva.") from exc
    return str(message.sid)


def send_confirmation_buttons(
    *,
    to_address: str,
    from_address: str,
    body: str,
) -> str:
    templates = ensure_interactive_templates(max_list_options=1)
    content_sid = templates[_template_key("confirm")]
    try:
        message = _client().messages.create(
            to=to_address,
            from_=from_address,
            content_sid=content_sid,
            content_variables=json.dumps({"1": str(body)[:1024]}, ensure_ascii=False),
        )
    except Exception as exc:
        raise InteractiveMessageError("Twilio no pudo enviar los botones interactivos.") from exc
    return str(message.sid)


def send_age_range_buttons(*, to_address: str, from_address: str) -> str:
    templates = ensure_interactive_templates(max_list_options=1)
    content_sid = templates[_template_key("age_range")]
    try:
        message = _client().messages.create(
            to=to_address,
            from_=from_address,
            content_sid=content_sid,
        )
    except Exception as exc:
        raise InteractiveMessageError(
            "Twilio no pudo enviar los botones para elegir la edad."
        ) from exc
    return str(message.sid)
