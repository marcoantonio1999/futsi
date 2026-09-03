from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.models import (
    CallTranscriptSegment,
    CallOutcome,
    Court,
    TrialAvailabilityRule,
    TrialBooking,
    TrialBookingSource,
    TrialVisit,
    TrialVisitStatus,
    VoiceCall,
)


ACTIVE_VISIT_STATUSES = [TrialVisitStatus.SCHEDULED]


class SchedulingError(ValueError):
    """A safe, caller-facing validation error for the Realtime tool."""


@transaction.atomic
def withdraw_voice_consent(*, voice_call_id: int) -> dict[str, Any]:
    """Stop local processing and remove the call transcript on withdrawal."""

    call = VoiceCall.objects.select_for_update().get(id=voice_call_id)
    withdrawn_at = call.consent_withdrawn_at or timezone.now()
    call.consent_withdrawn_at = withdrawn_at
    call.extracted_data = {"consent_withdrawn_at": withdrawn_at.isoformat()}
    call.summary = "La persona retiró el consentimiento y la transcripción local fue eliminada."
    if not call.booking_id:
        call.ai_outcome = CallOutcome.UNSUCCESSFUL
        call.failure_reason = "La persona retiró el consentimiento durante la llamada."
    call.save(
        update_fields=[
            "consent_withdrawn_at",
            "extracted_data",
            "summary",
            "ai_outcome",
            "failure_reason",
            "updated_at",
        ]
    )
    CallTranscriptSegment.objects.filter(call=call).delete()
    return {"ok": True, "message": "Consentimiento retirado; finaliza la sesión ahora."}


def _local_timezone() -> ZoneInfo:
    return ZoneInfo(settings.TIME_ZONE)


def _parse_date(value: str | None, *, fallback: date) -> date:
    if not value:
        return fallback
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise SchedulingError("La fecha debe usar el formato AAAA-MM-DD.") from exc


def _parse_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise SchedulingError("La fecha y hora deben usar formato ISO 8601.") from exc
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, _local_timezone())
    return parsed.astimezone(_local_timezone())


def _aware_local(day: date, clock: time) -> datetime:
    return datetime.combine(day, clock, tzinfo=_local_timezone())


def _capacity_used(rule: TrialAvailabilityRule, starts_at: datetime, ends_at: datetime) -> int:
    visits = TrialVisit.objects.filter(
        site_id=rule.site_id,
        status__in=ACTIVE_VISIT_STATUSES,
        starts_at__lt=ends_at,
        ends_at__gt=starts_at,
    )
    if rule.court_id:
        visits = visits.filter(court_id=rule.court_id)
    return visits.count()


def _rule_for_slot(
    *,
    site_id: int,
    court_id: int | None,
    starts_at: datetime,
) -> TrialAvailabilityRule | None:
    local_start = starts_at.astimezone(_local_timezone())
    candidates = TrialAvailabilityRule.objects.filter(
        site_id=site_id,
        site__is_active=True,
        weekday=local_start.weekday(),
        is_active=True,
        starts_at__lte=local_start.time().replace(tzinfo=None),
        ends_at__gt=local_start.time().replace(tzinfo=None),
    )
    candidates = candidates.filter(Q(court__isnull=True) | Q(court__is_active=True))
    if court_id is None:
        candidates = candidates.filter(court__isnull=True)
    else:
        candidates = candidates.filter(Q(court_id=court_id) | Q(court__isnull=True)).order_by(
            "-court_id"
        )
    for rule in candidates.select_related("site", "court"):
        rule_start = _aware_local(local_start.date(), rule.starts_at)
        delta_seconds = (local_start - rule_start).total_seconds()
        if delta_seconds < 0 or delta_seconds % (rule.slot_minutes * 60) != 0:
            continue
        expected_end = local_start + timedelta(minutes=rule.slot_minutes)
        if expected_end <= _aware_local(local_start.date(), rule.ends_at):
            return rule
    return None


