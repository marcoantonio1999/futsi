from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.contrib.admin.models import LogEntry
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from core.models import (
    AuditLog,
    CallTranscriptSegment,
    TrialBooking,
    TrialVisit,
    VoiceCall,
)


ANONYMIZED_NAME = "Datos eliminados"


def _admin_logs_for(model, ids: list[int]):
    if not ids:
        return LogEntry.objects.none()
    content_type = ContentType.objects.get_for_model(model)
    return LogEntry.objects.filter(
        content_type=content_type,
        object_id__in=[str(value) for value in ids],
    )


def _old_call_ids(cutoff, batch_size: int) -> list[int]:
    return list(
        VoiceCall.objects.filter(
            Q(ended_at__lt=cutoff)
            | Q(ended_at__isnull=True, created_at__lt=cutoff)
        )
        .order_by("id")
        .values_list("id", flat=True)[:batch_size]
    )


def _old_booking_ids(cutoff, batch_size: int) -> list[int]:
    return list(
        TrialBooking.objects.annotate(last_visit_at=Max("visits__ends_at"))
        .filter(
            Q(last_visit_at__lt=cutoff)
            | Q(
                last_visit_at__isnull=True,
                created_at__lt=cutoff,
            )
        )
        .exclude(responsible_name=ANONYMIZED_NAME)
        .order_by("id")
        .values_list("id", flat=True)[:batch_size]
    )


def purge_expired_voice_data(*, dry_run: bool = False) -> dict[str, int]:
    """Delete old call data and anonymize concluded trial bookings."""

    now = timezone.now()
    batch_size = int(getattr(settings, "VOICE_RETENTION_BATCH_SIZE", 1000))
    transcript_cutoff = now - timedelta(
        days=int(getattr(settings, "VOICE_TRANSCRIPT_RETENTION_DAYS", 90))
    )
    call_cutoff = now - timedelta(
        days=int(getattr(settings, "VOICE_CALL_RETENTION_DAYS", 365))
    )
    booking_cutoff = now - timedelta(
        days=int(getattr(settings, "TRIAL_PII_RETENTION_DAYS", 365))
    )

    if dry_run:
        return {
            "transcripts_deleted": CallTranscriptSegment.objects.filter(
                created_at__lt=transcript_cutoff
            ).count(),
            "calls_deleted": VoiceCall.objects.filter(
                Q(ended_at__lt=call_cutoff)
                | Q(ended_at__isnull=True, created_at__lt=call_cutoff)
            ).count(),
            "bookings_anonymized": TrialBooking.objects.annotate(
                last_visit_at=Max("visits__ends_at")
            )
            .filter(
                Q(last_visit_at__lt=booking_cutoff)
                | Q(
                    last_visit_at__isnull=True,
                    created_at__lt=booking_cutoff,
                )
            )
            .exclude(responsible_name=ANONYMIZED_NAME)
            .count(),
        }

    transcript_ids = list(
        CallTranscriptSegment.objects.filter(created_at__lt=transcript_cutoff)
        .order_by("id")
        .values_list("id", flat=True)[:batch_size]
    )
    call_ids = _old_call_ids(call_cutoff, batch_size)
    booking_ids = _old_booking_ids(booking_cutoff, batch_size)
    result = {
        "transcripts_deleted": len(transcript_ids),
        "calls_deleted": len(call_ids),
        "bookings_anonymized": len(booking_ids),
    }
    with transaction.atomic():
        if transcript_ids:
            CallTranscriptSegment.objects.filter(id__in=transcript_ids).delete()
        if call_ids:
            AuditLog.objects.filter(
                table_name=VoiceCall._meta.db_table,
                record_id__in=[str(call_id) for call_id in call_ids],
            ).delete()
            _admin_logs_for(VoiceCall, call_ids).delete()
            VoiceCall.objects.filter(id__in=call_ids).delete()
        if booking_ids:
            linked_call_ids = list(
                VoiceCall.objects.filter(booking_id__in=booking_ids).values_list(
                    "id",
                    flat=True,
                )
            )
            visit_ids = list(
                TrialVisit.objects.filter(booking_id__in=booking_ids).values_list(
                    "id",
                    flat=True,
                )
            )
            CallTranscriptSegment.objects.filter(
                call_id__in=linked_call_ids
            ).delete()
            # Tool results, free-text outcomes and audit snapshots can repeat
            # names or contact details. Redact every copy with the booking.
            VoiceCall.objects.filter(id__in=linked_call_ids).update(
                from_number="",
                summary="Datos personales eliminados por la política de retención.",
                failure_reason="",
                sanitized_error="",
                extracted_data={},
            )
            AuditLog.objects.filter(
                table_name=VoiceCall._meta.db_table,
                record_id__in=[str(call_id) for call_id in linked_call_ids],
            ).update(previous_values={}, new_values={}, metadata={})
            admin_retention_message = "Datos personales eliminados por retención."
            _admin_logs_for(VoiceCall, linked_call_ids).update(
                object_repr="Llamada anonimizada",
                change_message=admin_retention_message,
            )
            _admin_logs_for(TrialBooking, booking_ids).update(
                object_repr="Reserva de prueba anonimizada",
                change_message=admin_retention_message,
            )
            _admin_logs_for(TrialVisit, visit_ids).update(
                object_repr="Visita de prueba anonimizada",
                change_message=admin_retention_message,
            )
            TrialVisit.objects.filter(booking_id__in=booking_ids).update(
                notes="",
                updated_at=now,
            )
            TrialBooking.objects.filter(id__in=booking_ids).update(
                responsible_name=ANONYMIZED_NAME,
                responsible_phone="",
                responsible_email="",
                child_first_name=ANONYMIZED_NAME,
                child_age=None,
                notes="Datos personales eliminados por la política de retención.",
                updated_at=now,
            )
    return result
