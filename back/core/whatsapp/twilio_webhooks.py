from __future__ import annotations

import hmac
import logging
import re
import unicodedata
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.http import HttpRequest, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

from core.models import (
    TrialBooking,
    WhatsAppConversation,
    WhatsAppConversationStatus,
    WhatsAppConversationStep,
    WhatsAppMessage,
    WhatsAppMessageDirection,
)
from core.whatsapp.interactive import (
    InteractiveMessageError,
    send_age_range_buttons,
    send_confirmation_buttons,
    send_list_picker,
)
from core.voice.scheduling import (
    SchedulingError,
    book_two_trial_visits_from_whatsapp,
    list_trial_availability,
)


logger = logging.getLogger(__name__)
MESSAGE_SID_PATTERN = re.compile(r"^SM[a-fA-F0-9]{32}$")
WHATSAPP_ADDRESS_PATTERN = re.compile(r"^whatsapp:(\+[1-9]\d{7,14})$", re.IGNORECASE)
DAY_NAMES = (
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
)


def _request_signature_url(request: HttpRequest) -> str:
    base = str(settings.TWILIO_PUBLIC_BASE_URL or "").rstrip("/")
    if base:
        url = f"{base}{request.path}"
        if request.META.get("QUERY_STRING"):
            url += f"?{request.META['QUERY_STRING']}"
        return url
    return request.build_absolute_uri()


def _signature_is_valid(request: HttpRequest) -> bool:
    if not settings.TWILIO_VALIDATE_SIGNATURES:
        return bool(settings.DEBUG)
    auth_token = str(settings.TWILIO_AUTH_TOKEN or "")
    signature = request.headers.get("X-Twilio-Signature", "")
    if not auth_token or not signature:
        return False
    return RequestValidator(auth_token).validate(
        _request_signature_url(request),
        request.POST,
        signature,
    )


def _valid_twilio_request(request: HttpRequest) -> bool:
    if not _signature_is_valid(request):
        logger.warning("Rejected WhatsApp request with an invalid Twilio signature")
        return False
    configured_sid = str(settings.TWILIO_ACCOUNT_SID or "")
    received_sid = request.POST.get("AccountSid", "")
    if configured_sid and not hmac.compare_digest(configured_sid, received_sid):
        logger.warning("Rejected WhatsApp request with an unexpected account SID")
        return False
    return True


def _xml_message(body: str, *, status: int = 200) -> HttpResponse:
    response = MessagingResponse()
    if body:
        response.message(body)
    return HttpResponse(str(response), status=status, content_type="text/xml; charset=utf-8")


def _configured_number() -> str:
    raw = str(getattr(settings, "TWILIO_WHATSAPP_NUMBER", "") or "").strip()
    return raw.removeprefix("whatsapp:")


def _normalize_command(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    return " ".join(
        "".join(character for character in normalized if not unicodedata.combining(character))
        .lower()
        .strip()
        .split()
    )


def _clean_person_name(value: str, *, max_length: int) -> str:
    return " ".join(str(value or "").strip().split())[:max_length]


def _local_datetime(iso_value: str) -> datetime:
    parsed = datetime.fromisoformat(str(iso_value).replace("Z", "+00:00"))
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, ZoneInfo(settings.TIME_ZONE))
    return parsed.astimezone(ZoneInfo(settings.TIME_ZONE))


def _format_slot(slot: dict) -> str:
    start = _local_datetime(slot["starts_at"])
    court = f" · {slot['court_name']}" if slot.get("court_name") else ""
    return f"{DAY_NAMES[start.weekday()]} {start:%d/%m} a las {start:%H:%M}{court}"


def _numbered_options(options: list[dict], formatter) -> str:
    return "\n".join(f"{index}. {formatter(option)}" for index, option in enumerate(options, 1))


def _pick_number(body: str, options: list[dict]) -> dict | None:
    normalized = _normalize_command(body)
    if normalized.startswith("choice:"):
        normalized = normalized.removeprefix("choice:")
    if not normalized.isdigit():
        return None
    index = int(normalized) - 1
    if index < 0 or index >= len(options):
        return None
    return options[index]


