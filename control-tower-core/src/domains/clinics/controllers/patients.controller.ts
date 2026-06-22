import { Controller, Get, Post, Patch, Param, Query, Body, Logger, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsUtilsService } from '../services/clinics-utils.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../../../infrastructure/security/roles.decorator';
import * as bcrypt from 'bcrypt';

@Controller('api/v1/clinics/patients')
@UseGuards(ClinicsAuthGuard, RolesGuard)
export class PatientsController {
    private readonly logger = new Logger(PatientsController.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly utils: ClinicsUtilsService,
    ) {}

    @Get()
    async list(@Query('phone') phone?: string, @Query('q') q?: string, @Query('page') page = '1', @Query('limit') limit = '20') {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;
        try {
            let query = supabase.from('sakhi_clinic_patients').select('*', { count: 'exact' }).eq('clinic_id', clinic_id);
            if (phone) query = query.eq('mobile', phone);
            else if (q) query = query.or(`name.ilike.%${q}%,mobile.ilike.%${q}%`);
            else query = query.order('created_at', { ascending: false });
            query = query.range(from, to);
            const { data, error, count } = await query;
            if (error) throw error;
            return { success: true, data: data ?? [], pagination: { page: pageNum, limit: limitNum, total: count ?? data?.length ?? 0 } };
        } catch (error: any) {
            this.logger.error('GET /api/patients', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post()
    async create(@Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const tv = this.utils.toValue.bind(this.utils);
        try {
            const name = tv(body?.name);
            const mobile = tv(body?.mobile) ?? tv(body?.phone);
            const marital_status = tv(body?.marital_status) ?? tv(body?.maritalStatus) ?? 'Married';
            const registration_date = tv(body?.registration_date) || tv(body?.date) || new Date().toISOString().slice(0, 10);
            const gender = tv(body?.gender) || 'Female';

            if (!name || !mobile) {
                throw new HttpException({ success: false, error: 'name and mobile (or phone) are required' }, HttpStatus.BAD_REQUEST);
            }

            const { data: existing, error: existingError } = await supabase
                .from('sakhi_clinic_patients').select('id').eq('clinic_id', clinic_id).eq('mobile', mobile).maybeSingle();
            if (existingError && existingError.code !== 'PGRST116') throw existingError;
            if (existing) {
                throw new HttpException({ success: false, error: 'Patient with this mobile already exists' }, HttpStatus.CONFLICT);
            }

            const uhid = tv(body?.uhid) || (await this.utils.generateUhid(supabase));
            const rawPin = Math.floor(1000 + Math.random() * 9000).toString();
            const pin_hash = await bcrypt.hash(rawPin, 10);

            const payload = this.utils.sanitizePayload({
                clinic_id, uhid, lead_id: tv(body.lead_id), name, relation: tv(body.relation), marital_status, gender,
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
                pin_hash // Save the newly generated PIN
            });

            const { data, error } = await supabase.from('sakhi_clinic_patients').insert(payload).select().single();
            if (error) throw error;
            return { success: true, data, generatedPin: rawPin };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/patients', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase.from('sakhi_clinic_patients').select('*').eq('id', id).eq('clinic_id', clinic_id).single();
            if (error?.code === 'PGRST116' || !data) throw new HttpException({ success: false, error: 'Patient not found' }, HttpStatus.NOT_FOUND);
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`GET /api/patients/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id')
    @Roles('Admin', 'Receptionist', 'Doctor')
    async update(@Param('id') id: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const tv = this.utils.toValue.bind(this.utils);
        try {
            const mobile = tv(body.mobile) ?? tv(body.phone);
            if (mobile) {
                const { data: conflict, error: conflictError } = await supabase
                    .from('sakhi_clinic_patients').select('id').eq('clinic_id', clinic_id).eq('mobile', mobile).neq('id', id).maybeSingle();
                if (conflictError && conflictError.code !== 'PGRST116') throw conflictError;
                if (conflict) throw new HttpException({ success: false, error: 'Mobile number already exists' }, HttpStatus.CONFLICT);
            }
            const sanitized = this.utils.sanitizePayload({
                lead_id: tv(body.lead_id), name: tv(body.name), mobile,
                relation: tv(body.relation), marital_status: tv(body.marital_status) ?? tv(body.maritalStatus),
                gender: tv(body.gender), dob: tv(body.dob), age: tv(body.age),
                blood_group: tv(body.blood_group) ?? tv(body.bloodGroup), aadhar: tv(body.aadhar),
                email: tv(body.email), house: tv(body.house), street: tv(body.street) ?? tv(body.address),
                area: tv(body.area), city: tv(body.city), district: tv(body.district), state: tv(body.state),
                postal_code: tv(body.postal_code) ?? tv(body.postalCode),
                emergency_contact_name: tv(body.emergency_contact_name),
                emergency_contact_phone: tv(body.emergency_contact_phone),
                emergency_contact_relation: tv(body.emergency_contact_relation),
                assigned_doctor_id: tv(body.assigned_doctor_id),
                referral_doctor: tv(body.referral_doctor) ?? tv(body.referralDoctor),
                hospital_address: tv(body.hospital_address) ?? tv(body.hospitalAddress),
                registration_date: tv(body.registration_date) ?? tv(body.date), status: tv(body.status),
            });
            delete (sanitized as any).id;
            delete (sanitized as any).uhid;
            delete (sanitized as any).created_at;
            delete (sanitized as any).clinic_id; // don't allow changing clinic_id

            const { data, error } = await supabase.from('sakhi_clinic_patients').update(sanitized).eq('id', id).eq('clinic_id', clinic_id).select().single();
            if (error?.code === 'PGRST116') throw new HttpException({ success: false, error: 'Patient not found' }, HttpStatus.NOT_FOUND);
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/patients/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id/appointments')
    async getPatientAppointments(@Param('id') id: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase.from('sakhi_clinic_appointments').select('*').eq('patient_id', id).eq('clinic_id', clinic_id).order('appointment_date', { ascending: false });
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            this.logger.error(`GET /api/patients/${id}/appointments`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id/clinical-notes')
    async getClinicalNotes(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase.from('sakhi_clinic_patient_notes').select('id, patient_id, author_id, note, created_at').eq('patient_id', id).eq('clinic_id', clinic_id).order('created_at', { ascending: false });
            if (error) throw error;
            return { success: true, data: data ?? [] };
        } catch (error: any) {
            this.logger.error(`GET /api/patients/${id}/clinical-notes`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/clinical-notes')
    @Roles('Admin', 'Doctor')
    async createClinicalNote(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            if (!body?.note) throw new HttpException({ success: false, error: 'note is required' }, HttpStatus.BAD_REQUEST);
            const payload = this.utils.sanitizePayload({ clinic_id, patient_id: id, author_id: this.utils.isUuid(body?.doctor_id) ? body.doctor_id : null, note: body.note });
            const { data, error } = await supabase.from('sakhi_clinic_patient_notes').insert(payload).select().single();
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/clinical-notes`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id/notes')
    async getNotes(@Param('id') id: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase.from('sakhi_clinical_notes').select('*').eq('patient_id', id).eq('clinic_id', clinic_id).order('created_at', { ascending: false });
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            this.logger.error(`GET /api/patients/${id}/notes`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/notes')
    @Roles('Admin', 'Doctor')
    async createNote(@Param('id') id: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            if (!body?.doctor_id) throw new HttpException({ success: false, error: 'doctor_id is required' }, HttpStatus.BAD_REQUEST);
            const payload = this.utils.sanitizePayload({ clinic_id, patient_id: id, doctor_id: body.doctor_id, appointment_id: body.appointment_id, subjective: body.subjective, objective: body.objective, assessment: body.assessment, plan: body.plan });
            const { data, error } = await supabase.from('sakhi_clinical_notes').insert(payload).select().single();
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/notes`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id/documents')
    async getDocuments(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase.from('sakhi_clinic_documents').select('*').eq('patient_id', id).eq('clinic_id', clinic_id).order('created_at', { ascending: false });
            if (error) throw error;
            return { success: true, data: data ?? [] };
        } catch (error: any) {
            this.logger.error(`GET /api/patients/${id}/documents`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/documents')
    @Roles('Admin', 'Receptionist', 'Doctor', 'Nurse')
    async createDocument(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const name = body?.name || body?.filename;
            const contentType = body?.contentType || 'application/octet-stream';
            const document_type = body?.document_type || body?.type;
            const base64 = body?.base64;
            const urlFromClient = body?.url;
            if (!name || !document_type) throw new HttpException({ success: false, error: 'Document name and document_type are required' }, HttpStatus.BAD_REQUEST);

            let fileUrl = urlFromClient || '';
            if (base64) {
                const fileBuffer = Buffer.from(base64, 'base64');
                const safeName = name.replace(/\s+/g, '_');
                const path = `${id}/${Date.now()}-${safeName}`;
                const { error: uploadError } = await supabase.storage.from('patient-documents').upload(path, fileBuffer, { contentType, upsert: false });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from('patient-documents').getPublicUrl(path);
                fileUrl = publicUrlData?.publicUrl || fileUrl;
            }
            if (!fileUrl) throw new HttpException({ success: false, error: 'Document url or base64 content is required' }, HttpStatus.BAD_REQUEST);

            const { data, error } = await supabase.from('sakhi_clinic_documents')
                .insert({ clinic_id, patient_id: id, name, document_type, url: fileUrl, uploaded_at: new Date().toISOString() })
                .select().single();
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/documents`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/reset-pin')
    async resetPin(@Param('id') id: string, @Body() body: { newPin?: string }) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            // Generate a 4-digit PIN if none provided
            const newPin = body.newPin || Math.floor(1000 + Math.random() * 9000).toString();
            
            // Hash the PIN
            const pin_hash = await bcrypt.hash(newPin, 10);

            // Update patient record
            const { data, error } = await supabase.from('sakhi_clinic_patients')
                .update({ 
                    pin_hash,
                    failed_attempts: 0,
                    locked_until: null
                })
                .eq('id', id)
                .eq('clinic_id', clinic_id)
                .select('id, name, mobile')
                .single();

            if (error) throw error;
            
            return { 
                success: true, 
                message: 'PIN successfully reset',
                newPin // We return it so the clinic frontend can display it to the user
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/reset-pin`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