def list_trial_availability(
    *,
    site_id: int | None = None,
    court_id: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 12,
) -> dict[str, Any]:
    """Return concrete, capacity-checked slots from the configured recurring rules."""

    local_today = timezone.localdate()
    first_day = _parse_date(start_date, fallback=local_today)
    default_horizon = int(getattr(settings, "TRIAL_BOOKING_HORIZON_DAYS", 30))
    last_day = _parse_date(
        end_date,
        fallback=min(first_day + timedelta(days=14), local_today + timedelta(days=default_horizon)),
    )
    horizon_day = local_today + timedelta(days=default_horizon)
    if first_day < local_today:
        first_day = local_today
    if last_day < first_day:
        raise SchedulingError("La fecha final debe ser igual o posterior a la inicial.")
    last_day = min(last_day, horizon_day)
    limit = max(1, min(int(limit or 12), 40))

    rules = TrialAvailabilityRule.objects.filter(
        is_active=True,
        site__is_active=True,
    ).filter(
        Q(court__isnull=True) | Q(court__is_active=True)
    ).select_related("site", "court")
    if site_id:
        rules = rules.filter(site_id=site_id)
    if court_id:
        rules = rules.filter(Q(court_id=court_id) | Q(court__isnull=True))

    min_start = timezone.now() + timedelta(
        hours=int(getattr(settings, "TRIAL_MIN_ADVANCE_HOURS", 2))
    )
    slots: list[dict[str, Any]] = []
    seen: set[tuple[int, int | None, str]] = set()
    current_day = first_day
    while current_day <= last_day and len(slots) < limit:
        for rule in rules.filter(weekday=current_day.weekday()):
            slot_start = _aware_local(current_day, rule.starts_at)
            rule_end = _aware_local(current_day, rule.ends_at)
            while slot_start + timedelta(minutes=rule.slot_minutes) <= rule_end:
                slot_end = slot_start + timedelta(minutes=rule.slot_minutes)
                key = (rule.site_id, rule.court_id, slot_start.isoformat())
                if (
                    slot_start >= min_start
                    and key not in seen
                    and _capacity_used(rule, slot_start, slot_end) < rule.capacity
                ):
                    seen.add(key)
                    slots.append(
                        {
                            "site_id": rule.site_id,
                            "site_name": rule.site.name,
                            "court_id": rule.court_id,
                            "court_name": rule.court.name if rule.court else None,
                            "starts_at": slot_start.isoformat(),
                            "ends_at": slot_end.isoformat(),
                            "timezone": settings.TIME_ZONE,
                            "remaining_capacity": (
                                rule.capacity - _capacity_used(rule, slot_start, slot_end)
                            ),
                        }
                    )
                    if len(slots) >= limit:
                        break
                slot_start = slot_end
            if len(slots) >= limit:
                break
        current_day += timedelta(days=1)

    available_sites = [
        {
            "id": row["site_id"],
            "name": row["site__name"],
        }
        for row in (
            TrialAvailabilityRule.objects.filter(is_active=True, site__is_active=True)
            .filter(Q(court__isnull=True) | Q(court__is_active=True))
            .values("site_id", "site__name")
            .distinct()
            .order_by("site__name")
        )
    ]
    return {
        "ok": True,
        "timezone": settings.TIME_ZONE,
        "sites": available_sites,
        "slots": slots,
        "message": (
            "Estos son los horarios disponibles en este momento."
            if slots
            else "No hay horarios disponibles en el rango solicitado."
        ),
    }


def _normalized_child_first_name(child_first_name: str) -> str:
    value = " ".join(str(child_first_name or "").strip().split())
    if not value:
        raise SchedulingError("Falta el primer nombre del alumno.")
    return value[:100]


