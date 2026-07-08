from django.db import migrations


def postgres_table_exists(cursor, table_name: str) -> bool:
    cursor.execute("select to_regclass(%s)", [f"public.{table_name}"])
    return cursor.fetchone()[0] is not None


def create_unknown_attendance_records(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not postgres_table_exists(cursor, "unknown_attendance_subjects"):
            return
        if not postgres_table_exists(cursor, "unknown_attendance_captures"):
            return
        cursor.execute(
            """
            create table if not exists public.unknown_attendance_records (
                id uuid primary key default gen_random_uuid(),
                subject_id uuid not null,
                attendance_date date not null,
                site_id bigint null references public.sites(id) on delete set null,
                camera_id text not null default '',
                first_seen_at timestamptz not null,
                last_seen_at timestamptz not null,
                capture_count integer not null default 0,
                evidence_capture_id uuid null,
                quality_score double precision null,
                activity_window_start timestamptz not null,
                activity_window_end timestamptz not null,
                scheduled_session_id bigint null references public.attendance_sessions(id) on delete set null,
                scheduled_match_id bigint null references public.matches(id) on delete set null,
                is_unscheduled boolean not null default true,
                status text not null default 'observed',
                metadata jsonb not null default '{}'::jsonb,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now(),
                constraint fk_unknown_att_records_subject
                    foreign key (subject_id) references public.unknown_attendance_subjects(id) on delete cascade,
                constraint fk_unknown_att_records_capture
                    foreign key (evidence_capture_id) references public.unknown_attendance_captures(id) on delete set null
            );

            create unique index if not exists uq_unknown_att_record_subject_window
                on public.unknown_attendance_records (subject_id, coalesce(site_id, -1), camera_id, activity_window_start);

            create index if not exists ix_unknown_att_records_month
                on public.unknown_attendance_records (attendance_date, subject_id);

            create index if not exists ix_unknown_att_records_site_date
                on public.unknown_attendance_records (site_id, attendance_date);

            alter table public.unknown_attendance_records enable row level security;
            revoke all on table public.unknown_attendance_records from public;
            revoke all on table public.unknown_attendance_records from anon, authenticated;
            grant all on table public.unknown_attendance_records to service_role;
            """
        )


def drop_unknown_attendance_records(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("drop table if exists public.unknown_attendance_records")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0024_unknown_attendance_indexes"),
    ]

    operations = [
        migrations.RunPython(create_unknown_attendance_records, reverse_code=drop_unknown_attendance_records),
    ]
