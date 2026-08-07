from __future__ import annotations

from datetime import datetime

from .time_utils import BUSINESS_TIME_ZONE, business_time


MATCH_DAY_START_MINUTE = 9 * 60 + 45
MATCH_DAY_END_MINUTE = 14 * 60
MATCH_EVENING_START_MINUTE = 15 * 60 + 45
MATCH_EVENING_END_MINUTE = 23 * 60
MATCH_BILLING_EARLY_GRACE_MINUTES = 15


def match_fee_band(starts_at: str) -> str:
    value = str(starts_at or "").strip()
    if not value:
        return ""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return ""
    local = business_time(parsed)
    minute = local.hour * 60 + local.minute
    if MATCH_DAY_START_MINUTE <= minute <= MATCH_DAY_END_MINUTE:
        return "day"
    if MATCH_EVENING_START_MINUTE <= minute <= MATCH_EVENING_END_MINUTE:
        return "evening"
    return ""


def annotate_match_revenue(
    payload: dict,
    *,
    day_fee_amount: float,
    evening_fee_amount: float,
) -> dict:
    fees = {
        "day": round(float(day_fee_amount), 2),
        "evening": round(float(evening_fee_amount), 2),
    }
    for day in payload.get("items") or []:
        for window in day.get("windows") or []:
            anchor_value = (
                window.get("scheduled_starts_at")
                if window.get("window_type") == "scheduled"
                else window.get("starts_at")
            )
            billing_anchor = str(anchor_value or "")
            if not billing_anchor:
                billing_anchor = str(window.get("starts_at") or "")
            band = match_fee_band(billing_anchor)
            window["fee_band"] = band
            window["fee_amount"] = fees.get(band, 0.0)
            window["billing_anchor_at"] = billing_anchor
    payload["revenue_policy"] = {
        "match_day_fee_amount": fees["day"],
        "match_evening_fee_amount": fees["evening"],
        "time_zone": getattr(BUSINESS_TIME_ZONE, "key", "America/Mexico_City"),
        "early_grace_minutes": MATCH_BILLING_EARLY_GRACE_MINUTES,
        "bands": [
            {
                "key": "day",
                "label": "10:00 a.m. a 2:00 p.m.",
                "effective_start": "09:45",
                "effective_end": "14:00",
                "amount": fees["day"],
            },
            {
                "key": "evening",
                "label": "4:00 p.m. a 11:00 p.m.",
                "effective_start": "15:45",
                "effective_end": "23:00",
                "amount": fees["evening"],
            },
        ],
    }
    return payload
