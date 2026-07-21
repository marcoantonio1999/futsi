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
create index if not exists ix_sync_pending on sync_queue(status, next_attempt_at);
"""
