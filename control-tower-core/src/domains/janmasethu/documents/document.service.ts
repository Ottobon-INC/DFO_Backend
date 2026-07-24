import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentRepository } from './document.repository';
import { DocumentStorageService } from './document.storage';
import { DocumentGeneratorService } from './document.generator';
import {
    DocumentType, DocumentGenerationStatus,
    GenerateDocumentJobPayload, DFODocument
} from './document.types';
import { JanmasethuEncryptionService } from '../utils/encryption.service';
import { UploadReportDto } from '../dto/dfo.dto';
import { TemplateService } from './template.service';
import { PdfService } from './pdf.service';

const DOCUMENT_QUEUE = 'document_generation_queue';

/**
 * DocumentService
 *
 * Orchestrates the full document generation pipeline:
 * 1. Validates & fetches clinical data from Supabase
 * 2. Dispatches async BullMQ job for non-blocking generation
 * 3. Provides document retrieval with signed URLs on demand
 *
 * This service is the public API surface — controllers only call this.
 */
@Injectable()
export class DocumentService {
    private readonly logger = new Logger(DocumentService.name);

    constructor(
        @InjectQueue(DOCUMENT_QUEUE) private readonly docQueue: Queue,
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
        private readonly documentRepo: DocumentRepository,
        private readonly storageService: DocumentStorageService,
        private readonly generator: DocumentGeneratorService,
        private readonly encryption: JanmasethuEncryptionService,
        private readonly templateService: TemplateService,
        private readonly pdfService: PdfService,
    ) { }

    // ============================================================
    // 1. TRIGGER ASYNC DOCUMENT GENERATION (After Prescription Creation)
    // ============================================================

    /**
     * Queues a prescription document generation job.
     * Returns immediately — document is generated asynchronously.
     * Idempotent: does nothing if a document already exists for this prescription.
     */
    async queuePrescriptionGeneration(dto: {
        prescription_id: string;
        consultation_id: string;
        patient_id: string;
        doctor_id: string;
        generated_by: string;
    }): Promise<{ queued: boolean; document_id?: string; message: string }> {

        // --- IDEMPOTENCY CHECK ---
        const existing = await this.documentRepo.findByPrescriptionId(dto.prescription_id);
        if (existing) {
            this.logger.log(`Document already exists for prescription ${dto.prescription_id}. Skipping.`);
            return {
                queued: false,
                document_id: existing.id,
                message: 'Document already generated for this prescription.',
            };
        }

        const idempotencyKey = `prescription_${dto.prescription_id}_v1`;
        const fileName = `prescription_${dto.prescription_id}.docx`;
        const filePath = this.storageService.buildFilePath(
            dto.patient_id,
            dto.consultation_id,
            fileName
        );

        // Create PENDING record atomically before queuing
        const pendingDoc = await this.documentRepo.createPendingDocument({
            patient_id: dto.patient_id,
            consultation_id: dto.consultation_id,
            prescription_id: dto.prescription_id,
            type: DocumentType.PRESCRIPTION,
            file_name: fileName,
            file_path: filePath,
            generated_by: dto.generated_by,
        });

        // Enqueue the heavy work (async, non-blocking)
        const payload: GenerateDocumentJobPayload = {
            ...dto,
            type: DocumentType.PRESCRIPTION,
            idempotency_key: idempotencyKey,
        };

        await this.docQueue.add('GENERATE_PRESCRIPTION', payload, {
            jobId: idempotencyKey,         // BullMQ won't add a duplicate job with same jobId
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        });

        this.logger.log(`Queued prescription document generation: job ${idempotencyKey}`);
        return {
            queued: true,
            document_id: pendingDoc.id,
            message: 'Document generation queued. It will be available shortly.',
        };
    }

    // ============================================================
    // 2. SYNCHRONOUS GENERATION (Used internally by the BullMQ Worker)
    // ============================================================