def _slot_interactive_title(slot: dict) -> str:
    start = _local_datetime(slot["starts_at"])
    day = DAY_NAMES[start.weekday()][:3].capitalize()
    return f"{day} {start:%d/%m} · {start:%H:%M}"


def _interactive_options(options: list[dict], *, kind: str) -> list[dict[str, str]]:
    prepared = []
    for index, option in enumerate(options[:10], 1):
        if kind == "site":
            title = str(option["name"])
            description = "Sede FUTSI · prueba gratuita"
        else:
            title = _slot_interactive_title(option)
            description = str(option.get("court_name") or "Cancha por asignar")
        prepared.append(
            {
                "title": title,
                "description": description,
                "id": f"choice:{index}",
            }
        )
    return prepared


def _send_interactive_reply(
    conversation: WhatsAppConversation,
) -> str | None:
    if not getattr(settings, "TWILIO_WHATSAPP_INTERACTIVE", True):
        return None
    if conversation.status != WhatsAppConversationStatus.ACTIVE:
        return None
    context = dict(conversation.context or {})
    step = conversation.current_step
    if step == WhatsAppConversationStep.CHOOSE_SITE:
        options = _interactive_options(context.get("site_options", []), kind="site")
        if not options:
            return None
        return send_list_picker(
            to_address=conversation.from_address,
            from_address=conversation.to_address,
            body=(
                "¡Hola! Soy el asistente de FUTSI. Te ayudaré a reservar las dos "
                "visitas de la prueba gratuita. Elige la sede."
            ),
            button="Elegir sede",
            options=options,
        )
    if step == WhatsAppConversationStep.CHOOSE_FIRST_VISIT:
        options = _interactive_options(
            context.get("first_visit_options", []),
            kind="slot",
        )
        if not options:
            return None
        return send_list_picker(
            to_address=conversation.from_address,
            from_address=conversation.to_address,
            body="Elige el horario de la primera visita.",
            button="Ver horarios",
            options=options,
        )
    if step == WhatsAppConversationStep.CHILD_AGE:
        ages = context.get("age_options", [])
        if ages:
            options = [
                {
                    "title": f"{age} años",
                    "description": f"Seleccionar {age} años",
                    "id": f"age:{age}",
                }
                for age in ages
            ]
            return send_list_picker(
                to_address=conversation.from_address,
                from_address=conversation.to_address,
                body="Elige la edad exacta del niño o niña.",
                button="Elegir edad",
                options=options,
            )
        return send_age_range_buttons(
            to_address=conversation.from_address,
            from_address=conversation.to_address,
        )
    if step == WhatsAppConversationStep.CHOOSE_SECOND_VISIT:
        options = _interactive_options(
            context.get("second_visit_options", []),
            kind="slot",
        )
        if not options:
            return None
        return send_list_picker(
            to_address=conversation.from_address,
            from_address=conversation.to_address,
            body="Elige el horario de la segunda visita.",
            button="Ver horarios",
            options=options,
        )
    if step == WhatsAppConversationStep.CONFIRM:
        body = _confirmation_prompt(conversation).split("\n\nEscribe CONFIRMAR", 1)[0]
        return send_confirmation_buttons(
            to_address=conversation.from_address,
            from_address=conversation.to_address,
            body=body,
        )
    return None


def _available_site_options() -> list[dict]:
    catalog = list_trial_availability(limit=1).get("sites", [])
    available = []
    for site in catalog:
        first_visit_options = _first_visit_options(site["id"])
        if first_visit_options:
            available.append(
                {
                    "id": site["id"],
                    "name": site["name"],
                    "first_visit_options": first_visit_options,
                }
            )
    return available


