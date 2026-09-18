-- Phase 3: Enable Row Level Security (RLS) for Clinic Isolation

-- Enable RLS on core tables
ALTER TABLE sakhi_clinic_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_clinic_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_clinic_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_clinic_beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_clinic_room_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_clinic_admissions ENABLE ROW LEVEL SECURITY;

-- Policy for Clinic Users
-- A user can only see/modify users that belong to their own clinic
CREATE POLICY "Clinic Users Isolation" 
ON sakhi_clinic_users
FOR ALL
USING (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
)
WITH CHECK (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
);

-- Policy for Clinic Patients
CREATE POLICY "Clinic Patients Isolation" 
ON sakhi_clinic_patients
FOR ALL
USING (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
)
WITH CHECK (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
);

-- Policy for Clinic Rooms
CREATE POLICY "Clinic Rooms Isolation" 
ON sakhi_clinic_rooms
FOR ALL
USING (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
)
WITH CHECK (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
);

-- Policy for Clinic Beds (Beds belong to a room, which belongs to a clinic)
CREATE POLICY "Clinic Beds Isolation" 
ON sakhi_clinic_beds
FOR ALL
USING (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  EXISTS (SELECT 1 FROM sakhi_clinic_rooms r WHERE r.id = sakhi_clinic_beds.room_id AND r.clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
)
WITH CHECK (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  EXISTS (SELECT 1 FROM sakhi_clinic_rooms r WHERE r.id = sakhi_clinic_beds.room_id AND r.clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
);

-- Policy for Clinic Room Categories
CREATE POLICY "Clinic Room Categories Isolation" 
ON sakhi_clinic_room_categories
FOR ALL
USING (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
)
WITH CHECK (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
);

-- Policy for Clinic Admissions
CREATE POLICY "Clinic Admissions Isolation" 
ON sakhi_clinic_admissions
FOR ALL
USING (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
)
WITH CHECK (
  (auth.jwt() ->> 'is_super_admin')::boolean = true OR 
  clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
);
