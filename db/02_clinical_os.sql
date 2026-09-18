-- 02_clinical_os.sql
CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "patientId" UUID REFERENCES patients(id),
  "assignedClinicianId" UUID,
  queue VARCHAR(50) DEFAULT 'GENERAL',
  status VARCHAR(50) DEFAULT 'PENDING',
  severity VARCHAR(50) DEFAULT 'GREEN',
  "ownershipType" VARCHAR(50) DEFAULT 'AI',
  "clinicalNotes" TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
