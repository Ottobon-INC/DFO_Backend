-- ============================================================
-- Migration 007: Multi-Tenant Postgres Database Foundation
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Create the Master clinics table
-- ============================================================
CREATE TABLE IF NOT EXISTS clinics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    address TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert a default "Test/HQ Clinic" to bind existing test data to
-- We use a DO block to prevent duplicate inserts if run multiple times
DO $$ 
DECLARE 
    hq_clinic_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'HQ / Test Clinic') THEN
        INSERT INTO clinics (name) VALUES ('HQ / Test Clinic') RETURNING id INTO hq_clinic_id;
    END IF;
END $$;

-- ============================================================
-- 2. Modify sakhi_clinic_users for Super Admin & Multi-Tenancy
-- ============================================================
-- Add clinic_id as NULLABLE (since Super Admins don't belong to a single clinic)
ALTER TABLE sakhi_clinic_users 
ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;

-- Add is_super_admin flag
ALTER TABLE sakhi_clinic_users 
ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Add is_clinic_admin flag for hierarchical clinic management
ALTER TABLE sakhi_clinic_users 
ADD COLUMN IF NOT EXISTS is_clinic_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sakhi_users_clinic_id ON sakhi_clinic_users(clinic_id);

-- ============================================================
-- 3. Add clinic_id to Clinical Data Tables
-- ============================================================

-- Function to safely add the clinic_id column and update existing rows
DO $$
DECLARE
    hq_id UUID;
    t TEXT;
    tables_to_update TEXT[] := ARRAY[
        'sakhi_clinic_patients',
        'sakhi_clinic_appointments',
        'sakhi_clinic_documents',
        'sakhi_clinic_leads',
        'sakhi_clinic_patient_notes',
        'sakhi_clinical_notes',
        'clinical_analyses',
        'patient_consents',
        'patient_vitals',
        'dfo_support_tickets',
        'conversation_threads'
    ];
BEGIN
    -- Get the ID of the default clinic
    SELECT id INTO hq_id FROM clinics WHERE name = 'HQ / Test Clinic' LIMIT 1;

    FOREACH t IN ARRAY tables_to_update
    LOOP
        -- 1. Add the clinic_id column if it doesn't exist (Nullable initially)
        EXECUTE format('
            ALTER TABLE IF EXISTS %I 
            ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;
        ', t);

        -- 2. Update existing rows to belong to the HQ / Test Clinic
        EXECUTE format('
            UPDATE %I SET clinic_id = $1 WHERE clinic_id IS NULL;
        ', t) USING hq_id;

        -- 3. Enforce NOT NULL constraint now that existing data is handled
        EXECUTE format('
            ALTER TABLE IF EXISTS %I 
            ALTER COLUMN clinic_id SET NOT NULL;
        ', t);

        -- 4. Create standard index for the foreign key
        EXECUTE format('
            CREATE INDEX IF NOT EXISTS idx_%I_clinic_id ON %I(clinic_id);
        ', t, t);

        -- 5. Create compound index for multi-tenant queries (clinic_id, id)
        -- This drastically speeds up queries like: SELECT * FROM patients WHERE clinic_id = X AND id = Y
        EXECUTE format('
            CREATE INDEX IF NOT EXISTS idx_%I_clinic_compound ON %I(clinic_id, id);
        ', t, t);
        
    END LOOP;
END $$;

-- ============================================================
-- 4. Secure Test/HQ Users
-- ============================================================
-- Update any existing test users to belong to the HQ clinic by default
-- (Unless they are already marked as super admins)
DO $$
DECLARE
    hq_id UUID;
BEGIN
    SELECT id INTO hq_id FROM clinics WHERE name = 'HQ / Test Clinic' LIMIT 1;
    
    UPDATE sakhi_clinic_users 
    SET clinic_id = hq_id 
    WHERE clinic_id IS NULL AND is_super_admin = FALSE;
END $$;
