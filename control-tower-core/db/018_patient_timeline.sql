-- ============================================================
-- Migration 018: Patient Timeline View & Schema Expansion (V2)
-- Addresses UX gaps: Grouping, Cancellations, and Session tracking
-- ============================================================

-- Safely drop the previously created tables so we can recreate them with the new schema
DROP VIEW IF EXISTS sakhi_clinic_patient_timeline_view;
DROP TABLE IF EXISTS sakhi_clinic_prescriptions CASCADE;
DROP TABLE IF EXISTS sakhi_clinic_treatments CASCADE;

-- ============================================================
-- 1. Create sakhi_clinic_prescriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_clinic_prescriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL DEFAULT uuid_generate_v4(), -- To group multiple medications into one logical prescription
    patient_id UUID NOT NULL REFERENCES sakhi_clinic_patients(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES sakhi_clinic_users(id),
    medication_name TEXT NOT NULL,
    dosage TEXT NOT NULL,
    frequency TEXT NOT NULL,
    duration_days INTEGER,
    special_instructions TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Create sakhi_clinic_treatments
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_clinic_treatments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_treatment_id UUID REFERENCES sakhi_clinic_treatments(id) ON DELETE CASCADE, -- To link multiple sessions to a master plan
    patient_id UUID NOT NULL REFERENCES sakhi_clinic_patients(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES sakhi_clinic_users(id),
    treatment_name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'PLANNED', -- PLANNED, IN_PROGRESS, COMPLETED, CANCELLED
    cost NUMERIC(10,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. Create sakhi_clinic_patient_timeline_view
-- ============================================================
-- Note: SECURITY INVOKER ensures the view respects Row-Level Security 
-- of the underlying tables based on the querying user's token.
CREATE OR REPLACE VIEW sakhi_clinic_patient_timeline_view WITH (security_invoker = true) AS

-- 1. Appointments (Filtered for cancellations, mapped title to visit_reason)
SELECT 
    id AS source_id, 
    patient_id, 
    clinic_id, 
    created_at AS event_date,
    'APPOINTMENT' AS event_type, 
    COALESCE(visit_reason, type) AS title, 
    (type || ' - ' || status) AS description, 
    NULL AS file_url
FROM sakhi_clinic_appointments
WHERE status NOT IN ('CANCELLED', 'NO_SHOW', 'DELETED')

UNION ALL

-- 2. Consultations (Clinical Notes)
SELECT 
    id AS source_id, 
    patient_id, 
    clinic_id, 
    created_at AS event_date,
    'CONSULTATION' AS event_type, 
    'Clinical Note' AS title, 
    note AS description, 
    NULL AS file_url
FROM sakhi_clinical_notes

UNION ALL

-- 3. Investigations (Documents)
SELECT 
    id AS source_id, 
    patient_id, 
    clinic_id, 
    created_at AS event_date,
    'INVESTIGATION' AS event_type, 
    name AS title, 
    status AS description, 
    file_path AS file_url
FROM sakhi_clinic_documents
WHERE status != 'DELETED'

UNION ALL

-- 4. Prescriptions (Aggregated by group_id so they show up as ONE timeline card)
SELECT 
    group_id AS source_id, 
    patient_id, 
    clinic_id, 
    MAX(created_at) AS event_date,
    'PRESCRIPTION' AS event_type, 
    'Prescription' AS title, 
    STRING_AGG(medication_name || ' (' || dosage || ')', ', ') AS description, 
    NULL AS file_url
FROM sakhi_clinic_prescriptions
WHERE status != 'CANCELLED'
GROUP BY group_id, patient_id, clinic_id

UNION ALL

-- 5. Treatments (Sessions)
SELECT 
    id AS source_id, 
    patient_id, 
    clinic_id, 
    created_at AS event_date,
    'TREATMENT' AS event_type, 
    treatment_name AS title, 
    status AS description, 
    NULL AS file_url
FROM sakhi_clinic_treatments
WHERE status != 'CANCELLED';

-- ============================================================
-- 4. Composite Indexes for Timeline Query Performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_appointments_timeline ON sakhi_clinic_appointments(clinic_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_timeline ON sakhi_clinical_notes(clinic_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_timeline ON sakhi_clinic_documents(clinic_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_timeline ON sakhi_clinic_prescriptions(clinic_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatments_timeline ON sakhi_clinic_treatments(clinic_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_group ON sakhi_clinic_prescriptions(group_id);
