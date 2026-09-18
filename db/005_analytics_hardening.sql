-- ==========================================
-- DFO ANALYTICS CACHE & INDEXING
-- ==========================================

-- 1. Precomputed Metrics Cache Table
-- Stores JSON snapshots of dashboard data to avoid heavy real-time joins.
CREATE TABLE IF NOT EXISTS dfo_analytics_cache (
    key             TEXT PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

-- 2. Performance Indexes (Optimization)
-- Optimizing risk level and status lookups for threads
CREATE INDEX IF NOT EXISTS idx_threads_risk_status 
ON conversation_threads(status, domain) INCLUDE (metadata);

-- Optimizing audit log lookups for SLA calculation
CREATE INDEX IF NOT EXISTS idx_audit_logs_thread_event 
ON audit_logs(thread_id, event_type, created_at);

-- Optimizing appointment analytics
CREATE INDEX IF NOT EXISTS idx_appointments_status_date 
ON dfo_appointments(status, appointment_date);

-- 3. SLA Configuration Table (If not exists)
CREATE TABLE IF NOT EXISTS dfo_sla_configs (
    role                        TEXT PRIMARY KEY, -- 'NURSE', 'DOCTOR'
    max_response_time_seconds   INTEGER NOT NULL,
    created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default SLA rules
INSERT INTO dfo_sla_configs (role, max_response_time_seconds)
VALUES 
    ('NURSE', 300),   -- 5 Minutes
    ('DOCTOR', 1800)  -- 30 Minutes
ON CONFLICT (role) DO NOTHING;
