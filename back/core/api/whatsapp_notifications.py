"""Read-only, site-scoped attention alerts; no messages or production writes."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
import re
import unicodedata

from django.db import models
from django.db.models.functions import Coalesce
from django.utils import timezone
from core.models import WhatsAppHumanResponseEvent, WhatsAppMessage

MEXICO = ZoneInfo("America/Mexico_City")


def closing_acknowledgement(body):
    # Same closing-exchange policy as communicationUtils.ts; a thank-you with
    # a question still needs attention. Do not reopen chats for emoji/stickers.
    body = str(body or "").strip()
    if not body:
        return False
    if body.lower() in ("[sticker]", "[reaction]"):
        return True
    normalized = " ".join(re.sub(r"[^a-z0-9]+", " ", "".join(c for c in unicodedata.normalize("NFD", body).lower() if not unicodedata.combining(c))).split())
    if not normalized or normalized in {"ok", "okay", "perfecto", "listo", "entendido", "excelente", "super", "sale", "va", "de acuerdo", "esta bien", "muy bien", "claro", "saludos", "saludos cordiales"}:
        return True
    requests = r"\b(?:pero|aunque|duda|pregunta|quisiera|quiero|necesito|puede|puedes|podria|podrias|mandar|enviar|decir|confirmar|informar|agendar|inscribir|registrar|cambiar|cancelar|cuando|donde|como|cual|cuanto|horario|precio|costo)\b"
    return "gracias" in normalized and "?" not in body and not re.search(requests, normalized) and len(normalized.split()) <= 12


def working_seconds(start, end):
    """Count only 08:00 <= local time < 22:00, including overnight requests."""
    start, end = start.astimezone(MEXICO), end.astimezone(MEXICO)
    if end <= start:
        return 0
    # Whole intervening days are constant work windows, without an unbounded loop.
    days = (end.date() - start.date()).days
    opening = datetime.combine(start.date(), time(8), MEXICO)
    closing = datetime.combine(start.date(), time(22), MEXICO)
    if not days:
        return max(0, int((min(end, closing) - max(start, opening)).total_seconds()))
    first = max(0, int((closing - max(start, opening)).total_seconds()))
    last_open = datetime.combine(end.date(), time(8), MEXICO)
    last_close = datetime.combine(end.date(), time(22), MEXICO)
    last = max(0, int((min(end, last_close) - last_open).total_seconds()))
    return first + max(0, days - 1) * 14 * 3600 + last


def attention_notifications(conversations, now=None):
    from .trials import _manual_response_events
    now = now or timezone.now()
    local = now.astimezone(MEXICO)
    # Rolling seven days: old unanswered requests must not remain in the bell,
    # even if a recent follow-up or bot acknowledgement touched the conversation.
    start = now - timedelta(days=7)
    monday = start.astimezone(MEXICO).date()
    # Strip the inbox's message prefetch: alerts must not serialize/load full chats.
    conversations = conversations.prefetch_related(None).order_by()
    events = list(WhatsAppHumanResponseEvent.objects.filter(
        conversation__in=conversations, human_attention_expected=True,
        first_inbound_at__gte=start, first_inbound_at__lte=now,
    ).select_related("conversation", "responder_user").order_by("first_inbound_at"))
    events.extend(_manual_response_events(conversations, events, start, now))
    groups = {}
    for event in events:
        if event.response_seconds is None:
            continue
        address = event.conversation.to_address
        group = groups.setdefault(address, [])
        group.append(event.response_seconds)
    labels = {row["to_address"]: row for row in conversations.values(
        "to_address", "channel_site_id", "channel_site_name", "channel_label",
    ).distinct()}
    alerts = []
    for address, durations in groups.items():
        average = sum(durations) / len(durations)
        if average > 3600:
            alerts.append({"id": f"average:{address}:{monday}", "kind": "average",
                "business_address": address, "seconds": round(average),
                "sample_count": len(durations), "week_start": str(monday),
                **labels.get(address, {})})
    if 8 <= local.hour < 22:
        meaningful = WhatsAppMessage.objects.filter(conversation_id=models.OuterRef("pk")).exclude(
            body__iregex=r'^\s*\[(reaction|revoke)\]\s*$')
        last_out = meaningful.filter(direction="outbound").order_by("-created_at", "-id")
        latest = meaningful.order_by("-created_at", "-id")
        inbound = meaningful.filter(direction="inbound").order_by("-created_at", "-id")
        human = meaningful.filter(direction="outbound", response_source__in=("human_whatsapp", "human_dashboard")).order_by("-created_at", "-id")
        pending = conversations.annotate(
            alert_last_direction=models.Subquery(latest.values("direction")[:1]),
            alert_last_id=models.Subquery(latest.values("id")[:1]),
            alert_last_at=models.Subquery(latest.values("created_at")[:1]),
            alert_last_out=models.Subquery(last_out.values("created_at")[:1]),
            alert_inbound_at=models.Subquery(inbound.values("created_at")[:1]),
            alert_inbound_body=models.Subquery(inbound.values("body")[:1]),
            alert_inbound_routing=models.Subquery(inbound.values("routing_decision")[:1]),
            alert_human_at=models.Subquery(human.values("created_at")[:1]),
        ).filter(models.Q(alert_last_direction="inbound") | models.Q(alert_inbound_routing__in=("human_only", "automation_paused")) | models.Q(context__automation_paused_by_human=True))
        # Start at the first unanswered message, not at each follow-up from a customer.
        first = WhatsAppMessage.objects.filter(conversation_id=models.OuterRef("pk"), direction="inbound").exclude(
            body__iregex=r'^\s*\[(reaction|revoke)\]\s*$').filter(created_at__gt=Coalesce(
                models.OuterRef("alert_last_out"), models.Value(datetime(1970, 1, 1, tzinfo=MEXICO)),
                output_field=models.DateTimeField(),
            )).order_by("created_at", "id")
        first_human_wait = WhatsAppMessage.objects.filter(conversation_id=models.OuterRef("pk"), direction="inbound").exclude(body__iregex=r'^\s*\[(reaction|revoke)\]\s*$').filter(created_at__gt=Coalesce(models.OuterRef("alert_human_at"), models.Value(datetime(1970, 1, 1, tzinfo=MEXICO)), output_field=models.DateTimeField())).order_by("created_at", "id")
        for chat in pending.annotate(alert_started_at=models.Subquery(first.values("created_at")[:1]), alert_human_started_at=models.Subquery(first_human_wait.values("created_at")[:1])).values(
            "id", "to_address", "contact_phone", "context", "channel_site_id", "channel_site_name", "channel_label", "alert_started_at", "alert_last_id", "alert_last_at", "alert_last_out", "alert_inbound_at", "alert_inbound_body", "alert_inbound_routing", "alert_human_at", "alert_human_started_at", "alert_last_direction",
        ).iterator():
            context = chat["context"] if isinstance(chat["context"], dict) else {}
            resolution = context.get("attention_resolution")
            resolution = resolution if isinstance(resolution, dict) else {}
            if resolution.get("message_id") == chat["alert_last_id"]:
                continue
            human_at = chat["alert_human_at"]
            try:
                recorded = datetime.fromisoformat(str(context.get("human_last_reply_at", "")).replace("Z", "+00:00"))
                if recorded.tzinfo and (human_at is None or recorded > human_at):
                    human_at = recorded
            except ValueError:
                pass
            if human_at and (not chat["alert_inbound_at"] or human_at >= chat["alert_inbound_at"]):
                continue
            if chat["alert_last_out"] and closing_acknowledgement(chat["alert_inbound_body"]):
                continue
            needs_human = bool(context.get("automation_paused_by_human")) or chat["alert_inbound_routing"] in ("human_only", "automation_paused")
            if not needs_human and (chat["alert_last_direction"] != "inbound" or context.get("human_response_wait")):
                continue
            if needs_human:
                chat["alert_started_at"] = chat["alert_human_started_at"]
                if human_at and chat["alert_started_at"] and chat["alert_started_at"] <= human_at:
                    chat["alert_started_at"] = WhatsAppMessage.objects.filter(
                        conversation_id=chat["id"], direction="inbound", created_at__gt=human_at,
                    ).exclude(body__iregex=r'^\s*\[(reaction|revoke)\]\s*$').order_by("created_at", "id").values_list("created_at", flat=True).first()
            if not chat["alert_started_at"] or not start <= chat["alert_started_at"] <= now:
                continue
            seconds = working_seconds(chat["alert_started_at"], now) if chat["alert_started_at"] else 0
            if seconds > 7200:
                alerts.append({"id": f"pending:{chat['id']}:{chat['alert_started_at'].isoformat()}",
                    "kind": "pending", "conversation_id": chat["id"], "business_address": chat["to_address"],
                    "contact_name": context.get("contact_name") or chat["contact_phone"],
                    "seconds": seconds, "started_at": chat["alert_started_at"].isoformat(),
                    "channel_site_id": chat["channel_site_id"], "channel_site_name": chat["channel_site_name"], "channel_label": chat["channel_label"]})
    # Prioritize the rolling-week average warning above pending conversations.
    alerts.sort(key=lambda row: (0 if row["kind"] == "average" else 1, -row["seconds"], row["id"]))
    return {"items": alerts[:100], "total": len(alerts), "generated_at": now.isoformat(),
        "timezone": str(MEXICO), "week_start": str(monday), "window_start": start.isoformat(),
        "window_days": 7, "hours": {"start": "08:00", "end": "22:00"}}
