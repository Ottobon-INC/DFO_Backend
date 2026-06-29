import { Controller, Post, Body, Logger, HttpException, HttpStatus, UseGuards, Get, Query, Patch, Param, Delete } from '@nestjs/common';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { S3Service } from '../../../infrastructure/aws/s3.service';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { DocumentsService } from '../services/documents.service';
import { ClinicsUtilsService } from '../services/clinics-utils.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Controller('api/v1/clinics/documents')
@UseGuards(ClinicsAuthGuard)
export class DocumentsController {
    private readonly logger = new Logger(DocumentsController.name);

    constructor(
        private readonly s3Service: S3Service,
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly documentsService: DocumentsService,
        private readonly utils: ClinicsUtilsService
    ) {}

    @Post('upload-ticket')
    async generateUploadTicket(@Body() body: { filename?: string; fileSize?: number; documentType?: string }) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        const filename = body?.filename;
        const fileSize = body?.fileSize;
        const documentType = body?.documentType || 'staging';
        
        if (!filename) {
            throw new HttpException({ success: false, error: 'filename is required' }, HttpStatus.BAD_REQUEST);
        }

        if (!fileSize) {
            throw new HttpException({ success: false, error: 'fileSize is required' }, HttpStatus.BAD_REQUEST);
        }

        const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
        if (fileSize > MAX_FILE_SIZE) {
            throw new HttpException({ success: false, error: 'File size exceeds the 25MB limit.' }, HttpStatus.PAYLOAD_TOO_LARGE);
        }

