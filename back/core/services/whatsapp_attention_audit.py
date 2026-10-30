"""Read saved private AI evidence. Never calls providers or changes messages."""
import hashlib
import json
from django.db import models
from django.conf import settings
from core.models import WhatsAppMessage
from .whatsapp_quality_report import QualityAudit
from core.whatsapp.attention import is_human_reaction

VERSION = 'attention_v2'


def invalid_reaction_ids(conversation_ids, start, end):
    """Only explicit, verified NEW model evidence can revoke a human reaction."""
    if not _test_table_available():
        return set()
    rows = list(QualityAudit.objects.filter(conversation_id__in=conversation_ids, rubric=VERSION,
        status='completed',period_end__gte=start,period_end__lte=end).order_by('conversation_id','-period_end','-pk').values('conversation_id','result'))
    latest = {}
    for row in rows:
        latest.setdefault(row['conversation_id'],row['result'])
    eligible = {cid:r for cid,r in latest.items() if r.get('reaction_policy') == 'human_reaction_v1'
                and r.get('confidence',0)>=.9 and r.get('current_state')=='pending'
                and isinstance(r.get('insufficient_reaction_ids'),list)}
    ids = {int(mid) for r in eligible.values() for mid in r.get('message_versions',{}) if str(mid).isdigit()}
    by_chat = {}
    for message in WhatsAppMessage.objects.filter(pk__in=ids,conversation_id__in=eligible).values(
        'id','conversation_id','created_at','body','direction','response_source'):
        by_chat.setdefault(message['conversation_id'],{})[message['id']] = message
    invalid = set()
    for cid,result in eligible.items():
        messages=by_chat.get(cid,{})
        if not evidence_valid(result,messages):
            continue
        for mid in result['insufficient_reaction_ids']:
            m=messages.get(mid) if type(mid) is int else None
            if m and is_human_reaction(m['direction'],m['response_source'],m['body']):
                invalid.add(mid)
    return invalid


def _test_table_available():
    # Legacy unit-test settings do not create unmanaged shared tables. Dedicated
    # integration tests create this private table explicitly. Production must
    # surface DB errors, never silently disable analysis reads.
    if settings.FUTSI_ENV != 'test':
        return True
    from django.db import connection
    return QualityAudit._meta.db_table in connection.introspection.table_names()


def message_version(message):
    payload = [message['id'], message['direction'], message['body'], message['response_source'],
               message['created_at'].isoformat()]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()


def evidence_valid(result, messages):
    versions = result.get('message_versions')
    return (isinstance(versions, dict) and bool(versions) and all(
        str(mid).isdigit() and int(mid) in messages and message_version(messages[int(mid)]) == value
        for mid, value in versions.items()))


def ignored_request_ids(conversation_ids, start, end):
    """Exclude only model-supported exact requests, not entire conversations.

    Evidence is matched against its original chat and content. New messages cannot
    be excluded by an old snapshot; actual human reply timestamps stay untouched.
    """
    if not _test_table_available():
        return set()
    rows = list(QualityAudit.objects.filter(conversation_id__in=conversation_ids, rubric=VERSION,
        status='completed', period_end__gte=start, period_end__lte=end).values('conversation_id', 'result'))
    ids = {int(mid) for row in rows for mid in row['result'].get('message_versions', {}) if str(mid).isdigit()}
    by_chat = {}
    for message in WhatsAppMessage.objects.filter(id__in=ids, conversation_id__in=conversation_ids).values(
            'id', 'conversation_id', 'created_at', 'body', 'direction', 'response_source'):
        by_chat.setdefault(message['conversation_id'], {})[message['id']] = message
    ignored = set()
    for row in rows:
        result = row['result']
        if result.get('confidence', 0) < .9 or result.get('current_state') == 'uncertain':
            continue
        messages = by_chat.get(row['conversation_id'], {})
        if not evidence_valid(result, messages):
            continue
        for mid in result.get('non_request_ids', []) + result.get('resolved_request_ids', []):
            if type(mid) is int and mid in messages and messages[mid]['direction'] == 'inbound':
                ignored.add(mid)
    return ignored


def annotate_attention(queryset):
    if not _test_table_available():
        return queryset
    latest = QualityAudit.objects.filter(conversation_id=models.OuterRef('pk'), channel=models.OuterRef('to_address'),
        rubric=VERSION, status='completed').order_by('-period_end', '-pk')
    return queryset.annotate(saved_attention=models.Subquery(latest.values('result')[:1]))


def current_attention(instance):
    result = getattr(instance, 'saved_attention', None)
    if not isinstance(result, dict) or (result.get('current_state') != 'uncertain' and result.get('confidence', 0) < .9):
        return None
    context = instance.context if isinstance(instance.context, dict) else {}
    if str(context.get('human_last_reply_at') or '') != result.get('human_last_reply_at', ''):
        return None
    messages = list(instance.messages.all())
    meaningful = sorted((m for m in messages if m.body.strip().lower() != '[revoke]' and
                        (m.body.strip().lower() != '[reaction]' or is_human_reaction(m.direction,m.response_source,m.body))),
                        key=lambda m: (m.created_at, m.id))
    if not meaningful or meaningful[-1].id != result.get('last_message_id'):
        return None
    by_id = {m.id: dict(id=m.id, direction=m.direction, body=m.body, response_source=m.response_source,
                       created_at=m.created_at) for m in messages}
    if not evidence_valid(result, by_id):
        return None
    last=meaningful[-1]
    if is_human_reaction(last.direction,last.response_source,last.body) and result.get('current_state') in ('pending','uncertain'):
        if result.get('reaction_policy') != 'human_reaction_v1' or last.id not in result.get('insufficient_reaction_ids',[]):
            return None  # Old/uncertain analysis cannot revoke the immediate acknowledgement.
    return {key: result.get(key) for key in ('current_state', 'last_message_id', 'analyzed_until')}


def historical_non_request_ids(instance):
    result = getattr(instance, 'saved_attention', None)
    if not isinstance(result, dict) or result.get('confidence', 0) < .9 or result.get('current_state') == 'uncertain':
        return []
    by_id = {m.id: dict(id=m.id, direction=m.direction, body=m.body, response_source=m.response_source,
                       created_at=m.created_at) for m in instance.messages.all()}
    if not evidence_valid(result, by_id):
        return []
    return [mid for mid in result.get('non_request_ids', []) + result.get('resolved_request_ids', [])
            if type(mid) is int and mid in by_id and by_id[mid]['direction'] == 'inbound']
