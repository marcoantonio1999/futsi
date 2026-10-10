"""Authorized reads of the private audit table owned by the WhatsApp service."""
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import models
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from core.models import WhatsAppMessage
from .whatsapp_quality_scores import scores, score_summary, cost_summary


class QualityAudit(models.Model):
    conversation_id = models.BigIntegerField()
    channel = models.CharField(max_length=64)
    period_end = models.DateTimeField()
    rubric = models.CharField(max_length=32)
    model = models.CharField(max_length=120)
    status = models.CharField(max_length=16)
    result = models.JSONField()
    usage = models.JSONField()

    class Meta:
        app_label = "core"
        managed = False
        db_table = "whatsapp_quality_audits"


def quality_report(conversations, params):
    zone = ZoneInfo("America/Mexico_City")
    now = timezone.now().astimezone(zone)
    try:
        selected = datetime.fromisoformat(params["week_start"]).replace(tzinfo=zone) if params.get("week_start") else now
        start = selected.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=(selected.weekday()+1) % 7)
        offset = int(params.get("offset", 0))
        if not 0 <= offset <= 10000000:
            raise ValueError()
    except (TypeError, ValueError):
        raise ValidationError("Semana o página inválida.")
    end = start + timedelta(days=7)
    scoped = conversations.order_by().values("pk")
    rows = QualityAudit.objects.filter(conversation_id__in=scoped, rubric__in=["commercial_v2", "commercial_v3"], period_end__gt=start, period_end__lte=end)
    cutoff = rows.aggregate(value=models.Max("period_end"))["value"]
    rows = rows.filter(period_end=cutoff) if cutoff else rows.none()
    rubric = "commercial_v3" if rows.filter(rubric="commercial_v3").exists() else "commercial_v2"
    rows = rows.filter(rubric=rubric)
    if params.get("segment"):
        if params["segment"] not in {"prospecto", "cliente_actual", "sin_interes_visible", "no_evaluable"}:
            raise ValidationError("Segmento inválido.")
        rows = rows.filter(result__segment=params["segment"])
    summary_rows = list(rows.values("channel", "status", "result", "model", "usage"))
    counts = Counter(row["status"] for row in summary_rows)
    metadata = {row["to_address"]: row for row in conversations.order_by().values("to_address", "channel_site_name", "channel_label").distinct()}
    sites = {}
    activity_end = cutoff or min(now, end)
    active = conversations.filter(messages__created_at__gte=start, messages__created_at__lt=activity_end).order_by().values("to_address").annotate(chats=models.Count("pk", distinct=True))
    for row in active:
        channel = row["to_address"]
        label = metadata.get(channel, {})
        sites[channel] = {"channel": channel, "site": label.get("channel_site_name") or label.get("channel_label") or channel,
            "eligible": row["chats"], "completed": 0, "failed": 0, "skipped": 0, "proactive": 0, "insufficient": 0}
    for row in summary_rows:
        channel = row["channel"]
        label = metadata.get(channel, {})
        item = sites.setdefault(channel, {"channel": channel, "site": label.get("channel_site_name") or label.get("channel_label") or channel, "eligible": 0, "completed": 0, "failed": 0, "skipped": 0, "proactive": 0, "insufficient": 0})
        if row["status"] in item:
            item[row["status"]] += 1
        if row["status"] == "completed":
            item["proactive"] += row["result"].get("commercial_initiative") == "proactiva"
            item["insufficient"] += row["result"].get("useful_response") == "insuficiente"
    for channel, item in sites.items():
        item["scores"] = score_summary([row for row in summary_rows if row["channel"] == channel])
    page = list(rows.order_by("channel", "conversation_id").values("conversation_id", "channel", "status", "model", "result")[offset:offset+50])
    for row in page:
        row["site"] = sites[row["channel"]]["site"]
        row["scores"] = scores(row["result"]) if row["status"] == "completed" else {}
    evidence = None
    if params.get("conversation_id"):
        try:
            conversation_id = int(params["conversation_id"])
        except (ValueError, TypeError):
            raise ValidationError("Conversación inválida.")
        audited = rows.filter(conversation_id=conversation_id).first()
        if audited:
            # Never trust provider IDs to authorize access to another chat or period.
            ids = audited.result.get("evidence_message_ids") or []
            messages = WhatsAppMessage.objects.filter(conversation_id=conversation_id, id__in=ids,
                created_at__gte=start, created_at__lt=cutoff).order_by("created_at", "id")
            import re
            def redact(text):
                text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[correo]", text)
                return re.sub(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)", "[teléfono]", text)
            evidence = {"conversation_id": conversation_id, "result": audited.result, "scores": scores(audited.result),
                "messages": [{"id": m.id, "at": m.created_at.isoformat(), "direction": m.direction,
                    "source": m.response_source, "text": redact(m.body)} for m in messages]}
    return {"week_start": start.isoformat(), "analyzed_until": cutoff.isoformat() if cutoff else None,
        "provisional": cutoff is not None and cutoff < end, "status_counts": dict(counts),
        "model": sorted({row["model"] for row in summary_rows if row["model"]}),
        "effort": sorted({row["result"].get("reasoning_effort") or "no registrado" for row in summary_rows if row["status"] == "completed"}),
        "eligible": sum(row["eligible"] for row in sites.values()), "sites": list(sites.values()), "total": len(summary_rows), "offset": offset,
        "results": page, "outcomes_verified": False, "rubric": rubric,
        "scores": score_summary(summary_rows), "cost": cost_summary(summary_rows), "evidence": evidence,
        "score_method": "0/50/100 por criterio. No aplica/no evaluable se excluyen. Vendedor: media de respuesta útil y siguiente paso, solo prospectos. Resultados sujetos a revisión; no prueban ventas."}
