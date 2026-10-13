from collections import Counter
from django.db import connection
from core.api.whatsapp_chat_export import _directory_phone_id
import re


def classification_group(relationship):
    text = (relationship or "").strip().casefold()
    if not text or text == "sin clasificar":
        return "unclassified"
    if text in {"prospecto", "lista de espera"}:
        return "prospect"
    if text in {"alumno confirmado", "participante confirmado", "familia / cliente", "participante adulto"}:
        return "current_client"
    if text in {"indeterminado", "alumno probable", "participante probable", "mixto", "sin texto"}:
        return "ambiguous"
    # Never invent an active-client/prospect decision for historical free text.
    return "other"


def contact_audit(addresses):
    ids = sorted({value for address in addresses if (value := _directory_phone_id(address))})
    totals = Counter(dict(prospect=0, current_client=0, ambiguous=0, unclassified=0, other=0))
    result = {"total": 0, "categories": dict(totals), "relationships": [], "datasets": []}
    if not ids:
        return result
    tables = set(connection.introspection.table_names())
    if not {"whatsapp_contact_datasets", "whatsapp_contact_records"}.issubset(tables):
        return result
    with connection.cursor() as cursor:
        cursor.execute(f"""SELECT d.key, d.phone_number_id, r.relationship, COUNT(*)
            FROM whatsapp_contact_records r JOIN whatsapp_contact_datasets d ON d.id=r.dataset_id
            WHERE d.phone_number_id IN ({','.join(['%s'] * len(ids))})
            GROUP BY d.key, d.phone_number_id, r.relationship""", ids)
        rows = cursor.fetchall()
    relationships = Counter()
    datasets = Counter()
    for key, phone_id, relationship, count in rows:
        totals[classification_group(relationship)] += count
        relationships[relationship or "Sin clasificar"] += count
        datasets[key] += count
    return {"total": sum(totals.values()), "categories": dict(totals),
            "relationships": [{"label": name, "count": count} for name, count in sorted(relationships.items(), key=lambda item: (-item[1], item[0]))],
            "datasets": [{"key": key, "total": count} for key, count in sorted(datasets.items())]}


def _normalized_directory_phone(phone):
    digits = re.sub(r'\D', '', phone or '')
    if digits.startswith('521') and len(digits) == 13:
        return '52' + digits[-10:]
    if len(digits) == 10:
        return '52' + digits
    return digits


def period_contact_audit(conversations, start, end):
    """Historical classifications for contacts active in the authorized window."""
    pairs = set()
    for address, phone in conversations.filter(messages__created_at__gte=start, messages__created_at__lt=end).order_by().values_list('to_address', 'contact_phone').distinct():
        digits = _normalized_directory_phone(phone)
        if digits:
            pairs.add((_directory_phone_id(address) or address, digits))
    categories = Counter(dict(prospect=0, current_client=0, ambiguous=0, unclassified=0, other=0))
    relationships, datasets = Counter(), Counter()
    classified = {}
    ids = sorted({key for key, _ in pairs if key.isdigit()})
    tables = set(connection.introspection.table_names()) if ids else set()
    if {'whatsapp_contact_datasets','whatsapp_contact_records'}.issubset(tables):
        with connection.cursor() as cursor:
            cursor.execute(f"""SELECT d.key,d.phone_number_id,r.phone,r.relationship FROM whatsapp_contact_records r
                JOIN whatsapp_contact_datasets d ON d.id=r.dataset_id WHERE d.phone_number_id IN ({','.join(['%s'] * len(ids))})
                ORDER BY r.updated_at,r.id""",ids)
            for dataset, phone_id, phone, relationship in cursor.fetchall():
                digits = _normalized_directory_phone(phone)
                pair=(phone_id,digits)
                if pair in pairs:
                    classified[pair]=(dataset,relationship)
    for pair in pairs:
        dataset, relationship = classified.get(pair, ('', 'Sin clasificar'))
        categories[classification_group(relationship)] += 1
        relationships[relationship or 'Sin clasificar'] += 1
        if dataset:
            datasets[dataset] += 1
    return {'total':len(pairs),'categories':dict(categories),'relationships':[{'label':label,'count':count} for label,count in sorted(relationships.items())], 'datasets':[{'key':key,'total':count} for key,count in sorted(datasets.items())], 'period_start':start.isoformat(),'period_end':end.isoformat()}
