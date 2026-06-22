from datetime import datetime, timedelta

from django.db import migrations, models


def add_ends_at_column_if_missing(apps, schema_editor):
    AttendanceSession = apps.get_model("core", "AttendanceSession")
    table_name = AttendanceSession._meta.db_table
    existing_columns = {
        column.name
        for column in schema_editor.connection.introspection.get_table_description(
            schema_editor.connection.cursor(),
            table_name,
        )
    }
    if "ends_at" in existing_columns:
        return

    field = models.TimeField(blank=True, null=True)
    field.set_attributes_from_name("ends_at")
    schema_editor.add_field(AttendanceSession, field)


def backfill_ends_at(apps, schema_editor):
    AttendanceSession = apps.get_model("core", "AttendanceSession")
    for session in AttendanceSession.objects.filter(starts_at__isnull=False, ends_at__isnull=True):
        duration = max(1, int(session.duration_minutes or 120))
        starts_on = datetime.combine(session.date, session.starts_at)
        session.ends_at = (starts_on + timedelta(minutes=duration)).time()
        session.save(update_fields=["ends_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0022_backfill_match_attendance_sessions"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(add_ends_at_column_if_missing, migrations.RunPython.noop),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="attendancesession",
                    name="ends_at",
                    field=models.TimeField(blank=True, null=True),
                ),
            ],
        ),
        migrations.RunPython(backfill_ends_at, migrations.RunPython.noop),
    ]
