-- ============================================================
-- Migration 032: Create Sakhi Escalations
-- ============================================================

CREATE TABLE IF NOT EXISTS sakhi_escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    doctor_id TEXT, 
    patient_id UUID,
    patient_name TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, RESOLVED
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sakhi_escalations_clinic_id ON sakhi_escalations(clinic_id);
CREATE INDEX IF NOT EXISTS idx_sakhi_escalations_doctor_id ON sakhi_escalations(doctor_id);
CREATE INDEX IF NOT EXISTS idx_sakhi_escalations_status ON sakhi_escalations(status);
