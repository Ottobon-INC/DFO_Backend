-- 030_leads_conversion_and_rls.sql

-- 1. Enable RLS on Leads and Patient Notes
ALTER TABLE sakhi_clinic_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_clinic_patient_notes ENABLE ROW LEVEL SECURITY;

-- 2. Policies for sakhi_clinic_leads
DROP POLICY IF EXISTS "Enable isolation for sakhi_clinic_leads" ON sakhi_clinic_leads;
CREATE POLICY "Enable isolation for sakhi_clinic_leads"
ON sakhi_clinic_leads
FOR ALL
USING (
  clinic_id = (current_setting('request.jwt.claims', true)::json->>'clinic_id')::uuid
  OR 
  (current_setting('request.jwt.claims', true)::json->>'is_super_admin')::boolean = true
);

-- 3. Policies for sakhi_clinic_patient_notes
DROP POLICY IF EXISTS "Enable isolation for sakhi_clinic_patient_notes" ON sakhi_clinic_patient_notes;
CREATE POLICY "Enable isolation for sakhi_clinic_patient_notes"
ON sakhi_clinic_patient_notes
FOR ALL
USING (
  clinic_id = (current_setting('request.jwt.claims', true)::json->>'clinic_id')::uuid
  OR 
  (current_setting('request.jwt.claims', true)::json->>'is_super_admin')::boolean = true
);

-- 4. Update the RPC to accept all patient fields
CREATE OR REPLACE FUNCTION convert_lead_to_patient(
    p_lead_id UUID,
    p_clinic_id UUID,
    p_patient_data JSONB,
    p_clinical_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_patient_id UUID;
    v_lead_status VARCHAR;
BEGIN
    -- Step 1: Check lead status and existence (Lock row to prevent concurrent updates)
    SELECT status INTO v_lead_status
    FROM sakhi_clinic_leads
    WHERE id = p_lead_id AND clinic_id = p_clinic_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lead not found';
    END IF;

    IF v_lead_status = 'Converted' THEN
        RAISE EXCEPTION 'Lead is already converted';
    END IF;

    -- Step 2: Insert into sakhi_clinic_patients
    -- We extract values from the JSONB object
    INSERT INTO sakhi_clinic_patients (
        clinic_id,
        uhid,
        lead_id,
        name,
        relation,
        marital_status,
        gender,
        dob,
        age,
        blood_group,
        aadhar,
        mobile,
        email,
        house,
        street,
        area,
        city,
        district,
        state,
        postal_code,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relation,
        assigned_doctor_id,
        referral_doctor,
        hospital_address,
        registration_date,
        status,
        pin_hash
    ) VALUES (
        p_clinic_id,
        (p_patient_data->>'uhid')::VARCHAR,
        p_lead_id,
        (p_patient_data->>'name')::VARCHAR,
        (p_patient_data->>'relation')::VARCHAR,
        (p_patient_data->>'marital_status')::VARCHAR,
        (p_patient_data->>'gender')::VARCHAR,
        (p_patient_data->>'dob')::VARCHAR,
        (p_patient_data->>'age')::VARCHAR,
        (p_patient_data->>'blood_group')::VARCHAR,
        (p_patient_data->>'aadhar')::VARCHAR,
        (p_patient_data->>'mobile')::VARCHAR,
        (p_patient_data->>'email')::VARCHAR,
        (p_patient_data->>'house')::VARCHAR,
        (p_patient_data->>'street')::VARCHAR,
        (p_patient_data->>'area')::VARCHAR,
        (p_patient_data->>'city')::VARCHAR,
        (p_patient_data->>'district')::VARCHAR,
        (p_patient_data->>'state')::VARCHAR,
        (p_patient_data->>'postal_code')::VARCHAR,
        (p_patient_data->>'emergency_contact_name')::VARCHAR,
        (p_patient_data->>'emergency_contact_phone')::VARCHAR,
        (p_patient_data->>'emergency_contact_relation')::VARCHAR,
        NULLIF((p_patient_data->>'assigned_doctor_id'), '')::UUID,
        (p_patient_data->>'referral_doctor')::VARCHAR,
        (p_patient_data->>'hospital_address')::VARCHAR,
        (p_patient_data->>'registration_date')::DATE,
        (p_patient_data->>'status')::VARCHAR,
        (p_patient_data->>'pin_hash')::VARCHAR
    )
    RETURNING id INTO v_patient_id;

    -- Step 3: Insert initial clinical note if provided
    IF p_clinical_note IS NOT NULL AND p_clinical_note <> '' THEN
        INSERT INTO sakhi_clinic_patient_notes (
            clinic_id,
            patient_id,
            note
        ) VALUES (
            p_clinic_id,
            v_patient_id,
            'Initial Inquiry/Problem (from Lead): ' || p_clinical_note
        );
    END IF;

    -- Step 4: Update lead status
    UPDATE sakhi_clinic_leads
    SET status = 'Converted'
    WHERE id = p_lead_id AND clinic_id = p_clinic_id;

    -- Return success and the new patient ID
    RETURN json_build_object(
        'success', true,
        'patient_id', v_patient_id
    );
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Patient with this mobile already exists';
END;
$$;
