-- PostgreSQL reference schema for Futsi Mini ERP.
-- Django models in back/core/models.py are the source of truth for migrations.

CREATE TABLE sites (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name VARCHAR(120) NOT NULL UNIQUE,
    code VARCHAR(40) NOT NULL UNIQUE,
    address TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    close_editing_after_hours SMALLINT NOT NULL DEFAULT 24
);

CREATE TABLE core_user (
    id BIGSERIAL PRIMARY KEY,
    password VARCHAR(128) NOT NULL,
    last_login TIMESTAMPTZ NULL,
    is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
    username VARCHAR(150) NOT NULL UNIQUE,
    first_name VARCHAR(150) NOT NULL DEFAULT '',
    last_name VARCHAR(150) NOT NULL DEFAULT '',
    email VARCHAR(254) NOT NULL DEFAULT '',
    is_staff BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    date_joined TIMESTAMPTZ NOT NULL DEFAULT now(),
    role VARCHAR(32) NOT NULL DEFAULT 'site_coordinator',
    phone VARCHAR(30) NOT NULL DEFAULT '',
    primary_site_id BIGINT NULL REFERENCES sites(id) ON DELETE SET NULL,
    CONSTRAINT ck_core_user_role CHECK (
        role IN ('admin', 'dev', 'accounting', 'owner', 'site_coordinator', 'cashier', 'coach', 'guardian')
    )
);

CREATE TABLE courts (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    name VARCHAR(80) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_court_site_name UNIQUE (site_id, name)
);

