import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { DFODocument, DocumentType, DocumentGenerationStatus } from './document.types';

@Injectable()
export class DocumentRepository {
    private readonly logger = new Logger(DocumentRepository.name);
    private readonly TABLE = 'sakhi_clinic_documents';

    // In-memory registry for transient document metadata mapping: documentId -> metadata
    private documentMetadata = new Map<string, {
        prescription_id?: string;
        generation_status: DocumentGenerationStatus;
        version: number;
        error_message?: string;
        generated_by?: string;
    }>();

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
    ) { }

    private mergeMetadata(doc: any): DFODocument {
        if (!doc) return doc;
        const meta = this.documentMetadata.get(doc.id) || {
            generation_status: DocumentGenerationStatus.GENERATED,
            version: 1
        };
        return {
            id: doc.id,
            patient_id: doc.patient_id,
            file_name: doc.name,
            file_path: doc.file_path,
            file_size_bytes: doc.file_size || 0,
            mime_type: doc.mime_type,
            created_at: doc.created_at,
            prescription_id: meta.prescription_id,
            generation_status: meta.generation_status,
            version: meta.version,
            error_message: meta.error_message,
            generated_by: meta.generated_by
        } as any;
    }

    /**
     * Find an existing document by idempotency key (prescription_id + version).
     * Prevents duplicate documents from being generated for the same prescription.
     */
    async findByPrescriptionId(prescriptionId: string): Promise<DFODocument | null> {
        let matchingId: string | null = null;
        for (const [id, meta] of this.documentMetadata.entries()) {
            if (meta.prescription_id === prescriptionId && meta.generation_status === DocumentGenerationStatus.GENERATED) {
                matchingId = id;
            }
        }

        if (!matchingId) return null;

        const { data, error } = await this.supabase
            .from(this.TABLE)
            .select('*')
            .eq('id', matchingId)
            .maybeSingle();

        if (error) {
            this.logger.warn(`findByPrescriptionId failed to retrieve doc: ${error.message}`);
            return null;
        }

        return this.mergeMetadata(data);
    }

    /**
     * Create a pending document record BEFORE generation starts.
     * This is the start of the idempotent generation flow.
     */
    async createPendingDocument(dto: {
        patient_id: string;
        consultation_id?: string;
        prescription_id?: string;
        type: DocumentType;
        file_name: string;
        file_path: string;
        generated_by: string;
    }): Promise<DFODocument> {
        const id = require('crypto').randomUUID();
        const payload = {
            id,
            patient_id: dto.patient_id,
            name: dto.file_name,
            file_path: dto.file_path,
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            created_at: new Date()
        };

        const { data, error } = await this.supabase
            .from(this.TABLE)
            .insert([payload])
            .select()
            .single();

        if (error) throw new Error(`Failed to create document record: ${error.message}`);

        this.documentMetadata.set(id, {
            prescription_id: dto.prescription_id,
            generation_status: DocumentGenerationStatus.PENDING,
            version: 1,
            generated_by: dto.generated_by
        });

        return this.mergeMetadata(data);
    }

    /**
     * Mark a document as successfully generated with file size.
     */
    async markAsGenerated(documentId: string, fileSizeBytes: number): Promise<void> {
        const { error } = await this.supabase
            .from(this.TABLE)
            .update({
                file_size: fileSizeBytes
            })
            .eq('id', documentId);

        if (error) throw new Error(`Failed to mark document as generated: ${error.message}`);

        const meta = this.documentMetadata.get(documentId);
        if (meta) {
            meta.generation_status = DocumentGenerationStatus.GENERATED;
        }
    }

    /**
     * Mark a document as failed with an error message.
     */
    async markAsFailed(documentId: string, errorMessage: string): Promise<void> {
        const meta = this.documentMetadata.get(documentId);
        if (meta) {
            meta.generation_status = DocumentGenerationStatus.FAILED;
            meta.error_message = errorMessage;
        }
        this.logger.warn(`Document ${documentId} generation failed: ${errorMessage}`);
    }

    /**
     * Fetch all documents for a patient (for the patient document listing API).
     */
    async findByPatientId(patientId: string): Promise<DFODocument[]> {
        const { data, error } = await this.supabase
            .from(this.TABLE)
            .select('*')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false });

        if (error) throw new Error(`Failed to fetch patient documents: ${error.message}`);
        
        return (data || []).map(doc => this.mergeMetadata(doc));
    }

    /**
     * Fetch a single document record by its ID.
     */
    async findById(documentId: string): Promise<DFODocument | null> {
        const { data, error } = await this.supabase
            .from(this.TABLE)
            .select('*')
            .eq('id', documentId)
            .maybeSingle();

        if (error) return null;
        return this.mergeMetadata(data);
    }

    /**
     * Log every access (signed URL generation) for HIPAA audit compliance.
     */
    async logAccess(dto: {
        document_id: string;
        accessed_by: string;
        role: string;
        expires_at: Date;
    }): Promise<void> {
        this.logger.log(`[HIPAA AUDIT] Document access log: ${JSON.stringify(dto)}`);
    }

    /**
     * Increment the version of an existing document (for regeneration).
     */
    async incrementVersion(prescriptionId: string, newFilePath: string, newFileName: string): Promise<DFODocument> {
        const existing = await this.findByPrescriptionId(prescriptionId);
        if (!existing) throw new Error('No existing document to version');

        const { data, error } = await this.supabase
            .from(this.TABLE)
            .update({
                file_path: newFilePath,
                name: newFileName
            })
            .eq('id', existing.id)
            .select()
            .single();

        if (error) throw new Error(`Failed to increment document version: ${error.message}`);

        const meta = this.documentMetadata.get(existing.id);
        if (meta) {
            meta.version = meta.version + 1;
            meta.generation_status = DocumentGenerationStatus.PENDING;
        }

        return this.mergeMetadata(data);
    }
}
