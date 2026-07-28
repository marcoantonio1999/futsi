import django.db.models.deletion
from django.db import migrations, models


def secure_face_station_monthly_policies(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
            alter table face_station_monthly_policies enable row level security;

            do $$
            begin
                if exists (select 1 from pg_roles where rolname = 'anon') then
                    revoke all privileges on table face_station_monthly_policies from anon;
                end if;
                if exists (select 1 from pg_roles where rolname = 'authenticated') then
                    revoke all privileges on table face_station_monthly_policies from authenticated;
                end if;
            end
            $$;
            """
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0034_face_station_daily_reports"),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name="facestationdailyreport",
            name="ix_face_daily_device_date",
        ),
        migrations.CreateModel(
            name="FaceStationMonthlyPolicy",
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
                ("month_start", models.DateField()),
                (
                    "monthly_fee_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=1000,
                        max_digits=12,
                    ),
                ),
                (
                    "registered_minimum_days",
                    models.PositiveSmallIntegerField(default=1),
                ),
                (
                    "unknown_minimum_days",
                    models.PositiveSmallIntegerField(default=3),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="face_station_monthly_policies",
                        to="core.site",
                    ),
                ),
                (
                    "source_device",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="monthly_policies",
                        to="core.facestationdevice",
                    ),
                ),
            ],
            options={
                "db_table": "face_station_monthly_policies",
                "constraints": [
                    models.UniqueConstraint(
                        fields=("site", "month_start"),
                        name="uq_face_monthly_policy_site_month",
                    ),
                ],
            },
        ),
        migrations.RunPython(
            secure_face_station_monthly_policies,
            migrations.RunPython.noop,
        ),
    ]
