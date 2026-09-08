"""Explicit, previewed template sends; never runs as a background collection job."""
import re

from django.core import signing
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.models import Charge, Payment, Discount, WhatsAppAutomationSettings, WhatsAppConversation, WhatsAppMessage
from core.serializers import charge_balance
from core.whatsapp.meta_api import MetaWhatsAppError
from core.whatsapp.payment_reminders import _payer_details, _normalize_phone
from .template_catalog import catalog_for_channel
from .template_transport import send_template_payload

SALT = "manual-collection-preview-v1"
LABELS = {7: "Primer recordatorio", 14: "Segundo recordatorio", 21: "Aviso de baja"}


def charge_snapshot(charge, address, stage):
    if type(stage) is not int or stage not in LABELS:
        raise ValidationError("Selecciona la etapa 7, 14 o 21.")
    if not WhatsAppAutomationSettings.objects.filter(site_id=charge.site_id, business_address=address).exists():
        raise ValidationError("El número no está vinculado a la sede del adeudo.")
    balance = charge_balance(charge)
    if charge.status in {"paid", "canceled"} or balance <= 0:
        raise ValidationError("Este cargo ya no tiene saldo pendiente.")
    if not charge.due_date or (timezone.localdate() - charge.due_date).days < stage:
        raise ValidationError("Todavía no se alcanza la fecha de este recordatorio.")
    if Payment.objects.filter(charge=charge, status__in=["processing", "awaiting_confirmation"]).exists() or Discount.objects.filter(charge=charge, status="requested").exists():
        raise ValidationError("Revisa el pago o descuento pendiente antes de enviar.")
    if stage == 21 and not (charge.student_id and charge.student.status == "dropped"):
        raise ValidationError("Primero confirma la baja en Adeudos. Este botón no da de baja al alumno.")
    payer, phone, subject = _payer_details(charge)
    # Stored Mexican local numbers are explicitly normalized, never sent as a US number.
    digits = "".join(c for c in str(phone) if c.isdigit())
    phone = _normalize_phone("52" + digits if len(digits) == 10 else phone)
    return {"charge_id": charge.pk, "site_id": charge.site_id, "business_address": address, "stage": stage,
            "contact_phone": phone, "payer_name": payer, "subject_name": subject,
            "balance": str(balance), "concept": charge.concept, "due_date": charge.due_date.isoformat()}


def approved_template(address, name, language):
    cursor = ""
    seen = set()
    for _ in range(20):
        catalog = catalog_for_channel(address, cursor)
        for template in catalog["templates"]:
            if template["name"] == name and template["language"] == language:
                if template["status"] != "APPROVED":
                    raise ValidationError("La plantilla ya no está aprobada o disponible.")
                return template
        cursor = catalog.get("next_cursor", "")
        if not cursor or cursor in seen:
            break
        seen.add(cursor)
    raise ValidationError("No se encontró la plantilla aprobada en esta cuenta. Actualiza el catálogo.")


def render_template(template, values):
    if not isinstance(values, dict):
        raise ValidationError("Completa las variables de la plantilla.")
    parts, components = [], []
    for component in template["components"]:
        kind = component["type"].upper()
        if kind not in {"HEADER", "BODY", "FOOTER"} or component.get("format") not in {None, "", "TEXT"}:
            raise ValidationError("Este envío admite plantillas de texto sin botones ni archivos.")
        text = component.get("text", "")
        keys = sorted(set(re.findall(r"\{\{([^{}]+)\}\}", text)), key=lambda k: int(k) if k.isdigit() else 0)
        if keys and (not all(k.isdigit() for k in keys) or keys != [str(i) for i in range(1, len(keys) + 1)] or kind == "FOOTER"):
            raise ValidationError("Usa variables numéricas consecutivas {{1}}, {{2}}, etc.")
        params = []
        for key in keys:
            value = values.get(f"{kind.lower()}.{key}", "")
            if not isinstance(value, str) or not value.strip() or len(value) > 1024 or any(c in value for c in ["\n", "\r", "\t", "{{", "}}"]):
                raise ValidationError(f"Completa correctamente la variable {kind} {{{{{key}}}}}.")
            params.append({"type": "text", "text": value.strip()})
            text = text.replace("{{" + key + "}}", value.strip())
        if params:
            components.append({"type": kind.lower(), "parameters": params})
        if text:
            parts.append(text)
    if not parts:
        raise ValidationError("La plantilla no tiene texto para revisar.")
    return "\n\n".join(parts), components


