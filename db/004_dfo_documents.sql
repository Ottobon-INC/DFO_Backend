-- ============================================================
-- JanmaSethu DFO — Document Management Schema (Migration 004)
-- Run this in Supabase SQL Editor or apply via psql
-- ============================================================

-- Enable UUID if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- dfo_documents
-- Central registry of all generated clinical documents.
-- Stores ONLY file_path (never signed URLs — those are generated dynamically).
-- ============================================================
CREATE TABLE IF NOT EXISTS dfo_documents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Ownership & Linkage
    patient_id          UUID NOT NULL REFERENCES dfo_patients(id) ON DELETE CASCADE,
    consultation_id     UUID REFERENCES dfo_consultations(id) ON DELETE SET NULL,
    prescription_id     UUID REFERENCES dfo_prescriptions(id) ON DELETE SET NULL,

    -- Document Metadata
    type                TEXT NOT NULL CHECK (type IN ('prescription', 'report', 'discharge_summary', 'consultation_note')),
    file_path           TEXT NOT NULL,          -- e.g. patients/{patient_id}/consultations/{consultation_id}/prescription_{id}.docx
    file_name           TEXT NOT NULL,          -- e.g. prescription_2024-01-01.docx
    file_size_bytes     INTEGER,
    mime_type           TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

    -- Generation Metadata
    version             INTEGER NOT NULL DEFAULT 1,     -- Increment on regeneration
    generated_by        TEXT NOT NULL DEFAULT 'SYSTEM', -- actor_id of the generating clinician or SYSTEM
    generation_status   TEXT NOT NULL DEFAULT 'pending' CHECK (generation_status IN ('pending', 'generated', 'failed')),
    error_message       TEXT,                   -- Captured if generation_status = 'failed'

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_dfo_documents_patient_id      ON dfo_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_dfo_documents_consultation_id ON dfo_documents(consultation_id);
CREATE INDEX IF NOT EXISTS idx_dfo_documents_prescription_id ON dfo_documents(prescription_id);
CREATE INDEX IF NOT EXISTS idx_dfo_documents_type            ON dfo_documents(type);
CREATE INDEX IF NOT EXISTS idx_dfo_documents_status          ON dfo_documents(generation_status);

-- ============================================================
-- dfo_document_access_logs
-- Tracks every time a signed URL is generated (for audit).
-- Signed URLs themselves are NEVER stored.
-- ============================================================
CREATE TABLE IF NOT EXISTS dfo_document_access_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES dfo_documents(id) ON DELETE CASCADE,
    accessed_by TEXT NOT NULL,          -- clinician actor_id
    role        TEXT NOT NULL,          -- their role at access time
    expires_at  TIMESTAMPTZ NOT NULL,   -- when the signed URL expired
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfo_doc_access_document_id ON dfo_document_access_logs(document_id);
CREATE INDEX IF NOT EXISTS idx_dfo_doc_access_accessed_by ON dfo_document_access_logs(accessed_by);

-- ============================================================
-- Supabase Storage Setup (run in Supabase Dashboard > Storage)
-- OR via Supabase Management API:
--
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('documents', 'documents', false)
--   ON CONFLICT (id) DO NOTHING;
--
-- Folder structure enforced at application level:
--   /patients/{patient_id}/consultations/{consultation_id}/
--     prescription_{prescription_id}.docx
--     report_{report_id}.pdf
-- ============================================================
