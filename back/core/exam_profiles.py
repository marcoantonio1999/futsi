"""Literal, explainable profile filters and conservative contact matching. No AI."""
import math
import re
import unicodedata

from django.db.models import Case, When, FloatField, BooleanField, F, Value, Q
from django.db.models.functions import Cast
from rest_framework.exceptions import ValidationError

from core.exam_identity import exam_email, exam_phone


def normalized(value):
    return re.sub(r'\s+', ' ', ''.join(c for c in unicodedata.normalize('NFKD', value.casefold())
                                      if not unicodedata.combining(c))).strip()


def keywords(value):
    terms = list(dict.fromkeys(normalized(t) for t in re.split(r'[,;\n]', value) if t.strip()))
    if len(terms) > 20 or any(len(t) > 80 for t in terms):
        raise ValidationError({'detail': 'Usa hasta 20 palabras o frases de máximo 80 caracteres, separadas por comas.'})
    return terms


def keyword_pattern(term):
    # Token boundaries: Excel must not match "excelente"; C++ and .NET stay literal.
    return r'(?<![\w])' + re.escape(term) + r'(?![\w])'


def score_rows(rows):
    return rows.annotate(profile_score=Case(
        When(Q(grading_status='graded', submitted_at__isnull=False, grading__score__isnull=False) & ~Q(grading__score=None),
             then=Cast('grading__score', FloatField())), default=Value(None), output_field=FloatField()))


def filtered_attempts(rows, params, profiles=False):
    rows = score_rows(rows)
    cohort = rows.filter(profile_score__isnull=False)
    graded_count = cohort.count()
    threshold = None
    if params.get('top') == '10':
        if profiles and not params.get('exam'):
            raise ValidationError({'detail': 'Elige un examen para comparar su mejor 10 %, sin mezclar evaluaciones distintas.'})
        if graded_count:
            threshold = cohort.order_by('-profile_score', 'id').values_list('profile_score', flat=True)[math.ceil(graded_count / 10)-1]
            rows = rows.filter(profile_score__gte=threshold)
        else:
            rows = rows.none()
    query = params.get('q', '').strip()[:180]
    if query:
        rows = rows.filter(Q(name__icontains=query) | Q(email__icontains=query) | Q(phone__icontains=query))
    status = params.get('status', '')
    if status == 'graded':
        rows = rows.filter(profile_score__isnull=False)
    elif status == 'pending':
        rows = rows.filter(submitted_at__isnull=False).exclude(grading_status='graded')
    elif status == 'unsubmitted':
        rows = rows.filter(submitted_at__isnull=True)
    for field, operator in [('min_score', 'gte'), ('max_score', 'lte')]:
        value = params.get(field)
        if value not in (None, ''):
            try:
                number = float(value)
                if not math.isfinite(number) or not 0 <= number <= 10:
                    raise ValueError
            except (ValueError, TypeError):
                raise ValidationError({'detail': 'La calificación debe estar entre 0 y 10.'})
            rows = rows.filter(**{f'profile_score__{operator}': number})
    terms = keywords(params.get('keywords', '')) if profiles else []
    if terms:
        conditions = [Q(profile__cv_search__regex=keyword_pattern(t)) for t in terms]
        condition = conditions[0]
        for item in conditions[1:]:
            condition = condition | item if params.get('keyword_mode') == 'any' else condition & item
        rows = rows.filter(condition)
        rows = rows.annotate(**{f'profile_keyword_{i}': Case(
            When(profile__cv_search__regex=keyword_pattern(term),then=Value(True)),
            default=Value(False),output_field=BooleanField()) for i,term in enumerate(terms)})
    if profiles:
        if params.get('position'):
            rows = rows.filter(profile__position__icontains=params['position'][:180])
        if params.get('form_q'):
            rows = rows.filter(profile__form_search__contains=normalized(params['form_q'][:180]))
        if params.get('has_cv') == 'yes':
            rows = rows.filter(profile__cv_text__gt='')
        if params.get('has_form') == 'yes':
            rows = rows.filter(profile__form_text__gt='')
    ordering = params.get('ordering', 'newest')
    order = {'score_desc': F('profile_score').desc(nulls_last=True),
             'score_asc': F('profile_score').asc(nulls_last=True), 'name': 'name', 'newest': '-id'}
    if ordering not in order:
        raise ValidationError({'detail': 'Orden inválido.'})
    rows = rows.order_by(order['score_desc'] if params.get('top') == '10' else order[ordering], 'id')
    return rows, {'graded_count': graded_count, 'top_threshold': threshold, 'matched_keywords': terms}


def clean_string(value, limit, label):
    if not isinstance(value, str) or len(value) > limit:
        raise ValidationError({'detail': f'Revisa {label} (máximo {limit} caracteres).'})
    return value.strip()


def clean_fields(raw):
    if not isinstance(raw, dict) or len(raw) > 120:
        raise ValidationError({'detail': 'El formato admite hasta 120 campos de texto.'})
    return {clean_string(k, 100, 'el nombre de campo'): clean_string(v, 2000, 'el valor del campo')
            for k, v in raw.items() if v != ''}


def match_form(rows, fields, body):
    """Use only the applicant's contact fields, never an employer/reference phone."""
    canonical = {normalized(k).replace(' ', '_'): v for k, v in fields.items()}
    email = canonical.get('correo') or canonical.get('email') or canonical.get('correo_electronico') or ''
    phone = canonical.get('telefono') or canonical.get('phone') or canonical.get('celular') or ''
    # Plain-text exports must label contacts explicitly. Never match any random number in a CV/form.
    if not email:
        found = re.search(r'(?im)^\s*(?:correo(?: electr[oó]nico)?|email|e-mail)\s*:\s*([^\s]+@[^\s]+)', body)
        email = found.group(1) if found else ''
    if not phone:
        found = re.search(r'(?im)^\s*(?:tel[eé]fono|celular|phone)\s*:\s*([+\d][\d ()-]{7,25})', body)
        phone = found.group(1) if found else ''
    contact_email, contact_phone = exam_email(email), exam_phone(phone)
    if not contact_email and len(contact_phone) < 8:
        return 'unmatched', rows.none()
    condition = Q(pk__in=[])
    if contact_email:
        condition |= Q(identity_email=contact_email)
    if len(contact_phone) >= 8:
        condition |= Q(identity_phone=contact_phone)
    matches = rows.filter(condition)
    candidates = list(matches[:2])
    if len(candidates) != 1:
        return ('ambiguous' if candidates else 'unmatched'), matches
    candidate = candidates[0]
    if ((contact_email and candidate.identity_email != contact_email)
            or (len(contact_phone) >= 8 and candidate.identity_phone != contact_phone)):
        return 'conflict', matches
    return 'matched', matches