CREATE TABLE guardians (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    full_name VARCHAR(160) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(254) NOT NULL DEFAULT '',
    tax_name VARCHAR(180) NOT NULL DEFAULT '',
    tax_id VARCHAR(20) NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_guardian_full_name ON guardians(full_name);
CREATE INDEX ix_guardian_phone ON guardians(phone);

CREATE TABLE students (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    guardian_id BIGINT NOT NULL REFERENCES guardians(id) ON DELETE RESTRICT,
    full_name VARCHAR(160) NOT NULL,
    birth_date DATE NULL,
    category VARCHAR(60) NOT NULL DEFAULT '',
    group_name VARCHAR(80) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'trial',
    photo VARCHAR(100) NOT NULL DEFAULT '',
    medical_notes TEXT NOT NULL DEFAULT '',
    emergency_contact VARCHAR(160) NOT NULL DEFAULT '',
    emergency_phone VARCHAR(30) NOT NULL DEFAULT '',
    uniform_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    joined_at DATE NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT ck_student_status CHECK (status IN ('trial', 'active', 'paused', 'injured', 'dropped'))
);

CREATE INDEX ix_student_site_status ON students(site_id, status);
CREATE INDEX ix_student_full_name ON students(full_name);

CREATE TABLE tournaments (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    name VARCHAR(140) NOT NULL,
    billing_type VARCHAR(30) NOT NULL,
    starts_on DATE NULL,
    expected_weeks SMALLINT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_tournament_billing_type CHECK (billing_type IN ('full_tournament', 'weekly_match'))
);

CREATE INDEX ix_tournament_site_active ON tournaments(site_id, is_active);

CREATE TABLE teams (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
    name VARCHAR(140) NOT NULL,
    representative_name VARCHAR(160) NOT NULL,
    representative_phone VARCHAR(30) NOT NULL,
    representative_email VARCHAR(254) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_team_tournament_name UNIQUE (tournament_id, name)
);

CREATE TABLE players (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    full_name VARCHAR(160) NOT NULL,
    phone VARCHAR(30) NOT NULL DEFAULT '',
    photo VARCHAR(100) NOT NULL DEFAULT '',
    identity_document VARCHAR(100) NOT NULL DEFAULT '',
    waiver_document VARCHAR(100) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX ix_player_team_active ON players(team_id, is_active);

CREATE TABLE rounds (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
    number SMALLINT NOT NULL,
    starts_on DATE NULL,
    ends_on DATE NULL,
    CONSTRAINT uq_round_tournament_number UNIQUE (tournament_id, number)
);

CREATE TABLE attendance_sessions (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    session_type VARCHAR(30) NOT NULL,
    date DATE NOT NULL,
    starts_at TIME NULL,
    duration_minutes SMALLINT NOT NULL DEFAULT 120,
    court_id BIGINT NULL REFERENCES courts(id) ON DELETE RESTRICT,
    group_name VARCHAR(80) NOT NULL DEFAULT '',
    tournament_id BIGINT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
    round_id BIGINT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
    team_id BIGINT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    captured_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    closed_at TIMESTAMPTZ NULL,
    CONSTRAINT ck_attendance_session_type CHECK (session_type IN ('academy_class', 'tournament_match')),
    CONSTRAINT ck_attendance_session_duration CHECK (duration_minutes >= 1)
);

CREATE INDEX ix_att_session_site_date ON attendance_sessions(site_id, date);
CREATE INDEX ix_att_session_type_date ON attendance_sessions(session_type, date);

CREATE TABLE attendance_records (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id BIGINT NULL REFERENCES students(id) ON DELETE RESTRICT,
    team_id BIGINT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL,
    had_debt_at_capture BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason TEXT NOT NULL DEFAULT '',
    captured_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    CONSTRAINT ck_attendance_record_status CHECK (status IN ('present', 'absent', 'justified')),
    CONSTRAINT ck_attendance_record_subject CHECK (
        (student_id IS NOT NULL AND team_id IS NULL) OR
        (student_id IS NULL AND team_id IS NOT NULL)
    )
);

CREATE INDEX ix_att_record_session_status ON attendance_records(session_id, status);
CREATE INDEX ix_att_record_student ON attendance_records(student_id);
CREATE INDEX ix_att_record_team ON attendance_records(team_id);

CREATE TABLE charges (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    student_id BIGINT NULL REFERENCES students(id) ON DELETE RESTRICT,
    team_id BIGINT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    concept VARCHAR(80) NOT NULL,
    description VARCHAR(180) NOT NULL DEFAULT '',
    amount NUMERIC(12,2) NOT NULL,
    due_date DATE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    CONSTRAINT ck_charge_amount CHECK (amount >= 0),
    CONSTRAINT ck_charge_status CHECK (status IN ('pending', 'partial', 'paid', 'canceled')),
    CONSTRAINT ck_charge_subject CHECK (
        (student_id IS NOT NULL AND team_id IS NULL) OR
        (student_id IS NULL AND team_id IS NOT NULL)
    )
);

CREATE INDEX ix_charge_site_status ON charges(site_id, status);
CREATE INDEX ix_charge_student_status ON charges(student_id, status);
CREATE INDEX ix_charge_team_status ON charges(team_id, status);

CREATE TABLE payments (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    charge_id BIGINT NULL REFERENCES charges(id) ON DELETE RESTRICT,
    student_id BIGINT NULL REFERENCES students(id) ON DELETE RESTRICT,
    team_id BIGINT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    method VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'registered',
    amount NUMERIC(12,2) NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reference VARCHAR(120) NOT NULL DEFAULT '',
    tracking_key VARCHAR(120) NOT NULL DEFAULT '',
    receipt_file VARCHAR(100) NOT NULL DEFAULT '',
    received_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    notes TEXT NOT NULL DEFAULT '',
    CONSTRAINT ck_payment_amount CHECK (amount >= 0),
    CONSTRAINT ck_payment_method CHECK (method IN ('cash', 'transfer', 'card', 'courtesy')),
    CONSTRAINT ck_payment_status CHECK (status IN ('registered', 'reconciled', 'canceled'))
);

CREATE INDEX ix_payment_site_paid_at ON payments(site_id, paid_at);
CREATE INDEX ix_payment_method_status ON payments(method, status);
CREATE INDEX ix_payment_tracking_key ON payments(tracking_key);

CREATE TABLE discounts (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    charge_id BIGINT NULL REFERENCES charges(id) ON DELETE RESTRICT,
    student_id BIGINT NULL REFERENCES students(id) ON DELETE RESTRICT,
    team_id BIGINT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    reason VARCHAR(80) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'requested',
    evidence_file VARCHAR(100) NOT NULL DEFAULT '',
    requested_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    approved_by_id BIGINT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ NULL,
    CONSTRAINT ck_discount_amount CHECK (amount >= 0),
    CONSTRAINT ck_discount_status CHECK (status IN ('requested', 'approved', 'rejected', 'canceled'))
);

CREATE INDEX ix_discount_site_status ON discounts(site_id, status);
CREATE INDEX ix_discount_student_status ON discounts(student_id, status);
CREATE INDEX ix_discount_team_status ON discounts(team_id, status);

CREATE TABLE expenses (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    category VARCHAR(80) NOT NULL,
    description VARCHAR(180) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    provider_name VARCHAR(160) NOT NULL DEFAULT '',
    evidence_file VARCHAR(100) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    captured_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    approved_by_id BIGINT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ NULL,
    CONSTRAINT ck_expense_amount CHECK (amount >= 0),
    CONSTRAINT ck_expense_status CHECK (status IN ('pending', 'approved', 'rejected', 'canceled'))
);

CREATE INDEX ix_expense_site_date ON expenses(site_id, expense_date);
CREATE INDEX ix_expense_site_status ON expenses(site_id, status);

CREATE TABLE invoices (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    uuid UUID NOT NULL UNIQUE,
    kind VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'issued',
    site_id BIGINT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    student_id BIGINT NULL REFERENCES students(id) ON DELETE RESTRICT,
    guardian_id BIGINT NULL REFERENCES guardians(id) ON DELETE RESTRICT,
    coach_id BIGINT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    charge_id BIGINT NULL REFERENCES charges(id) ON DELETE RESTRICT,
    payment_id BIGINT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    expense_id BIGINT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
    recipient_name VARCHAR(180) NOT NULL,
    recipient_tax_id VARCHAR(20) NOT NULL DEFAULT '',
    recipient_email VARCHAR(254) NOT NULL DEFAULT '',
    concept VARCHAR(180) NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL,
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    xml_content TEXT NOT NULL DEFAULT '',
    pdf_file VARCHAR(100) NOT NULL DEFAULT '',
    issued_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    CONSTRAINT ck_invoice_kind CHECK (kind IN ('income', 'expense')),
    CONSTRAINT ck_invoice_status CHECK (status IN ('issued', 'canceled')),
    CONSTRAINT ck_invoice_amounts CHECK (subtotal >= 0 AND tax >= 0 AND total >= 0)
);

CREATE INDEX ix_invoice_kind_status ON invoices(kind, status);
CREATE INDEX ix_invoice_student_date ON invoices(student_id, issued_at);
CREATE INDEX ix_invoice_guardian_date ON invoices(guardian_id, issued_at);
CREATE INDEX ix_invoice_expense_date ON invoices(expense_id, issued_at);

CREATE TABLE face_recognition_attempts (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id BIGINT NULL REFERENCES students(id) ON DELETE SET NULL,
    captured_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    matched BOOLEAN NOT NULL DEFAULT FALSE,
    confidence NUMERIC(6,4) NOT NULL DEFAULT 0,
    engine VARCHAR(40) NOT NULL DEFAULT 'mock',
    notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_face_attempt_session_match ON face_recognition_attempts(session_id, matched);
CREATE INDEX ix_face_attempt_student_date ON face_recognition_attempts(student_id, created_at);

CREATE TABLE coach_work_logs (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    coach_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    group_name VARCHAR(80) NOT NULL DEFAULT '',
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    hours NUMERIC(5,2) NOT NULL,
    activity VARCHAR(80) NOT NULL DEFAULT 'Entrenamiento',
    notes TEXT NOT NULL DEFAULT '',
    hourly_rate_snapshot NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    CONSTRAINT ck_coach_work_hours CHECK (hours >= 0),
    CONSTRAINT ck_coach_hourly_rate CHECK (hourly_rate_snapshot >= 0)
);

CREATE INDEX ix_coach_log_coach_date ON coach_work_logs(coach_id, work_date);
CREATE INDEX ix_coach_log_site_date ON coach_work_logs(site_id, work_date);

CREATE TABLE daily_closures (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    business_date DATE NOT NULL,
    closed_by_id BIGINT NOT NULL REFERENCES core_user(id) ON DELETE RESTRICT,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cash_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
    cash_reported NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    is_reopened BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_daily_closure_site_date UNIQUE (site_id, business_date)
);

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id BIGINT NULL REFERENCES core_user(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    table_name VARCHAR(80) NOT NULL,
    record_id VARCHAR(80) NOT NULL,
    previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX ix_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX ix_audit_actor_created ON audit_logs(actor_id, created_at);
