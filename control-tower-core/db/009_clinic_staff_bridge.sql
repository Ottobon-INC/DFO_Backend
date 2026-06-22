-- ============================================================
-- Migration 009: Clinic Staff Bridge Table
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- Create the bridge table for assigning users to clinics
CREATE TABLE IF NOT EXISTS clinic_staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES sakhi_clinic_users(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Doctor', 'CRO', 'Receptionist', 'Nurse', 'Admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, clinic_id) -- A user can only have one active role per clinic
);

-- Create indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_clinic_staff_user_id ON clinic_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_clinic_staff_clinic_id ON clinic_staff(clinic_id);

-- Backfill existing staff assignments from sakhi_clinic_users
-- Note: 'role' in sakhi_clinic_users might not match the enum perfectly, so we map or default it.
DO $$ 
BEGIN
    INSERT INTO clinic_staff (user_id, clinic_id, role, is_active)
    SELECT 
        id as user_id, 
        clinic_id, 
        COALESCE(
            CASE 
                WHEN role = 'doctor' THEN 'Doctor'
                WHEN role = 'receptionist' THEN 'Receptionist'
                WHEN role = 'admin' THEN 'Admin'
                WHEN role = 'cro' THEN 'CRO'
                WHEN role = 'nurse' THEN 'Nurse'
                ELSE role 
            END, 
            'Doctor'
        ) as role,
        TRUE as is_active
    FROM sakhi_clinic_users
    WHERE clinic_id IS NOT NULL
    ON CONFLICT (user_id, clinic_id) DO NOTHING;
END $$;
