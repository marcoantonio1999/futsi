from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import unicodedata

from django.conf import settings
from django.db import transaction
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core.models import (
    Site,
    TrialBooking,
    WhatsAppConversation,
    WhatsAppConversationStatus,
    WhatsAppConversationStep,
    WhatsAppMessage,
    WhatsAppMessageDirection,
    WhatsAppOutboundDispatch,
    WhatsAppOutboundDispatchStatus,
)
from core.whatsapp.ai_faq import OpenAIWhatsAppError, answer_faq
from core.whatsapp.automation_settings import get_whatsapp_assistant_profile
from core.whatsapp.meta_api import (
    MetaWhatsAppError,
    configured_business_address,
    send_buttons,
    send_list,
    send_location,
    send_text,
)
from core.voice.scheduling import (
    SchedulingError,
    book_two_trial_visits_from_whatsapp,
)
from core.whatsapp.twilio_webhooks import (
    _clean_person_name,
    _first_visit_options,
    _format_slot,
    _second_visit_options,
)


logger = logging.getLogger(__name__)
PHONE_PATTERN = re.compile(r"^[1-9]\d{7,14}$")
DUALHOOK_DIRECT_FIELDS = {
    "messages",
    "smb_message_echoes",
    "smb_app_state_sync",
    "history",
}
BOLD_TERM_PATTERN = re.compile(
    r"(?<!\*)\b(prueba gratuita|academia|torneos)\b(?!\*)",
    re.IGNORECASE,
)
NO_SCHEDULE_PROMPT = (
    "¡Hola! 👋 Estás hablando con el asistente virtual de *B Power Academy*. "
    "Por ahora no tenemos horarios disponibles para la *prueba gratuita*, pero "
    "puedo ayudarte con información sobre la *academia*, costos y uniforme. 😊"
)
FAQ_PROMPT = (
    "¡Claro! 😊 Escríbeme tu pregunta sobre *B Power Academy*. Puedo ayudarte con "
    "la *academia*, costos, horarios, uniforme o la *prueba gratuita*."
)


def _welcome_prompt(business_address: str) -> str:
    return get_whatsapp_assistant_profile(business_address).welcome_message


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return " ".join(
        "".join(character for character in normalized if not unicodedata.combining(character))
        .casefold()
        .strip()
        .split()
    )


def _bold_whatsapp_terms(value: str) -> str:
    """Apply WhatsApp bold without altering the original capitalization."""
    text = str(value or "")
    markdown_bold = re.compile(
        r"\*\*((?:prueba gratuita|academia|torneos)(?:\s*:)?)[*]{2}",
        re.IGNORECASE,
    )
    text = markdown_bold.sub(lambda match: f"*{match.group(1)}*", text)
    return BOLD_TERM_PATTERN.sub(lambda match: f"*{match.group(0)}*", text)


def _is_greeting(value: str) -> bool:
    return _normalize_text(value) in {
        "hola",
        "buen dia",
        "buenas",
        "buenas tardes",
        "buenas noches",
        "inicio",
        "menu",
    }


def _booking_requested(value: str) -> bool:
    command = _normalize_text(value)
    if command in {"menu:book", "agendar", "reservar", "agendar prueba", "reservar prueba"}:
        return True
    return any(
        phrase in command
        for phrase in (
            "quiero agendar",
            "quiero reservar",
            "quiero una prueba",
            "agendar una prueba",
            "reservar una prueba",
            "hacer una cita",
        )
    )


def _affirmative_requested(value: str) -> bool:
    return _normalize_text(value) in {
        "si",
        "si quiero",
        "si, quiero",
        "menu:book",
        "quiero",
        "claro",
    }


def _faq_requested(value: str) -> bool:
    return _normalize_text(value) in {"menu:faq", "pregunta", "hacer una pregunta"}


def _location_requested(value: str) -> bool:
    command = _normalize_text(value)
    return any(
        phrase in command
        for phrase in (
            "ubicacion",
            "direccion",
            "donde estan",
            "donde entrenan",
            "donde juegan",
            "donde se juegan",
            "como llego",
            "como llegar",
            "mandame el mapa",
            "manda el mapa",
        )
    )


def _looks_like_question(value: str) -> bool:
    command = _normalize_text(value)
    return "?" in str(value or "") or command.startswith(
        (
            "que ",
            "como ",
            "cuando ",
            "cuanto ",
            "cual ",
            "donde ",
            "puedo ",
            "puede ",
            "tienen ",
            "debo ",
            "necesito saber ",
        )
    )


