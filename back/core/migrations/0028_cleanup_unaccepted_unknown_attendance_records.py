from django.db import migrations


def postgres_table_exists(cursor, table_name: str) -> bool:
    cursor.execute("select to_regclass(%s)", [f"public.{table_name}"])
    return cursor.fetchone()[0] is not None


def cleanup_unaccepted_records(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not all(postgres_table_exists(cursor, table) for table in ("unknown_attendance_records", "unknown_attendance_subjects")):
            return
        cursor.execute(
            """
            delete from public.unknown_attendance_records r
             using public.unknown_attendance_subjects s
             where r.subject_id = s.id
               and coalesce(s.metadata->>'accepted_at', '') = ''
               and r.metadata->>'source' in ('subject_face_backfill', 'unknown_attendance_captures');
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0027_backfill_unknown_records_from_subjects"),
    ]

    operations = [
        migrations.RunPython(cleanup_unaccepted_records, reverse_code=migrations.RunPython.noop),
    ]
