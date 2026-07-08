from django.db import migrations


def postgres_table_exists(cursor, table_name: str) -> bool:
    cursor.execute("select to_regclass(%s)", [f"public.{table_name}"])
    return cursor.fetchone()[0] is not None


def backfill_records_from_subjects(apps, schema_editor):
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
                status,
                metadata,
                created_at,
                updated_at
            )
            select s.id,
                   (s.last_seen_at at time zone 'America/Mexico_City')::date,
                   s.site_id,
                   coalesce(s.camera_id, ''),
                   coalesce(s.first_seen_at, s.last_seen_at, s.created_at),
                   coalesce(s.last_seen_at, s.first_seen_at, s.created_at),
                   greatest(coalesce(s.capture_count, 1), 1),
                   null,
                   null,
                   date_trunc('hour', coalesce(s.last_seen_at, s.first_seen_at, s.created_at)),
                   date_trunc('hour', coalesce(s.last_seen_at, s.first_seen_at, s.created_at)) + interval '1 hour',
                   null,
                   null,
                   true,
                   'observed',
                   jsonb_build_object('source', 'subject_face_backfill'),
                   now(),
                   now()
              from public.unknown_attendance_subjects s
             where s.status <> 'deleted'
               and coalesce(s.matched_person_type, '') = ''
               and coalesce(s.metadata->>'face_crop_uri', '') <> ''
               and not exists (
                   select 1
                     from public.unknown_attendance_records r
                    where r.subject_id = s.id
                      and coalesce(r.site_id, -1) = coalesce(s.site_id, -1)
                      and r.camera_id = coalesce(s.camera_id, '')
                      and r.activity_window_start = date_trunc('hour', coalesce(s.last_seen_at, s.first_seen_at, s.created_at))
               );
            """
        )


def reverse_backfill_records_from_subjects(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not postgres_table_exists(cursor, "unknown_attendance_records"):
            return
        cursor.execute(
            """
            delete from public.unknown_attendance_records
             where metadata->>'source' = 'subject_face_backfill';
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0026_backfill_unknown_attendance_records"),
    ]

    operations = [
        migrations.RunPython(backfill_records_from_subjects, reverse_code=reverse_backfill_records_from_subjects),
    ]
