"""Read-only, site-scoped attention alerts; no messages or production writes."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import models
from django.db.models.functions import Coalesce
from django.utils import timezone
from core.models import WhatsAppHumanResponseEvent, WhatsAppMessage
from core.whatsapp.attention import closing_acknowledgement, reportable_messages_q
from core.whatsapp.conversation_scope import individual_conversations
from core.whatsapp.response_schedule import working_seconds, get_schedule, is_working

MEXICO = ZoneInfo("America/Mexico_City")


def attention_notifications(conversations, now=None):
    from .trials import _manual_response_events, _reportable_response_events
    now = now or timezone.now()
    schedule = get_schedule()
    # Rolling seven days: old unanswered requests must not remain in the bell,
    # even if a recent follow-up or bot acknowledgement touched the conversation.
    start = now - timedelta(days=7)
    monday = start.astimezone(MEXICO).date()
    # Strip the inbox's message prefetch: alerts must not serialize/load full chats.
    conversations = individual_conversations(conversations).prefetch_related(None).order_by()
    events = list(WhatsAppHumanResponseEvent.objects.filter(
        conversation__in=conversations, human_attention_expected=True,
        first_inbound_at__gte=start, first_inbound_at__lte=now,
    ).select_related("conversation", "responder_user", "first_inbound_message").order_by("first_inbound_at"))
    from core.services.whatsapp_attention_audit import ignored_request_ids, invalid_reaction_ids
    ignored_ids = ignored_request_ids(conversations.values('pk'), start, now)
    invalid_reactions = invalid_reaction_ids(conversations.values('pk'), start, now)
    events = _reportable_response_events(events, start, now, ignored_ids, invalid_reactions)
    events.extend(_manual_response_events(conversations, events, start, now, ignored_ids, invalid_reactions))
    groups = {}
    for event in events:
        if event.response_seconds is None:
            continue
        address = event.conversation.to_address
        group = groups.setdefault(address, [])
        group.append(working_seconds(event.first_inbound_at, event.responded_at, schedule))
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
    if is_working(now, schedule):
        meaningful = WhatsAppMessage.objects.filter(reportable_messages_q(),conversation_id=models.OuterRef("pk")).exclude(pk__in=invalid_reactions)
        rejected = WhatsAppMessage.objects.filter(conversation_id=models.OuterRef('pk'),pk__in=invalid_reactions).order_by('-created_at','-id')
        last_out = meaningful.filter(direction="outbound").order_by("-created_at", "-id")
        latest = meaningful.order_by("-created_at", "-id")
        inbound = meaningful.filter(direction="inbound").exclude(pk__in=ignored_ids).order_by("-created_at", "-id")
        human = meaningful.filter(direction="outbound", response_source__in=("human_whatsapp", "human_dashboard")).order_by("-created_at", "-id")
        pending = conversations.annotate(
            alert_rejected_human_at=models.Subquery(rejected.values('created_at')[:1]),
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
        first = WhatsAppMessage.objects.filter(conversation_id=models.OuterRef("pk"), direction="inbound").exclude(pk__in=ignored_ids).exclude(
            body__iregex=r'^\s*\[(reaction|revoke)\]\s*$').filter(created_at__gt=Coalesce(
                models.OuterRef("alert_last_out"), models.Value(datetime(1970, 1, 1, tzinfo=MEXICO)),
                output_field=models.DateTimeField(),
            )).order_by("created_at", "id")
        first_human_wait = WhatsAppMessage.objects.filter(conversation_id=models.OuterRef("pk"), direction="inbound").exclude(pk__in=ignored_ids).exclude(body__iregex=r'^\s*\[(reaction|revoke)\]\s*$').filter(created_at__gt=Coalesce(models.OuterRef("alert_human_at"), models.Value(datetime(1970, 1, 1, tzinfo=MEXICO)), output_field=models.DateTimeField())).order_by("created_at", "id")
        pending_rows = list(pending.annotate(alert_started_at=models.Subquery(first.values("created_at")[:1]), alert_human_started_at=models.Subquery(first_human_wait.values("created_at")[:1])).values(
            "id", "to_address", "contact_phone", "context", "channel_site_id", "channel_site_name", "channel_label", "alert_started_at", "alert_last_id", "alert_last_at", "alert_last_out", "alert_inbound_at", "alert_inbound_body", "alert_inbound_routing", "alert_human_at", "alert_human_started_at", "alert_last_direction", "alert_rejected_human_at",
        ))
        # Inspect the open incoming turn, not just its last emoji. One bounded
        # read for the visible candidates; no per-chat lookup, model or timer.
        incoming_by_chat = {}
        starts = [stamp for row in pending_rows for stamp in (row["alert_started_at"], row["alert_human_started_at"]) if stamp]
        if starts:
            incoming = WhatsAppMessage.objects.filter(conversation_id__in=[row["id"] for row in pending_rows],
                direction="inbound", created_at__gte=min(starts)).exclude(pk__in=ignored_ids).order_by("created_at", "id").values("id", "conversation_id", "created_at", "body")
            for message in incoming.iterator():
                if not closing_acknowledgement(message["body"]) and message["body"].strip().lower() not in {"[reaction]", "[revoke]"}:
                    incoming_by_chat.setdefault(message["conversation_id"], []).append(message)
        for chat in pending_rows:
            context = chat["context"] if isinstance(chat["context"], dict) else {}
            resolution = context.get("attention_resolution")
            resolution = resolution if isinstance(resolution, dict) else {}
            if resolution.get("message_id") == chat["alert_last_id"]:
                continue
            human_at = chat["alert_human_at"]
            try:
                recorded = datetime.fromisoformat(str(context.get("human_last_reply_at", "")).replace("Z", "+00:00"))
                rejected_at=chat['alert_rejected_human_at']
                if recorded.tzinfo and (not rejected_at or recorded > rejected_at+timedelta(seconds=2)) and (human_at is None or recorded > human_at):
                    human_at = recorded
            except ValueError:
                pass
            if human_at and (not chat["alert_inbound_at"] or human_at >= chat["alert_inbound_at"]):
                continue
            needs_human = bool(context.get("automation_paused_by_human")) or chat["alert_inbound_routing"] in ("human_only", "automation_paused")
            if not needs_human and (chat["alert_last_direction"] != "inbound" or context.get("human_response_wait")):
                continue
            if needs_human:
                chat["alert_started_at"] = chat["alert_human_started_at"]
            boundary = human_at if needs_human else chat["alert_last_out"]
            actual_request = next((m for m in incoming_by_chat.get(chat["id"], [])
                if boundary is None or m["created_at"] > boundary), None)
            if actual_request is None:
                continue  # The incoming turn contains only closing acknowledgements.
            chat["alert_started_at"] = actual_request["created_at"]
            if not chat["alert_started_at"] or not start <= chat["alert_started_at"] <= now:
                continue
            seconds = working_seconds(chat["alert_started_at"], now, schedule) if chat["alert_started_at"] else 0
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
        "window_days": 7, "hours": {"start": schedule.starts_at.strftime('%H:%M'), "end": schedule.ends_at.strftime('%H:%M'), "days":schedule.days}}