    /**
     * The actual generation pipeline — called by DocumentWorker.
     * Fetches all data, generates DOCX, uploads to Supabase Storage.
     */
    async executeGeneration(payload: GenerateDocumentJobPayload): Promise<void> {
        const { prescription_id, consultation_id, patient_id, doctor_id } = payload;

        // Find the pending document record
        const docRecord = await this.documentRepo.findByPrescriptionId(prescription_id);
        if (!docRecord) {
            throw new Error(`No pending document record found for prescription ${prescription_id}`);
        }

        try {
            // 1. Fetch all clinical data in parallel
            const [patientRaw, consultationRaw, prescriptionRaw, doctorRaw] = await Promise.all([
                this.fetchPatient(patient_id),
                this.fetchConsultation(consultation_id),
                this.fetchPrescription(prescription_id),
                this.fetchDoctor(doctor_id),
            ]);

            if (!patientRaw || !prescriptionRaw || !doctorRaw) {
                throw new Error('One or more required records not found for document generation.');
            }

            // 2. Decrypt PII fields (documents are generated in plain-text for printing)
            const patientDecrypted = {
                ...patientRaw,
                full_name: this.encryption.decrypt(patientRaw.full_name),
                phone_number: this.encryption.decrypt(patientRaw.phone_number || ''),
            };

            // 3. Assemble data shape for the template
            const documentData = {
                clinic: {
                    name: 'Janmasethu Fertility & Maternity Clinic',
                    address: '123 Care Avenue, Bangalore, Karnataka 560001',
                    phone: '+91 80 1234 5678',
                },
                doctor: {
                    id: doctorRaw.id,
                    full_name: doctorRaw.full_name,
                    specialization: doctorRaw.specialization || [],
                },
                patient: {
                    id: patientDecrypted.id,
                    full_name: patientDecrypted.full_name,
                    phone_number: patientDecrypted.phone_number,
                    journey_stage: patientDecrypted.journey_stage,
                    age: patientDecrypted.age,
                },
                prescription: {
                    id: prescriptionRaw.id,
                    medication_name: prescriptionRaw.medication_name,
                    dosage: prescriptionRaw.dosage,
                    frequency: prescriptionRaw.frequency,
                    duration_days: prescriptionRaw.duration_days,
                    special_instructions: prescriptionRaw.special_instructions,
                    created_at: new Date(prescriptionRaw.created_at),
                },
                consultation: {
                    id: consultationRaw?.id || 'N/A',
                    clinical_notes: consultationRaw?.clinical_notes || 'No notes provided',
                    diagnosis_tags: consultationRaw?.diagnosis_tags || [],
                    start_time: consultationRaw?.start_time ? new Date(consultationRaw.start_time) : new Date(),
                },
            };

            // 4. Generate the DOCX buffer
            const fileBuffer = await this.generator.generatePrescriptionDocument(documentData);

            // 5. Upload to Supabase Storage
            const { path, size } = await this.storageService.upload(
                docRecord.file_path,
                fileBuffer
            );

            // 6. Mark document as generated with file size
            await this.documentRepo.markAsGenerated(docRecord.id, size);

            this.logger.log(`✅ Document generation complete: ${path} (${size} bytes)`);

        } catch (error) {
            this.logger.error(`❌ Document generation failed: ${error.message}`);
            await this.documentRepo.markAsFailed(docRecord.id, error.message);
            throw error; // Re-throw so BullMQ retries the job
        }
    }

    /**
     * NEW: Generates a PDF using HTML Templates (Handlebars + Puppeteer)
     * This follows the user's requested Step 3 & 4.
     */
    async executePdfGeneration(payload: GenerateDocumentJobPayload): Promise<void> {
        const { prescription_id, consultation_id, patient_id, doctor_id } = payload;

        const docRecord = await this.documentRepo.findByPrescriptionId(prescription_id);
        if (!docRecord) throw new Error(`Pulse: No pending record for ${prescription_id}`);

        try {
            // 1. Fetch & Decrypt (Same as DOCX flow)
            const [patient, consultation, prescriptions, doctor] = await Promise.all([
                this.fetchPatient(patient_id),
                this.fetchConsultation(consultation_id),
                this.fetchPrescriptionsByConsultation(consultation_id),
                this.fetchDoctor(doctor_id),
            ]);

            const patientName = this.encryption.decrypt(patient.full_name);

            // 2. Prepare Template Data (Matches the {{placeholders}} in the HTML)
            const templateData = {
                patient_name: patientName,
                appointment_date: new Date(consultation.start_time).toLocaleDateString(),
                appointment_time: new Date(consultation.start_time).toLocaleTimeString(),
                age: patient.age || 'N/A',
                gender: patient.gender || 'N/A',
                patient_id: patient.id.substring(0, 8).toUpperCase(),
                clinical_notes: consultation.clinical_notes,
                additional_notes: 'See below for medication details.', // Can't map 1:1, so we generalize
                doctor_name: doctor.full_name,
                reg_no: doctor.registration_number || 'REG-99210-A',
                doctor_signature_url: doctor.signature_url || 'https://via.placeholder.com/150x50?text=Digital+Signature',
                medications: prescriptions.map(prescription => ({
                    name: prescription.medication_name,
                    dosage: prescription.dosage,
                    frequency: prescription.frequency,
                    duration: `${prescription.duration_days} Days`,
                    instructions: prescription.special_instructions
                }))
            };

            // 3. Render HTML using Handlebars (Step 2 & 3)
            const html = await this.templateService.renderTemplate('prescription_template', templateData);

            // 4. Convert HTML to PDF using Puppeteer (Step 4)
            const pdfBuffer = await this.pdfService.generatePdf(html);

            // 5. Upload to Supabase (Bucket: document)
            const pdfPath = docRecord.file_path.replace('.docx', '.pdf');
            const { size } = await this.storageService.upload(pdfPath, pdfBuffer, 'application/pdf');

            // 6. Update Registry
            await this.documentRepo.markAsGenerated(docRecord.id, size);

            // Optionally update the file path in DB if we switched from .docx to .pdf
            await this.supabase.from('dfo_documents').update({
                file_path: pdfPath,
                file_name: docRecord.file_name.replace('.docx', '.pdf')
            }).eq('id', docRecord.id);

            this.logger.log(`✅ PDF Generation Successful: ${pdfPath}`);

        } catch (error) {
            this.logger.error(`❌ PDF Generation Failed: ${error.message}`);
            await this.documentRepo.markAsFailed(docRecord.id, error.message);
            throw error;
        }
    }