        try {
            const { uploadUrl, path } = await this.s3Service.generatePresignedUploadUrl(clinic_id, filename, documentType);
            return {
                success: true,
                data: {
                    uploadUrl,
                    path,
                    method: 'PUT',
                    expiresIn: 300,
                }
            };
        } catch (error: any) {
            this.logger.error(`POST /api/v1/clinics/documents/upload-ticket failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post('register')
    async registerDocument(@Body() body: { patient_id?: string; name: string; file_path: string; file_size: number; mime_type: string; document_type: string }) {
        const clinic_id = TenantContext.getClinicId();
        const uploaded_by = TenantContext.getUserId();

        if (!clinic_id || !uploaded_by) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        const { patient_id, name, file_path, file_size, mime_type, document_type } = body;

        if (!name || !file_path) {
            throw new HttpException({ success: false, error: 'name and file_path are required' }, HttpStatus.BAD_REQUEST);
        }

        const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
        if (file_size && file_size > MAX_FILE_SIZE) {
            throw new HttpException({ success: false, error: 'File size exceeds the 25MB limit.' }, HttpStatus.PAYLOAD_TOO_LARGE);
        }

        const status = patient_id ? 'assigned' : 'unassigned';

        try {
            const supabase = this.supabaseService.getClient();

            // Validate patient ownership if patient_id is provided
            if (patient_id) {
                if (!this.isValidUUID(patient_id)) {
                    throw new HttpException({ success: false, error: 'Invalid patient ID format' }, HttpStatus.BAD_REQUEST);
                }
                const { data: patient, error: patientError } = await supabase
                    .from('sakhi_clinic_patients')
                    .select('clinic_id')
                    .eq('id', patient_id)
                    .single();

                if (patientError || !patient) {
                    throw new HttpException({ success: false, error: 'Patient not found' }, HttpStatus.NOT_FOUND);
                }

                if (patient.clinic_id !== clinic_id) {
                    this.logger.warn(`SECURITY: Cross-tenant patient access attempt in /register. User clinic: ${clinic_id}, Patient clinic: ${patient.clinic_id}`);
                    throw new HttpException({ success: false, error: 'Forbidden' }, HttpStatus.FORBIDDEN);
                }
            }

            const { data, error } = await supabase.from('sakhi_clinic_documents').insert([{
                clinic_id,
                patient_id: patient_id || null,
                name,
                file_path,
                file_size,
                mime_type,
                uploaded_by,
                status
            }]).select().single();

            if (error) {
                this.logger.error('Supabase document register error:', error);
                throw new HttpException({ success: false, error: 'Database error' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            return {
                success: true,
                data
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/v1/clinics/documents/register failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Get('unassigned')
    async getUnassignedDocuments(@Query('page') page: string = '1', @Query('limit') limit: string = '10') {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const offset = (pageNum - 1) * limitNum;

        try {
            const supabase = this.supabaseService.getClient();
            const { data, count, error } = await supabase
                .from('sakhi_clinic_documents')
                .select('*, uploader:sakhi_clinic_users!uploaded_by(name)', { count: 'exact' })
                .eq('clinic_id', clinic_id)
                .is('patient_id', null)
                .eq('status', 'unassigned')
                .order('created_at', { ascending: true }) // Oldest first
                .range(offset, offset + limitNum - 1);

            if (error) {
                this.logger.error('Supabase query error:', error);
                throw new HttpException({ success: false, error: 'Database error' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // Generate S3 presigned URLs for each document
            const documentsWithUrls = await Promise.all(
                (data || []).map(async (doc) => {
                    let previewUrl: string | null = null;
                    if (doc.file_path) {
                        try {
                            previewUrl = await this.s3Service.generatePresignedDownloadUrl(doc.file_path);
                        } catch (s3Error: any) {
                            this.logger.warn(`Could not generate presigned URL for ${doc.file_path}: ${s3Error.message}`);
                        }
                    }
                    return {
                        ...doc,
                        previewUrl
                    };
                })
            );

            return {
                success: true,
                data: documentsWithUrls,
                meta: {
                    page: pageNum,
                    limit: limitNum,
                    total: count || 0,
                    totalPages: Math.ceil((count || 0) / limitNum)
                }
            };
        } catch (error: any) {
            this.logger.error(`GET /api/v1/clinics/documents/unassigned failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    private isValidUUID(uuid: string): boolean {
        const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return regex.test(uuid);
    }

    @Patch(':id/link')
    async linkDocumentToPatient(@Param('id') documentId: string, @Body() body: { patient_id: string, document_type?: string }) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        const { patient_id, document_type } = body;
        if (!patient_id) {
            throw new HttpException({ success: false, error: 'patient_id is required' }, HttpStatus.BAD_REQUEST);
        }

        if (!this.isValidUUID(documentId) || !this.isValidUUID(patient_id)) {
            throw new HttpException({ success: false, error: 'Invalid ID format' }, HttpStatus.BAD_REQUEST);
        }

        try {
            const supabase = this.supabaseService.getClient();

            // 1. Fetch document and verify ownership
            const { data: document, error: docError } = await supabase
                .from('sakhi_clinic_documents')
                .select('clinic_id, status')
                .eq('id', documentId)
                .single();

            if (docError || !document) {
                throw new HttpException({ success: false, error: 'Document not found' }, HttpStatus.NOT_FOUND);
            }

            if (document.status === 'assigned') {
                throw new HttpException({ success: false, error: 'Document is already assigned' }, HttpStatus.CONFLICT);
            }

            if (document.clinic_id !== clinic_id) {
                // Potential cross-tenant access attempt
                this.logger.warn(`SECURITY: Cross-tenant document access attempt. User clinic: ${clinic_id}, Doc clinic: ${document.clinic_id}`);
                throw new HttpException({ success: false, error: 'Forbidden' }, HttpStatus.FORBIDDEN);
            }

            // 2. Fetch target patient and verify ownership
            const { data: patient, error: patientError } = await supabase
                .from('sakhi_clinic_patients')
                .select('clinic_id')
                .eq('id', patient_id)
                .single();

            if (patientError || !patient) {
                throw new HttpException({ success: false, error: 'Patient not found' }, HttpStatus.NOT_FOUND);
            }

            if (patient.clinic_id !== clinic_id) {
                // Potential cross-tenant access attempt
                this.logger.warn(`SECURITY: Cross-tenant patient access attempt. User clinic: ${clinic_id}, Patient clinic: ${patient.clinic_id}`);
                throw new HttpException({ success: false, error: 'Forbidden' }, HttpStatus.FORBIDDEN);
            }

            // 3. Both belong to the clinic, execute the link
            const updatePayload: any = { 
                patient_id: patient_id, 
                status: 'assigned' 
            };
            
            if (document_type) {
                updatePayload.document_type = document_type;
            }

            const { data: updatedDoc, error: updateError } = await supabase
                .from('sakhi_clinic_documents')
                .update(updatePayload)
                .eq('id', documentId)
                .select()
                .single();

            if (updateError) {
                throw new HttpException({ success: false, error: 'Database update error' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // 4. Audit Trail
            const actor_id = TenantContext.getUserId();
            if (actor_id) {
                await supabase.from('sakhi_audit_logs').insert({
                    actor_id,
                    action: 'link_document',
                    entity_name: 'sakhi_clinic_documents',
                    entity_id: documentId,
                    new_values: { patient_id }
                });
            }

            return {
                success: true,
                message: 'Document successfully linked to patient',
                data: updatedDoc
            };

        } catch (error: any) {
            // Re-throw HttpExceptions as is
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`PATCH /api/v1/clinics/documents/${documentId}/link failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Patch(':id/unlink')
    async unlinkDocumentFromPatient(@Param('id') documentId: string, @Body() body: { reason: string }) {
        const clinic_id = TenantContext.getClinicId();
        const { reason } = body;

        if (!clinic_id) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        if (!reason || reason.trim() === '') {
            throw new HttpException({ success: false, error: 'A reason is required to unlink a document.' }, HttpStatus.BAD_REQUEST);
        }

        if (!this.isValidUUID(documentId)) {
            throw new HttpException({ success: false, error: 'Invalid document ID format' }, HttpStatus.BAD_REQUEST);
        }

        try {
            const supabase = this.supabaseService.getClient();

            // 1. Fetch document and verify ownership
            const { data: document, error: docError } = await supabase
                .from('sakhi_clinic_documents')
                .select('clinic_id, status, patient_id')
                .eq('id', documentId)
                .single();

            if (docError || !document) {
                throw new HttpException({ success: false, error: 'Document not found' }, HttpStatus.NOT_FOUND);
            }

            if (document.clinic_id !== clinic_id) {
                this.logger.warn(`SECURITY: Cross-tenant document unlink attempt. User clinic: ${clinic_id}, Doc clinic: ${document.clinic_id}`);
                throw new HttpException({ success: false, error: 'Forbidden' }, HttpStatus.FORBIDDEN);
            }

            if (document.status === 'unassigned') {
                throw new HttpException({ success: false, error: 'Document is already unassigned' }, HttpStatus.CONFLICT);
            }

            const previous_patient_id = document.patient_id;

            // 2. Execute unlink
            const { data: updatedDoc, error: updateError } = await supabase
                .from('sakhi_clinic_documents')
                .update({ 
                    patient_id: null, 
                    status: 'unassigned' 
                })
                .eq('id', documentId)
                .select()
                .single();

            if (updateError) {
                throw new HttpException({ success: false, error: 'Database update error' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // 3. Audit Trail
            const actor_id = TenantContext.getUserId();
            if (actor_id) {
                await supabase.from('sakhi_audit_logs').insert({
                    actor_id,
                    action: 'unlink_document',
                    entity_name: 'sakhi_clinic_documents',
                    entity_id: documentId,
                    new_values: { previous_patient_id, reason }
                });
            }

            return {
                success: true,
                message: 'Document successfully unlinked',
                data: updatedDoc
            };

        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/v1/clinics/documents/${documentId}/unlink failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Delete(':id')
    async deleteDocument(@Param('id') documentId: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        if (!this.isValidUUID(documentId)) {
            throw new HttpException({ success: false, error: 'Invalid document ID format' }, HttpStatus.BAD_REQUEST);
        }

        try {
            const supabase = this.supabaseService.getClient();

            // 1. Fetch document and verify ownership
            const { data: document, error: docError } = await supabase
                .from('sakhi_clinic_documents')
                .select('clinic_id, file_path')
                .eq('id', documentId)
                .single();

            if (docError || !document) {
                throw new HttpException({ success: false, error: 'Document not found' }, HttpStatus.NOT_FOUND);
            }

            if (document.clinic_id !== clinic_id) {
                this.logger.warn(`SECURITY: Cross-tenant document delete attempt. User clinic: ${clinic_id}, Doc clinic: ${document.clinic_id}`);
                throw new HttpException({ success: false, error: 'Forbidden' }, HttpStatus.FORBIDDEN);
            }

            // 2. Delete from Database
            const { error: deleteError } = await supabase
                .from('sakhi_clinic_documents')
                .delete()
                .eq('id', documentId);

            if (deleteError) {
                throw new HttpException({ success: false, error: 'Database delete error' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // Physically delete the file from AWS S3 to prevent orphan file cost leaks
            if (document.file_path) {
                await this.s3Service.deleteFile(document.file_path);
            }

            // 3. Audit Trail
            const actor_id = TenantContext.getUserId();
            if (actor_id) {
                await supabase.from('sakhi_audit_logs').insert({
                    actor_id,
                    action: 'delete_document',
                    entity_name: 'sakhi_clinic_documents',
                    entity_id: documentId,
                    new_values: { deleted_path: document.file_path }
                });
            }

            return {
                success: true,
                message: 'Document deleted successfully'
            };
        } catch (error: any) {
            this.logger.error(`DELETE /api/v1/clinics/documents/${documentId} failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post(':id/link-new-patient')
    async linkNewPatientToDocument(@Param('id') documentId: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        if (!this.isValidUUID(documentId)) {
            throw new HttpException({ success: false, error: 'Invalid document ID format' }, HttpStatus.BAD_REQUEST);
        }

        const tv = this.utils.toValue.bind(this.utils);
        const name = tv(body?.name);
        const mobile = tv(body?.mobile) ?? tv(body?.phone);

        if (!name || !mobile) {
            throw new HttpException({ success: false, error: 'name and mobile (or phone) are required' }, HttpStatus.BAD_REQUEST);
        }

        try {
            const supabase = this.supabaseService.getClient();

            // Validate Document Ownership and Status
            const { data: document, error: docError } = await supabase
                .from('sakhi_clinic_documents')
                .select('clinic_id, status')
                .eq('id', documentId)
                .single();

            if (docError || !document) {
                throw new HttpException({ success: false, error: 'Document not found' }, HttpStatus.NOT_FOUND);
            }

            if (document.clinic_id !== clinic_id) {
                this.logger.warn(`SECURITY: Cross-tenant document link attempt. User clinic: ${clinic_id}, Doc clinic: ${document.clinic_id}`);
                throw new HttpException({ success: false, error: 'Forbidden' }, HttpStatus.FORBIDDEN);
            }

            if (document.status === 'assigned') {
                throw new HttpException({ success: false, error: 'Document is already assigned' }, HttpStatus.CONFLICT);
            }

            // Check for existing mobile to prevent duplicates
            const { data: existing, error: existingError } = await supabase
                .from('sakhi_clinic_patients')
                .select('id')
                .eq('clinic_id', clinic_id)
                .eq('mobile', mobile)
                .maybeSingle();

            if (existingError && existingError.code !== 'PGRST116') throw existingError;
            if (existing) {
                throw new HttpException({ success: false, error: 'Patient with this mobile already exists' }, HttpStatus.CONFLICT);
            }

            // Prepare the new patient payload using the same logic as PatientsController
            const uhid = tv(body?.uhid) || (await this.utils.generateUhid(supabase));
            const rawPin = crypto.randomInt(1000, 10000).toString();
            const pin_hash = await bcrypt.hash(rawPin, 10);
            
            const registration_date = tv(body?.registration_date) || tv(body?.date) || new Date().toISOString().slice(0, 10);

            const payload = this.utils.sanitizePayload({
                clinic_id, uhid, lead_id: tv(body.lead_id), name, relation: tv(body.relation), 
                marital_status: tv(body?.marital_status) ?? tv(body?.maritalStatus) ?? 'Married', 
                gender: tv(body?.gender) || 'Female',
                dob: tv(body.dob), age: tv(body.age), blood_group: tv(body.blood_group) ?? tv(body.bloodGroup),
                aadhar: tv(body.aadhar), mobile, email: tv(body.email), house: tv(body.house),
                street: tv(body.street) ?? tv(body.address), area: tv(body.area), city: tv(body.city),
                district: tv(body.district), state: tv(body.state),
                postal_code: tv(body.postal_code) ?? tv(body.postalCode),
                emergency_contact_name: tv(body.emergency_contact_name),
                emergency_contact_phone: tv(body.emergency_contact_phone),
                emergency_contact_relation: tv(body.emergency_contact_relation),
                assigned_doctor_id: tv(body.assigned_doctor_id),
                referral_doctor: tv(body.referral_doctor) ?? tv(body.referralDoctor),
                hospital_address: tv(body.hospital_address) ?? tv(body.hospitalAddress),
                registration_date, status: tv(body.status),
                pin_hash
            });

            // Execute the Postgres transaction using our new service
            const result = await this.documentsService.linkNewPatientTransaction(clinic_id, documentId, payload);

            // Audit Trail
            const actor_id = TenantContext.getUserId();
            if (actor_id) {
                await supabase.from('sakhi_audit_logs').insert({
                    actor_id,
                    action: 'link_new_patient_to_document',
                    entity_name: 'sakhi_clinic_documents',
                    entity_id: documentId,
                    new_values: { patient_id: result.id } // result is now the full patient record, so we use result.id
                });
            }

            return {
                success: true,
                message: 'Patient created and document linked successfully',
                data: {
                    ...result, // Return the full patient record
                    generatedPin: rawPin
                }
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/v1/clinics/documents/${documentId}/link-new-patient failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