def _default_site() -> Site | None:
    code = str(settings.META_WHATSAPP_DEFAULT_SITE_CODE or "").strip()
    return Site.objects.filter(code=code, is_active=True).first()


def _schedule_options(site_id: int) -> list[dict]:
    """Return compact two-visit packages, with the earliest package as default."""
    packages = []
    seen = set()
    for first in _first_visit_options(site_id):
        for second in _second_visit_options(site_id, first)[:2]:
            key = (first.get("starts_at"), second.get("starts_at"))
            if key in seen:
                continue
            seen.add(key)
            packages.append({"first": first, "second": second})
            if len(packages) >= 10:
                return packages
    return packages


def _menu_context(site: Site | None) -> dict:
    schedules = _schedule_options(site.id) if site else []
    return {
        "kind": "menu",
        "booking_available": bool(schedules),
        "schedule_options": schedules,
    }


def _new_menu_conversation(
    *, from_address: str, to_address: str, contact_phone: str
) -> WhatsAppConversation:
    site = _default_site()
    return WhatsAppConversation.objects.create(
        contact_phone=contact_phone,
        from_address=from_address,
        to_address=to_address,
        current_step=WhatsAppConversationStep.MENU,
        site=site,
        context=_menu_context(site),
        last_message_at=timezone.now(),
    )


def _new_faq_conversation(
    *, from_address: str, to_address: str, contact_phone: str
) -> WhatsAppConversation:
    return WhatsAppConversation.objects.create(
        contact_phone=contact_phone,
        from_address=from_address,
        to_address=to_address,
        current_step=WhatsAppConversationStep.FAQ,
        site=_default_site(),
        context={"kind": "faq", "openai_usage": {}},
        last_message_at=timezone.now(),
    )


def _schedule_prompt(package: dict) -> str:
    return (
        "Te propongo este horario para las dos visitas gratuitas:\n"
        f"1ª visita: {_format_slot(package['first'])}\n"
        f"2ª visita: {_format_slot(package['second'])}\n\n"
        "¿Te funciona?"
    )


def _start_booking_for_existing(conversation: WhatsAppConversation) -> str:
    site = _default_site()
    schedules = _schedule_options(site.id) if site else []
    conversation.site = site
    conversation.booking = None
    conversation.failure_reason = ""
    if not schedules:
        conversation.current_step = WhatsAppConversationStep.MENU
        conversation.context = {
            "kind": "menu",
            "booking_available": False,
            "schedule_options": [],
        }
        reply = NO_SCHEDULE_PROMPT
    else:
        conversation.current_step = WhatsAppConversationStep.CHOOSE_FIRST_VISIT
        conversation.context = {
            "kind": "trial_booking",
            "fast_booking": True,
            "schedule_options": schedules,
            "show_schedule_options": False,
        }
        reply = _schedule_prompt(schedules[0])
    conversation.save(
        update_fields=[
            "site",
            "booking",
            "failure_reason",
            "current_step",
            "context",
            "updated_at",
        ]
    )
    return reply


def _start_booking_for_new_contact(
    *, from_address: str, to_address: str, contact_phone: str
) -> tuple[WhatsAppConversation, str]:
    conversation = _new_menu_conversation(
        from_address=from_address,
        to_address=to_address,
        contact_phone=contact_phone,
    )
    return conversation, _start_booking_for_existing(conversation)


def _move_to_menu(conversation: WhatsAppConversation) -> str:
    site = _default_site()
    conversation.current_step = WhatsAppConversationStep.MENU
    conversation.site = site
    conversation.context = _menu_context(site)
    conversation.failure_reason = ""
    conversation.save(
        update_fields=["current_step", "site", "context", "failure_reason", "updated_at"]
    )
    return (
        _welcome_prompt(conversation.to_address)
        if conversation.context["booking_available"]
        else NO_SCHEDULE_PROMPT
    )


def _normalize_contact_phone(value: str, fallback: str) -> str | None:
    command = _normalize_text(value)
    if command in {"contact:same", "usar este numero", "este numero"}:
        return fallback
    digits = "".join(character for character in str(value or "") if character.isdigit())
    if digits.startswith("521") and len(digits) == 13:
        digits = "52" + digits[3:]
    elif len(digits) == 10:
        digits = "52" + digits
    if not 8 <= len(digits) <= 15 or digits.startswith("0"):
        return None
    return "+" + digits


