-- ============================================================
-- Migration 024: Clinical Notes Soft Delete & Compliance
-- Adds a status column to sakhi_clinical_notes and filters
-- out deleted notes from the patient timeline view.
-- ============================================================

-- 1. Add status column to sakhi_clinical_notes
ALTER TABLE sakhi_clinical_notes
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';

-- 2. Recreate sakhi_clinic_patient_timeline_view to filter out DELETED notes
DROP VIEW IF EXISTS sakhi_clinic_patient_timeline_view;

CREATE OR REPLACE VIEW sakhi_clinic_patient_timeline_view WITH (security_invoker = true) AS

-- 1. Appointments
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
WHERE status != 'DELETED'

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

-- 4. Prescriptions
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