def _site_prompt(options: list[dict]) -> str:
    if not options:
        return (
            "Por el momento no hay horarios de prueba disponibles. "
            "Escribe REINICIAR más tarde para volver a consultar."
        )
    return (
        "¡Hola! Soy el asistente de FUTSI. Te ayudaré a reservar las dos visitas "
        "de la prueba gratuita.\n\nElige una sede respondiendo sólo con su número:\n"
        f"{_numbered_options(options, lambda option: option['name'])}"
    )


def _slot_prompt(*, visit_number: int, options: list[dict]) -> str:
    label = "primera" if visit_number == 1 else "segunda"
    return (
        f"Elige la {label} visita respondiendo sólo con el número:\n"
        f"{_numbered_options(options, _format_slot)}"
    )


def _first_visit_options(site_id: int) -> list[dict]:
    def viable_options(candidates: list[dict]) -> list[dict]:
        viable = []
        compatible_dates: dict[str, bool] = {}
        for candidate in candidates:
            candidate_date = _local_datetime(candidate["starts_at"]).date().isoformat()
            if candidate_date not in compatible_dates:
                compatible_dates[candidate_date] = bool(
                    _second_visit_options(site_id, candidate)
                )
            if compatible_dates[candidate_date]:
                viable.append(candidate)
            if len(viable) >= 6:
                break
        return viable

    candidates = list_trial_availability(site_id=site_id, limit=12).get("slots", [])
    viable = viable_options(candidates)
    if viable or len(candidates) < 12:
        return viable
    return viable_options(
        list_trial_availability(site_id=site_id, limit=40).get("slots", [])
    )


def _second_visit_options(site_id: int, first_slot: dict) -> list[dict]:
    first = _local_datetime(first_slot["starts_at"])
    min_days = int(getattr(settings, "TRIAL_MIN_DAYS_BETWEEN_VISITS", 1))
    max_days = int(getattr(settings, "TRIAL_MAX_DAYS_BETWEEN_VISITS", 21))
    result = list_trial_availability(
        site_id=site_id,
        start_date=(first.date() + timedelta(days=min_days)).isoformat(),
        end_date=(first.date() + timedelta(days=max_days)).isoformat(),
        limit=6,
    )
    return [
        slot
        for slot in result.get("slots", [])
        if slot["starts_at"] != first_slot["starts_at"]
    ]


def _start_conversation(*, from_address: str, to_address: str, contact_phone: str):
    options = _available_site_options()
    conversation = WhatsAppConversation.objects.create(
        contact_phone=contact_phone,
        from_address=from_address,
        to_address=to_address,
        current_step=WhatsAppConversationStep.CHOOSE_SITE,
        context={"site_options": options},
        last_message_at=timezone.now(),
    )
    return conversation, _site_prompt(options)


def _reset_conversation(conversation: WhatsAppConversation) -> str:
    options = _available_site_options()
    conversation.current_step = WhatsAppConversationStep.CHOOSE_SITE
    conversation.site = None
    conversation.booking = None
    conversation.context = {"site_options": options}
    conversation.failure_reason = ""
    conversation.save(
        update_fields=[
            "current_step",
            "site",
            "booking",
            "context",
            "failure_reason",
            "updated_at",
        ]
    )
    return _site_prompt(options)


def _current_prompt(conversation: WhatsAppConversation) -> str:
    context = dict(conversation.context or {})
    step = conversation.current_step
    if step == WhatsAppConversationStep.CHOOSE_SITE:
        return _site_prompt(context.get("site_options", []))
    if step == WhatsAppConversationStep.RESPONSIBLE_NAME:
        return "Escribe el nombre completo de la mamá, papá o responsable."
    if step == WhatsAppConversationStep.CHILD_NAME:
        return "¿Cuál es el primer nombre del niño o niña?"
    if step == WhatsAppConversationStep.CHILD_AGE:
        return "Selecciona el rango de edad o escribe la edad exacta."
    if step == WhatsAppConversationStep.CHOOSE_FIRST_VISIT:
        return _slot_prompt(visit_number=1, options=context.get("first_visit_options", []))
    if step == WhatsAppConversationStep.CHOOSE_SECOND_VISIT:
        return _slot_prompt(visit_number=2, options=context.get("second_visit_options", []))
    if step == WhatsAppConversationStep.CONFIRM:
        return _confirmation_prompt(conversation)
    return "Esta conversación terminó. Escribe HOLA para iniciar una nueva reserva."


