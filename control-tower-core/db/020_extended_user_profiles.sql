-- ============================================================
-- Migration 020: Extended User Profiles
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. Add new columns
ALTER TABLE sakhi_clinic_users
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS middle_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT,
ADD COLUMN IF NOT EXISTS hospital_id TEXT,
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS department TEXT,
ADD COLUMN IF NOT EXISTS designation TEXT,
ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

-- 2. Data Migration: Split existing 'name' into first_name and last_name
DO $$
DECLARE
    user_record RECORD;
    name_parts TEXT[];
    f_name TEXT;
    l_name TEXT;
BEGIN
    FOR user_record IN SELECT id, name FROM sakhi_clinic_users WHERE name IS NOT NULL
    LOOP
        -- Split by space
        name_parts := string_to_array(trim(user_record.name), ' ');
        
        IF array_length(name_parts, 1) = 1 THEN
            f_name := name_parts[1];
            l_name := '';
        ELSE
            f_name := name_parts[1];
            -- Join the rest as last name
            l_name := array_to_string(name_parts[2:array_length(name_parts, 1)], ' ');
        END IF;

        UPDATE sakhi_clinic_users 
        SET first_name = f_name, last_name = l_name
        WHERE id = user_record.id;
    END LOOP;
END $$;

-- 3. Drop the old 'name' column safely
ALTER TABLE sakhi_clinic_users DROP COLUMN IF EXISTS name;

-- 4. Make first_name NOT NULL since it's now the primary identifier
-- Ensure any remaining NULLs get a fallback before applying constraint
UPDATE sakhi_clinic_users SET first_name = 'Unknown' WHERE first_name IS NULL;
ALTER TABLE sakhi_clinic_users ALTER COLUMN first_name SET NOT NULL;
