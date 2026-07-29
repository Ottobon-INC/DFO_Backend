import {
    Controller, Post, Get, Param, Body, Headers,
    BadRequestException, UnauthorizedException, Logger,
    UseInterceptors, UploadedFile
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { UploadReportDto } from '../dto/dfo.dto';
import { JanmasethuRbacService } from '../janmasethu.rbac';
import { JanmasethuAuditService } from '../janmasethu.audit.service';
import { JANMASETHU_DOMAIN, JanmasethuUserRole, JanmasethuUserContext } from '../janmasethu.types';
import { TenantContext } from '../../../infrastructure/context/tenant.context';

@Controller('janmasethu/documents')
export class DocumentController {
    private readonly logger = new Logger(DocumentController.name);

    constructor(
        private readonly documentService: DocumentService,
        private readonly rbacService: JanmasethuRbacService,
        private readonly auditService: JanmasethuAuditService,
    ) { }

    private getUserContext(headers: Record<string, any>): JanmasethuUserContext {
        const userId = headers['x-user-id'];
        const userRole = headers['x-user-role'] as JanmasethuUserRole;
        if (!userId || !userRole) throw new UnauthorizedException('Missing user context headers');
        return { id: userId, role: userRole };
    }

    // ============================================================
    // POST /janmasethu/documents/generate/prescription
    //
    // Triggers asynchronous prescription document generation.
    // Returns immediately with a document_id — client polls for status.
    //
    // REQUEST BODY:
    // {
    //   "prescription_id": "uuid",
    //   "consultation_id": "uuid",
    //   "patient_id": "uuid",
    //   "doctor_id": "uuid"
    // }
    //
    // RESPONSE:
    // { "queued": true, "document_id": "uuid", "message": "..." }
    // ============================================================
    @Post('generate/prescription')
    async generatePrescription(
        @Body() body: {
            prescription_id: string;
            consultation_id: string;
            patient_id: string;
            doctor_id: string;
        },
        @Headers() headers: any
    ) {
        const ctx = this.getUserContext(headers);

        if (!this.rbacService.canViewPII(ctx)) {
            throw new BadRequestException('Only authorized clinicians may generate clinical documents.');
        }

        try {
            const result = await this.documentService.queuePrescriptionGeneration({
                ...body,
                clinic_id: TenantContext.getClinicId() || '',
                generated_by: ctx.id,
            });

            await this.auditService.logClinicalUpdate(
                ctx.id,
                'PRESCRIPTION_DOCUMENT_QUEUED',
                body.prescription_id,
                { document_id: result.document_id, queued: result.queued }
            );

            return result;
        } catch (error) {
            this.logger.error(`Document generation trigger failed: ${error.message}`);
            throw new BadRequestException(`Generation failed: ${error.message}`);
        }
    }

    // ============================================================
    // GET /janmasethu/documents/patient/:patient_id
    //
    // Returns all generated documents for a patient.
    // Each document entry includes a dynamically generated signed URL.
    //
    // RESPONSE:
    // [
    //   {
    //     "id": "uuid",
    //     "type": "prescription",
    //     "file_name": "prescription_xxx.docx",
    //     "version": 1,
    //     "generation_status": "generated",
    //     "signed_url": "https://supabase.co/storage/...?token=...",
    //     "expires_at": "2024-01-01T12:00:00.000Z"
    //   }
    // ]
    // ============================================================
    @Get('patient/:patient_id')
    async getPatientDocuments(
        @Param('patient_id') patientId: string,
        @Headers() headers: any,
    ) {
        const ctx = this.getUserContext(headers);

        if (!this.rbacService.canViewPII(ctx)) {
            throw new UnauthorizedException('Document access requires PII privileges.');
        }

        await this.auditService.logPIIAccess(ctx.id, ctx.role, patientId, 'ACCESSED_PATIENT_DOCUMENTS');

        return this.documentService.getPatientDocuments(patientId, ctx.id, ctx.role);
    }

    // ============================================================
    // GET /janmasethu/documents/:id
    //
    // Returns a single document with a fresh signed URL.
    //
    // RESPONSE:
    // {
    //   "id": "uuid",
    //   "patient_id": "uuid",
    //   "type": "prescription",
    //   "file_name": "prescription_xxx.docx",
    //   "version": 1,
    //   "signed_url": "https://...",
    //   "expires_at": "2024-01-01T12:00:00.000Z"
    // }
    // ============================================================
    @Get(':id')
    async getDocument(
        @Param('id') documentId: string,
        @Headers() headers: any,
    ) {
        const ctx = this.getUserContext(headers);

        if (!this.rbacService.canViewPII(ctx)) {
            throw new UnauthorizedException('Document access requires PII privileges.');
        }

        await this.auditService.logPIIAccess(ctx.id, ctx.role, documentId, 'ACCESSED_SINGLE_DOCUMENT');

        return this.documentService.getDocumentById(documentId, ctx.id, ctx.role);
    }

    // ============================================================
    // 4. REPORT UPLOAD ENDPOINT (Binary File Handling)
    // ============================================================

    /**
     * POST /janmasethu/documents/upload/report
     *
     * Uploads a physical medical report from a doctor/nurse.
     * Expects multipart/form-data:
     * - file: The physical lab report file
     * - patient_id: uuid
     * - report_type: string
     * - clinical_notes: string (optional)
     */
    @Post('upload/report')
    @UseInterceptors(FileInterceptor('file'))
    async uploadReport(
        @UploadedFile() file: any,
        @Body() dto: UploadReportDto,
        @Headers() headers: any,
    ) {
        const ctx = this.getUserContext(headers);

        if (!this.rbacService.canViewPII(ctx)) {
            throw new UnauthorizedException('Medical record upload requires clinical PII privileges.');
        }

        if (!file) throw new BadRequestException('Binary medical report file is missing.');

        try {
            const doc = await this.documentService.uploadLaboratoryReport(dto, file, ctx.id);

            await this.auditService.logClinicalUpdate(
                ctx.id,
                'REPORT_UPLOADED',
                dto.patient_id,
                { document_id: doc.id, type: dto.report_type }
            );

            return doc;
        } catch (error) {
            this.logger.error(`Report upload failed: ${error.message}`);
            throw new BadRequestException(`Report upload failed: ${error.message}`);
        }
    }
}
