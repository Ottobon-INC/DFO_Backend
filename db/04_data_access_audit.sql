-- 04_data_access_audit.sql
-- Tracking all sensitive data access for healthcare compliance

CREATE TABLE IF NOT EXISTS data_access_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(100) NOT NULL, -- The ID of the person (clinician/admin) accessing the data
  action VARCHAR(50) NOT NULL, -- 'READ', 'CREATE', 'UPDATE', 'DELETE'
  resource_type VARCHAR(50) NOT NULL, -- 'PATIENT', 'LEAD', 'MESSAGE', 'THREAD'
  resource_id UUID, -- Optional specific record ID
  details TEXT, -- Optional metadata (e.g., "Accessed full history")
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for compliance monitoring and reporting
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON data_access_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON data_access_audit(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON data_access_audit(created_at);
