import { Controller, Get, Post, Patch, Param, Query, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsUtilsService } from '../services/clinics-utils.service';

@Controller('api/appointments')
export class AppointmentsController {
    private readonly logger = new Logger(AppointmentsController.name);
    private readonly allowedTypes = ['Consultation', 'Follow-up', 'Procedure', 'Emergency', 'Scan', 'Surgery', 'Camp'];
    private readonly allowedStatuses = ['Scheduled', 'Arrived', 'Checked-In', 'Completed', 'Canceled', 'Expected'];

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly utils: ClinicsUtilsService,
    ) {}

    @Get()
    async list(
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('date') date?: string,
        @Query('doctor_id') doctorId?: string,
        @Query('status') status?: string,
        @Query('mobile') mobile?: string,
    ) {
        const supabase = this.supabaseService.getClient();
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;

        try {
            let query = supabase
                .from('sakhi_clinic_appointments')
                .select(mobile ? '*, sakhi_clinic_patients!inner(mobile)' : '*', { count: 'exact' })
                .order('appointment_date', { ascending: true })
                .range(from, to);

            if (date) query = query.eq('appointment_date', date);
            if (doctorId && this.utils.isUuid(doctorId)) query = query.eq('doctor_id', doctorId);
            if (status) query = query.eq('status', status);
            if (mobile) query = query.eq('sakhi_clinic_patients.mobile', mobile);

            const { data, error, count } = await query;
            if (error) throw error;

            const items = (data as any[] | null) ?? [];
            const cleanedItems = items.map((item) => {
                const { sakhi_clinic_patients, ...rest } = item as any;
                return rest;
            });

            return {
                success: true,
                data: {
                    items: cleanedItems,
                    pagination: { page: pageNum, limit: limitNum, total: count ?? cleanedItems.length ?? 0 },
                },
            };
        } catch (error: any) {
            this.logger.error('GET /api/appointments', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('doctors')
    async getDoctors() {
        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .select('id, email, role')
                .eq('role', 'Doctor');
            if (error) throw error;
            const mapped = (data || []).map(u => ({
                id: u.id,
                email: u.email,
                role: u.role,
                name: u.email ? u.email.split('@')[0].split('.')[0].charAt(0).toUpperCase() + u.email.split('@')[0].split('.')[0].slice(1) : 'Doctor'
            }));
            return { success: true, data: mapped };
        } catch (error: any) {
            this.logger.error('GET /api/appointments/doctors', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post()
    async create(@Body() body: any) {
        const supabase = this.supabaseService.getClient();

        try {
            let patient_id = body.patient_id;
            let lead_id = body.lead_id;
            let appointment_date = body.appointment_date;
            let start_time = body.start_time;
            let end_time = body.end_time;
            const doctorIdRaw = body.doctor_id;
            let doctor_id = doctorIdRaw && this.utils.isUuid(doctorIdRaw) ? doctorIdRaw : null;
            const requestedType = typeof body.type === 'string' ? body.type : '';
            let type = 'Consultation';
            const normalizedType = requestedType.trim();
            if (this.allowedTypes.includes(normalizedType)) {
                type = normalizedType;
            } else if (!normalizedType || /ivf/i.test(normalizedType) || /other/i.test(normalizedType)) {
                type = 'Consultation';
            }

            let doctorNameSnapshot = body.doctor_name_snapshot ?? body.doctor_name ?? body.doctorName ?? body.consultantName ?? body.consultant ?? body.doctor;
            let nameSnapshot = body.patient_name_snapshot ?? body.name;
            const sexSnapshot = body.sex_snapshot ?? body.sex ?? body.gender;
            let patientPhoneSnapshot = body.patient_phone_snapshot ?? body.phone ?? body.mobile;
            const patientDobSnapshot = body.patient_dob_snapshot ?? body.dob;
            const patientEmailSnapshot = body.patient_email_snapshot ?? body.email;
            const patientAddressSnapshot = body.patient_address_snapshot ?? body.address ?? body.street;
            const patientPostalCodeSnapshot = body.patient_postal_code_snapshot ?? body.postalCode ?? body.postal_code ?? body.pin;
            const patientMaritalStatusSnapshot = body.patient_marital_status_snapshot ?? body.maritalStatus ?? body.marital_status;
            const patientAgeSnapshot = body.patient_age_snapshot ?? body.age;
            const source = body.source ?? body.referral_source ?? body.appointment_source;
            const referralDoctor = body.referral_doctor ?? body.referralDoctor;
            const referralDoctorPhone = body.referral_doctor_phone ?? body.referralDoctorPhone ?? body.refDoctorMobile;
            const referralNotes = body.referral_notes ?? body.referralNotes;

            if (!doctorNameSnapshot && doctorIdRaw && !this.utils.isUuid(doctorIdRaw)) {
                doctorNameSnapshot = doctorIdRaw;
            }

            if (!patient_id && !lead_id) {
                if (body.name && body.phone) {
                    const { data: existingLead, error: existingLeadError } = await supabase
                        .from('sakhi_clinic_leads').select('id').eq('phone', body.phone).maybeSingle();
                    if (existingLeadError && existingLeadError.code !== 'PGRST116') throw existingLeadError;
                    if (existingLead?.id) {
                        lead_id = existingLead.id;
                    } else {
                        const { data: newLead, error: leadError } = await supabase
                            .from('sakhi_clinic_leads')
                            .insert(this.utils.sanitizePayload({ name: body.name, phone: body.phone }))
                            .select('id, name, phone').single();
                        if (leadError) throw leadError;
                        lead_id = newLead?.id;
                        if (!nameSnapshot) nameSnapshot = newLead?.name ?? nameSnapshot;
                        if (!patientPhoneSnapshot) patientPhoneSnapshot = newLead?.phone ?? patientPhoneSnapshot;
                    }
                } else {
                    throw new HttpException({ success: false, error: 'patient_id or lead_id is required' }, HttpStatus.BAD_REQUEST);
                }
            }

            if (patient_id) {
                if (!this.utils.isUuid(patient_id)) {
                    throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
                }
                const { data: patient, error: patientError } = await supabase
                    .from('sakhi_clinic_patients').select('id, name, mobile').eq('id', patient_id).single();
                if (patientError?.code === 'PGRST116' || !patient) {
                    throw new HttpException({ success: false, error: 'Patient not found' }, HttpStatus.NOT_FOUND);
                }
                if (patientError) throw patientError;
                if (!nameSnapshot) nameSnapshot = patient.name;
                if (!patientPhoneSnapshot) patientPhoneSnapshot = patient.mobile;
            }

            if (lead_id && !patient_id && (!nameSnapshot || !patientPhoneSnapshot)) {
                const { data: leadRow, error: leadError } = await supabase
                    .from('sakhi_clinic_leads').select('name, phone').eq('id', lead_id).single();
                if (leadError && leadError.code !== 'PGRST116') throw leadError;
                if (leadRow) {
                    if (!nameSnapshot) nameSnapshot = leadRow.name ?? nameSnapshot;
                    if (!patientPhoneSnapshot) patientPhoneSnapshot = leadRow.phone ?? patientPhoneSnapshot;
                }
            }

            if (!appointment_date) appointment_date = new Date().toISOString().split('T')[0];
            if (!start_time) {
                const now = new Date();
                start_time = now.toISOString().split('T')[1].slice(0, 5);
            }
            if (!end_time) end_time = start_time;

            if (doctor_id && !doctorNameSnapshot) {
                const { data: doctorRow, error: doctorNameError } = await supabase
                    .from('sakhi_clinic_users').select('email').eq('id', doctor_id).maybeSingle();
                if (doctorNameError && doctorNameError.code !== 'PGRST116') throw doctorNameError;
                if (doctorRow?.email) {
                    doctorNameSnapshot = doctorRow.email.split('@')[0].split('.')[0].charAt(0).toUpperCase() + doctorRow.email.split('@')[0].split('.')[0].slice(1);
                }
            }

            const payload = this.utils.sanitizePayload({
                patient_id, lead_id, doctor_id, appointment_date, start_time, end_time, type,
                status: body.status, visit_reason: body.visit_reason, resource_id: body.resource_id,
                patient_name_snapshot: nameSnapshot, sex_snapshot: sexSnapshot,
                doctor_name_snapshot: doctorNameSnapshot, patient_phone_snapshot: patientPhoneSnapshot,
                patient_dob_snapshot: patientDobSnapshot, patient_email_snapshot: patientEmailSnapshot,
                patient_address_snapshot: patientAddressSnapshot, patient_postal_code_snapshot: patientPostalCodeSnapshot,
                patient_marital_status_snapshot: patientMaritalStatusSnapshot, patient_age_snapshot: patientAgeSnapshot,
                source, referral_doctor: referralDoctor, referral_doctor_phone: referralDoctorPhone, referral_notes: referralNotes,
            });

            const { data, error } = await supabase.from('sakhi_clinic_appointments').insert(payload).select().single();
            if (error) throw error;

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/appointments', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) {
            throw new HttpException({ success: false, error: 'Invalid appointment id', code: 'INVALID_APPOINTMENT_ID' }, HttpStatus.BAD_REQUEST);
        }
        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('id, patient_id, lead_id, doctor_id, appointment_date, start_time, end_time, type, status, visit_reason, resource_id, doctor_name_snapshot, cancellation_reason, cancelled_at, created_at, updated_at')
                .eq('id', id).single();
            if (error?.code === 'PGRST116' || !data) {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`GET /api/appointments/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) {
            throw new HttpException({ success: false, error: 'Invalid appointment id', code: 'INVALID_APPOINTMENT_ID' }, HttpStatus.BAD_REQUEST);
        }
        const supabase = this.supabaseService.getClient();
        try {
            const { data: appointment, error: appointmentError } = await supabase
                .from('sakhi_clinic_appointments').select('status').eq('id', id).single();
            if (appointmentError?.code === 'PGRST116' || !appointment) {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (appointmentError) throw appointmentError;
            if (appointment.status === 'Completed') {
                throw new HttpException({ success: false, error: 'Cannot update a completed appointment', code: 'STATUS_IMMUTABLE_COMPLETED' }, HttpStatus.BAD_REQUEST);
            }

            let validatedDoctorId = body?.doctor_id;
            if (body?.doctor_id !== undefined) {
                if (!this.utils.isUuid(body.doctor_id)) {
                    validatedDoctorId = undefined;
                } else {
                    const { data: doctor, error: doctorError } = await supabase
                        .from('sakhi_clinic_users').select('id').eq('id', body.doctor_id).single();
                    if (doctorError?.code === 'PGRST116' || !doctor) {
                        throw new HttpException({ success: false, error: 'Doctor not found', code: 'DOCTOR_NOT_FOUND' }, HttpStatus.NOT_FOUND);
                    }
                    if (doctorError) throw doctorError;
                }
            }

            const startTime = body.appointment_time ?? body.start_time;
            const endTime = body.end_time ?? startTime;
            const allowed = this.utils.sanitizePayload({
                appointment_date: body.appointment_date,
                start_time: startTime, end_time: endTime,
                doctor_id: validatedDoctorId, notes: body.notes,
            });

            const { data, error } = await supabase.from('sakhi_clinic_appointments').update(allowed).eq('id', id).select().single();
            if (error?.code === 'PGRST116') {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (error) throw error;
            await this.utils.backfillPatientSnapshot(supabase, id);
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/appointments/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id/status')
    async updateStatus(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) {
            throw new HttpException({ success: false, error: 'Invalid appointment id', code: 'INVALID_APPOINTMENT_ID' }, HttpStatus.BAD_REQUEST);
        }
        const supabase = this.supabaseService.getClient();
        try {
            const status = body?.status;
            if (!status || !this.allowedStatuses.includes(status)) {
                throw new HttpException({ success: false, error: 'Invalid status value', code: 'INVALID_STATUS' }, HttpStatus.BAD_REQUEST);
            }

            const { data: appointment, error: appointmentError } = await supabase
                .from('sakhi_clinic_appointments').select('status').eq('id', id).single();
            if (appointmentError?.code === 'PGRST116' || !appointment) {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (appointmentError) throw appointmentError;
            if (appointment.status === 'Completed') {
                throw new HttpException({ success: false, error: 'Cannot update a completed appointment', code: 'STATUS_IMMUTABLE_COMPLETED' }, HttpStatus.BAD_REQUEST);
            }

            const timestamp = new Date().toISOString();
            const cancellationReason = body?.cancellation_reason ?? body?.reason ?? 'Cancelled by frontdesk';
            const payload = this.utils.sanitizePayload({
                status,
                cancellation_reason: status === 'Canceled' ? cancellationReason : undefined,
                cancelled_at: status === 'Canceled' ? timestamp : undefined,
                arrived_at: status === 'Arrived' ? timestamp : undefined,
                checked_in_at: status === 'Checked-In' ? timestamp : undefined,
                completed_at: status === 'Completed' ? timestamp : undefined,
            });

            const { data, error } = await supabase.from('sakhi_clinic_appointments').update(payload).eq('id', id).select().single();
            if (error?.code === 'PGRST116') {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/appointments/${id}/status`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
