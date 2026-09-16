-- ============================================================
-- Follow-Ups Schema
-- Run this ENTIRE file in Supabase SQL Editor in one go
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: follow_ups
-- ============================================================
CREATE TABLE IF NOT EXISTS follow_ups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id       UUID NOT NULL,
    patient_id      UUID NOT NULL REFERENCES sakhi_clinic_patients(id) ON DELETE CASCADE,
    doctor_id       UUID REFERENCES clinic_staff(id) ON DELETE SET NULL, -- The doctor who recommended the follow-up
    follow_up_date  DATE NOT NULL,
    reason          TEXT,
    status          VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Called', 'Appointment Booked', 'Cancelled')),
    notes           TEXT, -- Front desk notes from calls
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX idx_follow_ups_clinic ON follow_ups(clinic_id);
CREATE INDEX idx_follow_ups_patient ON follow_ups(patient_id);
CREATE INDEX idx_follow_ups_date ON follow_ups(follow_up_date);
CREATE INDEX idx_follow_ups_status ON follow_ups(status);
