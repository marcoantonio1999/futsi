from django.db import migrations


def postgres_table_exists(cursor, table_name: str) -> bool:
    cursor.execute("select to_regclass(%s)", [f"public.{table_name}"])
    return cursor.fetchone()[0] is not None


def merge_unknown_records_by_day(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not postgres_table_exists(cursor, "unknown_attendance_records"):
            return
        cursor.execute(
            """
            with grouped as (
                select subject_id,
                       attendance_date,
                       min(first_seen_at) as first_seen_at,
                       max(last_seen_at) as last_seen_at,
                       sum(greatest(capture_count, 0)) as capture_count,
                       max(quality_score) as quality_score,
                       bool_and(is_unscheduled) as is_unscheduled,
                       bool_or(status <> 'deleted') as has_active_record,
                       array_agg(id order by coalesce(quality_score, -1) desc, last_seen_at desc, id) as ordered_ids,
                       array_agg(id order by id) as all_ids
                  from public.unknown_attendance_records
                 group by subject_id, attendance_date
                having count(*) > 1
            ),
            canonical as (
                select r.*,
                       g.first_seen_at as merged_first_seen_at,
                       g.last_seen_at as merged_last_seen_at,
                       g.capture_count as merged_capture_count,
                       g.quality_score as merged_quality_score,
                       g.is_unscheduled as merged_is_unscheduled,
                       g.has_active_record,
                       g.all_ids
                  from grouped g
                  join public.unknown_attendance_records r on r.id = g.ordered_ids[1]
            )
            update public.unknown_attendance_records target
               set first_seen_at = c.merged_first_seen_at,
                   last_seen_at = c.merged_last_seen_at,
                   capture_count = c.merged_capture_count,
                   evidence_capture_id = c.evidence_capture_id,
                   quality_score = c.merged_quality_score,
                   activity_window_start = date_trunc('day', c.merged_last_seen_at at time zone 'America/Mexico_City') at time zone 'America/Mexico_City',
                   activity_window_end = (date_trunc('day', c.merged_last_seen_at at time zone 'America/Mexico_City') + interval '1 day') at time zone 'America/Mexico_City',
                   is_unscheduled = c.merged_is_unscheduled,
                   status = case when c.has_active_record then 'observed' else 'deleted' end,
                   metadata = coalesce(target.metadata, '{}'::jsonb)
                       || jsonb_build_object(
                            'attendance_scope', 'day',
                            'merged_record_ids', c.all_ids,
                            'merged_at', now()
                       ),
                   updated_at = now()
              from canonical c
             where target.id = c.id;

            delete from public.unknown_attendance_records doomed
             using (
                select unnest(all_ids[2:array_length(all_ids, 1)]) as id
                  from (
                    select array_agg(id order by coalesce(quality_score, -1) desc, last_seen_at desc, id) as all_ids
                      from public.unknown_attendance_records
                     group by subject_id, attendance_date
                    having count(*) > 1
                  ) duplicate_groups
             ) duplicates
             where doomed.id = duplicates.id;

            update public.unknown_attendance_records
               set activity_window_start = date_trunc('day', last_seen_at at time zone 'America/Mexico_City') at time zone 'America/Mexico_City',
                   activity_window_end = (date_trunc('day', last_seen_at at time zone 'America/Mexico_City') + interval '1 day') at time zone 'America/Mexico_City',
                   metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('attendance_scope', 'day'),
                   updated_at = now()
             where metadata->>'attendance_scope' is distinct from 'day';

            create unique index if not exists uq_unknown_att_record_subject_day
                on public.unknown_attendance_records (subject_id, attendance_date);
            """
        )


def reverse_merge_unknown_records_by_day(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("drop index if exists public.uq_unknown_att_record_subject_day")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0029_backfill_accepted_unknown_attendance_records"),
    ]

    operations = [
        migrations.RunPython(merge_unknown_records_by_day, reverse_code=reverse_merge_unknown_records_by_day),
    ]
