-- ============================================================
-- Migration 010: Add Document Status for Triage Queue
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- Add 'status' column to sakhi_clinic_documents with default 'unassigned'
ALTER TABLE IF EXISTS sakhi_clinic_documents 
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'unassigned';

-- Create a compound index to support the /unassigned endpoint query
-- This index targets exactly the documents we need for triage:
--   status = 'unassigned' AND patient_id IS NULL AND clinic_id = ?
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_docs_unassigned 
ON sakhi_clinic_documents(clinic_id, status) 
WHERE patient_id IS NULL;
