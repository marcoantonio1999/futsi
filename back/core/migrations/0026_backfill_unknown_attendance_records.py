from django.db import migrations


def postgres_table_exists(cursor, table_name: str) -> bool:
    cursor.execute("select to_regclass(%s)", [f"public.{table_name}"])
    return cursor.fetchone()[0] is not None


def backfill_records_from_captures(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        required_tables = ("unknown_attendance_records", "unknown_attendance_captures", "unknown_attendance_subjects")
        if not all(postgres_table_exists(cursor, table) for table in required_tables):
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
                metadata
            )
            with capture_rows as (
                select c.id,
                       c.subject_id,
                       c.site_id,
                       coalesce(c.camera_id, '') as camera_id,
                       c.captured_at,
                       (c.captured_at at time zone 'America/Mexico_City') as local_ts,
                       nullif(c.metadata #>> '{quality,quality_score}', '')::double precision as quality_score
                  from public.unknown_attendance_captures c
                  join public.unknown_attendance_subjects s on s.id = c.subject_id
                 where c.deleted_at is null
                   and c.subject_id is not null
                   and s.status <> 'deleted'
            ),
            grouped as (
                select subject_id,
                       site_id,
                       camera_id,
                       date_trunc('hour', local_ts) as window_start_local,
                       date_trunc('hour', local_ts) + interval '1 hour' as window_end_local,
                       min(captured_at) as first_seen_at,
                       max(captured_at) as last_seen_at,
                       count(*)::int as capture_count,
                       (array_agg(id order by quality_score desc nulls last, captured_at desc))[1] as evidence_capture_id,
                       max(quality_score) as quality_score
                  from capture_rows
                 group by subject_id, site_id, camera_id, date_trunc('hour', local_ts)
            )
            select g.subject_id,
                   g.window_start_local::date as attendance_date,
                   g.site_id,
                   g.camera_id,
                   g.first_seen_at,
                   g.last_seen_at,
                   g.capture_count,
                   g.evidence_capture_id,
                   g.quality_score,
                   g.window_start_local at time zone 'America/Mexico_City' as activity_window_start,
                   g.window_end_local at time zone 'America/Mexico_City' as activity_window_end,
                   scheduled.id as scheduled_session_id,
                   scheduled.match_id as scheduled_match_id,
                   scheduled.id is null and scheduled.match_id is null as is_unscheduled,
                   jsonb_build_object('backfilled_at', now(), 'source', 'unknown_attendance_captures')
              from grouped g
              left join lateral (
                    select s.id, s.match_id
                      from public.attendance_sessions s
                     where g.site_id is not null
                       and s.site_id = g.site_id
                       and s.starts_at is not null
                       and (s.date::timestamp + s.starts_at) < g.window_end_local
                       and (
                           s.date::timestamp
                           + s.starts_at
                           + (coalesce(s.duration_minutes, 60)::int * interval '1 minute')
                       ) > g.window_start_local
                     order by abs(extract(epoch from ((s.date::timestamp + s.starts_at) - g.window_start_local)))
                     limit 1
                  ) scheduled on true
            on conflict (subject_id, (coalesce(site_id, -1)), camera_id, activity_window_start)
            do update set
                first_seen_at = least(public.unknown_attendance_records.first_seen_at, excluded.first_seen_at),
                last_seen_at = greatest(public.unknown_attendance_records.last_seen_at, excluded.last_seen_at),
                capture_count = greatest(public.unknown_attendance_records.capture_count, excluded.capture_count),
                evidence_capture_id = coalesce(excluded.evidence_capture_id, public.unknown_attendance_records.evidence_capture_id),
                quality_score = greatest(coalesce(public.unknown_attendance_records.quality_score, 0), coalesce(excluded.quality_score, 0)),
                scheduled_session_id = coalesce(public.unknown_attendance_records.scheduled_session_id, excluded.scheduled_session_id),
                scheduled_match_id = coalesce(public.unknown_attendance_records.scheduled_match_id, excluded.scheduled_match_id),
                is_unscheduled = coalesce(public.unknown_attendance_records.scheduled_session_id, excluded.scheduled_session_id) is null
                    and coalesce(public.unknown_attendance_records.scheduled_match_id, excluded.scheduled_match_id) is null,
                metadata = coalesce(public.unknown_attendance_records.metadata, '{}'::jsonb) || excluded.metadata,
                updated_at = now();
            """
        )


def reverse_backfill_records_from_captures(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not postgres_table_exists(cursor, "unknown_attendance_records"):
            return
        cursor.execute(
            """
            delete from public.unknown_attendance_records
             where metadata->>'source' = 'unknown_attendance_captures';
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0025_unknown_attendance_records"),
    ]

    operations = [
        migrations.RunPython(backfill_records_from_captures, reverse_code=reverse_backfill_records_from_captures),
    ]
