import { Controller, Get, Post, Patch, Param, Query, Body, Logger, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { AppointmentEvent } from '../../../infrastructure/events/event-payloads';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsUtilsService } from '../services/clinics-utils.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';

@Controller('api/v1/clinics/appointments')
@UseGuards(ClinicsAuthGuard)
export class AppointmentsController {
    private readonly logger = new Logger(AppointmentsController.name);
    private readonly allowedTypes = ['Consultation', 'Follow-up', 'Procedure', 'Emergency', 'Scan', 'Surgery', 'Camp'];
    private readonly allowedStatuses = ['Scheduled', 'Arrived', 'Checked-In', 'In-Consultation', 'Completed', 'Canceled', 'Expected'];

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly utils: ClinicsUtilsService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) {}

    @Get()
    async list(
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('date') date?: string,
        @Query('status') status?: string,
        @Query('patient_id') patientId?: string,
        @Query('doctor_id') doctorId?: string,
        @Query('start_date') startDate?: string,
        @Query('end_date') endDate?: string
    ) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();

        try {
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            const start = (pageNum - 1) * limitNum;
            const end = start + limitNum - 1;

            let query = supabase.from('sakhi_clinic_appointments')
                .select(`id, patient_id, lead_id, doctor_id, appointment_date, start_time, end_time, type, status, queue_status, token_number, visit_reason, resource_id, patient_name_snapshot, sex_snapshot, doctor_name_snapshot, patient_phone_snapshot, patient_dob_snapshot, patient_age_snapshot, cancellation_reason, cancelled_at, created_at, doctor:sakhi_clinic_users!doctor_id(first_name, last_name), patient:sakhi_clinic_patients!patient_id(name)`, { count: 'exact' })
                .eq('clinic_id', clinic_id);

            if (date) query = query.eq('appointment_date', date);
            if (startDate) query = query.gte('appointment_date', startDate);
            if (endDate) query = query.lte('appointment_date', endDate);
            if (status) query = query.eq('status', status);
            if (patientId && this.utils.isUuid(patientId)) query = query.eq('patient_id', patientId);
            if (doctorId && this.utils.isUuid(doctorId)) query = query.eq('doctor_id', doctorId);

            const { data, count, error } = await query.order('appointment_date', { ascending: false }).order('start_time', { ascending: false }).range(start, end);
            if (error) throw error;

            return { success: true, data: data || [], meta: { page: pageNum, limit: limitNum, total: count || 0 } };
        } catch (error: any) {
            this.logger.error('GET /api/v1/clinics/appointments', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('doctors')
    async getDoctors() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();

        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .select('id, first_name, last_name, specialization, role')
                .eq('clinic_id', clinic_id)
                .in('role', ['Doctor', 'Superadmin', 'Admin'])
                .order('first_name');
            if (error) throw error;
            
            const mappedData = (data || []).map(d => ({
                ...d,
                name: `${d.first_name || ''} ${d.last_name || ''}`.trim()
            }));
            
            return { success: true, data: mappedData };
        } catch (error: any) {
            this.logger.error('GET /api/v1/clinics/appointments/doctors', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post()
    async create(@Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();

        // Note: The system assumes all clinics operate strictly in Indian Standard Time (IST).
        // Time strings (e.g., '09:00') and dates (e.g., '2023-10-15') are processed without UTC conversion.
        try {
            let patient_id = body.patient_id;
            let lead_id = body.lead_id;
            let appointment_date = body.appointment_date;
            let start_time = body.start_time;
            let end_time = body.end_time;

            if (patient_id) lead_id = null; // Strip lead_id if patient is present to prevent bypass

            if (appointment_date) {
                if (isNaN(new Date(appointment_date).getTime())) throw new HttpException({ success: false, error: 'Invalid appointment_date' }, HttpStatus.BAD_REQUEST);
                const now = new Date();
                const localDateStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
                if (appointment_date < localDateStr) {
                    throw new HttpException({ success: false, error: 'appointment_date cannot be in the past' }, HttpStatus.BAD_REQUEST);
                }
            } else {
                const now = new Date();
                appointment_date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
            }

            if (start_time && !/^([01]\d|2[0-3]):?([0-5]\d)$/.test(start_time)) {
                throw new HttpException({ success: false, error: 'Invalid start_time format (HH:MM expected)' }, HttpStatus.BAD_REQUEST);
            }

            if (!start_time) {
                const now = new Date();
                start_time = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[1].slice(0, 5);
            }

            if (!end_time) {
                const [h, m] = start_time.split(':').map(Number);
                const endM = (m + 15) % 60;
                const endH = h + Math.floor((m + 15) / 60);
                end_time = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
            }

            // Ensure start_time is padded to 5 chars (HH:MM) just in case the regex changes
            if (start_time.length === 4) start_time = '0' + start_time;
            
            if (end_time <= start_time) {
                throw new HttpException({ success: false, error: 'end_time must be strictly after start_time. Overnight appointments are not supported.' }, HttpStatus.BAD_REQUEST);
            }

            const doctorIdRaw = body.doctor_id;
            let doctor_id = doctorIdRaw && this.utils.isUuid(doctorIdRaw) ? doctorIdRaw : null;
            
            if (doctor_id) {
                const availability = await this.utils.checkGlobalDoctorAvailability(
                    supabase,
                    doctor_id,
                    appointment_date,
                    start_time,
                    end_time
                );

                if (!availability.isAvailable) {
                    throw new HttpException(
                        { 
                            success: false, 
                            error: availability.conflictClinicId === clinic_id 
                                ? 'Double Booking Detected. This slot is already taken at this clinic.' 
                                : 'Scheduling Conflict. The doctor is already booked at another clinic during this time slot.'
                        }, 
                        HttpStatus.BAD_REQUEST
                    );
                }
            }

            const requestedType = typeof body.type === 'string' ? body.type : '';
            let type = 'Consultation';
            const normalizedType = requestedType.trim();
            if (this.allowedTypes.includes(normalizedType)) type = normalizedType;
            else if (!normalizedType || /ivf/i.test(normalizedType) || /other/i.test(normalizedType)) type = 'Consultation';

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

            if (!doctorNameSnapshot && doctor_id) doctorNameSnapshot = doctor_id;

            if (!patient_id && !lead_id) {
                if (body.name && body.phone) {
                    const { data: existingPatient } = await supabase.from('sakhi_clinic_patients').select('id, name, mobile').eq('mobile', body.phone).eq('clinic_id', clinic_id).maybeSingle();
                    if (existingPatient?.id) {
                        patient_id = existingPatient.id;
                        if (!nameSnapshot) nameSnapshot = existingPatient.name;
                        if (!patientPhoneSnapshot) patientPhoneSnapshot = existingPatient.mobile;
                    } else {
                        const { data: existingLead, error: existingLeadError } = await supabase.from('sakhi_clinic_leads').select('id, name, phone').eq('phone', body.phone).eq('clinic_id', clinic_id).maybeSingle();
                        if (existingLeadError && existingLeadError.code !== 'PGRST116') throw existingLeadError;
                        if (existingLead?.id) {
                            lead_id = existingLead.id;
                            if (!nameSnapshot) nameSnapshot = existingLead.name ?? nameSnapshot;
                            if (!patientPhoneSnapshot) patientPhoneSnapshot = existingLead.phone ?? patientPhoneSnapshot;
                        } else {
                            const { data: newLead, error: leadError } = await supabase.from('sakhi_clinic_leads').insert(this.utils.sanitizePayload({ clinic_id, name: body.name, phone: body.phone })).select('id, name, phone').single();
                            if (leadError) throw leadError;
                            lead_id = newLead?.id;
                            if (!nameSnapshot) nameSnapshot = newLead?.name ?? nameSnapshot;
                            if (!patientPhoneSnapshot) patientPhoneSnapshot = newLead?.phone ?? patientPhoneSnapshot;
                        }
                    }
                } else throw new HttpException({ success: false, error: 'patient_id or lead_id is required' }, HttpStatus.BAD_REQUEST);
            }

            if (patient_id) {
                if (!this.utils.isUuid(patient_id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
                const { data: patient, error: patientError } = await supabase.from('sakhi_clinic_patients').select('id, name, mobile').eq('id', patient_id).eq('clinic_id', clinic_id).single();
                if (patientError?.code === 'PGRST116' || !patient) throw new HttpException({ success: false, error: 'Patient not found or belongs to another clinic' }, HttpStatus.NOT_FOUND);
                if (patientError) throw patientError;
                if (!nameSnapshot) nameSnapshot = patient.name;
                if (!patientPhoneSnapshot) patientPhoneSnapshot = patient.mobile;
            } else if (lead_id && (!nameSnapshot || !patientPhoneSnapshot)) {
                const { data: leadRow, error: leadError } = await supabase.from('sakhi_clinic_leads').select('name, phone').eq('id', lead_id).eq('clinic_id', clinic_id).single();
                if (leadError && leadError.code !== 'PGRST116') throw leadError;
                if (leadRow) {
                    if (!nameSnapshot) nameSnapshot = leadRow.name ?? nameSnapshot;
                    if (!patientPhoneSnapshot) patientPhoneSnapshot = leadRow.phone ?? patientPhoneSnapshot;
                }
            }

            if (doctor_id) {
                const { data: doctorRow, error: doctorNameError } = await supabase.from('sakhi_clinic_users').select('name').eq('id', doctor_id).eq('clinic_id', clinic_id).eq('role', 'Doctor').maybeSingle();
                if (doctorNameError && doctorNameError.code !== 'PGRST116') throw doctorNameError;
                if (!doctorRow) throw new HttpException({ success: false, error: 'Doctor not found or invalid role' }, HttpStatus.BAD_REQUEST);
                if (!doctorNameSnapshot || doctorNameSnapshot === doctor_id) doctorNameSnapshot = doctorRow.name;
            }

            const payload = this.utils.sanitizePayload({
                clinic_id, patient_id, lead_id, doctor_id, appointment_date, start_time, end_time, type,
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

            if (doctor_id) {
                // Increment slot count
                await this.utils.incrementSlotBooking(supabase, doctor_id, appointment_date, start_time);
            }

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.APPOINTMENT_CREATED, new AppointmentEvent(
                clinic_id, actor_id, data.id, { action: 'create_appointment' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/v1/clinics/appointments', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) {
            throw new HttpException({ success: false, error: 'Invalid appointment id', code: 'INVALID_APPOINTMENT_ID' }, HttpStatus.BAD_REQUEST);
        }
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();

        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('id, patient_id, lead_id, doctor_id, appointment_date, start_time, end_time, type, status, visit_reason, resource_id, doctor_name_snapshot, cancellation_reason, cancelled_at, created_at, updated_at')
                .eq('id', id)
                .eq('clinic_id', clinic_id)
                .single();
            if (error?.code === 'PGRST116' || !data) {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`GET /api/v1/clinics/appointments/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) {
            throw new HttpException({ success: false, error: 'Invalid appointment id', code: 'INVALID_APPOINTMENT_ID' }, HttpStatus.BAD_REQUEST);
        }
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();

        try {
            const { data: appointment, error: appointmentError } = await supabase
                .from('sakhi_clinic_appointments').select('status, doctor_id, start_time, appointment_date').eq('id', id).eq('clinic_id', clinic_id).single();
            if (appointmentError?.code === 'PGRST116' || !appointment) {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (appointmentError) throw appointmentError;
            if (['Completed', 'Canceled', 'No Show'].includes(appointment.status)) {
                throw new HttpException({ success: false, error: 'Cannot update a finalized appointment', code: 'STATUS_IMMUTABLE' }, HttpStatus.BAD_REQUEST);
            }

            let appointment_date = body.appointment_date ?? appointment.appointment_date;
            let start_time = body.start_time ?? appointment.start_time;

            if (body.appointment_date) {
                if (isNaN(new Date(body.appointment_date).getTime())) throw new HttpException({ success: false, error: 'Invalid appointment_date format' }, HttpStatus.BAD_REQUEST);
                const now = new Date();
                const localDateStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
                if (body.appointment_date < localDateStr) {
                    throw new HttpException({ success: false, error: 'appointment_date cannot be in the past' }, HttpStatus.BAD_REQUEST);
                }
            }

            if (body.start_time && !/^([01]\d|2[0-3]):?([0-5]\d)$/.test(body.start_time)) {
                throw new HttpException({ success: false, error: 'Invalid start_time format (HH:MM expected)' }, HttpStatus.BAD_REQUEST);
            }

            let endTime = body.end_time;
            if (!endTime && start_time) {
                const [h, m] = start_time.split(':').map(Number);
                const endM = (m + 15) % 60;
                const endH = h + Math.floor((m + 15) / 60);
                endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
            }

            // Ensure start_time is padded to 5 chars (HH:MM)
            if (start_time && start_time.length === 4) start_time = '0' + start_time;

            if (start_time && endTime && endTime <= start_time) {
                throw new HttpException({ success: false, error: 'end_time must be strictly after start_time. Overnight appointments are not supported.' }, HttpStatus.BAD_REQUEST);
            }

            let validatedDoctorId = body?.doctor_id;
            if (body?.doctor_id !== undefined) {
                if (!this.utils.isUuid(body.doctor_id)) {
                    validatedDoctorId = undefined;
                } else {
                    const { data: doctor, error: doctorError } = await supabase
                        .from('sakhi_clinic_users').select('id').eq('id', body.doctor_id).eq('clinic_id', clinic_id).eq('role', 'Doctor').single();
                    if (doctorError?.code === 'PGRST116' || !doctor) {
                        throw new HttpException({ success: false, error: 'Doctor not found or invalid role', code: 'DOCTOR_NOT_FOUND' }, HttpStatus.BAD_REQUEST);
                    }
                    if (doctorError) throw doctorError;
                    
                    const checkDocId = validatedDoctorId ?? appointment.doctor_id;
                    if (checkDocId) {
                        const availability = await this.utils.checkGlobalDoctorAvailability(
                            supabase, checkDocId, appointment_date, start_time, endTime, id
                        );
                        if (!availability.isAvailable) {
                            throw new HttpException(
                                { 
                                    success: false, 
                                    error: availability.conflictClinicId === clinic_id 
                                        ? 'Double Booking Detected. This slot is already taken at this clinic.' 
                                        : 'Scheduling Conflict. The doctor is already booked at another clinic during this time slot.'
                                }, 
                                HttpStatus.BAD_REQUEST
                            );
                        }
                    }
                }
            } else if (body.appointment_date || body.start_time) {
                 if (appointment.doctor_id) {
                        const availability = await this.utils.checkGlobalDoctorAvailability(
                            supabase, appointment.doctor_id, appointment_date, start_time, endTime, id
                        );
                        if (!availability.isAvailable) {
                            throw new HttpException(
                                { 
                                    success: false, 
                                    error: availability.conflictClinicId === clinic_id 
                                        ? 'Double Booking Detected. This slot is already taken at this clinic.' 
                                        : 'Scheduling Conflict. The doctor is already booked at another clinic during this time slot.'
                                }, 
                                HttpStatus.BAD_REQUEST
                            );
                        }
                 }
            }

            const allowed = this.utils.sanitizePayload({
                appointment_date: body.appointment_date,
                start_time: body.start_time, end_time: endTime,
                doctor_id: validatedDoctorId, notes: body.notes,
            });

            const oldDoctor = appointment.doctor_id;
            const oldDate = appointment.appointment_date;
            const oldStartTime = appointment.start_time;
            
            const newDoctor = validatedDoctorId ?? oldDoctor;
            const newDate = appointment_date;
            const newStartTime = start_time;
            
            const timeOrDoctorChanged = (oldDoctor !== newDoctor) || (oldDate !== newDate) || (oldStartTime !== newStartTime);

            const { data, error } = await supabase.from('sakhi_clinic_appointments').update(allowed).eq('id', id).eq('clinic_id', clinic_id).select().single();
            if (error?.code === 'PGRST116') {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (error) throw error;

            if (timeOrDoctorChanged) {
                if (oldDoctor) await this.utils.decrementSlotBooking(supabase, oldDoctor, oldDate, oldStartTime);
                if (newDoctor) await this.utils.incrementSlotBooking(supabase, newDoctor, newDate, newStartTime);
            }

            await this.utils.backfillPatientSnapshot(supabase, id);

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.APPOINTMENT_UPDATED, new AppointmentEvent(
                clinic_id, actor_id, id, { action: 'update_appointment' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/v1/clinics/appointments/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id/status')
    async updateStatus(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) {
            throw new HttpException({ success: false, error: 'Invalid appointment id', code: 'INVALID_APPOINTMENT_ID' }, HttpStatus.BAD_REQUEST);
        }
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();

        try {
            const status = body?.status;
            if (!status || !this.allowedStatuses.includes(status)) {
                throw new HttpException({ success: false, error: 'Invalid status value', code: 'INVALID_STATUS' }, HttpStatus.BAD_REQUEST);
            }

            const { data: appointment, error: appointmentError } = await supabase
                .from('sakhi_clinic_appointments').select('status, doctor_id, appointment_date, start_time').eq('id', id).eq('clinic_id', clinic_id).single();
            if (appointmentError?.code === 'PGRST116' || !appointment) {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (appointmentError) throw appointmentError;
            if (['Completed', 'Canceled', 'No Show'].includes(appointment.status)) {
                throw new HttpException({ success: false, error: 'Cannot update a finalized appointment', code: 'STATUS_IMMUTABLE' }, HttpStatus.BAD_REQUEST);
            }

            const timestamp = new Date().toISOString();
            const cancellationReason = body?.cancellation_reason ?? body?.reason ?? 'Cancelled by frontdesk';
            
            let token_number: string | undefined = undefined;
            if (status === 'Checked-In') {
                const { data: currentAppt } = await supabase.from('sakhi_clinic_appointments').select('token_number').eq('id', id).single();
                if (!currentAppt?.token_number && appointment.doctor_id) {
                    token_number = await this.generateSmartToken(supabase, clinic_id, appointment.doctor_id, appointment.appointment_date);
                }
            }

            let queue_status;
            switch (status) {
                case 'Checked-In': queue_status = 'WAITING'; break;
                case 'In-Consultation': queue_status = 'IN_CONSULTATION'; break;
                case 'Completed': queue_status = 'COMPLETED'; break;
                case 'Canceled': queue_status = 'CANCELED'; break;
                case 'No Show': queue_status = 'NO_SHOW'; break;
                case 'Arrived': queue_status = 'ARRIVED'; break;
                case 'Scheduled': queue_status = 'SCHEDULED'; break;
            }

            const payload: any = this.utils.sanitizePayload({
                status,
                queue_status,
                cancellation_reason: status === 'Canceled' ? cancellationReason : undefined,
                cancelled_at: status === 'Canceled' ? timestamp : undefined,
                arrived_at: status === 'Arrived' ? timestamp : undefined,
                checked_in_at: status === 'Checked-In' ? timestamp : undefined,
                completed_at: status === 'Completed' ? timestamp : undefined,
            });

            if (token_number) {
                payload.token_number = token_number;
            }

            const { data, error } = await supabase.from('sakhi_clinic_appointments').update(payload).eq('id', id).eq('clinic_id', clinic_id).select().single();
            if (error?.code === 'PGRST116') {
                throw new HttpException({ success: false, error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
            }
            if (error) throw error;

            if (['Canceled', 'No Show'].includes(status) && !['Canceled', 'No Show'].includes(appointment.status)) {
                if (appointment.doctor_id) {
                    await this.utils.decrementSlotBooking(supabase, appointment.doctor_id, appointment.appointment_date, appointment.start_time);
                }
            } else if (!['Canceled', 'No Show'].includes(status) && ['Canceled', 'No Show'].includes(appointment.status)) {
                if (appointment.doctor_id) {
                    await this.utils.incrementSlotBooking(supabase, appointment.doctor_id, appointment.appointment_date, appointment.start_time);
                }
            }

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.APPOINTMENT_STATUS_CHANGED, new AppointmentEvent(
                clinic_id, actor_id, id, { action: 'update_appointment_status', previousStatus: appointment.status, newStatus: status }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/v1/clinics/appointments/${id}/status`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('walk-in-express')
    async walkInExpress(@Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();

        try {
            const { name, phone, doctor_id, gender, visit_reason } = body;
            if (!name || !phone || !doctor_id) {
                throw new HttpException({ success: false, error: 'Name, phone, and doctor_id are required' }, HttpStatus.BAD_REQUEST);
            }

            // 1. Resolve or Create Patient
            let patient_id;
            // Exact match on mobile and name (case insensitive)
            const { data: existingPatient } = await supabase.from('sakhi_clinic_patients')
                .select('id')
                .eq('mobile', phone)
                .ilike('name', name)
                .eq('clinic_id', clinic_id)
                .maybeSingle();
            
            if (existingPatient?.id) {
                patient_id = existingPatient.id;
            } else {
                const { data: newPatient, error: patientError } = await supabase.from('sakhi_clinic_patients').insert([{
                    clinic_id,
                    name,
                    mobile: phone,
                    gender: gender || 'Unknown',
                    status: 'Active'
                }]).select('id').single();
                if (patientError) throw patientError;
                patient_id = newPatient.id;
            }

            // 2. Determine Token Logic (Smart Tokens)
            const today = new Date();
            const localDateStr = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split('T')[0];
            const currentTimeStr = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split('T')[1].slice(0, 5);

            const tokenNumber = await this.generateSmartToken(supabase, clinic_id, doctor_id, localDateStr);

            // 3. Create Appointment and Check-In
            const payload = {
                clinic_id,
                patient_id,
                doctor_id,
                appointment_date: localDateStr,
                start_time: currentTimeStr,
                type: 'Consultation',
                status: 'Checked-In',
                visit_reason: visit_reason || 'Walk-in',
                token_number: tokenNumber,
                checked_in_at: new Date().toISOString(),
                patient_name_snapshot: name,
                patient_phone_snapshot: phone
            };

            const { data: appointment, error: appointmentError } = await supabase.from('sakhi_clinic_appointments').insert([payload]).select().single();
            if (appointmentError) throw appointmentError;

            // Trigger events
            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.APPOINTMENT_CREATED, new AppointmentEvent(
                clinic_id, actor_id, appointment.id, { action: 'walk_in_express' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data: appointment, token: tokenNumber };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/v1/clinics/appointments/walk-in-express`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private async generateSmartToken(supabase: any, clinic_id: string, doctor_id: string, dateStr: string): Promise<string> {
        // Check how many doctors in clinic
        const { count: doctorCount } = await supabase.from('sakhi_clinic_users')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', clinic_id).eq('role', 'Doctor');

        let prefix = 'T-';
        if (doctorCount && doctorCount > 1 && doctor_id) {
            // Get doctor name for prefix
            const { data: doctor } = await supabase.from('sakhi_clinic_users').select('first_name, last_name').eq('id', doctor_id).single();
            if (doctor && doctor.first_name) {
                let init = doctor.first_name.charAt(0).toUpperCase();
                if (doctor.last_name) {
                    init += doctor.last_name.charAt(0).toUpperCase();
                } else {
                    init = doctor.first_name.substring(0, 3).toUpperCase();
                }
                prefix = init + '-';
            }
        }

        // Count today's active appointments to determine queue number
        const { count: appointmentsCount } = await supabase.from('sakhi_clinic_appointments')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', clinic_id)
            .eq('appointment_date', dateStr)
            .not('token_number', 'is', null);
        
        // Note: For extreme concurrency, we might want to check if the generated token already exists in a retry loop.
        // Or simply rely on the count of appointments that ALREADY have a token today.
        const nextQueueNumber = (appointmentsCount || 0) + 1;
        return `${prefix}${nextQueueNumber}`;
    }
}

