-- 025_doctor_availability_and_capacity.sql

-- 1. Create the doctor schedules table (renamed from dfo_ to sakhi_clinic_)
CREATE TABLE IF NOT EXISTS sakhi_clinic_doctor_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 1=Monday...
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
    slot_capacity INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(doctor_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_doctor_schedules_doctor ON sakhi_clinic_doctor_schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_doctor_schedules_clinic ON sakhi_clinic_doctor_schedules(clinic_id);

-- 2. Create the availability slots table
CREATE TABLE IF NOT EXISTS sakhi_clinic_availability_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    slot_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 1,
    booked_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(doctor_id, slot_date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_availability_slots_doctor_date ON sakhi_clinic_availability_slots(doctor_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_sakhi_clinic_availability_slots_clinic ON sakhi_clinic_availability_slots(clinic_id);
