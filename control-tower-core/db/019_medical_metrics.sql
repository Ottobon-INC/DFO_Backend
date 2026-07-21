-- ============================================================
-- Migration 019: Medical Metrics & Constraints Fix
-- ============================================================

-- 0. Rename table to follow convention
ALTER TABLE IF EXISTS patient_vitals RENAME TO sakhi_clinic_patient_vitals;

DO $$ 
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='sakhi_clinic_patient_vitals' and column_name='value_encrypted') THEN
      ALTER TABLE sakhi_clinic_patient_vitals RENAME COLUMN value_encrypted TO vital_value;
  END IF;
END $$;

ALTER TABLE sakhi_clinic_patient_vitals
  DROP CONSTRAINT IF EXISTS fk_sakhi_clinic_patient_vitals_patient;

ALTER TABLE sakhi_clinic_patient_vitals
  ADD CONSTRAINT fk_sakhi_clinic_patient_vitals_patient 
  FOREIGN KEY (patient_id) REFERENCES sakhi_clinic_patients(id) ON DELETE CASCADE;

-- 1.5 Add clinic_id for RLS isolation
ALTER TABLE sakhi_clinic_patient_vitals 
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;

-- 2. Create Allergies Table
CREATE TABLE IF NOT EXISTS sakhi_clinic_allergies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES sakhi_clinic_patients(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    allergy_name TEXT NOT NULL,
    severity TEXT CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    reaction TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Medical History Table
CREATE TABLE IF NOT EXISTS sakhi_clinic_medical_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES sakhi_clinic_patients(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    condition_name TEXT NOT NULL,
    diagnosis_date DATE,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast parallel reads
CREATE INDEX IF NOT EXISTS idx_allergies_patient ON sakhi_clinic_allergies(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_history_patient ON sakhi_clinic_medical_history(clinic_id, patient_id);

-- 4. Add Appointment Linking for Longitudinal Tracking
ALTER TABLE sakhi_clinic_patient_vitals 
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES sakhi_clinic_appointments(id) ON DELETE SET NULL;

ALTER TABLE sakhi_clinic_allergies 
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES sakhi_clinic_appointments(id) ON DELETE SET NULL;

ALTER TABLE sakhi_clinic_medical_history 
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES sakhi_clinic_appointments(id) ON DELETE SET NULL;

-- 5. Update Timeline View to Include Metrics
-- We redefine the view to append Vitals, Allergies, and Medical History
DROP VIEW IF EXISTS patient_timeline_view;
CREATE OR REPLACE VIEW sakhi_clinic_patient_timeline_view WITH (security_invoker = true) AS
SELECT id AS source_id, patient_id, clinic_id, created_at AS event_date, 'APPOINTMENT' AS event_type, COALESCE(visit_reason, type) AS title, (type || ' - ' || status) AS description, NULL AS file_url
FROM sakhi_clinic_appointments WHERE status NOT IN ('CANCELLED', 'NO_SHOW', 'DELETED')
UNION ALL
SELECT id AS source_id, patient_id, clinic_id, created_at AS event_date, 'CONSULTATION' AS event_type, 'Clinical Note' AS title, note AS description, NULL AS file_url
FROM sakhi_clinical_notes
UNION ALL
SELECT id AS source_id, patient_id, clinic_id, created_at AS event_date, 'INVESTIGATION' AS event_type, name AS title, status AS description, file_path AS file_url
FROM sakhi_clinic_documents WHERE status != 'DELETED'
UNION ALL
SELECT group_id AS source_id, patient_id, clinic_id, MAX(created_at) AS event_date, 'PRESCRIPTION' AS event_type, 'Prescription' AS title, STRING_AGG(medication_name || ' (' || dosage || ')', ', ') AS description, NULL AS file_url
FROM sakhi_clinic_prescriptions WHERE status != 'CANCELLED' GROUP BY group_id, patient_id, clinic_id
UNION ALL
SELECT id AS source_id, patient_id, clinic_id, created_at AS event_date, 'TREATMENT' AS event_type, treatment_name AS title, status AS description, NULL AS file_url
FROM sakhi_clinic_treatments WHERE status != 'CANCELLED'
UNION ALL
-- NEW METRICS:
SELECT id AS source_id, patient_id, clinic_id, recorded_at AS event_date, 'VITALS' AS event_type, 'Vitals Recorded' AS title, (vital_type || ': ' || vital_value) AS description, NULL AS file_url
FROM sakhi_clinic_patient_vitals
UNION ALL
SELECT id AS source_id, patient_id, clinic_id, created_at AS event_date, 'ALLERGY' AS event_type, 'Allergy Added' AS title, (allergy_name || ' (' || severity || ')') AS description, NULL AS file_url
FROM sakhi_clinic_allergies
UNION ALL
SELECT id AS source_id, patient_id, clinic_id, created_at AS event_date, 'MEDICAL_HISTORY' AS event_type, 'Medical History Updated' AS title, (condition_name || ' - ' || status) AS description, NULL AS file_url
FROM sakhi_clinic_medical_history;

-- Enable Realtime Broadcast for sakhi_clinic_patient_vitals (Day 8 Integration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'sakhi_clinic_patient_vitals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sakhi_clinic_patient_vitals;
  END IF;
END $$;