def _fast_current_prompt(conversation: WhatsAppConversation) -> str:
    context = dict(conversation.context or {})
    step = conversation.current_step
    if step == WhatsAppConversationStep.CHOOSE_FIRST_VISIT:
        schedules = context.get("schedule_options") or []
        if not schedules:
            return NO_SCHEDULE_PROMPT
        if context.get("show_schedule_options"):
            return "Elige otro paquete de horarios de la lista."
        return _schedule_prompt(schedules[0])
    if step == WhatsAppConversationStep.RESPONSIBLE_NAME:
        return "¿Cuál es el nombre del padre, madre o responsable?"
    if step == WhatsAppConversationStep.CHILD_NAME:
        return "¿Cuál es el nombre del niño o niña?"
    if step == WhatsAppConversationStep.CONTACT_PHONE:
        return "¿Cuál es el número de teléfono de contacto?"
    return _welcome_prompt(conversation.to_address)


def _finish_booking(conversation: WhatsAppConversation) -> str:
    context = dict(conversation.context or {})
    try:
        result = book_two_trial_visits_from_whatsapp(
            site_id=conversation.site_id,
            responsible_name=context["responsible_name"],
            responsible_phone=context["responsible_phone"],
            child_first_name=context["child_first_name"],
            child_age=None,
            visits=[context["first_visit"], context["second_visit"]],
        )
    except (KeyError, SchedulingError):
        schedules = _schedule_options(conversation.site_id)
        for key in ("first_visit", "second_visit"):
            context.pop(key, None)
        context["schedule_options"] = schedules
        context["show_schedule_options"] = False
        conversation.context = context
        conversation.current_step = (
            WhatsAppConversationStep.CHOOSE_FIRST_VISIT
            if schedules
            else WhatsAppConversationStep.MENU
        )
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        if not schedules:
            return NO_SCHEDULE_PROMPT
        return "Ese horario acaba de ocuparse. Te propongo el siguiente:\n\n" + _schedule_prompt(
            schedules[0]
        )

    conversation.booking = TrialBooking.objects.get(pk=result["booking_id"])
    conversation.status = WhatsAppConversationStatus.COMPLETED
    conversation.current_step = WhatsAppConversationStep.FINISHED
    conversation.save(update_fields=["booking", "status", "current_step", "updated_at"])
    return (
        f"¡Listo, {context['responsible_name']}! 🎉 La prueba de "
        f"{context['child_first_name']} quedó agendada.\n"
        f"1ª visita: {_format_slot(context['first_visit'])}\n"
        f"2ª visita: {_format_slot(context['second_visit'])}\n\n"
        "¡Les esperamos en *B Power Academy*! ⚽💚"
    )


def _select_schedule(conversation: WhatsAppConversation, package: dict) -> str:
    context = dict(conversation.context or {})
    context["first_visit"] = package["first"]
    context["second_visit"] = package["second"]
    context["show_schedule_options"] = False
    conversation.context = context
    if all(
        context.get(key)
        for key in ("responsible_name", "child_first_name", "responsible_phone")
    ):
        conversation.save(update_fields=["context", "updated_at"])
        return _finish_booking(conversation)
    conversation.current_step = WhatsAppConversationStep.RESPONSIBLE_NAME
    conversation.save(update_fields=["context", "current_step", "updated_at"])
    return "¡Perfecto! 😊 ¿Cuál es el nombre del padre, madre o responsable?"


