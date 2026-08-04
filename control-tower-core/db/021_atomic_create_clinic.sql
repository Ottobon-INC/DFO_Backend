-- ============================================================
-- Migration 021: Atomic Clinic Creation
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. Add idempotency key to clinics
ALTER TABLE clinics 
ADD COLUMN IF NOT EXISTS creation_request_id UUID UNIQUE;

-- 2. Create the atomic RPC
CREATE OR REPLACE FUNCTION atomic_create_clinic(
    p_request_id UUID,
    p_clinic_name TEXT,
    p_owner_name TEXT,
    p_owner_email TEXT,
    p_owner_role TEXT,
    p_password_hash TEXT,
    p_super_admin_id UUID
) RETURNS JSON AS $$
DECLARE
    v_clinic_id UUID;
    v_admin_id UUID;
    v_is_super_admin BOOLEAN;
BEGIN
    -- 1. Authorization: Verify caller is a super admin
    SELECT EXISTS (
        SELECT 1 FROM super_admins WHERE id = p_super_admin_id
    ) INTO v_is_super_admin;
    
    IF NOT v_is_super_admin THEN
        RETURN json_build_object('status', 'error', 'code', 'UNAUTHORIZED', 'message', 'Caller is not a super admin');
    END IF;

    -- 2. Idempotency: Check if this request_id was already processed
    IF p_request_id IS NOT NULL THEN
        SELECT id INTO v_clinic_id FROM clinics WHERE creation_request_id = p_request_id;
        IF v_clinic_id IS NOT NULL THEN
            -- If we already created it, fetch the admin ID to return the exact same response
            SELECT id INTO v_admin_id FROM sakhi_clinic_users WHERE clinic_id = v_clinic_id AND is_clinic_admin = TRUE LIMIT 1;
            RETURN json_build_object('status', 'success', 'clinic_id', v_clinic_id, 'admin_id', v_admin_id, 'idempotent', true);
        END IF;
    END IF;

    -- 3. Pre-check email for a better error message (constraint handles race conditions)
    IF EXISTS (SELECT 1 FROM sakhi_clinic_users WHERE email = p_owner_email) THEN
        RETURN json_build_object('status', 'error', 'code', 'EMAIL_ALREADY_REGISTERED', 'conflict_email', p_owner_email);
    END IF;

    -- 4. Insert Clinic
    INSERT INTO clinics (name, creation_request_id)
    VALUES (p_clinic_name, p_request_id)
    RETURNING id INTO v_clinic_id;

    -- 5. Insert Admin User
    -- This relies on the UNIQUE (email, domain) or UNIQUE (email) constraint on sakhi_clinic_users.
    -- If another transaction inserts this email right before us, this statement will throw a unique violation (23505),
    -- which will be caught by the EXCEPTION block, rolling back the clinic insert automatically.
    INSERT INTO sakhi_clinic_users (first_name, email, password_hash, role, clinic_id, is_clinic_admin, is_super_admin)
    VALUES (p_owner_name, p_owner_email, p_password_hash, p_owner_role, v_clinic_id, TRUE, FALSE)
    RETURNING id INTO v_admin_id;

    RETURN json_build_object('status', 'success', 'clinic_id', v_clinic_id, 'admin_id', v_admin_id, 'idempotent', false);

EXCEPTION
    WHEN unique_violation THEN
        -- Standard 23505 unique constraint violation (likely the email constraint on sakhi_clinic_users)
        RETURN json_build_object('status', 'error', 'code', 'EMAIL_ALREADY_REGISTERED', 'conflict_email', p_owner_email);
    WHEN OTHERS THEN
        RETURN json_build_object('status', 'error', 'code', 'INTERNAL_SERVER_ERROR', 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql;