@transaction.atomic
def book_two_trial_visits_from_whatsapp(
    *,
    site_id: int,
    responsible_name: str,
    responsible_phone: str,
    child_first_name: str,
    child_age: int | None,
    visits: list[dict[str, Any]],
) -> dict[str, Any]:
    """Book exactly two capacity-checked visits from a WhatsApp conversation."""

    if len(visits or []) != 2:
        raise SchedulingError("Se requieren exactamente dos visitas.")
    responsible_name = " ".join(str(responsible_name or "").strip().split())[:160]
    responsible_phone = str(responsible_phone or "").strip()[:30]
    if not responsible_name:
        raise SchedulingError("Falta el nombre de la persona responsable.")
    if not responsible_phone:
        raise SchedulingError("Falta el teléfono de contacto.")
    if len("".join(character for character in responsible_phone if character.isdigit())) < 7:
        raise SchedulingError("El teléfono de contacto no es válido.")
    try:
        normalized_age = int(child_age) if child_age is not None else None
    except (TypeError, ValueError) as exc:
        raise SchedulingError("La edad del alumno no es válida.") from exc
    if normalized_age is not None and not 3 <= normalized_age <= 17:
        raise SchedulingError("La edad del alumno debe estar entre 3 y 17 años.")
    safe_child_name = _normalized_child_first_name(child_first_name)

    parsed_visits: list[tuple[datetime, int | None, TrialAvailabilityRule]] = []
    minimum_start = timezone.now().astimezone(_local_timezone()) + timedelta(
        hours=int(getattr(settings, "TRIAL_MIN_ADVANCE_HOURS", 2))
    )
    horizon_day = timezone.localdate() + timedelta(
        days=int(getattr(settings, "TRIAL_BOOKING_HORIZON_DAYS", 30))
    )
    for visit in visits:
        starts_at = _parse_datetime(str(visit.get("starts_at") or ""))
        if starts_at < minimum_start:
            raise SchedulingError(
                "Uno de los horarios ya no cumple el tiempo mínimo de anticipación."
            )
        if starts_at.date() > horizon_day:
            raise SchedulingError(
                "Uno de los horarios está fuera del horizonte permitido para reservar."
            )
        court_id = visit.get("court_id")
        if court_id in ("", None):
            court_id = None
        else:
            try:
                court_id = int(court_id)
            except (TypeError, ValueError) as exc:
                raise SchedulingError("La cancha seleccionada no es válida.") from exc
            if not Court.objects.filter(
                id=court_id,
                site_id=site_id,
                is_active=True,
            ).exists():
                raise SchedulingError("La cancha seleccionada no pertenece a la sede.")
        rule = _rule_for_slot(site_id=site_id, court_id=court_id, starts_at=starts_at)
        if not rule:
            raise SchedulingError("Uno de los horarios ya no pertenece a la disponibilidad vigente.")
        parsed_visits.append((starts_at, court_id or rule.court_id, rule))

    parsed_visits.sort(key=lambda row: row[0])
    if parsed_visits[0][0] == parsed_visits[1][0]:
        raise SchedulingError("Las dos visitas deben tener horarios distintos.")
    spacing = parsed_visits[1][0].date() - parsed_visits[0][0].date()
    min_days = int(getattr(settings, "TRIAL_MIN_DAYS_BETWEEN_VISITS", 1))
    max_days = int(getattr(settings, "TRIAL_MAX_DAYS_BETWEEN_VISITS", 21))
    if spacing.days < min_days or spacing.days > max_days:
        raise SchedulingError(
            f"Las visitas deben separarse entre {min_days} y {max_days} días."
        )

    rule_ids = [row[2].id for row in parsed_visits]
    locked_rules = {
        rule.id: rule
        for rule in TrialAvailabilityRule.objects.select_for_update()
        .filter(id__in=rule_ids, is_active=True)
    }
    for starts_at, _court_id, initial_rule in parsed_visits:
        rule = locked_rules.get(initial_rule.id)
        if not rule:
            raise SchedulingError("La disponibilidad cambió; vuelve a consultar horarios.")
        ends_at = starts_at + timedelta(minutes=rule.slot_minutes)
        if _capacity_used(rule, starts_at, ends_at) >= rule.capacity:
            raise SchedulingError("Uno de los horarios acaba de llenarse; elige otro.")

    booking = TrialBooking.objects.create(
        site_id=site_id,
        responsible_name=responsible_name,
        responsible_phone=responsible_phone,
        responsible_email="",
        child_first_name=safe_child_name,
        child_age=normalized_age,
        source=TrialBookingSource.WHATSAPP,
        notes="",
    )
    for index, (starts_at, court_id, rule) in enumerate(parsed_visits, start=1):
        TrialVisit.objects.create(
            booking=booking,
            site_id=site_id,
            court_id=court_id,
            visit_number=index,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=rule.slot_minutes),
        )
    return _booking_result(booking)


