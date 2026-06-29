-- ============================================================
-- Migration 011: Atomic Nested Onboarding Transaction
-- Creates an RPC function to atomically insert a patient and 
-- link them to an unassigned document.
-- Run this in your Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION link_new_patient_to_document(
    p_clinic_id UUID,
    p_document_id UUID,
    p_patient_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_patient_id UUID;
    v_document_exists BOOLEAN;
    v_query TEXT;
    v_keys TEXT;
    v_vals TEXT;
    v_patient_record RECORD;
BEGIN
    -- 1. Check if the document exists, belongs to the clinic, and is unassigned
    SELECT EXISTS (
        SELECT 1 FROM sakhi_clinic_documents 
        WHERE id = p_document_id 
          AND clinic_id = p_clinic_id 
          AND patient_id IS NULL 
          AND status = 'unassigned'
    ) INTO v_document_exists;
    
    IF NOT v_document_exists THEN
        RAISE EXCEPTION 'Document not found, already assigned, or unauthorized access';
    END IF;

    -- 2. Insert the patient dynamically using the JSON payload
    -- This ensures we only insert provided fields and let Postgres handle default values
    -- We force the clinic_id to match the authenticated context to prevent tenant escape
    p_patient_payload := p_patient_payload || jsonb_build_object('clinic_id', p_clinic_id);

    SELECT string_agg(quote_ident(key), ','), 
           string_agg(quote_nullable(value), ',')
    INTO v_keys, v_vals
    FROM jsonb_each_text(p_patient_payload);

    IF v_keys IS NULL OR v_vals IS NULL THEN
        RAISE EXCEPTION 'Invalid patient payload';
    END IF;

    v_query := format('INSERT INTO sakhi_clinic_patients (%s) VALUES (%s) RETURNING *', v_keys, v_vals);
    EXECUTE v_query INTO v_patient_record;
    v_patient_id := v_patient_record.id;

    -- 3. Update the document to link the new patient
    UPDATE sakhi_clinic_documents 
    SET patient_id = v_patient_id, 
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_document_id AND clinic_id = p_clinic_id;

    -- Return the full patient record
    RETURN to_jsonb(v_patient_record) || jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
    -- Postgres automatically rolls back the transaction on exception
    RAISE EXCEPTION 'Transaction failed: %', SQLERRM;
END;
$$;