def _advance_fast_booking(conversation: WhatsAppConversation, body: str) -> str:
    command = _normalize_text(body)
    context = dict(conversation.context or {})
    step = conversation.current_step

    if step in {
        WhatsAppConversationStep.CHOOSE_SITE,
        WhatsAppConversationStep.CHOOSE_SECOND_VISIT,
        WhatsAppConversationStep.CHILD_AGE,
        WhatsAppConversationStep.CONFIRM,
    }:
        return _start_booking_for_existing(conversation)

    if step == WhatsAppConversationStep.CHOOSE_FIRST_VISIT:
        schedules = context.get("schedule_options") or []
        if not schedules:
            return _start_booking_for_existing(conversation)
        if command in {"schedule:other", "elegir otro", "otro", "cambiar"}:
            context["show_schedule_options"] = True
            conversation.context = context
            conversation.save(update_fields=["context", "updated_at"])
            return "Claro 😊 Elige el paquete de horarios que prefieras."
        if command in {"schedule:default", "si", "si, continuar", "continuar", "1"}:
            return _select_schedule(conversation, schedules[0])
        if command.startswith("schedule:"):
            command = command.removeprefix("schedule:")
        if command.isdigit() and 1 <= int(command) <= len(schedules):
            return _select_schedule(conversation, schedules[int(command) - 1])
        return "Selecciona “Sí, continuar” o “Elegir otro”."

    if step == WhatsAppConversationStep.RESPONSIBLE_NAME:
        name = _clean_person_name(body, max_length=160)
        if len(name) < 3 or name.isdigit():
            return "Escribe el nombre del padre, madre o responsable, por favor."
        context["responsible_name"] = name
        conversation.context = context
        conversation.current_step = WhatsAppConversationStep.CHILD_NAME
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        return "Gracias 😊 ¿Cuál es el nombre del niño o niña?"

    if step == WhatsAppConversationStep.CHILD_NAME:
        name = _clean_person_name(body, max_length=100)
        if len(name) < 2 or name.isdigit():
            return "Escribe el nombre del niño o niña, por favor."
        context["child_first_name"] = name
        conversation.context = context
        conversation.current_step = WhatsAppConversationStep.CONTACT_PHONE
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        return (
            "¿Cuál es el número de teléfono de contacto? Puedes escribirlo o usar "
            "el mismo número de este chat."
        )

    if step == WhatsAppConversationStep.CONTACT_PHONE:
        phone = _normalize_contact_phone(body, conversation.contact_phone)
        if not phone:
            return "No reconocí el número. Escríbelo con 10 dígitos, por ejemplo 55 1234 5678."
        context["responsible_phone"] = phone
        conversation.context = context
        conversation.save(update_fields=["context", "updated_at"])
        return _finish_booking(conversation)

    return _start_booking_for_existing(conversation)


def _location_reply(conversation: WhatsAppConversation) -> str:
    context = dict(conversation.context or {})
    if conversation.current_step == WhatsAppConversationStep.FAQ:
        context["kind"] = "faq"
    else:
        context.setdefault("kind", "trial_booking")
    context["_send_location"] = True
    conversation.context = context
    conversation.save(update_fields=["context", "updated_at"])
    return (
        f"📍 {settings.META_WHATSAPP_LOCATION_NAME}\n"
        f"{settings.META_WHATSAPP_LOCATION_ADDRESS}\n"
        f"Teléfono {settings.META_WHATSAPP_CONTACT_PHONE}"
    )


def _faq_answer(conversation: WhatsAppConversation, body: str) -> str:
    try:
        answer = answer_faq(conversation=conversation, user_message=body)
    except OpenAIWhatsAppError:
        logger.exception("OpenAI returned an unusable WhatsApp FAQ response")
        answer_text = (
            "Gracias por escribirnos 😊 En este momento no pude consultar esa información. "
            "Una persona del equipo puede darte seguimiento."
        )
        conversation.follow_up_required = True
        conversation.follow_up_updated_at = timezone.now()
        conversation.save(
            update_fields=["follow_up_required", "follow_up_updated_at", "updated_at"]
        )
        return answer_text

    context = dict(conversation.context or {})
    if conversation.current_step == WhatsAppConversationStep.FAQ:
        context["kind"] = "faq"
    else:
        context.setdefault("kind", "trial_booking")
    if answer.model:
        context["openai_model"] = answer.model
    if answer.usage:
        totals = dict(context.get("openai_usage") or {})
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            totals[key] = int(totals.get(key) or 0) + int(answer.usage.get(key) or 0)
        context["openai_usage"] = totals
    conversation.context = context
    update_fields = ["context", "updated_at"]
    if answer.needs_human:
        conversation.follow_up_required = True
        conversation.follow_up_updated_at = timezone.now()
        update_fields.extend(["follow_up_required", "follow_up_updated_at"])
    conversation.save(update_fields=update_fields)
    return answer.text


