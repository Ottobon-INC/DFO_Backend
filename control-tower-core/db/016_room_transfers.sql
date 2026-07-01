-- ============================================================
-- Migration 016: Room Transfers Atomic RPC
-- Run this in your Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION atomic_transfer_bed(
    p_clinic_id UUID,
    p_admission_id UUID,
    p_new_bed_id UUID,
    p_new_daily_rate NUMERIC
) RETURNS JSON AS $$
DECLARE
    v_old_assignment_id UUID;
    v_old_bed_id UUID;
    v_new_assignment_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- 1. Find the current assignment and old bed
    SELECT id, bed_id INTO v_old_assignment_id, v_old_bed_id
    FROM sakhi_clinic_bed_assignments
    WHERE admission_id = p_admission_id AND is_current = TRUE
    FOR UPDATE;

    -- 2. Release old assignment and bed (if one existed)
    IF v_old_assignment_id IS NOT NULL THEN
        UPDATE sakhi_clinic_bed_assignments 
        SET is_current = FALSE, released_at = v_now 
        WHERE id = v_old_assignment_id;

        UPDATE sakhi_clinic_beds 
        SET status = 'available' 
        WHERE id = v_old_bed_id;
    END IF;

    -- 3. Create new assignment
    INSERT INTO sakhi_clinic_bed_assignments (admission_id, bed_id, daily_rate_snapshot, is_current, assigned_at)
    VALUES (p_admission_id, p_new_bed_id, p_new_daily_rate, TRUE, v_now)
    RETURNING id INTO v_new_assignment_id;

    -- 4. Update new bed status
    UPDATE sakhi_clinic_beds 
    SET status = 'occupied' 
    WHERE id = p_new_bed_id;

    RETURN json_build_object('success', true, 'old_assignment_id', v_old_assignment_id, 'new_assignment_id', v_new_assignment_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to execute atomic transfer: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;
