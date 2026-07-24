-- 023_convert_lead_rpc.sql

-- 1. Add Unique Constraint to sakhi_clinic_patients to prevent race conditions
ALTER TABLE sakhi_clinic_patients
DROP CONSTRAINT IF EXISTS uq_clinic_patient_mobile;

ALTER TABLE sakhi_clinic_patients
ADD CONSTRAINT uq_clinic_patient_mobile UNIQUE (clinic_id, mobile);

-- 2. Create the RPC function
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
        mobile,
        marital_status,
        gender,
        age,
        emergency_contact_name,
        registration_date,
        status,
        pin_hash
    ) VALUES (
        p_clinic_id,
        (p_patient_data->>'uhid')::VARCHAR,
        p_lead_id,
        (p_patient_data->>'name')::VARCHAR,
        (p_patient_data->>'mobile')::VARCHAR,
        (p_patient_data->>'marital_status')::VARCHAR,
        (p_patient_data->>'gender')::VARCHAR,
        (p_patient_data->>'age')::VARCHAR,
        (p_patient_data->>'emergency_contact_name')::VARCHAR,
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
