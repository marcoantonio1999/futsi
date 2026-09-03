from datetime import timedelta
from io import StringIO

import pytest
from django.contrib.admin.models import CHANGE, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from core.models import (
    AuditLog,
    CallTranscriptSegment,
    TrialBooking,
    TrialVisit,
    VoiceCall,
)
from core.tests.factories import make_site, make_user
from core.voice.retention import ANONYMIZED_NAME, purge_expired_voice_data


pytestmark = [pytest.mark.api, pytest.mark.django_db]


@override_settings(
    VOICE_TRANSCRIPT_RETENTION_DAYS=30,
    VOICE_CALL_RETENTION_DAYS=30,
    TRIAL_PII_RETENTION_DAYS=30,
    VOICE_RETENTION_BATCH_SIZE=100,
)
def test_retention_dry_run_then_deletes_and_anonymizes_every_pii_copy():
    now = timezone.now()
    old_time = now - timedelta(days=45)
    recent_time = now - timedelta(days=5)
    site = make_site()
    admin_user = make_user(role="admin")

    old_call = VoiceCall.objects.create(
        call_sid="CA" + ("1" * 32),
        from_number="+525511111111",
        to_number="+14014090000",
        ended_at=old_time,
    )
    old_segment = CallTranscriptSegment.objects.create(
        call=old_call,
        sequence=1,
        speaker="caller",
        text="Mi nombre y teléfono son datos privados.",
    )
    CallTranscriptSegment.objects.filter(id=old_segment.id).update(
        created_at=old_time
    )
    old_audit = AuditLog.objects.create(
        action="voice_call_reviewed",
        table_name=VoiceCall._meta.db_table,
        record_id=str(old_call.id),
        previous_values={"failure_reason": "Nombre privado"},
        new_values={"failure_reason": "Otro dato privado"},
        metadata={"call_sid": old_call.call_sid},
    )
    old_admin_log = LogEntry.objects.create(
        user=admin_user,
        content_type=ContentType.objects.get_for_model(VoiceCall),
        object_id=str(old_call.id),
        object_repr=old_call.call_sid,
        action_flag=CHANGE,
        change_message="Cambio de llamada",
    )

    concluded_booking = TrialBooking.objects.create(
        site=site,
        responsible_name="Persona Responsable",
        responsible_phone="+525522222222",
        responsible_email="responsable@example.com",
        child_first_name="Menor",
        child_age=10,
        source="voice",
        status="completed",
    )
    TrialVisit.objects.create(
        booking=concluded_booking,
        site=site,
        visit_number=1,
        starts_at=old_time - timedelta(hours=1),
        ends_at=old_time,
        status="completed",
    )
    linked_call = VoiceCall.objects.create(
        call_sid="CA" + ("2" * 32),
        from_number="+525522222222",
        to_number="+14014090000",
        booking=concluded_booking,
        summary="Resumen potencialmente libre",
        failure_reason="Texto libre potencialmente sensible",
        extracted_data={
            "tool_results": {
                "tool-1": {"child_first_name": "Menor", "booking_id": concluded_booking.id}
            }
        },
    )
    linked_segment = CallTranscriptSegment.objects.create(
        call=linked_call,
        sequence=1,
        speaker="caller",
        text="Esta copia también debe desaparecer con la reserva.",
    )
    linked_audit = AuditLog.objects.create(
        action="voice_call_reviewed",
        table_name=VoiceCall._meta.db_table,
        record_id=str(linked_call.id),
        previous_values={"failure_reason": "Dato anterior"},
        new_values={"failure_reason": "Dato nuevo"},
        metadata={"call_sid": linked_call.call_sid},
    )
    booking_admin_log = LogEntry.objects.create(
        user=admin_user,
        content_type=ContentType.objects.get_for_model(TrialBooking),
        object_id=str(concluded_booking.id),
        object_repr=f"{concluded_booking.child_first_name} - {site.name}",
        action_flag=CHANGE,
        change_message="Cambio con posibles datos personales",
    )

    recent_booking = TrialBooking.objects.create(
        site=site,
        responsible_name="Responsable Reciente",
        responsible_phone="+525533333333",
        child_first_name="Alumno Reciente",
        child_age=12,
        source="voice",
        status="completed",
    )
    TrialVisit.objects.create(
        booking=recent_booking,
        site=site,
        visit_number=1,
        starts_at=recent_time - timedelta(hours=1),
        ends_at=recent_time,
        status="completed",
    )
    orphan_booking = TrialBooking.objects.create(
        site=site,
        responsible_name="Responsable Huérfano",
        responsible_phone="+525544444444",
        child_first_name="Alumno Huérfano",
        child_age=11,
        source="manual",
        status="scheduled",
    )
    TrialBooking.objects.filter(id=orphan_booking.id).update(created_at=old_time)

    dry_run = purge_expired_voice_data(dry_run=True)

    assert dry_run == {
        "transcripts_deleted": 1,
        "calls_deleted": 1,
        "bookings_anonymized": 2,
    }
    assert VoiceCall.objects.filter(id=old_call.id).exists()
    assert CallTranscriptSegment.objects.filter(id=old_segment.id).exists()
    concluded_booking.refresh_from_db()
    assert concluded_booking.responsible_name == "Persona Responsable"

    result = purge_expired_voice_data()

    assert result == dry_run
    assert not VoiceCall.objects.filter(id=old_call.id).exists()
    assert not CallTranscriptSegment.objects.filter(id=old_segment.id).exists()
    assert not AuditLog.objects.filter(id=old_audit.id).exists()
    assert not LogEntry.objects.filter(id=old_admin_log.id).exists()

    concluded_booking.refresh_from_db()
    assert concluded_booking.responsible_name == ANONYMIZED_NAME
    assert concluded_booking.child_first_name == ANONYMIZED_NAME
    assert concluded_booking.responsible_phone == ""
    assert concluded_booking.responsible_email == ""
    assert concluded_booking.child_age is None
    assert "retención" in concluded_booking.notes

    linked_call.refresh_from_db()
    assert linked_call.from_number == ""
    assert linked_call.extracted_data == {}
    assert linked_call.failure_reason == ""
    assert "retención" in linked_call.summary
    assert not CallTranscriptSegment.objects.filter(id=linked_segment.id).exists()
    linked_audit.refresh_from_db()
    assert linked_audit.previous_values == {}
    assert linked_audit.new_values == {}
    assert linked_audit.metadata == {}
    booking_admin_log.refresh_from_db()
    assert booking_admin_log.object_repr == "Reserva de prueba anonimizada"
    assert booking_admin_log.change_message == (
        "Datos personales eliminados por retención."
    )

    recent_booking.refresh_from_db()
    assert recent_booking.responsible_name == "Responsable Reciente"
    assert recent_booking.child_first_name == "Alumno Reciente"
    orphan_booking.refresh_from_db()
    assert orphan_booking.responsible_name == ANONYMIZED_NAME
    assert orphan_booking.child_first_name == ANONYMIZED_NAME


@override_settings(
    VOICE_TRANSCRIPT_RETENTION_DAYS=30,
    VOICE_CALL_RETENTION_DAYS=30,
    TRIAL_PII_RETENTION_DAYS=30,
    VOICE_RETENTION_BATCH_SIZE=1,
)
def test_retention_command_drains_multiple_batches():
    old_time = timezone.now() - timedelta(days=45)
    for index in range(2):
        VoiceCall.objects.create(
            call_sid=f"CA{index + 8:032x}",
            from_number=f"+52550000000{index}",
            to_number="+14014090000",
            ended_at=old_time,
        )

    output = StringIO()
    call_command(
        "purge_voice_data",
        max_batches=5,
        stdout=output,
    )

    assert not VoiceCall.objects.exists()
    assert "2 llamadas" in output.getvalue()
