-- Create the sakhi_clinic_patient_vitals table for time-series health metrics
CREATE TABLE IF NOT EXISTS sakhi_clinic_patient_vitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL,
  vital_type VARCHAR(50) NOT NULL, -- e.g., 'blood_pressure', 'heart_rate', 'temperature', 'weight', 'blood_sugar'
  value_encrypted TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimization for retrieving a patient's historical vitals
CREATE INDEX IF NOT EXISTS sakhi_clinic_patient_vitals_patient_id_idx ON sakhi_clinic_patient_vitals(patient_id);
-- Optimization for time-series analysis (getting recent vitals)
CREATE INDEX IF NOT EXISTS sakhi_clinic_patient_vitals_recorded_at_idx ON sakhi_clinic_patient_vitals(patient_id, vital_type, recorded_at DESC);
