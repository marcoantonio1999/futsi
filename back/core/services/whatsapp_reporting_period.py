"""Shared rolling reporting windows; legacy weekly requests remain supported."""
from datetime import timedelta
from zoneinfo import ZoneInfo
from django.utils import timezone
from rest_framework.exceptions import ValidationError

RANGES = {'week': 7, 'three_days': 3, 'day': 1, 'month': 30}

def rolling_period(params, now=None):
    key = params.get('range')
    if key is None:
        return None
    if key not in RANGES:
        raise ValidationError({'range': 'Elige última semana, últimos 3 días, último día o último mes.'})
    end = (now or timezone.now()).astimezone(ZoneInfo('America/Mexico_City'))
    return end - timedelta(days=RANGES[key]), end, key, RANGES[key]