def _route_message(
    *,
    conversation: WhatsAppConversation | None,
    from_address: str,
    to_address: str,
    contact_phone: str,
    body: str,
    selection: str,
) -> tuple[WhatsAppConversation, str]:
    intent_value = selection or body
    if conversation is None:
        if _booking_requested(intent_value) or _affirmative_requested(intent_value):
            return _start_booking_for_new_contact(
                from_address=from_address,
                to_address=to_address,
                contact_phone=contact_phone,
            )
        if _is_greeting(intent_value):
            conversation = _new_menu_conversation(
                from_address=from_address,
                to_address=to_address,
                contact_phone=contact_phone,
            )
            reply = (
                _welcome_prompt(to_address)
                if conversation.context.get("booking_available")
                else NO_SCHEDULE_PROMPT
            )
            return conversation, reply
        conversation = _new_faq_conversation(
            from_address=from_address,
            to_address=to_address,
            contact_phone=contact_phone,
        )
        if _location_requested(intent_value):
            return conversation, _location_reply(conversation)
        return conversation, _faq_answer(conversation, body)

    if conversation.current_step == WhatsAppConversationStep.MENU:
        if _booking_requested(intent_value) or _affirmative_requested(intent_value):
            return conversation, _start_booking_for_existing(conversation)
        if _is_greeting(intent_value):
            return conversation, _welcome_prompt(conversation.to_address)
        conversation.current_step = WhatsAppConversationStep.FAQ
        conversation.context = {"kind": "faq", "openai_usage": {}}
        conversation.save(update_fields=["current_step", "context", "updated_at"])
        if _faq_requested(intent_value):
            return conversation, FAQ_PROMPT
        if _location_requested(intent_value):
            return conversation, _location_reply(conversation)
        return conversation, _faq_answer(conversation, body)

    if conversation.current_step == WhatsAppConversationStep.FAQ:
        if _booking_requested(intent_value) or _affirmative_requested(intent_value):
            return conversation, _start_booking_for_existing(conversation)
        if _is_greeting(intent_value):
            return conversation, _move_to_menu(conversation)
        if _faq_requested(intent_value):
            return conversation, FAQ_PROMPT
        if _location_requested(intent_value):
            return conversation, _location_reply(conversation)
        return conversation, _faq_answer(conversation, body)

    if _location_requested(intent_value):
        return conversation, _location_reply(conversation)

    if _looks_like_question(body):
        answer = _faq_answer(conversation, body)
        context = dict(conversation.context or {})
        context["_reply_as_text"] = True
        conversation.context = context
        conversation.save(update_fields=["context", "updated_at"])
        return (
            conversation,
            answer + "\n\nPara continuar con tu reserva: " + _fast_current_prompt(conversation),
        )

    return conversation, _advance_fast_booking(conversation, selection)


def _configured() -> bool:
    provider = str(settings.META_WHATSAPP_PROVIDER or "meta").strip().lower()
    common = bool(
        settings.META_WHATSAPP_PHONE_NUMBER_ID
        and settings.META_WHATSAPP_VERIFY_TOKEN
    )
    if provider == "dualhook":
        return bool(common and settings.DUALHOOK_API_KEY and settings.DUALHOOK_WABA_ID)
    return bool(
        common
        and settings.META_WHATSAPP_ACCESS_TOKEN
        and settings.META_WHATSAPP_APP_SECRET
    )


def _dualhook_payload_is_valid(request: HttpRequest) -> bool:
    """Validate direct Meta deliveries for a Dualhook-managed connection.

    Meta signs these requests with Dualhook's private app secret, which cannot be
    shared with customers. Dualhook therefore recommends binding the payload to
    the expected WABA and phone-number identifiers instead.
    """

    expected_waba_id = str(settings.DUALHOOK_WABA_ID or "").strip()
    expected_phone_id = str(settings.META_WHATSAPP_PHONE_NUMBER_ID or "").strip()
    if not expected_waba_id or not expected_phone_id:
        return False
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    if not isinstance(payload, dict) or payload.get("object") != "whatsapp_business_account":
        return False
    entries = payload.get("entry")
    if not isinstance(entries, list) or not entries:
        return False
    for entry in entries:
        if not isinstance(entry, dict) or str(entry.get("id") or "") != expected_waba_id:
            return False
        changes = entry.get("changes")
        if not isinstance(changes, list) or not changes:
            return False
        for change in changes:
            if not isinstance(change, dict):
                return False
            field = str(change.get("field") or "")
            if field not in DUALHOOK_DIRECT_FIELDS:
                return False
            if field == "messages":
                value = change.get("value") or {}
                metadata = value.get("metadata") or {}
                if str(metadata.get("phone_number_id") or "") != expected_phone_id:
                    return False
    return True


