-- ============================================================
-- Migration 013: Compound Indexes for Time-Series Queries
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. Index for fetching a clinic's patients sorted by creation date
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_patients_clinic_created_at 
ON sakhi_clinic_patients(clinic_id, created_at DESC);

-- 2. Index for fetching a clinic's appointments sorted by creation date
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_appointments_clinic_created_at 
ON sakhi_clinic_appointments(clinic_id, created_at DESC);

-- 3. Index for fetching a clinic's documents sorted by creation date
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_documents_clinic_created_at 
ON sakhi_clinic_documents(clinic_id, created_at DESC);

-- Optional: If leads or notes are queried by created_at, we can index them too
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_leads_clinic_created_at 
ON sakhi_clinic_leads(clinic_id, created_at DESC);
