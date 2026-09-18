-- ============================================================
-- Migration 014: Room Allocation Module (Multi-Tenant)
-- Run this in your Supabase SQL Editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. sakhi_clinic_room_categories
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_clinic_room_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sakhi_clinic_room_categories_name_clinic UNIQUE (clinic_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_room_categories_clinic_active ON sakhi_clinic_room_categories(clinic_id, is_active);

-- ============================================================
-- 2. sakhi_clinic_rooms
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_clinic_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES sakhi_clinic_room_categories(id) ON DELETE RESTRICT,
    room_number TEXT NOT NULL,
    floor TEXT,
    capacity INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sakhi_clinic_rooms_number_clinic UNIQUE (clinic_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_rooms_clinic_category ON sakhi_clinic_rooms(clinic_id, category_id);

-- ============================================================
-- 3. sakhi_clinic_beds
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_clinic_beds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES sakhi_clinic_rooms(id) ON DELETE CASCADE,
    bed_identifier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'reserved')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sakhi_clinic_beds_identifier_room UNIQUE (room_id, bed_identifier)
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_beds_room_id_status ON sakhi_clinic_beds(room_id, status);

-- ============================================================
-- 4. sakhi_clinic_admissions
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_clinic_admissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES sakhi_clinic_patients(id) ON DELETE RESTRICT,
    admitting_doctor_id UUID REFERENCES sakhi_clinic_users(id) ON DELETE SET NULL,
    admission_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    discharge_date TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted', 'discharged', 'cancelled')),
    diagnosis TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_admissions_clinic_status ON sakhi_clinic_admissions(clinic_id, status);

-- ============================================================
-- 5. sakhi_clinic_bed_assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_clinic_bed_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admission_id UUID NOT NULL REFERENCES sakhi_clinic_admissions(id) ON DELETE CASCADE,
    bed_id UUID NOT NULL REFERENCES sakhi_clinic_beds(id) ON DELETE RESTRICT,
    daily_rate_snapshot NUMERIC(10,2) NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_bed_assignments_admission_current ON sakhi_clinic_bed_assignments(admission_id, is_current);
CREATE INDEX idx_sakhi_clinic_bed_assignments_bed_current ON sakhi_clinic_bed_assignments(bed_id, is_current);

-- Prevent double booking a bed: Only one current assignment per bed is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_assignment_per_bed 
ON sakhi_clinic_bed_assignments(bed_id) WHERE is_current = TRUE;
