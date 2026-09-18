-- 032_doctor_schedules_and_leaves_enhancement.sql
-- Run this in your Supabase / PostgreSQL SQL Editor

-- 1. Ensure extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Enhance sakhi_clinic_doctor_schedules table (Weekly Shift Template)
CREATE TABLE IF NOT EXISTS sakhi_clinic_doctor_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 1=Monday...
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
    slot_capacity INTEGER NOT NULL DEFAULT 1,
    session_name VARCHAR(100) DEFAULT 'General Session',
    room_number VARCHAR(50) DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(doctor_id, day_of_week, start_time)
);

-- Add columns if table already existed without them
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sakhi_clinic_doctor_schedules' AND column_name = 'session_name') THEN
        ALTER TABLE sakhi_clinic_doctor_schedules ADD COLUMN session_name VARCHAR(100) DEFAULT 'General Session';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sakhi_clinic_doctor_schedules' AND column_name = 'room_number') THEN
        ALTER TABLE sakhi_clinic_doctor_schedules ADD COLUMN room_number VARCHAR(50) DEFAULT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_doctor_schedules_doc ON sakhi_clinic_doctor_schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_doctor_schedules_clinic ON sakhi_clinic_doctor_schedules(clinic_id);

-- 3. Enhance sakhi_clinic_availability_slots table (Concrete Daily Slots)
CREATE TABLE IF NOT EXISTS sakhi_clinic_availability_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    slot_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 1,
    booked_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE', 'BOOKED', 'BLOCKED', 'LEAVE'
    block_reason TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(doctor_id, slot_date, start_time)
);

-- Add columns if table already existed without them
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sakhi_clinic_availability_slots' AND column_name = 'status') THEN
        ALTER TABLE sakhi_clinic_availability_slots ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sakhi_clinic_availability_slots' AND column_name = 'block_reason') THEN
        ALTER TABLE sakhi_clinic_availability_slots ADD COLUMN block_reason TEXT DEFAULT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_avail_slots_doc_date ON sakhi_clinic_availability_slots(doctor_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_avail_slots_clinic ON sakhi_clinic_availability_slots(clinic_id);

-- 4. Create sakhi_clinic_doctor_leaves table (Day-Wise Overrides & Leaves)
CREATE TABLE IF NOT EXISTS sakhi_clinic_doctor_leaves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    leave_date DATE NOT NULL,
    leave_type VARCHAR(50) NOT NULL DEFAULT 'Full Day', -- 'Full Day', 'Morning Shift', 'Evening Shift', 'Emergency'
    reason TEXT DEFAULT 'Doctor on Leave',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(doctor_id, leave_date)
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_leaves_doc_date ON sakhi_clinic_doctor_leaves(doctor_id, leave_date);
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_leaves_clinic ON sakhi_clinic_doctor_leaves(clinic_id);

-- Output confirmation
SELECT 'Doctor Schedules & Leaves schema migration completed successfully!' AS status;
