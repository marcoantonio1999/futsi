"""Read-only, site-scoped bridge-day findings for the quality dashboard.

Not wired to an endpoint until the bridge calendar and worker are integrated.
"""
from collections import Counter
from core.services.whatsapp_quality_report import QualityAudit
from core.models import WhatsAppAutomationSettings

RUBRIC = 'bridge_invitation_v1'


def bridge_report(conversations, period_end=None):
    scoped = conversations.order_by().values('pk')
    rows = QualityAudit.objects.filter(conversation_id__in=scoped, rubric=RUBRIC)
    if period_end is not None:
        rows = rows.filter(period_end=period_end)
    else:
        from django.db.models import Max
        cutoff = rows.aggregate(value=Max('period_end'))['value']
        rows = rows.filter(period_end=cutoff) if cutoff else rows.none()
    channel_names = {row['business_address']: (row['channel_label'] or row['site__name'] or 'Número de torneo')
        for row in WhatsAppAutomationSettings.objects.filter(business_address__in=rows.values('channel')).values('business_address', 'channel_label', 'site__name')}
    counts = Counter()
    findings = []
    latest_period = None
    bridge_label = ""
    for row in rows.order_by('channel', 'conversation_id').values('conversation_id', 'channel', 'period_end', 'status', 'result'):
        latest_period = row['period_end']
        bridge_label = row['result'].get('bridge_label', bridge_label)
        category = row['result'].get('category') if row['status'] == 'completed' else row['status']
        counts[category or 'unknown'] += 1
        if category in ('missed_opportunity', 'discouraged'):
            findings.append({'conversation_id': row['conversation_id'], 'channel': row['channel'],
                             'period_start': row['result'].get('period_start', ''), 'category': category, 'channel_label': channel_names.get(row['channel'], 'Número de torneo'), 'period_end': row['period_end'].isoformat(),
                             'evidence_message_ids': row['result'].get('evidence_message_ids', [])})
    return {'counts': dict(counts), 'findings': findings, 'period_end': latest_period.isoformat() if latest_period else None, 'bridge_label': bridge_label}
