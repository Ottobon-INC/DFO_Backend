-- 020_sakhi_clinic_phi_access_logs.sql
-- Tracking PHI (Protected Health Information) data access for HIPAA compliance

CREATE TABLE IF NOT EXISTS sakhi_clinic_phi_access_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(100) NOT NULL, -- The ID of the person (clinician/admin/patient) accessing the data
  patient_id VARCHAR(100) NOT NULL, -- The specific patient whose PHI was accessed
  action_type VARCHAR(50) NOT NULL, -- e.g., 'READ', 'EXPORT'
  resource_accessed VARCHAR(255), -- What specific data was accessed (e.g., 'Timeline', 'LabReport_123')
  client_ip VARCHAR(45), -- IP address of the client (IPv4/IPv6)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for compliance monitoring and reporting
CREATE INDEX IF NOT EXISTS idx_phi_audit_user_id ON sakhi_clinic_phi_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_phi_audit_patient_id ON sakhi_clinic_phi_access_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_phi_audit_created_at ON sakhi_clinic_phi_access_logs(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE sakhi_clinic_phi_access_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to insert logs.
-- This ensures that the application (with anon key + user token) can write audit logs.
-- Notice there are NO policies for UPDATE or DELETE, rendering this table insert-only.
CREATE POLICY "Enable insert for authenticated users only" 
ON sakhi_clinic_phi_access_logs 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Policy: Allow service role (backend) to read logs for compliance reporting.
-- If the system ever needs to read them, only service_role (or specific admins) can do so.
-- Assuming standard Supabase setup, service_role bypasses RLS by default, but we can be explicit if needed.
-- For standard users, they should NOT be able to read all logs.
CREATE POLICY "Allow users to read their own logs" 
ON sakhi_clinic_phi_access_logs 
FOR SELECT 
TO authenticated
USING (user_id = auth.uid()::text); -- Assuming user_id maps to auth.uid(), cast to text if necessary.
