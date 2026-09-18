-- 029_add_tier_to_categories.sql
ALTER TABLE sakhi_clinic_room_categories ADD COLUMN IF NOT EXISTS tier VARCHAR(255);
