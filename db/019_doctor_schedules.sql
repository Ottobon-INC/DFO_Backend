-- 019_doctor_schedules.sql
CREATE TABLE IF NOT EXISTS dfo_doctor_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 1=Monday...
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(doctor_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_dfo_doctor_schedules_doctor ON dfo_doctor_schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_dfo_doctor_schedules_clinic ON dfo_doctor_schedules(clinic_id);

-- Add a trigger to auto-update updated_at if it doesn't exist
CREATE OR REPLACE FUNCTION update_dfo_doctor_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dfo_doctor_schedules_updated_at ON dfo_doctor_schedules;
CREATE TRIGGER trg_dfo_doctor_schedules_updated_at
BEFORE UPDATE ON dfo_doctor_schedules
FOR EACH ROW
EXECUTE FUNCTION update_dfo_doctor_schedules_updated_at();
