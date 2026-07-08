from django.db import migrations


def postgres_table_exists(cursor, table_name: str) -> bool:
    cursor.execute("select to_regclass(%s)", [f"public.{table_name}"])
    return cursor.fetchone()[0] is not None


def backfill_accepted_subject_records(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not all(postgres_table_exists(cursor, table) for table in ("unknown_attendance_records", "unknown_attendance_subjects")):
            return
        cursor.execute(
            """
            insert into public.unknown_attendance_records (
                subject_id,
                attendance_date,
                site_id,
                camera_id,
                first_seen_at,
                last_seen_at,
                capture_count,
                evidence_capture_id,
                quality_score,
                activity_window_start,
                activity_window_end,
                scheduled_session_id,
                scheduled_match_id,
                is_unscheduled,
                metadata,
                updated_at
            )
            select s.id,
                   (coalesce(s.last_seen_at, s.first_seen_at, s.created_at) at time zone 'America/Mexico_City')::date,
                   s.site_id,
                   coalesce(s.camera_id, ''),
                   coalesce(s.first_seen_at, s.last_seen_at, s.created_at),
                   coalesce(s.last_seen_at, s.first_seen_at, s.created_at),
                   greatest(coalesce(s.capture_count, 1), 1),
                   case
                     when coalesce(s.metadata->>'best_capture_id', s.metadata->>'first_capture_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then coalesce(s.metadata->>'best_capture_id', s.metadata->>'first_capture_id')::uuid
                     else null
                   end,
                   nullif(coalesce(s.metadata->>'quality_score', s.metadata #>> '{quality,quality_score}'), '')::double precision,
                   date_trunc('hour', coalesce(s.last_seen_at, s.first_seen_at, s.created_at)),
                   date_trunc('hour', coalesce(s.last_seen_at, s.first_seen_at, s.created_at)) + interval '1 hour',
                   null,
                   null,
                   true,
                   jsonb_build_object('source', 'accepted_subject_backfill', 'accepted_at', s.metadata->>'accepted_at'),
                   now()
              from public.unknown_attendance_subjects s
             where s.status <> 'deleted'
               and coalesce(s.metadata->>'accepted_at', '') <> ''
               and coalesce(s.matched_person_type, '') = ''
            on conflict (subject_id, (coalesce(site_id, -1)), camera_id, activity_window_start)
            do update set
                first_seen_at = least(public.unknown_attendance_records.first_seen_at, excluded.first_seen_at),
                last_seen_at = greatest(public.unknown_attendance_records.last_seen_at, excluded.last_seen_at),
                capture_count = greatest(public.unknown_attendance_records.capture_count, excluded.capture_count),
                evidence_capture_id = coalesce(public.unknown_attendance_records.evidence_capture_id, excluded.evidence_capture_id),
                quality_score = greatest(coalesce(public.unknown_attendance_records.quality_score, 0), coalesce(excluded.quality_score, 0)),
                status = 'observed',
                metadata = coalesce(public.unknown_attendance_records.metadata, '{}'::jsonb) || excluded.metadata,
                updated_at = now();
            """
        )


def reverse_backfill_accepted_subject_records(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not postgres_table_exists(cursor, "unknown_attendance_records"):
            return
        cursor.execute(
            """
            delete from public.unknown_attendance_records
             where metadata->>'source' = 'accepted_subject_backfill';
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0028_cleanup_unaccepted_unknown_attendance_records"),
    ]

    operations = [
        migrations.RunPython(backfill_accepted_subject_records, reverse_code=reverse_backfill_accepted_subject_records),
    ]
