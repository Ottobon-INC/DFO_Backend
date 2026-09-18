-- Add failed_attempts and locked_until to sakhi_clinic_users
ALTER TABLE sakhi_clinic_users 
ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Add failed_attempts and locked_until to super_admins
ALTER TABLE super_admins 
ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