def _signature_is_valid(request: HttpRequest) -> bool:
    provider = str(settings.META_WHATSAPP_PROVIDER or "meta").strip().lower()
    if provider == "dualhook":
        return _dualhook_payload_is_valid(request)
    if not settings.META_WHATSAPP_VALIDATE_SIGNATURES:
        return bool(settings.DEBUG)
    signature = request.headers.get("X-Hub-Signature-256", "")
    app_secret = str(settings.META_WHATSAPP_APP_SECRET or "")
    if not signature.startswith("sha256=") or not app_secret:
        return False
    expected = "sha256=" + hmac.new(
        app_secret.encode("utf-8"),
        request.body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _verification_response(request: HttpRequest) -> HttpResponse:
    mode = request.GET.get("hub.mode", "")
    received_token = request.GET.get("hub.verify_token", "")
    challenge = request.GET.get("hub.challenge", "")
    expected_token = str(settings.META_WHATSAPP_VERIFY_TOKEN or "")
    if (
        mode == "subscribe"
        and challenge
        and expected_token
        and hmac.compare_digest(expected_token, received_token)
    ):
        return HttpResponse(challenge, content_type="text/plain; charset=utf-8")
    return HttpResponse(status=403)


def _message_text(message: dict) -> tuple[str, str]:
    message_type = str(message.get("type") or "")
    if message_type == "text":
        body = str((message.get("text") or {}).get("body") or "")[:4000]
        return body, body
    if message_type == "interactive":
        interactive = message.get("interactive") or {}
        reply = interactive.get("list_reply") or interactive.get("button_reply") or {}
        body = str(reply.get("title") or "")[:4000]
        selection = str(reply.get("id") or body)[:200]
        return body, selection
    if message_type == "button":
        button = message.get("button") or {}
        body = str(button.get("text") or "")[:4000]
        selection = str(button.get("payload") or body)[:200]
        return body, selection
    return f"[{message_type or 'mensaje no compatible'}]", "ayuda"


def _prepare_flow_delivery(
    conversation: WhatsAppConversation,
    reply: str,
) -> tuple[str, dict]:
    if (
        not settings.META_WHATSAPP_INTERACTIVE
        or conversation.status != WhatsAppConversationStatus.ACTIVE
    ):
        return "text", {"body": reply}

    context = dict(conversation.context or {})
    step = conversation.current_step
    if context.pop("_send_location", False):
        conversation.context = context
        conversation.save(update_fields=["context", "updated_at"])
        return "location", {
            "latitude": settings.META_WHATSAPP_LOCATION_LATITUDE,
            "longitude": settings.META_WHATSAPP_LOCATION_LONGITUDE,
            "name": settings.META_WHATSAPP_LOCATION_NAME,
            "address": (
                f"{settings.META_WHATSAPP_LOCATION_ADDRESS}\n"
                f"Teléfono {settings.META_WHATSAPP_CONTACT_PHONE}"
            ),
        }
    if context.pop("_reply_as_text", False):
        conversation.context = context
        conversation.save(update_fields=["context", "updated_at"])
        return "text", {"body": reply}
    if step == WhatsAppConversationStep.MENU:
        if not context.get("booking_available"):
            return "text", {"body": reply}
        return "buttons", {
            "body": _bold_whatsapp_terms(reply),
            "buttons": [
                {"id": "menu:book", "title": "Sí, quiero"},
            ],
        }
    if step == WhatsAppConversationStep.CHOOSE_FIRST_VISIT:
        schedules = context.get("schedule_options") or []
        if context.get("show_schedule_options") and schedules:
            options = []
            for index, package in enumerate(schedules[:10], 1):
                options.append(
                    {
                        "id": f"schedule:{index}",
                        "title": f"Opción {index}",
                        "description": (
                            f"1ª {_format_slot(package['first'])} · "
                            f"2ª {_format_slot(package['second'])}"
                        )[:72],
                    }
                )
            return "list", {
                "body": "Elige otro paquete para tus dos visitas gratuitas.",
                "button": "Ver horarios",
                "options": options,
            }
        return "buttons", {
            "body": reply,
            "buttons": [
                {"id": "schedule:default", "title": "Sí, continuar"},
                {"id": "schedule:other", "title": "Elegir otro"},
            ],
        }
    if step == WhatsAppConversationStep.CONTACT_PHONE:
        return "buttons", {
            "body": reply,
            "buttons": [
                {"id": "contact:same", "title": "Usar este número"},
            ],
        }
    return "text", {"body": reply}


def _deliver_flow_reply(*, contact_phone: str, delivery_kind: str, payload: dict) -> str:
    if delivery_kind == "buttons":
        return send_buttons(to_phone=contact_phone, **payload)
    if delivery_kind == "list":
        return send_list(to_phone=contact_phone, **payload)
    if delivery_kind == "location":
        return send_location(to_phone=contact_phone, **payload)
    return send_text(to_phone=contact_phone, body=str(payload.get("body") or ""))


def _claim_outbound_dispatch(dispatch_id: int) -> dict | None:
    with transaction.atomic():
        dispatch = WhatsAppOutboundDispatch.objects.select_for_update().get(pk=dispatch_id)
        if dispatch.status != WhatsAppOutboundDispatchStatus.RESERVED:
            return None
        dispatch.status = WhatsAppOutboundDispatchStatus.SENDING
        dispatch.save(update_fields=["status", "updated_at"])
        return {
            "contact_phone": dispatch.conversation.contact_phone,
            "delivery_kind": dispatch.delivery_kind,
            "payload": dict(dispatch.payload or {}),
            "body": dispatch.body,
        }


def _finish_outbound_dispatch(dispatch_id: int, outgoing_id: str) -> None:
    with transaction.atomic():
        dispatch = WhatsAppOutboundDispatch.objects.select_for_update().get(pk=dispatch_id)
        if dispatch.status != WhatsAppOutboundDispatchStatus.SENDING:
            return
        WhatsAppMessage.objects.create(
            conversation_id=dispatch.conversation_id,
            provider_sid=outgoing_id,
            in_reply_to_sid=dispatch.in_reply_to_sid,
            direction=WhatsAppMessageDirection.OUTBOUND,
            body=dispatch.body,
        )
        dispatch.status = WhatsAppOutboundDispatchStatus.SENT
        dispatch.provider_sid = outgoing_id
        dispatch.error_message = ""
        dispatch.save(
            update_fields=["status", "provider_sid", "error_message", "updated_at"]
        )


def _fail_outbound_dispatch(dispatch_id: int, *, error: MetaWhatsAppError) -> None:
    status_value = (
        WhatsAppOutboundDispatchStatus.UNCERTAIN
        if error.delivery_uncertain
        else WhatsAppOutboundDispatchStatus.FAILED
    )
    with transaction.atomic():
        dispatch = WhatsAppOutboundDispatch.objects.select_for_update().select_related(
            "conversation"
        ).get(pk=dispatch_id)
        if dispatch.status != WhatsAppOutboundDispatchStatus.SENDING:
            return
        dispatch.status = status_value
        dispatch.error_message = str(error)[:500]
        dispatch.save(update_fields=["status", "error_message", "updated_at"])
        conversation = dispatch.conversation
        context = dict(conversation.context or {})
        context["outbound_delivery_attention"] = {
            "dispatch_id": dispatch.pk,
            "status": status_value,
            "in_reply_to_sid": dispatch.in_reply_to_sid,
        }
        conversation.context = context
        conversation.follow_up_required = True
        conversation.follow_up_updated_at = timezone.now()
        conversation.save(
            update_fields=[
                "context",
                "follow_up_required",
                "follow_up_updated_at",
                "updated_at",
            ]
        )


def _dispatch_reserved_reply(dispatch_id: int) -> bool:
    claimed = _claim_outbound_dispatch(dispatch_id)
    if claimed is None:
        return False
    try:
        outgoing_id = _deliver_flow_reply(
            contact_phone=claimed["contact_phone"],
            delivery_kind=claimed["delivery_kind"],
            payload=claimed["payload"],
        )
    except MetaWhatsAppError as first_error:
        if claimed["delivery_kind"] != "text" and not first_error.delivery_uncertain:
            logger.warning(
                "WhatsApp rejected an interactive reply; using a text fallback: %s",
                first_error,
            )
            try:
                outgoing_id = send_text(
                    to_phone=claimed["contact_phone"],
                    body=claimed["body"],
                )
            except MetaWhatsAppError as fallback_error:
                _fail_outbound_dispatch(dispatch_id, error=fallback_error)
                return False
        else:
            _fail_outbound_dispatch(dispatch_id, error=first_error)
            return False
    _finish_outbound_dispatch(dispatch_id, outgoing_id)
    return True


def _process_message(*, message: dict, metadata: dict, contact_name: str = "") -> None:
    message_id = str(message.get("id") or "")[:255]
    from_digits = str(message.get("from") or "")
    configured_phone_id = str(settings.META_WHATSAPP_PHONE_NUMBER_ID or "")
    received_phone_id = str(metadata.get("phone_number_id") or "")
    if not message_id or not PHONE_PATTERN.fullmatch(from_digits):
        raise ValueError("Invalid Meta WhatsApp message identifiers")
    if not received_phone_id or not hmac.compare_digest(configured_phone_id, received_phone_id):
        raise PermissionError("Unexpected Meta WhatsApp phone number ID")

    contact_phone = f"+{from_digits}"
    from_address = f"whatsapp:{contact_phone}"
    to_address = configured_business_address()
    body, selection = _message_text(message)

    if WhatsAppMessage.objects.filter(
        provider_sid=message_id,
        direction=WhatsAppMessageDirection.INBOUND,
    ).exists():
        reserved_dispatch_id = (
            WhatsAppOutboundDispatch.objects.filter(
                in_reply_to_sid=message_id,
                status=WhatsAppOutboundDispatchStatus.RESERVED,
            )
            .values_list("id", flat=True)
            .first()
        )
        if reserved_dispatch_id is not None:
            _dispatch_reserved_reply(reserved_dispatch_id)
        return

    dispatch_id = None
    with transaction.atomic():
        if WhatsAppMessage.objects.select_for_update().filter(
            provider_sid=message_id,
            direction=WhatsAppMessageDirection.INBOUND,
        ).exists():
            return

        conversation = (
            WhatsAppConversation.objects.select_for_update()
            .filter(
                contact_phone=contact_phone,
                to_address=to_address,
                status=WhatsAppConversationStatus.ACTIVE,
            )
            .first()
        )
        conversation, reply = _route_message(
            conversation=conversation,
            from_address=from_address,
            to_address=to_address,
            contact_phone=contact_phone,
            body=body,
            selection=selection,
        )
        reply = _bold_whatsapp_terms(reply)
        delivery_kind, delivery_payload = _prepare_flow_delivery(conversation, reply)

        clean_contact_name = str(contact_name or "").strip()[:200]
        if clean_contact_name:
            context = dict(conversation.context or {})
            context["contact_name"] = clean_contact_name
            conversation.context = context

        conversation.last_message_at = timezone.now()
        conversation.save(update_fields=["context", "last_message_at", "updated_at"])
        WhatsAppMessage.objects.create(
            conversation=conversation,
            provider_sid=message_id,
            direction=WhatsAppMessageDirection.INBOUND,
            body=body,
        )
        dispatch, created = WhatsAppOutboundDispatch.objects.get_or_create(
            in_reply_to_sid=message_id,
            defaults={
                "conversation": conversation,
                "delivery_kind": delivery_kind,
                "payload": delivery_payload,
                "body": reply,
            },
        )
        dispatch_id = dispatch.pk if created else None
    if dispatch_id is not None:
        _dispatch_reserved_reply(dispatch_id)


def _process_payload(payload: dict) -> None:
    if payload.get("object") != "whatsapp_business_account":
        return
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") != "messages":
                continue
            value = change.get("value") or {}
            metadata = value.get("metadata") or {}
            contact_names = {
                str(contact.get("wa_id") or ""): str(
                    (contact.get("profile") or {}).get("name") or ""
                )
                for contact in value.get("contacts") or []
                if isinstance(contact, dict)
            }
            for message in value.get("messages") or []:
                _process_message(
                    message=message,
                    metadata=metadata,
                    contact_name=contact_names.get(str(message.get("from") or ""), ""),
                )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def meta_webhook(request: HttpRequest) -> HttpResponse:
    if request.method == "GET":
        return _verification_response(request)
    if not _configured():
        logger.error("Meta WhatsApp webhook is not fully configured")
        return JsonResponse({"detail": "WhatsApp no está configurado."}, status=503)
    if not _signature_is_valid(request):
        logger.warning("Rejected Meta WhatsApp request with an invalid signature")
        return HttpResponse(status=403)
    try:
        payload = json.loads(request.body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError
        _process_payload(payload)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return HttpResponse(status=400)
    except PermissionError:
        return HttpResponse(status=403)
    return JsonResponse({"status": "received"})
