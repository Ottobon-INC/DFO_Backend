-- ============================================================
-- Migration 015: Room Allocation Edge Cases
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. Prevent simultaneous transfers (Patient can only be in one bed at a time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_assignment_per_admission 
ON sakhi_clinic_bed_assignments(admission_id) WHERE is_current = TRUE;

-- 2. Create an atomic RPC for Admission to prevent orphaned records
CREATE OR REPLACE FUNCTION atomic_create_admission(
    p_clinic_id UUID,
    p_patient_id UUID,
    p_admitting_doctor_id UUID,
    p_diagnosis TEXT,
    p_notes TEXT,
    p_bed_id UUID,
    p_daily_rate NUMERIC
) RETURNS JSON AS $$
DECLARE
    v_admission_id UUID;
    v_assignment_id UUID;
BEGIN
    -- Insert Admission
    INSERT INTO sakhi_clinic_admissions (clinic_id, patient_id, admitting_doctor_id, diagnosis, notes, status)
    VALUES (p_clinic_id, p_patient_id, p_admitting_doctor_id, p_diagnosis, p_notes, 'admitted')
    RETURNING id INTO v_admission_id;

    -- Insert Bed Assignment
    INSERT INTO sakhi_clinic_bed_assignments (admission_id, bed_id, daily_rate_snapshot, is_current)
    VALUES (v_admission_id, p_bed_id, p_daily_rate, TRUE)
    RETURNING id INTO v_assignment_id;

    -- Update Bed Status
    UPDATE sakhi_clinic_beds SET status = 'occupied' WHERE id = p_bed_id;

    RETURN json_build_object('admission_id', v_admission_id, 'assignment_id', v_assignment_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to create atomic admission: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;
