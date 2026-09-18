-- 006_support_tickets.sql
-- Inbound Service and Support Engagement Tickets for JanmaSethu Clinical OS

CREATE TABLE IF NOT EXISTS dfo_support_tickets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id           UUID REFERENCES conversation_threads(id) ON DELETE SET NULL,
    patient_id          UUID REFERENCES dfo_patients(id) ON DELETE SET NULL,
    patient_phone       TEXT,
    patient_name        TEXT,
    category            TEXT NOT NULL, -- 'Technical Assistance' | 'Healthcare Guidance' | 'Emotional Support' | 'Appointment Assistance' | 'Donor Assistance' | 'General Inquiry'
    priority            TEXT NOT NULL DEFAULT 'LOW', -- 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    status              TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED'
    source              TEXT NOT NULL DEFAULT 'web', -- 'whatsapp' | 'web' | 'portal'
    assigned_user_id    UUID, -- doctor_id or clinician_id
    escalation_metadata JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints to enforce domain-safe support categories, priorities, and statuses
    CONSTRAINT chk_support_category CHECK (category IN ('Technical Assistance', 'Healthcare Guidance', 'Emotional Support', 'Appointment Assistance', 'Donor Assistance', 'General Inquiry')),
    CONSTRAINT chk_support_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT chk_support_status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'))
);

-- Indexing for high-performance lookup in live queues
CREATE INDEX IF NOT EXISTS idx_support_tickets_thread_id ON dfo_support_tickets(thread_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_patient_id ON dfo_support_tickets(patient_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON dfo_support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON dfo_support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON dfo_support_tickets(created_at);
