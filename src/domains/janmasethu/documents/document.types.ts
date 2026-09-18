// ============================================================
// document.types.ts — All Type Definitions for Document System
// ============================================================

export enum DocumentType {
    PRESCRIPTION = 'prescription',
    REPORT = 'report',
    DISCHARGE_SUMMARY = 'discharge_summary',
    CONSULTATION_NOTE = 'consultation_note',
}

export enum DocumentGenerationStatus {
    PENDING = 'pending',
    GENERATED = 'generated',
    FAILED = 'failed',
}

export interface DFODocument {
    id: string;
    patient_id: string;
    consultation_id?: string;
    prescription_id?: string;
    type: DocumentType;
    file_path: string;            // Storage path — NOT a URL
    file_name: string;
    file_size_bytes?: number;
    mime_type: string;
    version: number;
    generated_by: string;
    generation_status: DocumentGenerationStatus;
    error_message?: string;
    created_at: Date;
    updated_at: Date;
}

export interface DocumentAccessLog {
    id: string;
    document_id: string;
    accessed_by: string;
    role: string;
    expires_at: Date;
    created_at: Date;
}

// DTO for queuing a document generation job
export interface GenerateDocumentJobPayload {
    prescription_id: string;
    consultation_id: string;
    patient_id: string;
    clinic_id: string;
    doctor_id: string;
    type: DocumentType;
    generated_by: string;
    clinical_notes?: string;
    idempotency_key: string;      // Prevents duplicate doc generation for same prescription
}

// Internal clinical data shape fed into the document template
export interface PrescriptionDocumentData {
    clinic: {
        name: string;
        address: string;
        phone: string;
        logo?: string;
    };
    doctor: {
        id: string;
        full_name: string;
        specialization: string[];
    };
    patient: {
        id: string;
        full_name: string;
        age?: number;
        phone_number: string;
        journey_stage: string;
    };
    prescription: {
        id: string;
        medication_name: string;
        dosage: string;
        frequency: string;
        duration_days: number;
        special_instructions?: string;
        created_at: Date;
    };
    consultation: {
        id: string;
        clinical_notes?: string;
        diagnosis_tags?: string[];
        start_time: Date;
    };
}
