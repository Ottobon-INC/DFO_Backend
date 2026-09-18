-- ============================================================
-- Migration 017: Deep Edge Cases (Capacity Triggers & Constraints)
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. Prevent Double Admission (Patient can only have one active admission at a time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_admission_per_patient 
ON sakhi_clinic_admissions(patient_id) WHERE status = 'admitted';

-- 2. Database Engine-Level Room Capacity Guard
CREATE OR REPLACE FUNCTION check_room_capacity()
RETURNS TRIGGER AS $$
DECLARE
    v_capacity INTEGER;
    v_current_count INTEGER;
BEGIN
    -- Get the physical capacity of the room
    SELECT capacity INTO v_capacity
    FROM sakhi_clinic_rooms
    WHERE id = NEW.room_id;

    -- Get the current number of beds in this room
    SELECT COUNT(*) INTO v_current_count
    FROM sakhi_clinic_beds
    WHERE room_id = NEW.room_id;

    -- Guard against exceeding capacity
    IF v_current_count >= v_capacity THEN
        RAISE EXCEPTION 'Room capacity exceeded. Cannot add more beds to this room.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists to allow re-running
DROP TRIGGER IF EXISTS trg_check_room_capacity ON sakhi_clinic_beds;

-- Attach the trigger to fire BEFORE INSERT on beds
CREATE TRIGGER trg_check_room_capacity
BEFORE INSERT ON sakhi_clinic_beds
FOR EACH ROW
EXECUTE FUNCTION check_room_capacity();
