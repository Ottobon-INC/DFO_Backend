-- ============================================================
-- Migration 022: Orphan Clinics Cleanup
-- Run this manually in your Supabase SQL Editor.
-- ============================================================

-- Step 1: Review the orphans before you run Step 2.
-- Run this SELECT query to see exactly which clinics will be soft-deleted.
/*
SELECT 
    c.id, 
    c.name, 
    c.created_at,
    (SELECT COUNT(*) FROM sakhi_clinic_users u WHERE u.clinic_id = c.id) as user_count
FROM clinics c
WHERE c.is_active = TRUE
AND (SELECT COUNT(*) FROM sakhi_clinic_users u WHERE u.clinic_id = c.id) = 0;
*/

-- Step 2: Soft delete the orphans (uncomment to execute)
/*
UPDATE clinics
SET is_active = FALSE
WHERE is_active = TRUE
AND (SELECT COUNT(*) FROM sakhi_clinic_users u WHERE u.clinic_id = clinics.id) = 0;
*/

-- (Optional) Step 3: Hard delete later (after 30 days)
/*
DELETE FROM clinics
WHERE is_active = FALSE
AND (SELECT COUNT(*) FROM sakhi_clinic_users u WHERE u.clinic_id = clinics.id) = 0
AND updated_at < NOW() - INTERVAL '30 days';
*/
