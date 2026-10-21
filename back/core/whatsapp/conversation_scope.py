"""Keep explicitly identified groups out of individual-attention reporting.

Never infer a group from its display name or participant's phone number.
This only filters reads: messages, response events and audits remain intact.
"""
from django.db.models import Q


def group_conversations_q():
    group = Q(from_address__iendswith='@g.us') | Q(contact_phone__iendswith='@g.us')
    for key in ('is_group', 'isGroup'):
        group |= Q(context__has_key=key) & Q(**{f'context__{key}': True})
    for key in ('chat_type', 'chatType', 'conversation_type', 'kind'):
        group |= Q(context__has_key=key) & Q(**{f'context__{key}__iexact': 'group'})
    # A non-empty provider group identifier is explicit group evidence.
    for key in ('group_id', 'groupId'):
        group |= Q(context__has_key=key) & ~Q(**{f'context__{key}': ''}) & ~Q(**{f'context__{key}': None})
    return group


def individual_conversations(queryset):
    return queryset.exclude(group_conversations_q())