def _confirmation_prompt(conversation: WhatsAppConversation) -> str:
    context = dict(conversation.context or {})
    first = context["first_visit"]
    second = context["second_visit"]
    return (
        "Revisa tu reserva:\n"
        f"Responsable: {context['responsible_name']}\n"
        f"Alumno: {context['child_first_name']}, {context['child_age']} años\n"
        f"Sede: {conversation.site.name}\n"
        f"Visita 1: {_format_slot(first)}\n"
        f"Visita 2: {_format_slot(second)}\n\n"
        "Escribe CONFIRMAR para agendar o CAMBIAR para elegir otros horarios."
    )


def _advance(conversation: WhatsAppConversation, body: str) -> str:
    command = _normalize_command(body)
    if command in {"hola", "inicio", "menu"}:
        return _reset_conversation(conversation)
    if command == "ayuda":
        return _current_prompt(conversation)
    if command == "reiniciar":
        return _reset_conversation(conversation)
    if command == "cancelar":
        conversation.status = WhatsAppConversationStatus.CANCELED
        conversation.current_step = WhatsAppConversationStep.FINISHED
        conversation.save(update_fields=["status", "current_step", "updated_at"])
        return "La solicitud fue cancelada. Si quieres comenzar de nuevo, escribe HOLA."

    context = dict(conversation.context or {})
    step = conversation.current_step
    if step == WhatsAppConversationStep.CHOOSE_SITE:
        selected = _pick_number(body, context.get("site_options", []))
        if not selected:
            return "No reconocí esa sede.\n\n" + _current_prompt(conversation)
        options = selected.get("first_visit_options") or _first_visit_options(
            selected["id"]
        )
        if not options:
            site_options = _available_site_options()
            conversation.site = None
            conversation.current_step = WhatsAppConversationStep.CHOOSE_SITE
            conversation.context = {"site_options": site_options}
            conversation.save(
                update_fields=["site", "current_step", "context", "updated_at"]
            )
            return (
                "Los horarios de esa sede acaban de ocuparse.\n\n"
                + _site_prompt(site_options)
            )
        conversation.site_id = selected["id"]
        conversation.current_step = WhatsAppConversationStep.CHOOSE_FIRST_VISIT
        context.pop("site_options", None)
        context["site_name"] = selected["name"]
        context["first_visit_options"] = options
        conversation.context = context
        conversation.save(update_fields=["site", "current_step", "context", "updated_at"])
        return _slot_prompt(visit_number=1, options=options)

    if step == WhatsAppConversationStep.RESPONSIBLE_NAME:
        name = _clean_person_name(body, max_length=160)
        if len(name) < 3 or name.isdigit():
            return "Necesito el nombre completo del responsable. Escríbelo nuevamente."
        context["responsible_name"] = name
        conversation.context = context
        conversation.current_step = WhatsAppConversationStep.CHILD_NAME
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        return "¿Cuál es el primer nombre del niño o niña?"

    if step == WhatsAppConversationStep.CHILD_NAME:
        name = _clean_person_name(body, max_length=100)
        if len(name) < 2 or name.isdigit():
            return "No reconocí el nombre. Escribe sólo el primer nombre del niño o niña."
        context["child_first_name"] = name
        context.pop("age_options", None)
        conversation.context = context
        conversation.current_step = WhatsAppConversationStep.CHILD_AGE
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        return "Selecciona el rango de edad o escribe la edad exacta."

    if step == WhatsAppConversationStep.CHILD_AGE:
        if command.startswith("age_range:"):
            parts = command.split(":")
            if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
                first_age = int(parts[1])
                last_age = int(parts[2])
                allowed_ranges = {(3, 7), (8, 12), (13, 17)}
                if (first_age, last_age) in allowed_ranges:
                    context["age_options"] = list(range(first_age, last_age + 1))
                    conversation.context = context
                    conversation.save(update_fields=["context", "updated_at"])
                    return "Elige la edad exacta del niño o niña."
        if command.startswith("age:"):
            command = command.removeprefix("age:")
        if not command.isdigit() or not 3 <= int(command) <= 17:
            return "Selecciona un rango y después la edad exacta, o escribe un número del 3 al 17."
        context["child_age"] = int(command)
        context.pop("age_options", None)
        conversation.context = context
        conversation.current_step = WhatsAppConversationStep.CONFIRM
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        return _confirmation_prompt(conversation)

    if step == WhatsAppConversationStep.CHOOSE_FIRST_VISIT:
        selected = _pick_number(body, context.get("first_visit_options", []))
        if not selected:
            return "No reconocí ese horario.\n\n" + _current_prompt(conversation)
        second_options = _second_visit_options(conversation.site_id, selected)
        if not second_options:
            options = _first_visit_options(conversation.site_id)
            context["first_visit_options"] = options
            conversation.context = context
            conversation.save(update_fields=["context", "updated_at"])
            return (
                "Ese horario no tiene una segunda visita compatible. Elige otra primera visita:\n"
                + _numbered_options(options, _format_slot)
            )
        context["first_visit"] = selected
        context["second_visit_options"] = second_options
        conversation.context = context
        conversation.current_step = WhatsAppConversationStep.CHOOSE_SECOND_VISIT
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        return _slot_prompt(visit_number=2, options=second_options)

    if step == WhatsAppConversationStep.CHOOSE_SECOND_VISIT:
        selected = _pick_number(body, context.get("second_visit_options", []))
        if not selected:
            return "No reconocí ese horario.\n\n" + _current_prompt(conversation)
        context["second_visit"] = selected
        conversation.context = context
        has_contact_details = all(
            context.get(key)
            for key in ("responsible_name", "child_first_name", "child_age")
        )
        conversation.current_step = (
            WhatsAppConversationStep.CONFIRM
            if has_contact_details
            else WhatsAppConversationStep.RESPONSIBLE_NAME
        )
        conversation.save(update_fields=["context", "current_step", "updated_at"])
        if has_contact_details:
            return _confirmation_prompt(conversation)
        return "Escribe el nombre completo de la mamá, papá o responsable."

    if step == WhatsAppConversationStep.CONFIRM:
        if command == "cambiar":
            options = _first_visit_options(conversation.site_id)
            context.pop("first_visit", None)
            context.pop("second_visit", None)
            context.pop("second_visit_options", None)
            context["first_visit_options"] = options
            conversation.context = context
            conversation.current_step = WhatsAppConversationStep.CHOOSE_FIRST_VISIT
            conversation.save(update_fields=["context", "current_step", "updated_at"])
            return _slot_prompt(visit_number=1, options=options)
        if command not in {"confirmar", "si", "1"}:
            return "Para finalizar escribe CONFIRMAR. Para elegir otros horarios escribe CAMBIAR."
        try:
            result = book_two_trial_visits_from_whatsapp(
                site_id=conversation.site_id,
                responsible_name=context["responsible_name"],
                responsible_phone=conversation.contact_phone,
                child_first_name=context["child_first_name"],
                child_age=context["child_age"],
                visits=[context["first_visit"], context["second_visit"]],
            )
        except SchedulingError:
            options = _first_visit_options(conversation.site_id)
            context.pop("first_visit", None)
            context.pop("second_visit", None)
            context.pop("second_visit_options", None)
            context["first_visit_options"] = options
            conversation.context = context
            conversation.current_step = WhatsAppConversationStep.CHOOSE_FIRST_VISIT
            conversation.save(update_fields=["context", "current_step", "updated_at"])
            if not options:
                return (
                    "Los horarios elegidos acaban de ocuparse. Escribe REINICIAR para consultar "
                    "otra sede o inténtalo más tarde."
                )
            return (
                "Uno de los horarios acaba de ocuparse. Elige nuevamente la primera visita:\n"
                + _numbered_options(options, _format_slot)
            )
        conversation.booking = TrialBooking.objects.get(pk=result["booking_id"])
        conversation.status = WhatsAppConversationStatus.COMPLETED
        conversation.current_step = WhatsAppConversationStep.FINISHED
        conversation.save(
            update_fields=["booking", "status", "current_step", "updated_at"]
        )
        return (
            f"¡Listo! Reserva #{result['booking_id']} confirmada para {context['child_first_name']}.\n"
            f"Visita 1: {_format_slot(context['first_visit'])}\n"
            f"Visita 2: {_format_slot(context['second_visit'])}\n\n"
            "Te esperamos en FUTSI."
        )

    return "Esta conversación terminó. Escribe HOLA para iniciar una nueva reserva."


