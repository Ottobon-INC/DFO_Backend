-- ============================================================
-- Migration 031: Create Sakhi Clinic Demo Requests Table
-- For B2B Hospital & Clinic Onboarding / Walkthrough Inquiries
-- ============================================================

CREATE TABLE IF NOT EXISTS sakhi_clinic_demo_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255) NOT NULL,
    designation VARCHAR(100),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    city VARCHAR(100),
    patient_volume VARCHAR(50),
    preferred_channel VARCHAR(50) DEFAULT 'WhatsApp Walkthrough',
    preferred_slot VARCHAR(100),
    message TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    assigned_to UUID REFERENCES sakhi_clinic_users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for rapid search and sorting
CREATE INDEX IF NOT EXISTS idx_sakhi_demo_requests_email ON sakhi_clinic_demo_requests(email);
CREATE INDEX IF NOT EXISTS idx_sakhi_demo_requests_phone ON sakhi_clinic_demo_requests(phone);
CREATE INDEX IF NOT EXISTS idx_sakhi_demo_requests_status ON sakhi_clinic_demo_requests(status);
CREATE INDEX IF NOT EXISTS idx_sakhi_demo_requests_created_at ON sakhi_clinic_demo_requests(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE sakhi_clinic_demo_requests ENABLE ROW LEVEL SECURITY;

-- 1. Allow public / unauthenticated users on the website to submit demo requests
DROP POLICY IF EXISTS "Allow public demo requests insert" ON sakhi_clinic_demo_requests;
CREATE POLICY "Allow public demo requests insert"
ON sakhi_clinic_demo_requests FOR INSERT
WITH CHECK (true);

-- 2. Allow authenticated administrators and service role to read and manage demo requests
DROP POLICY IF EXISTS "Allow staff to view demo requests" ON sakhi_clinic_demo_requests;
CREATE POLICY "Allow staff to view demo requests"
ON sakhi_clinic_demo_requests FOR ALL
USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