@transaction.atomic
def book_two_trial_visits(
    *,
    voice_call_id: int,
    tool_call_id: str,
    site_id: int,
    responsible_name: str,
    responsible_phone: str,
    responsible_email: str = "",
    child_first_name: str = "",
    child_age: int | None = None,
    visits: list[dict[str, Any]],
) -> dict[str, Any]:
    """Book exactly two capacity-checked visits, idempotently per voice call."""

    call = VoiceCall.objects.select_for_update().get(id=voice_call_id)
    tool_results = dict((call.extracted_data or {}).get("tool_results") or {})
    if tool_call_id and tool_call_id in tool_results:
        return tool_results[tool_call_id]
    if call.booking_id:
        result = _booking_result(call.booking)
        if tool_call_id:
            tool_results[tool_call_id] = result
            call.extracted_data = {**(call.extracted_data or {}), "tool_results": tool_results}
            call.save(update_fields=["extracted_data", "updated_at"])
        return result

    if len(visits or []) != 2:
        raise SchedulingError("Se requieren exactamente dos visitas.")
    responsible_name = " ".join(str(responsible_name or "").strip().split())[:160]
    responsible_phone = str(responsible_phone or call.from_number or "").strip()[:30]
    if not responsible_name:
        raise SchedulingError("Falta el nombre de la persona responsable.")
    if not responsible_phone:
        raise SchedulingError("Falta el teléfono de contacto.")
    if len("".join(character for character in responsible_phone if character.isdigit())) < 7:
        raise SchedulingError("El teléfono de contacto no es válido.")
    responsible_email = str(responsible_email or "").strip()[:254]
    if responsible_email:
        try:
            validate_email(responsible_email)
        except DjangoValidationError as exc:
            raise SchedulingError("El correo de contacto no es válido.") from exc
    try:
        normalized_age = int(child_age) if child_age is not None else None
    except (TypeError, ValueError) as exc:
        raise SchedulingError("La edad del alumno no es válida.") from exc
    if normalized_age is not None and not 3 <= normalized_age <= 17:
        raise SchedulingError("La edad del alumno debe estar entre 3 y 17 años.")
    safe_child_name = _normalized_child_first_name(child_first_name)

    parsed_visits: list[tuple[datetime, int | None, TrialAvailabilityRule]] = []
    minimum_start = timezone.now().astimezone(_local_timezone()) + timedelta(
        hours=int(getattr(settings, "TRIAL_MIN_ADVANCE_HOURS", 2))
    )
    horizon_day = timezone.localdate() + timedelta(
        days=int(getattr(settings, "TRIAL_BOOKING_HORIZON_DAYS", 30))
    )
    for visit in visits:
        starts_at = _parse_datetime(str(visit.get("starts_at") or ""))
        if starts_at < minimum_start:
            raise SchedulingError(
                "Uno de los horarios ya no cumple el tiempo mínimo de anticipación."
            )
        if starts_at.date() > horizon_day:
            raise SchedulingError(
                "Uno de los horarios está fuera del horizonte permitido para reservar."
            )
        court_id = visit.get("court_id")
        if court_id in ("", None):
            court_id = None
        else:
            try:
                court_id = int(court_id)
            except (TypeError, ValueError) as exc:
                raise SchedulingError("La cancha seleccionada no es válida.") from exc
            if not Court.objects.filter(
                id=court_id,
                site_id=site_id,
                is_active=True,
            ).exists():
                raise SchedulingError("La cancha seleccionada no pertenece a la sede.")
        rule = _rule_for_slot(site_id=site_id, court_id=court_id, starts_at=starts_at)
        if not rule:
            raise SchedulingError("Uno de los horarios ya no pertenece a la disponibilidad vigente.")
        parsed_visits.append((starts_at, court_id or rule.court_id, rule))

    parsed_visits.sort(key=lambda row: row[0])
    if parsed_visits[0][0] == parsed_visits[1][0]:
        raise SchedulingError("Las dos visitas deben tener horarios distintos.")
    spacing = parsed_visits[1][0].date() - parsed_visits[0][0].date()
    min_days = int(getattr(settings, "TRIAL_MIN_DAYS_BETWEEN_VISITS", 1))
    max_days = int(getattr(settings, "TRIAL_MAX_DAYS_BETWEEN_VISITS", 21))
    if spacing.days < min_days or spacing.days > max_days:
        raise SchedulingError(
            f"Las visitas deben separarse entre {min_days} y {max_days} días."
        )

    rule_ids = [row[2].id for row in parsed_visits]
    locked_rules = {
        rule.id: rule
        for rule in TrialAvailabilityRule.objects.select_for_update()
        .filter(id__in=rule_ids, is_active=True)
    }
    for starts_at, _court_id, initial_rule in parsed_visits:
        rule = locked_rules.get(initial_rule.id)
        if not rule:
            raise SchedulingError("La disponibilidad cambió; vuelve a consultar horarios.")
        ends_at = starts_at + timedelta(minutes=rule.slot_minutes)
        if _capacity_used(rule, starts_at, ends_at) >= rule.capacity:
            raise SchedulingError("Uno de los horarios acaba de llenarse; elige otro.")

    booking = TrialBooking.objects.create(
        site_id=site_id,
        responsible_name=responsible_name,
        responsible_phone=responsible_phone,
        responsible_email=responsible_email,
        child_first_name=safe_child_name,
        child_age=normalized_age,
        source=TrialBookingSource.VOICE,
        notes="",
    )
    for index, (starts_at, court_id, rule) in enumerate(parsed_visits, start=1):
        TrialVisit.objects.create(
            booking=booking,
            site_id=site_id,
            court_id=court_id,
            visit_number=index,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=rule.slot_minutes),
        )

    call.booking = booking
    call.ai_outcome = CallOutcome.SUCCESSFUL
    call.summary = (
        f"Prueba gratuita agendada con dos visitas en {booking.site.name}."
    )
    result = _booking_result(booking)
    if tool_call_id:
        tool_results[tool_call_id] = result
    call.extracted_data = {
        **(call.extracted_data or {}),
        "booking_id": booking.id,
        "tool_results": tool_results,
    }
    call.failure_reason = ""
    call.save(
        update_fields=[
            "booking",
            "ai_outcome",
            "summary",
            "extracted_data",
            "failure_reason",
            "updated_at",
        ]
    )
    return result


