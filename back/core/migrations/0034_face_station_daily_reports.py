import django.db.models.deletion
from django.db import migrations, models


def secure_face_station_reports(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
            alter table face_station_daily_reports enable row level security;
            alter table face_station_daily_presences enable row level security;

            do $$
            begin
                if exists (select 1 from pg_roles where rolname = 'anon') then
                    revoke all privileges on table face_station_daily_reports from anon;
                    revoke all privileges on table face_station_daily_presences from anon;
                end if;
                if exists (select 1 from pg_roles where rolname = 'authenticated') then
                    revoke all privileges on table face_station_daily_reports from authenticated;
                    revoke all privileges on table face_station_daily_presences from authenticated;
                end if;
            end
            $$;
            """
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_face_station_collaborators"),
    ]

    operations = [
        migrations.CreateModel(
            name="FaceStationDailyReport",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("report_date", models.DateField()),
                ("revision", models.PositiveIntegerField(default=1)),
                ("payload_sha256", models.CharField(max_length=64)),
                ("schema_version", models.PositiveSmallIntegerField(default=1)),
                ("generated_at", models.DateTimeField()),
                ("finalized", models.BooleanField(default=True)),
                ("policy", models.JSONField(default=dict)),
                ("row_count", models.PositiveIntegerField(default=0)),
                (
                    "device",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="daily_reports",
                        to="core.facestationdevice",
                    ),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="face_station_daily_reports",
                        to="core.site",
                    ),
                ),
            ],
            options={
                "db_table": "face_station_daily_reports",
                "indexes": [
                    models.Index(
                        fields=["site", "report_date"],
                        name="ix_face_daily_site_date",
                    ),
                    models.Index(
                        fields=["device", "report_date"],
                        name="ix_face_daily_device_date",
                    ),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("device", "report_date"),
                        name="uq_face_daily_device_date",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="FaceStationDailyPresence",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("subject_kind", models.CharField(max_length=10)),
                ("subject_key", models.CharField(max_length=120)),
                (
                    "canonical_person_key",
                    models.CharField(blank=True, max_length=80),
                ),
                ("name", models.CharField(max_length=160)),
                ("person_type", models.CharField(blank=True, max_length=32)),
                ("group_name", models.CharField(blank=True, max_length=80)),
                ("team_name", models.CharField(blank=True, max_length=120)),
                ("status", models.CharField(blank=True, max_length=32)),
                ("session_count", models.PositiveIntegerField(default=0)),
                ("detection_count", models.PositiveIntegerField(default=0)),
                (
                    "first_seen_at",
                    models.DateTimeField(blank=True, null=True),
                ),
                (
                    "last_seen_at",
                    models.DateTimeField(blank=True, null=True),
                ),
                ("best_similarity", models.FloatField(default=0)),
                ("evidence_count", models.PositiveIntegerField(default=0)),
                (
                    "report",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="presences",
                        to="core.facestationdailyreport",
                    ),
                ),
            ],
            options={
                "db_table": "face_station_daily_presences",
                "indexes": [
                    models.Index(
                        fields=["subject_kind", "subject_key"],
                        name="ix_face_daily_subject",
                    ),
                    models.Index(
                        fields=["canonical_person_key"],
                        name="ix_face_daily_canonical",
                    ),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("report", "subject_kind", "subject_key"),
                        name="uq_face_daily_presence_subject",
                    ),
                ],
            },
        ),
        migrations.RunPython(
            secure_face_station_reports,
            migrations.RunPython.noop,
        ),
    ]