def preview(charge, user, data):
    stage = data.get("stage")
    snapshot = charge_snapshot(charge, str(data.get("business_address", "")), stage)
    template = approved_template(snapshot["business_address"], data.get("template_name"), data.get("language"))
    body, components = render_template(template, data.get("values", {}))
    payload = {**snapshot, "user_id": user.pk, "template_name": template["name"], "language": template["language"],
               "values": data.get("values", {}), "body": body, "components": components}
    return {**snapshot, "body": body, "template_name": template["name"], "language": template["language"],
            "confirmation": signing.dumps(payload, salt=SALT, compress=True)}


def send(charge, user, data):
    try:
        payload = signing.loads(str(data.get("confirmation", "")), salt=SALT, max_age=300)
    except signing.BadSignature:
        raise ValidationError("La vista previa venció o no es válida. Vuelve a revisar el mensaje.")
    if payload["user_id"] != user.pk or payload["charge_id"] != charge.pk:
        raise ValidationError("La confirmación no corresponde a este usuario y cargo.")
    # Approval is checked again, not trusted from a stale browser catalog.
    template = approved_template(payload["business_address"], payload["template_name"], payload["language"])
    body, components = render_template(template, payload["values"])
    if body != payload["body"] or components != payload["components"]:
        raise ValidationError("La plantilla cambió. Genera una nueva vista previa.")
    # Commit the claim BEFORE network I/O: concurrent requests/retries cannot send twice.
    with transaction.atomic():
        fresh = Charge.objects.select_for_update().get(pk=charge.pk)
        snapshot = charge_snapshot(fresh, payload["business_address"], payload["stage"])
        if any(payload[k] != v for k, v in snapshot.items()):
            raise ValidationError("El adeudo o destinatario cambió. Actualiza y revisa el mensaje otra vez.")
        previous = WhatsAppConversation.objects.filter(context__kind="payment_reminder", context__charge_id=charge.pk,
            context__stage=payload["stage"]).exclude(context__send_state="rejected")
        if previous.exists():
            raise ValidationError("Esta etapa ya tiene un envío registrado o por confirmar. Revisa el historial; no se reenviará.")
        chat = WhatsAppConversation.objects.create(site=charge.site, contact_phone=payload["contact_phone"],
            from_address="whatsapp:" + payload["contact_phone"], to_address=payload["business_address"],
            status="completed", current_step="finished", last_message_at=timezone.now(),
            context={**snapshot, "kind": "payment_reminder", "send_state": "sending", "sent_by": user.pk,
                     "template_name": payload["template_name"], "language": payload["language"], "body": body})
    try:
        message_id = send_template_payload(payload["business_address"], payload["contact_phone"],
            {"name": payload["template_name"], "language": {"code": payload["language"]}, "components": components})
    except MetaWhatsAppError as exc:
        chat.context["send_state"] = "uncertain" if exc.delivery_uncertain else "rejected"
        chat.failure_reason = str(exc)
        chat.save(update_fields=["context", "failure_reason", "updated_at"])
        raise
    # If recording fails after provider acceptance, 'sending' still blocks a duplicate.
    WhatsAppMessage.objects.create(conversation=chat, provider_sid=message_id, direction="outbound",
        response_source="human", sent_by=user, body=body)
    chat.context["send_state"] = "accepted"
    chat.save(update_fields=["context", "updated_at"])
    return {"message_id": message_id, "detail": "Mensaje aceptado por WhatsApp. La entrega al destinatario aún debe confirmarse."}
