-- 028_add_name_to_rooms.sql
ALTER TABLE sakhi_clinic_rooms ADD COLUMN IF NOT EXISTS name VARCHAR(255);