@csrf_exempt
@require_POST
def incoming_message(request: HttpRequest) -> HttpResponse:
    if not _valid_twilio_request(request):
        return HttpResponse(status=403)
    if not _configured_number() or not settings.TWILIO_PUBLIC_BASE_URL:
        logger.error("WhatsApp webhook is not fully configured")
        return _xml_message("El asistente no está disponible por el momento.")

    message_sid = request.POST.get("MessageSid", "")
    from_address = request.POST.get("From", "")[:64]
    to_address = request.POST.get("To", "")[:64]
    from_match = WHATSAPP_ADDRESS_PATTERN.fullmatch(from_address)
    to_match = WHATSAPP_ADDRESS_PATTERN.fullmatch(to_address)
    if not MESSAGE_SID_PATTERN.fullmatch(message_sid) or not from_match or not to_match:
        return HttpResponse(status=400)
    if not hmac.compare_digest(_configured_number(), to_match.group(1)):
        logger.warning("Rejected WhatsApp request for an unexpected destination")
        return HttpResponse(status=403)

    body = request.POST.get("Body", "")[:4000]
    selection = request.POST.get("ButtonPayload", "")[:200] or body
    contact_phone = from_match.group(1)
    with transaction.atomic():
        duplicate = WhatsAppMessage.objects.select_for_update().filter(
            provider_sid=message_sid,
            direction=WhatsAppMessageDirection.INBOUND,
        ).first()
        if duplicate:
            stored_reply = WhatsAppMessage.objects.filter(
                in_reply_to_sid=message_sid,
                direction=WhatsAppMessageDirection.OUTBOUND,
            ).first()
            if stored_reply and stored_reply.provider_sid:
                return _xml_message("")
            return _xml_message(stored_reply.body if stored_reply else "")

        conversation = (
            WhatsAppConversation.objects.select_for_update()
            .filter(
                contact_phone=contact_phone,
                to_address=to_address,
                status=WhatsAppConversationStatus.ACTIVE,
            )
            .first()
        )
        is_new = conversation is None
        if is_new:
            conversation, reply = _start_conversation(
                from_address=from_address,
                to_address=to_address,
                contact_phone=contact_phone,
            )
        else:
            reply = _advance(conversation, selection)

        now = timezone.now()
        conversation.last_message_at = now
        conversation.save(update_fields=["last_message_at", "updated_at"])
        WhatsAppMessage.objects.create(
            conversation=conversation,
            provider_sid=message_sid,
            direction=WhatsAppMessageDirection.INBOUND,
            body=body,
        )
        outgoing_sid = None
        try:
            outgoing_sid = _send_interactive_reply(conversation)
        except InteractiveMessageError as exc:
            logger.warning("WhatsApp interactive reply fell back to text: %s", exc)
        WhatsAppMessage.objects.create(
            conversation=conversation,
            provider_sid=outgoing_sid,
            in_reply_to_sid=message_sid,
            direction=WhatsAppMessageDirection.OUTBOUND,
            body=reply,
        )
    return _xml_message("" if outgoing_sid else reply)