def _booking_result(booking: TrialBooking) -> dict[str, Any]:
    visits = list(booking.visits.select_related("site", "court").order_by("visit_number"))
    return {
        "ok": True,
        "booking_id": booking.id,
        "site_id": booking.site_id,
        "site_name": booking.site.name,
        "child_first_name": booking.child_first_name,
        "visits": [
            {
                "visit_number": visit.visit_number,
                "starts_at": visit.starts_at.astimezone(_local_timezone()).isoformat(),
                "ends_at": visit.ends_at.astimezone(_local_timezone()).isoformat(),
                "court_id": visit.court_id,
                "court_name": visit.court.name if visit.court else None,
            }
            for visit in visits
        ],
        "message": "La reserva de las dos visitas quedó confirmada.",
    }


@transaction.atomic
def record_unsuccessful_outcome(
    *,
    voice_call_id: int,
    tool_call_id: str,
    reason: str,
    summary: str = "",
) -> dict[str, Any]:
    call = VoiceCall.objects.select_for_update().get(id=voice_call_id)
    if call.booking_id:
        return {"ok": True, "message": "La llamada ya tiene una reserva confirmada."}
    tool_results = dict((call.extracted_data or {}).get("tool_results") or {})
    if tool_call_id and tool_call_id in tool_results:
        return tool_results[tool_call_id]
    safe_reason = " ".join(str(reason or "").strip().split())[:2000]
    if not safe_reason:
        safe_reason = "La persona terminó la llamada sin completar la reserva."
    call.ai_outcome = CallOutcome.UNSUCCESSFUL
    call.failure_reason = safe_reason
    call.summary = (
        " ".join(str(summary or "").strip().split())[:1000]
        or "Llamada finalizada sin una reserva confirmada."
    )
    result = {"ok": True, "message": "Resultado de la llamada registrado."}
    if tool_call_id:
        tool_results[tool_call_id] = result
    call.extracted_data = {**(call.extracted_data or {}), "tool_results": tool_results}
    call.save(
        update_fields=[
            "ai_outcome",
            "failure_reason",
            "summary",
            "extracted_data",
            "updated_at",
        ]
    )
    return result
