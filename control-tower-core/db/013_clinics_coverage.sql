-- Create clinics_coverage table for ZIP matching and hospital partner ranking
CREATE TABLE IF NOT EXISTS clinics_coverage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    zip_code VARCHAR(20) NOT NULL,
    specialities JSONB DEFAULT '[]'::jsonb,
    partner_rank INTEGER DEFAULT 1,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index coverage queries
CREATE INDEX IF NOT EXISTS idx_clinics_coverage_zip ON clinics_coverage(zip_code);
CREATE INDEX IF NOT EXISTS idx_clinics_coverage_clinic ON clinics_coverage(clinic_id);

-- Add zip_code to sakhi_clinic_leads
ALTER TABLE sakhi_clinic_leads ADD COLUMN IF NOT EXISTS zip_code VARCHAR(20);
