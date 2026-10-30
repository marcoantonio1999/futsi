"""Closing exchanges do not open a request for human attention.

Keep this small deterministic policy in sync across the API and webhook service.
Only whole acknowledgements match; a courtesy followed by a question does not.
"""
import re
import unicodedata


def is_human_reaction(direction, source, body):
    return direction == 'outbound' and source in ('human_whatsapp', 'human_dashboard') and str(body or '').strip().lower() == '[reaction]'


def reportable_messages_q():
    from django.db.models import Q
    return ~Q(body__iregex=r'^\s*\[revoke\]\s*$') & (
        ~Q(body__iregex=r'^\s*\[reaction\]\s*$') |
        Q(direction='outbound', response_source__in=('human_whatsapp','human_dashboard')))


_CLOSING = re.compile(
    r"(?:muchas? |muchisimas? |mil |muchisisimas? )?gracia+s+"
    r"(?: (?:por (?:todo|la (?:informacion|info|ayuda|atencion|respuesta)|el (?:apoyo|dato)|confirmar|avisar)|a ti|a usted|a ustedes))?"
    r"|grax|grx|thanks|thank you|thx|te agradezco|le agradezco|se agradece|muy amable"
    r"|a ustedes|a usted|a ti|igualmente|de nada|por nada|con gusto"
    r"|ok(?:ay)?|perfecto|listo|entendido|entiendo|excelente|ecelente|super|sale|vale|va|bueno|de acuerdo|esta bien|esta perfecto|muy bien|claro"
    r"|adio+s+|chao|chau|bye(?: bye)?|hasta luego|hasta pronto|hasta manana|nos vemos|cuidate|cuidese"
    r"|saludos(?: cordiales)?|(?:que (?:tengas|tenga|tengan|pases|pase|pasen) (?:un )?)?"
    r"(?:buen dia|buena tarde|buena noche|bonito dia|lindo dia|excelente dia|buen fin de semana)"
)


def closing_acknowledgement(body):
    text = str(body or '').strip()
    if not text:
        return False
    if text.casefold() in {'[sticker]', '[reaction]', '[revoke]'}:
        return True
    # Questions and numeric details must never disappear into a courtesy rule.
    if '?' in text or '¿' in text:
        return False
    if not any(char.isalnum() for char in text):
        return True  # Emoji-only, including combined emoji and skin tones.
    normalized = ' '.join(re.sub(r'[^\w]+', ' ', ''.join(
        char for char in unicodedata.normalize('NFKD', text).casefold()
        if not unicodedata.combining(char))).split())
    if normalized in {'buen dia', 'buena tarde', 'buena noche', 'bonito dia', 'lindo dia', 'excelente dia'}:
        return False  # A standalone greeting may be the start of a request.
    # Greetings/affirmations are not closures on their own. Accept them only
    # before a COMPLETE acknowledgement, never before arbitrary new information.
    prefix = re.match(r'^(?:(?:hola+|buenas (?:tardes|noches)|buenos dias|si+)\s+)+', normalized)
    if prefix:
        normalized = normalized[prefix.end():]
        if normalized in {'buen dia', 'buena tarde', 'buena noche', 'bonito dia', 'lindo dia', 'excelente dia'}:
            return False
    # Consume complete acknowledgement phrases, permitting combinations such as
    # "perfecto, muchas gracias, hasta luego" but never an arbitrary text suffix.
    while normalized:
        match = _CLOSING.match(normalized)
        if not match or (match.end() < len(normalized) and normalized[match.end()] != ' '):
            return False
        normalized = normalized[match.end():].strip()
        if normalized.startswith('y '):
            normalized = normalized[2:]
    return True
