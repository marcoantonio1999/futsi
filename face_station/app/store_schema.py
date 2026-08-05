SCHEMA_SQL = """
pragma journal_mode = wal;
pragma synchronous = normal;

create table if not exists people (
    person_key text primary key,
    person_type text not null,
    remote_id integer not null,
    name text not null,
    group_name text not null default '',
    team_name text not null default '',
    photo_url text not null default '',
    photo_path text not null default '',
    reference_version text not null default '',
    reference_available integer not null default 0,
    embedding blob,
    active integer not null default 1,
    updated_at text not null
);

create table if not exists sessions (
    remote_id integer primary key,
    session_type text not null,
    session_date text not null,
    starts_at text,
    ends_at text,
    duration_minutes integer not null,
    label text not null,
    closed integer not null default 0,
    roster_json text not null default '[]',
    updated_at text not null
);

create table if not exists monthly_payments (
    person_key text not null,
    payment_month text not null,
    payment_count integer not null default 0,
    amount real not null default 0,
    last_paid_at text not null default '',
    updated_at text not null,
    primary key (person_key,payment_month),
    foreign key(person_key) references people(person_key) on delete cascade
);

create table if not exists unknown_subjects (
    subject_id text primary key,
    temporary_name text not null unique,
    status text not null default 'candidate',
    centroid blob not null,
    best_crop_path text not null default '',
    best_quality real not null default 0,
    first_seen_at text not null,
    last_seen_at text not null,
    detection_count integer not null default 0,
    linked_person_key text,
    remote_subject_id text,
    quality_hits integer not null default 0,
    quality_version text not null default '',
    quality_json text not null default '{}',
    merged_into text,
    updated_at text not null
);

create table if not exists local_counters (
    counter_key text primary key,
    next_value integer not null
);

create table if not exists runtime_state (
    state_key text primary key,
    state_value text not null default '',
    updated_at text not null
);

create table if not exists daily_presence (
    subject_key text not null,
    presence_date text not null,
    subject_kind text not null,
    first_seen_at text not null,
    last_seen_at text not null,
    detection_count integer not null default 0,
    best_similarity real not null default 0,
    best_crop_path text not null default '',
    session_id integer not null default -1,
    synced integer not null default 0,
    primary key (subject_key, presence_date, session_id)
);

create table if not exists face_crops (
    id integer primary key autoincrement,
    subject_key text not null,
    subject_kind text not null,
    seen_at text not null,
    crop_path text not null unique,
    similarity real not null default 0,
    quality real not null default 0,
    camera text not null default '',
    embedding blob,
    analysis_version text not null default '',
    quality_pass integer not null default 0,
    quality_json text not null default '{}',
    evidence_selected integer not null default 1,
    evidence_reason text not null default 'uncurated',
    evidence_score real not null default 0,
    evidence_curated_at text not null default '',
    created_at text not null
);

create table if not exists unknown_references (
    id integer primary key autoincrement,
    subject_id text not null,
    crop_path text not null unique,
    embedding blob not null,
    quality real not null,
    captured_at text not null,
    quality_json text not null default '{}',
    created_at text not null,
    foreign key(subject_id) references unknown_subjects(subject_id) on delete cascade
);

create table if not exists known_references (
    id integer primary key autoincrement,
    person_key text not null,
    crop_path text not null,
    embedding blob not null,
    quality real not null,
    captured_at text not null,
    quality_json text not null default '{}',
    source text not null default 'observed',
    pinned integer not null default 0,
    created_at text not null,
    unique(person_key,crop_path),
    foreign key(person_key) references people(person_key) on delete cascade
);

create table if not exists unassigned_crops (
    id integer primary key autoincrement,
    queue_crop_id integer unique,
    captured_at text not null,
    camera text not null default '',
    crop_path text not null unique,
    embedding blob not null,
    quality real not null default 0,
    det_score real not null default 0,
    reason text not null,
    similarity real not null default 0,
    match_json text not null default '{}',
    quality_json text not null default '{}',
    analysis_version text not null default '',
    status text not null default 'pending',
    resolved_kind text not null default '',
    resolved_key text not null default '',
    resolved_at text not null default '',
    created_at text not null,
    updated_at text not null
);

create table if not exists reprocess_runs (
    run_id text primary key,
    target_date text not null,
    analysis_version text not null,
    status text not null,
    backup_path text not null default '',
    report_json text not null default '{}',
    created_at text not null,
    completed_at text not null default ''
);

create table if not exists evidence_retention_runs (
    run_id text primary key,
    cutoff_date text not null,
    status text not null,
    backup_path text not null default '',
    manifest_path text not null default '',
    quarantine_path text not null default '',
    purge_after text not null default '',
    error text not null default '',
    groups_curated integer not null default 0,
    crops_selected integer not null default 0,
    crops_pruned integer not null default 0,
    bytes_pruned integer not null default 0,
    report_json text not null default '{}',
    created_at text not null,
    completed_at text not null default ''
);

create table if not exists evidence_retention_items (
    run_id text not null,
    face_crop_id integer not null,
    source_path text not null,
    quarantine_path text not null,
    file_bytes integer not null default 0,
    state text not null default 'planned',
    error text not null default '',
    updated_at text not null,
    primary key (run_id,face_crop_id),
    unique(run_id,source_path),
    foreign key(run_id) references evidence_retention_runs(run_id) on delete cascade
);

create table if not exists daily_detection_stats (
    subject_key text not null,
    subject_kind text not null,
    evidence_date text not null,
    detection_count integer not null default 0,
    first_seen_at text not null default '',
    last_seen_at text not null default '',
    retained_count integer not null default 0,
    curated_at text not null,
    primary key (subject_key,subject_kind,evidence_date)
);

create table if not exists crop_processing_queue (
    id integer primary key autoincrement,
    captured_at text not null,
    camera_key text not null,
    camera_label text not null,
    crop_path text not null unique,
    file_bytes integer not null default 0,
    crop_width integer not null default 0,
    crop_height integer not null default 0,
    det_score real not null default 0,
    bbox_json text not null default '[]',
    landmarks_json text not null default '[]',
    status text not null default 'pending',
    result_kind text not null default '',
    result_key text not null default '',
    result_name text not null default '',
    similarity real not null default 0,
    last_error text not null default '',
    created_at text not null,
    updated_at text not null,
    processed_at text not null default ''
);

create table if not exists crop_processing_stats (
    capture_date text not null,
    status text not null,
    item_count integer not null default 0,
    file_bytes integer not null default 0,
    primary key (capture_date, status)
);

create table if not exists match_schedule (
    id integer primary key autoincrement,
    match_date text not null,
    starts_at text not null,
    ends_at text not null,
    expected_duration_minutes integer not null default 50,
    tolerance_minutes integer not null default 5,
    tournament text not null default '',
    home_team text not null default '',
    away_team text not null default '',
    referee text not null default '',
    source text not null default 'manual',
    created_at text not null,
    updated_at text not null,
    unique(match_date,starts_at,home_team,away_team)
);

create table if not exists match_analysis_days (
    analysis_date text primary key,
    status text not null default 'pending',
    match_detected integer not null default 0,
    window_count integer not null default 0,
    scheduled_count integer not null default 0,
    scheduled_confirmed_count integer not null default 0,
    unscheduled_count integer not null default 0,
    max_unique_people integer not null default 0,
    source_crop_count integer not null default 0,
    source_queue_count integer not null default 0,
    source_schedule_count integer not null default 0,
    unresolved_queue_count integer not null default 0,
    first_seen_at text not null default '',
    last_seen_at text not null default '',
    analysis_version text not null default '',
    analyzed_at text not null default ''
);

create table if not exists match_analysis_windows (
    id integer primary key autoincrement,
    analysis_date text not null,
    window_index integer not null,
    starts_at text not null,
    ends_at text not null,
    duration_minutes integer not null default 0,
    max_unique_people integer not null default 0,
    participant_count integer not null default 0,
    known_count integer not null default 0,
    unknown_count integer not null default 0,
    participants_json text not null default '[]',
    window_type text not null default 'unscheduled',
    window_status text not null default 'outside_schedule',
    schedule_id integer,
    tournament text not null default '',
    home_team text not null default '',
    away_team text not null default '',
    scheduled_starts_at text not null default '',
    scheduled_ends_at text not null default '',
    evidence_starts_at text not null default '',
    evidence_ends_at text not null default '',
    tolerance_minutes integer not null default 0,
    created_at text not null,
    unique(analysis_date,window_index),
    foreign key(analysis_date) references match_analysis_days(analysis_date) on delete cascade
);

create table if not exists sync_queue (
    id integer primary key autoincrement,
    event_id text not null unique,
    event_type text not null,
    payload_json text not null,
    status text not null default 'pending',
    attempts integer not null default 0,
    next_attempt_at text not null,
    last_error text not null default '',
    created_at text not null,
    updated_at text not null
);

create index if not exists ix_presence_date on daily_presence(presence_date, last_seen_at desc);
create index if not exists ix_unknown_status on unknown_subjects(status, last_seen_at desc);
create index if not exists ix_face_crops_subject_page on face_crops(subject_kind, subject_key, seen_at desc, id desc);
create index if not exists ix_unknown_references_subject on unknown_references(subject_id, quality desc);
create index if not exists ix_known_references_person on known_references(person_key,pinned desc,quality desc,id);
create index if not exists ix_unassigned_status_date on unassigned_crops(status, captured_at, id);
create index if not exists ix_reprocess_runs_date on reprocess_runs(target_date, created_at desc);
create index if not exists ix_evidence_retention_runs_date on evidence_retention_runs(cutoff_date,created_at desc);
create index if not exists ix_evidence_retention_items_state on evidence_retention_items(run_id,state,face_crop_id);
create index if not exists ix_daily_detection_stats_date on daily_detection_stats(evidence_date,subject_kind,subject_key);
create index if not exists ix_monthly_payments_month on monthly_payments(payment_month,person_key);
create index if not exists ix_crop_processing_status on crop_processing_queue(status, captured_at);
create index if not exists ix_crop_processing_date on crop_processing_queue(substr(captured_at,1,10), id desc);
create index if not exists ix_match_schedule_date on match_schedule(match_date,starts_at);
create index if not exists ix_match_analysis_days_status on match_analysis_days(status,analysis_date desc);
create index if not exists ix_match_analysis_windows_date on match_analysis_windows(analysis_date,window_index);
create index if not exists ix_sync_pending on sync_queue(status, next_attempt_at);

create trigger if not exists trg_crop_processing_stats_insert
after insert on crop_processing_queue
begin
    insert into crop_processing_stats(capture_date,status,item_count,file_bytes)
    values (substr(new.captured_at,1,10),new.status,1,max(new.file_bytes,0))
    on conflict(capture_date,status) do update set
        item_count=crop_processing_stats.item_count + 1,
        file_bytes=crop_processing_stats.file_bytes + excluded.file_bytes;
end;

create trigger if not exists trg_crop_processing_stats_delete
after delete on crop_processing_queue
begin
    update crop_processing_stats
    set item_count=max(item_count - 1,0),
        file_bytes=max(file_bytes - max(old.file_bytes,0),0)
    where capture_date=substr(old.captured_at,1,10) and status=old.status;
end;

create trigger if not exists trg_crop_processing_stats_update
after update of captured_at,status,file_bytes on crop_processing_queue
when old.captured_at <> new.captured_at
  or old.status <> new.status
  or old.file_bytes <> new.file_bytes
begin
    update crop_processing_stats
    set item_count=max(item_count - 1,0),
        file_bytes=max(file_bytes - max(old.file_bytes,0),0)
    where capture_date=substr(old.captured_at,1,10) and status=old.status;

    insert into crop_processing_stats(capture_date,status,item_count,file_bytes)
    values (substr(new.captured_at,1,10),new.status,1,max(new.file_bytes,0))
    on conflict(capture_date,status) do update set
        item_count=crop_processing_stats.item_count + 1,
        file_bytes=crop_processing_stats.file_bytes + excluded.file_bytes;
end;
"""
