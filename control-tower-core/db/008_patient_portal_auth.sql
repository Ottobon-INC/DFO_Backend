-- Adding PIN authentication fields for the Patient Portal
ALTER TABLE public.sakhi_clinic_patients 
ADD COLUMN IF NOT EXISTS pin_hash TEXT,
ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;