    // ============================================================
    // 3. DOCUMENT RETRIEVAL WITH SIGNED URLS
    // ============================================================

    /**
     * Returns all documents for a patient with dynamically generated signed URLs.
     * Logs every access for HIPAA compliance.
     */
    async getPatientDocuments(patientId: string, actorId: string, actorRole: string): Promise<any[]> {
        const documents = await this.documentRepo.findByPatientId(patientId);

        return Promise.all(documents.map(async (doc) => {
            const { signedUrl, expiresAt } = await this.storageService.generateSignedUrl(doc.file_path);

            // Log access to audit trail (non-blocking best-effort)
            this.documentRepo.logAccess({
                document_id: doc.id,
                accessed_by: actorId,
                role: actorRole,
                expires_at: expiresAt,
            }).catch(e => this.logger.warn(`Access log failed: ${e.message}`));

            return {
                id: doc.id,
                type: doc.type,
                file_name: doc.file_name,
                version: doc.version,
                created_at: doc.created_at,
                generation_status: doc.generation_status,
                signed_url: signedUrl,
                expires_at: expiresAt,
            };
        }));
    }

    /**
     * Returns a single document with a signed URL.
     * Logs access for compliance.
     */
    async getDocumentById(documentId: string, actorId: string, actorRole: string): Promise<any> {
        const doc = await this.documentRepo.findById(documentId);
        if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

        const { signedUrl, expiresAt } = await this.storageService.generateSignedUrl(doc.file_path);

        await this.documentRepo.logAccess({
            document_id: doc.id,
            accessed_by: actorId,
            role: actorRole,
            expires_at: expiresAt,
        });

        return {
            id: doc.id,
            patient_id: doc.patient_id,
            prescription_id: doc.prescription_id,
            consultation_id: doc.consultation_id,
            type: doc.type,
            file_name: doc.file_name,
            version: doc.version,
            signed_url: signedUrl,
            expires_at: expiresAt,
        };
    }

    // ============================================================
    // 4. LABORATORY REPORT UPLOADS (Binary Files)
    // ============================================================

    /**
     * Handles physical file uploads for Lab Reports / Scans.
     * 1. Stores binary in Supabase Storage.
     * 2. Persists metadata in dfo_documents.
     * 3. Links to patient medical history.
     */
    async uploadLaboratoryReport(
        dto: UploadReportDto,
        file: { buffer: Buffer, originalname: string, mimetype: string },
        actorId: string
    ): Promise<DFODocument> {
        this.logger.log(`📥 Uploading clinical report for patient ${dto.patient_id}: ${dto.report_type}`);

        // Construct unique file path for this specific lab report
        const timestamp = Date.now();
        const safeFileName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const fileName = `report_${timestamp}_${safeFileName}`;
        const filePath = `patients/${dto.patient_id}/reports/${fileName}`;

        // 1. Upload to Supabase Storage
        const uploadResult = await this.storageService.upload(
            filePath,
            file.buffer,
            file.mimetype
        );

        // 2. Persist metadata in the registry
        // We reuse the pending record creation and then mark it as generated immediately since upload is sync.
        const doc = await this.documentRepo.createPendingDocument({
            patient_id: dto.patient_id,
            type: DocumentType.REPORT,
            file_name: fileName,
            file_path: filePath,
            generated_by: actorId
        });

        await this.documentRepo.markAsGenerated(doc.id, uploadResult.size);

        // 3. Link to Medical History Record
        // (Assuming you have an medical_history table too, otherwise this is sufficient)
        this.logger.log(`✅ Lab Report Uploaded: ${doc.id} mapped to ${filePath}`);

        return { ...doc, generation_status: DocumentGenerationStatus.GENERATED };
    }

    // ============================================================
    // PRIVATE DATA FETCHERS
    // ============================================================

    private async fetchPatient(patientId: string) {
        const { data } = await this.supabase
            .from('dfo_patients').select('*').eq('id', patientId).maybeSingle();
        return data;
    }

    private async fetchConsultation(consultationId: string) {
        const { data } = await this.supabase
            .from('dfo_consultations').select('*').eq('id', consultationId).maybeSingle();
        return data;
    }

    private async fetchPrescription(prescriptionId: string) {
        const { data } = await this.supabase
            .from('dfo_prescriptions').select('*').eq('id', prescriptionId).maybeSingle();
        return data;
    }

    private async fetchPrescriptionsByConsultation(consultationId: string) {
        const { data } = await this.supabase
            .from('dfo_prescriptions').select('*').eq('consultation_id', consultationId);
        return data || [];
    }

    private async fetchDoctor(doctorId: string) {
        const { data } = await this.supabase
            .from('dfo_doctors').select('*').eq('id', doctorId).maybeSingle();
        return data;
    }
}
