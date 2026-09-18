-- 03_audit_and_messages.sql

-- Chat history table for all patient-clinician interactions
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "threadId" UUID REFERENCES threads(id),
  "senderType" VARCHAR(20) NOT NULL, -- 'AI', 'PATIENT', 'CLINICIAN'
  "senderId" UUID, -- Can be clinician user ID or patient ID
  content TEXT NOT NULL, -- AES-256 Encrypted
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit trail for ownership transitions between AI and Humans
CREATE TABLE IF NOT EXISTS ownership_audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "threadId" UUID REFERENCES threads(id),
  "fromOwner" VARCHAR(50) NOT NULL,
  "toOwner" VARCHAR(50) NOT NULL,
  "reason" TEXT,
  "severityScore" INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages("threadId");
CREATE INDEX IF NOT EXISTS idx_ownership_audits_thread_id ON ownership_audits("threadId");
