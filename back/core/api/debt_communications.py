"""Read-only collection queue. Balances and dates come from billing, never simulations."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.models import Discount, Payment, WhatsAppAutomationSettings, WhatsAppConversation
from core.serializers import ChargeSerializer


STAGES = ((7, "Primer recordatorio"), (14, "Segundo recordatorio"), (21, "Aviso de baja"))


def collection_report(queryset, params):
    site = params.get("site")
    address = params.get("business_address", "")
    profiles = WhatsAppAutomationSettings.objects.select_related("site")
    if site == "unassigned":
        queryset = queryset.none()  # Every charge must belong to a site.
    elif site:
        if not site.isdigit():
            raise ValidationError({"site": "Selecciona una sede válida."})
        queryset = queryset.filter(site_id=int(site))
    if address:
        profile = profiles.filter(business_address=address, site__isnull=False).first()
        queryset = queryset.filter(site_id=profile.site_id) if profile else queryset.none()

    charges = list(queryset.exclude(status__in=["paid", "canceled"]).order_by("due_date", "id"))
    charge_ids = [charge.pk for charge in charges]
    pending_ids = set(Payment.objects.filter(charge_id__in=charge_ids, status__in=["processing", "awaiting_confirmation"]).values_list("charge_id", flat=True))
    discount_ids = set(Discount.objects.filter(charge_id__in=charge_ids, status="requested").values_list("charge_id", flat=True))
    channels = {}
    for profile in profiles:
        channels.setdefault(profile.site_id, []).append(profile.business_address)
    # A past generic reminder is not falsely attributed to any weekly stage.
    history = {}
    attempts = {}
    conversations = WhatsAppConversation.objects.filter(
        context__kind="payment_reminder", context__charge_id__in=charge_ids
    ).prefetch_related("messages").order_by("-created_at")
    for chat in conversations:
        if address and chat.to_address != address:
            continue
        charge_id = chat.context.get("charge_id")
        if chat.context.get("stage"):
            attempts.setdefault(charge_id, []).append({"stage": chat.context["stage"],
                "state": chat.context.get("send_state", "sending"), "created_at": chat.created_at.isoformat(),
                "detail": chat.failure_reason, "template_name": chat.context.get("template_name", "")})
        for message in chat.messages.all():
            if message.direction != "outbound":
                continue
            history.setdefault(charge_id, []).append({
                "conversation_id": chat.pk, "message_id": message.pk,
                "created_at": message.created_at.isoformat(), "business_address": chat.to_address,
                "body": message.body,
                "label": "Recordatorio registrado · entrega no verificada aquí",
            })

    today = timezone.localdate()
    rows = []
    for charge in charges:
        row = ChargeSerializer(charge).data
        if Decimal(row["balance"]) <= 0:
            continue
        days = (today - charge.due_date).days if charge.due_date else None
        stage = 21 if days is not None and days >= 21 else 14 if days is not None and days >= 14 else 7 if days is not None and days >= 7 else 0
        pending = charge.pk in pending_ids
        discount_pending = charge.pk in discount_ids
        dropped = bool(charge.student_id and charge.student.status == "dropped")
        blocker = ""
        if not charge.due_date:
            blocker = "Falta fecha de vencimiento en Adeudos."
        elif pending or discount_pending:
            blocker = "Revisar pago o descuento pendiente antes de contactar."
        elif stage == 21:
            blocker = "Baja registrada; falta configurar su plantilla y envío." if dropped else "Requiere confirmar la baja; no se enviará un aviso de baja inexistente."
        elif not channels.get(charge.site_id):
            blocker = "La sede no tiene un número de WhatsApp vinculado."
        rows.append({
            **row, "overdue_days": max(0, days) if days is not None else None,
            "stage": stage, "blocker": blocker, "student_dropped": dropped,
            "channels": channels.get(charge.site_id, []), "history": history.get(charge.pk, []),
            "attempts": attempts.get(charge.pk, []),
            "milestones": [{"day": day, "label": label, "date": (charge.due_date + timedelta(days=day)).isoformat() if charge.due_date else None,
                            "reached": days is not None and days >= day} for day, label in STAGES],
        })
    return {"as_of": today.isoformat(), "automatic_sending_enabled": False,
            "notice": "Seguimiento ligado a Adeudos. La secuencia automática de 7, 14 y 21 días aún no está activada; las fechas no significan que se haya enviado un mensaje.",
            "rows": rows}
