-- ============================================================
-- Control Tower Core — Database Schema
-- Used by:
--   1. docker-compose.yml (auto-applied via docker-entrypoint-initdb.d)
--   2. test/integration-test.setup.ts (applied programmatically via pg client to TestContainers)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- conversation_threads
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_threads (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain      TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    channel     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'green',     -- green | yellow | red
    ownership   TEXT NOT NULL DEFAULT 'AI',        -- AI | HUMAN
    assigned_role       TEXT,
    assigned_user_id    TEXT,
    is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- conversation_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id   UUID NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
    sender_id   TEXT NOT NULL,
    sender_type TEXT NOT NULL,                     -- USER | AI | HUMAN
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON conversation_messages(thread_id);

-- ============================================================
-- sentiment_evaluations
-- ============================================================
CREATE TABLE IF NOT EXISTS sentiment_evaluations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id   UUID NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
    message_id  UUID,
    score       NUMERIC(5,4) NOT NULL,
    label       TEXT NOT NULL,
    provider    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sentiment_thread_id ON sentiment_evaluations(thread_id);

-- ============================================================
-- guardrail_evaluations
-- ============================================================
CREATE TABLE IF NOT EXISTS guardrail_evaluations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id       UUID NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
    content_snippet TEXT,
    triggered_rule  TEXT NOT NULL,
    action          TEXT NOT NULL,                 -- escalate | block | warn
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guardrail_thread_id ON guardrail_evaluations(thread_id);

-- ============================================================
-- audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id   UUID REFERENCES conversation_threads(id) ON DELETE SET NULL,
    actor_id    TEXT NOT NULL,
    actor_type  TEXT NOT NULL,                 -- HUMAN | AI | SYSTEM
    action      TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_thread_id ON audit_logs(thread_id);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_logs(action);

-- ============================================================
-- routing_events
-- ============================================================
CREATE TABLE IF NOT EXISTS routing_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id   UUID NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
    actor_id    TEXT NOT NULL,
    target_role TEXT,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routing_thread_id ON routing_events(thread_id);

-- ============================================================
-- dead_letter_queue
-- ============================================================
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id   UUID REFERENCES conversation_threads(id) ON DELETE SET NULL,
    job_type    TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    error       TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- users (Login Credentials — Multi-Domain Generic)
-- One users table serves ALL domains registered in this Control Tower.
-- Email uniqueness is enforced per-domain, not globally.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL,          -- domain-specific role, e.g. CRO | DOCTOR | NURSE
    domain          TEXT NOT NULL,          -- e.g. 'janmasethu', 'oncology', 'cardiology'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Same email can exist in different domains (different apps)
    CONSTRAINT uq_users_email_domain UNIQUE (email, domain)
);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_domain  ON users(domain);



