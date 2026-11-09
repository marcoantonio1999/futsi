"""Conservative parsing of applicant-provided form fields for optional filters."""
import re
import unicodedata
from decimal import Decimal, InvalidOperation

from rest_framework.exceptions import ValidationError


def age_value(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r'\s*(\d{1,3})\s*(?:años?|anos?)?\s*', value, re.IGNORECASE)
    age = int(match.group(1)) if match else 0
    return age if 1 <= age <= 120 else None


def salary_value(value):
    if not isinstance(value, str):
        return None
    # Accept a single monetary amount and optional monthly context only.
    match = re.fullmatch(r'\s*(?:mxn\s*)?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(mil)?\s*(?:pesos|mxn)?\s*(?:mensual(?:es)?|al mes|por mes)?\s*', value, re.IGNORECASE)
    if not match:
        return None
    try:
        amount = Decimal(match.group(1).replace(',', '') + ('.' + match.group(2) if match.group(2) else ''))
        if match.group(3): amount *= 1000
        return amount if 0 <= amount <= 100000000 else None
    except InvalidOperation:
        return None


def duration_months(value):
    if not isinstance(value, str):
        return None
    value = ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if not unicodedata.combining(c))
    # Units are mandatory; free-form ranges, current/ongoing durations and
    # date strings are deliberately not guessed.
    match = re.fullmatch(r'\s*(?:(\d{1,3}(?:\.\d{1,2})?)\s*anos?\s*)?(?:y\s*)?(?:(\d{1,3})\s*mes(?:es)?\s*)?', value)
    if not match or not (match.group(1) or match.group(2)):
        return None
    months = Decimal(match.group(1) or '0') * 12 + Decimal(match.group(2) or '0')
    return months if 0 <= months <= 1200 else None


def reported_experience(fields):
    total = Decimal(0)
    found = False
    for i in range(1, 5):
        company = str(fields.get(f'empleo_{i}_compania', '') or '').strip()
        duration = str(fields.get(f'empleo_{i}_tiempo_servicio', '') or '').strip()
        if not company and not duration:
            continue
        if company.casefold() == 'no aplica' and duration.casefold() in ('', 'no aplica'):
            continue
        parsed = duration_months(duration)
        if parsed is None:
            return None
        found = True
        total += parsed
    return total if found and total <= 1200 else None


def parse_bounds(params, definitions):
    bounds = {}
    for name, maximum, whole in definitions:
        for suffix in ('min', 'max'):
            raw = params.get(f'{name}_{suffix}', '')
            if raw in (None, ''):
                continue
            try:
                number = Decimal(str(raw))
                if not number.is_finite() or number < 0 or number > maximum or (whole and number != number.to_integral_value()):
                    raise InvalidOperation
            except (InvalidOperation, ValueError):
                raise ValidationError({'detail': f'Revisa el rango de {name}.'})
            bounds[f'{name}_{suffix}'] = number
        if bounds.get(f'{name}_min', Decimal(0)) > bounds.get(f'{name}_max', Decimal(maximum)):
            raise ValidationError({'detail': f'El mínimo de {name} no puede superar el máximo.'})
    return bounds


def matches_bounds(value, bounds, name):
    if value is None:
        return False
    return (f'{name}_min' not in bounds or value >= bounds[f'{name}_min']) and (f'{name}_max' not in bounds or value <= bounds[f'{name}_max'])


def filter_form_fields(rows, params):
    bounds = parse_bounds(params, [('edad', 120, True), ('sueldo', 100000000, False), ('experiencia', 100, False)])
    if not bounds:
        return rows
    matched = []
    for pk, fields in rows.values_list('pk', 'profile__form_fields').iterator(chunk_size=200):
        fields = fields if isinstance(fields, dict) else {}
        if any(k.startswith('edad_') for k in bounds) and not matches_bounds(age_value(fields.get('edad')), bounds, 'edad'):
            continue
        if any(k.startswith('sueldo_') for k in bounds) and not matches_bounds(salary_value(fields.get('sueldo_deseado')), bounds, 'sueldo'):
            continue
        if any(k.startswith('experiencia_') for k in bounds):
            months = reported_experience(fields)
            if not matches_bounds(months / 12 if months is not None else None, bounds, 'experiencia'):
                continue
        matched.append(pk)
    return rows.filter(pk__in=matched)
