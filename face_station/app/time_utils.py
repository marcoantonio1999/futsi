from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


try:
    BUSINESS_TIME_ZONE = ZoneInfo("America/Mexico_City")
except ZoneInfoNotFoundError:
    BUSINESS_TIME_ZONE = timezone(
        timedelta(hours=-6),
        name="America/Mexico_City",
    )


def business_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=BUSINESS_TIME_ZONE)
    return value.astimezone(BUSINESS_TIME_ZONE)
