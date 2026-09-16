import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentRepository } from './document.repository';
import { S3Service } from '../../../infrastructure/aws/s3.service';
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

@Injectable()
export class DocumentService {
    private readonly logger = new Logger(DocumentService.name);

    constructor(
        @InjectQueue(DOCUMENT_QUEUE) private readonly docQueue: Queue,
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
        private readonly documentRepo: DocumentRepository,
        private readonly s3Service: S3Service,
        private readonly generator: DocumentGeneratorService,
        private readonly encryption: JanmasethuEncryptionService,
        private readonly templateService: TemplateService,
        private readonly pdfService: PdfService,
    ) { }

    async queuePrescriptionGeneration(dto: {
        prescription_id: string;
        consultation_id: string;
        patient_id: string;
        clinic_id: string;
        doctor_id: string;
        generated_by: string;
        clinical_notes?: string;
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

        const patientInfo = await this.fetchPatient(dto.patient_id);
        const rawName = (patientInfo.name || patientInfo.full_name || (patientInfo.first_name ? `${patientInfo.first_name} ${patientInfo.last_name || ''}`.trim() : '') || 'patient').trim();
        const safePatientName = rawName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

        const idempotencyKey = `prescription_${dto.prescription_id}_v1`;
        const fileName = `prescription_${safePatientName}_${dto.prescription_id}.pdf`;
        const filePath = `clinics/${dto.clinic_id}/prescriptions/${Date.now()}-${fileName}`;

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

        const payload: GenerateDocumentJobPayload = {
            ...dto,
            type: DocumentType.PRESCRIPTION,
            idempotency_key: idempotencyKey,
        };

        await this.docQueue.add('GENERATE_PRESCRIPTION', payload, {
            jobId: idempotencyKey,
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

    async executeGeneration(payload: GenerateDocumentJobPayload): Promise<void> {
        // Legacy: replaced by executePdfGeneration
    }

    async executePdfGeneration(payload: GenerateDocumentJobPayload): Promise<void> {
        const { prescription_id, consultation_id, patient_id, clinic_id, doctor_id } = payload;

        const docRecord = await this.documentRepo.findByPrescriptionId(prescription_id);
        if (!docRecord) throw new Error(`Pulse: No pending record for ${prescription_id}`);

        try {
            const [patient, prescriptions, doctor, clinic] = await Promise.all([
                this.fetchPatient(patient_id),
                this.fetchPrescriptionsByConsultation(consultation_id),
                this.fetchDoctor(doctor_id),
                this.fetchClinic(clinic_id),
            ]);

            // Properly resolve patient name from 'name', 'full_name', or 'first_name + last_name'
            const formatTitleCase = (str: string) => {
                if (!str) return '';
                return str.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            };

            const rawPatientName = (patient.name || patient.full_name || (patient.first_name ? `${patient.first_name} ${patient.last_name || ''}`.trim() : '') || 'Patient').trim();
            const patientName = formatTitleCase(rawPatientName);

            // Properly resolve doctor name from 'first_name + last_name', 'name', or 'full_name'
            const doctorName = (
                (doctor.first_name ? `Dr. ${doctor.first_name} ${doctor.last_name || ''}`.trim() : '') ||
                doctor.name ||
                doctor.full_name ||
                'Attending Physician'
            ).trim();

            const formattedClinicalNotes = payload.clinical_notes 
                ? payload.clinical_notes.replace(/\n/g, '<br/>') 
                : 'See below for medication details.';

            const templateData = {
                clinic_name: clinic.name || 'JANMASETHU',
                patient_name: patientName,
                appointment_date: new Date().toLocaleDateString(),
                appointment_time: new Date().toLocaleTimeString(),
                age: patient.age || 'N/A',
                gender: patient.gender || 'N/A',
                patient_id: patient.uhid || (patient.id ? patient.id.substring(0, 8).toUpperCase() : 'N/A'),
                clinical_notes: formattedClinicalNotes,
                additional_notes: 'Generated via Patient Portal',
                doctor_name: doctorName,
                doctor_qualifications: doctor.qualifications || (doctor.specialization && doctor.specialization.length > 0 ? (Array.isArray(doctor.specialization) ? doctor.specialization.join(', ') : doctor.specialization) : 'MBBS'),
                reg_no: doctor.registration_number || 'REG-99210-A',
                doctor_signature_url: doctor.signature_url || 'https://via.placeholder.com/150x50?text=Digital+Signature',
                medications: prescriptions.map((prescription: any) => {
                    const originalInstructions = prescription.special_instructions || '';
                    const qtyMatch = originalInstructions.match(/(?:\.\s*)?Quantity:\s*(.*)$/i);
                    const quantity = qtyMatch ? qtyMatch[1] : '';
                    const instructions = originalInstructions.replace(/(?:\.\s*)?Quantity:\s*.*$/i, '').trim();

                    return {
                        name: prescription.medication_name,
                        dosage: prescription.dosage,
                        frequency: prescription.frequency,
                        duration: `${prescription.duration_days} Days`,
                        quantity: quantity,
                        instructions: instructions || 'As directed'
                    };
                })
            };

            const html = await this.templateService.renderTemplate('prescription_template', templateData);
            const pdfBuffer = await this.pdfService.generatePdf(html);

            // Upload to AWS S3
            const size = await this.s3Service.uploadFile(docRecord.file_path, pdfBuffer, 'application/pdf');

            // Update Registry
            await this.documentRepo.markAsGenerated(docRecord.id, size);
            
            await this.supabase.from('sakhi_clinic_documents').update({
                status: 'published'
            }).eq('id', docRecord.id);

            this.logger.log(`✅ PDF Generation Successful: ${docRecord.file_path}`);
        } catch (error) {
            this.logger.error(`❌ PDF Generation Failed: ${error.message}`);
            await this.documentRepo.markAsFailed(docRecord.id, error.message);
            throw error;
        }
    }

    async getPatientDocuments(patientId: string, actorId: string, actorRole: string): Promise<any[]> {
        const { data: documents } = await this.supabase
            .from('sakhi_clinic_documents')
            .select('*')
            .eq('patient_id', patientId);

        if (!documents) return [];

        return Promise.all(documents.map(async (doc) => {
            const isPublished = doc.status === 'published';
            let signedUrl: string | null = null;

            if (isPublished && doc.file_path) {
                try {
                    signedUrl = await this.s3Service.generatePresignedDownloadUrl(doc.file_path, 3600, doc.name);
                } catch (e: any) {
                    this.logger.warn(`Presigned URL generation failed for ${doc.id}: ${e.message}`);
                }
            }

            if (signedUrl) {
                this.documentRepo.logAccess({
                    document_id: doc.id,
                    accessed_by: actorId,
                    role: actorRole,
                    expires_at: new Date(Date.now() + 3600 * 1000),
                }).catch(e => this.logger.warn(`Access log failed: ${e.message}`));
            }

            return {
                id: doc.id,
                type: doc.type || 'unknown',
                file_name: doc.name,
                version: doc.version || 1,
                created_at: doc.created_at,
                generation_status: doc.status || (isPublished ? 'generated' : 'pending'),
                signed_url: signedUrl,
                expires_at: signedUrl ? new Date(Date.now() + 3600 * 1000) : null,
            };
        }));
    }

    async getDocumentById(documentId: string, actorId: string, actorRole: string): Promise<any> {
        const { data: doc } = await this.supabase
            .from('sakhi_clinic_documents')
            .select('*')
            .eq('id', documentId)
            .maybeSingle();
            
        if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

        const signedUrl = await this.s3Service.generatePresignedDownloadUrl(doc.file_path);

        return {
            id: doc.id,
            patient_id: doc.patient_id,
            file_name: doc.name,
            signed_url: signedUrl,
            expires_at: new Date(Date.now() + 3600 * 1000),
        };
    }

    async uploadLaboratoryReport(
        dto: UploadReportDto,
        file: { buffer: Buffer, originalname: string, mimetype: string },
        actorId: string
    ): Promise<any> {
        this.logger.log(`📥 Uploading clinical report for patient ${dto.patient_id}`);

        const timestamp = Date.now();
        const safeFileName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const fileName = `report_${timestamp}_${safeFileName}`;
        
        const { data: patient } = await this.supabase
            .from('sakhi_clinic_patients')
            .select('clinic_id')
            .eq('id', dto.patient_id)
            .single();

        const filePath = `clinics/${patient?.clinic_id || 'unknown'}/reports/${fileName}`;

        const size = await this.s3Service.uploadFile(filePath, file.buffer, file.mimetype);

        const { data: doc } = await this.supabase.from('sakhi_clinic_documents').insert([{
            patient_id: dto.patient_id,
            clinic_id: patient?.clinic_id,
            name: fileName,
            file_path: filePath,
            mime_type: file.mimetype,
            uploaded_by: actorId,
            status: 'published'
        }]).select().single();

        this.logger.log(`✅ Lab Report Uploaded: ${doc.id} mapped to ${filePath}`);

        return doc;
    }

    private async fetchPatient(patientId: string) {
        const { data } = await this.supabase
            .from('sakhi_clinic_patients').select('*').eq('id', patientId).maybeSingle();
        return data || {};
    }

    private async fetchPrescriptionsByConsultation(groupId: string) {
        const { data } = await this.supabase
            .from('sakhi_clinic_prescriptions').select('*').eq('group_id', groupId);
        return data || [];
    }

    private async fetchDoctor(doctorId: string) {
        const { data } = await this.supabase
            .from('sakhi_clinic_users').select('*').eq('id', doctorId).maybeSingle();
        return data || {};
    }

    private async fetchClinic(clinicId: string) {
        const { data } = await this.supabase
            .from('clinics').select('*').eq('id', clinicId).maybeSingle();
        return data || {};
    }
}
