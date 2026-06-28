from django.db import migrations


def add_unknown_attendance_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
            do $$
            begin
              if to_regclass('public.unknown_attendance_captures') is not null then
                create index if not exists ix_unknown_captures_pending_date
                  on public.unknown_attendance_captures (captured_at)
                  where deleted_at is null
                    and processed_at is null
                    and status = 'uploaded'
                    and (drive_remote_path is not null or drive_file_id is not null);

                create index if not exists ix_unknown_captures_subject_updated
                  on public.unknown_attendance_captures (subject_id, updated_at desc)
                  where deleted_at is null;
              end if;

              if to_regclass('public.unknown_attendance_subjects') is not null then
                create index if not exists ix_unknown_subjects_status_seen
                  on public.unknown_attendance_subjects (status, last_seen_at desc)
                  where status <> 'deleted';
              end if;
            end $$;
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0023_attendance_session_ends_at"),
    ]

    operations = [
        migrations.RunPython(add_unknown_attendance_indexes, reverse_code=migrations.RunPython.noop),
    ]
