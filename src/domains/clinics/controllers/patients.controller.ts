import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Logger, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { PatientEvent } from '../../../infrastructure/events/event-payloads';
import { isValidPhoneNumber, formatPhoneNumber } from '../../../common/validators/phone.validator';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsUtilsService } from '../services/clinics-utils.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { Permissions } from '../../../infrastructure/security/permissions.decorator';
import * as bcrypt from 'bcrypt';

@Controller('api/v1/clinics/patients')
@UseGuards(ClinicsAuthGuard, PermissionsGuard)
export class PatientsController {
    private readonly logger = new Logger(PatientsController.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly utils: ClinicsUtilsService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) { }

    @Get()
    async list(@Query('phone') phone?: string, @Query('q') q?: string, @Query('page') page = '1', @Query('limit') limit = '20') {
        const clinic_id = TenantContext.getClinicId();
        const role = TenantContext.getRole()?.toLowerCase();
        const isCroOrAdmin = role === 'cro' || role === 'admin';

        if (!clinic_id && !isCroOrAdmin) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;
        try {
            let query = supabase.from('sakhi_clinic_patients').select('*', { count: 'exact' });
            if (clinic_id) {
                query = query.eq('clinic_id', clinic_id);
            }
            if (phone) query = query.eq('mobile', phone);
            else if (q) {
                const safeQ = q.replace(/[,\.()"]/g, '');
                query = query.or(`name.ilike.%${safeQ}%,mobile.ilike.%${safeQ}%`);
            } else query = query.order('created_at', { ascending: false });
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
            const rawName = tv(body?.name);
            const mobile = tv(body?.mobile) ?? tv(body?.phone);
            const marital_status = tv(body?.marital_status) ?? tv(body?.maritalStatus) ?? null;
            const registration_date = tv(body?.registration_date) || tv(body?.date) || new Date().toISOString().slice(0, 10);
            const gender = tv(body?.gender) || null;

            if (!rawName || !mobile) {
                throw new HttpException({ success: false, error: 'name and mobile (or phone) are required' }, HttpStatus.BAD_REQUEST);
            }

            // Normalize name: trim whitespace, collapse multiple spaces, title-case consistency
            const name = String(rawName).trim().replace(/\s+/g, ' ');

            // Strict number format check (supports 10-15 digits, optional leading +)
            const mobileStr = String(mobile).trim();
            if (!isValidPhoneNumber(mobileStr)) {
                throw new HttpException({ success: false, error: 'Invalid mobile number format. Must be a valid 10-15 digit number.' }, HttpStatus.BAD_REQUEST);
            }

            const cleanMobile = formatPhoneNumber(mobileStr);

            // Allow multiple family members to share the same mobile number.
            // Only block exact duplicates where both name AND mobile match within the same clinic.
            // Using .limit(1) instead of .maybeSingle() to safely handle pre-existing duplicates in the DB.
            const { data: exactDuplicates, error: existingError } = await supabase
                .from('sakhi_clinic_patients').select('id').eq('clinic_id', clinic_id).eq('mobile', cleanMobile).ilike('name', name).limit(1);
            if (existingError) throw existingError;
            if (exactDuplicates && exactDuplicates.length > 0) {
                throw new HttpException({ success: false, error: 'A patient with this exact name and mobile number already exists' }, HttpStatus.CONFLICT);
            }

            const uhid = tv(body?.uhid) || (await this.utils.generateUhid(supabase));
            const rawPin = Math.floor(1000 + Math.random() * 9000).toString();
            const pin_hash = await bcrypt.hash(rawPin, 10);

            const payload = this.utils.sanitizePayload({
                clinic_id, uhid, lead_id: tv(body.lead_id), name, relation: tv(body.relation), marital_status, gender,
                dob: tv(body.dob), age: tv(body.age), blood_group: tv(body.blood_group) ?? tv(body.bloodGroup),
                aadhar: tv(body.aadhar), mobile: cleanMobile, email: tv(body.email), house: tv(body.house),
                street: tv(body.street) ?? tv(body.address), area: tv(body.area), city: tv(body.city),
                district: tv(body.district), state: tv(body.state),
                postal_code: tv(body.postal_code) ?? tv(body.postalCode),
                emergency_contact_name: tv(body.emergency_contact_name),
                emergency_contact_phone: tv(body.emergency_contact_phone),
                emergency_contact_relation: tv(body.emergency_contact_relation),
                assigned_doctor_id: tv(body.assigned_doctor_id),
                referral_doctor: tv(body.referral_doctor) ?? tv(body.referralDoctor),
                registration_date, status: tv(body.status),
                pin_hash // Save the newly generated PIN
            });

            const { data, error } = await supabase.from('sakhi_clinic_patients').insert(payload).select().single();
            if (error) throw error;

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_CREATED, new PatientEvent(
                clinic_id, actor_id, data.id, { action: 'create_patient' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data, generatedPin: rawPin };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            // Handle DB unique constraint violation gracefully (uq_clinic_patient_mobile)
            // This fires when the DB-level UNIQUE(clinic_id, mobile) constraint hasn't been dropped yet.
            if (error?.code === '23505') {
                this.logger.warn('DB unique constraint hit on mobile — constraint needs to be dropped for family member support', { clinic_id, mobile: body?.mobile || body?.phone });
                throw new HttpException({ success: false, error: 'A patient with this mobile number already exists. To register family members with the same number, the database constraint must be updated.' }, HttpStatus.CONFLICT);
            }
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

            const { data: abhaData, error: abhaError } = await supabase
                .from('patient_abha')
                .select('abha_number, abha_address, verification_status, is_active, verified_at')
                .eq('patient_id', id)
                .eq('is_active', true)
                .single();

            data.abha = (!abhaError && abhaData) ? abhaData : null;

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`GET /api/patients/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id/dashboard-metrics')
    async getPatientDashboardData(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        const supabase = this.supabaseService.getClient();

        try {
            // Fire all 4 requests in parallel to minimize latency
            const [vitalsRes, allergiesRes, historyRes, treatmentsRes] = await Promise.all([
                supabase.from('sakhi_clinic_patient_vitals')
                    .select('vital_type, vital_value, recorded_at')
                    .eq('patient_id', id)
                    .order('recorded_at', { ascending: false }).limit(100),
                supabase.from('sakhi_clinic_allergies')
                    .select('allergy_name, severity')
                    .eq('patient_id', id).eq('clinic_id', clinic_id),
                supabase.from('sakhi_clinic_medical_history')
                    .select('condition_name, status')
                    .eq('patient_id', id).eq('clinic_id', clinic_id),
                supabase.from('sakhi_clinic_treatments')
                    .select('treatment_name, status')
                    .eq('patient_id', id).eq('clinic_id', clinic_id)
                    .in('status', ['PLANNED', 'IN_PROGRESS'])
            ]);

            // Data Handling & Empty Fallbacks
            return {
                success: true,
                data: {
                    vitals: vitalsRes.data?.length ? vitalsRes.data : [{ vital_type: 'System', vital_value: 'No Vitals Logged' }],
                    allergies: allergiesRes.data?.length ? allergiesRes.data : [{ allergy_name: 'No Known Allergies [NKA]' }],
                    medicalHistory: historyRes.data?.length ? historyRes.data : [{ condition_name: 'No Prior Medical History' }],
                    ongoingTreatments: treatmentsRes.data?.length ? treatmentsRes.data : [{ treatment_name: 'No Active Treatments' }]
                }
            };
        } catch (error: any) {
            this.logger.error(`GET /api/patients/${id}/dashboard-metrics`, error);
            throw new HttpException('Parallel Fetch Failed', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/vitals')
    @Permissions('can_view_patients')
    async addVitals(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const items = Array.isArray(body) 
                ? body 
                : (Array.isArray(body?.vitals) ? body.vitals : [body]);

            const validPayloads = items
                .map((item: any) => {
                    const vitalType = item?.vital_type ?? item?.type;
                    const vitalValue = item?.vital_value ?? item?.value;
                    if (!vitalType || vitalValue === undefined || vitalValue === null || String(vitalValue).trim() === '') {
                        return null;
                    }
                    return {
                        patient_id: id,
                        clinic_id: clinic_id,
                        appointment_id: item.appointment_id || body?.appointment_id || null,
                        vital_type: vitalType,
                        vital_value: String(vitalValue),
                        recorded_at: item.recorded_at || body?.recorded_at || new Date().toISOString()
                    };
                })
                .filter(Boolean);

            if (validPayloads.length === 0) {
                throw new HttpException({ success: false, error: 'vital_type and value are required' }, HttpStatus.BAD_REQUEST);
            }

            const { data, error } = await supabase
                .from('sakhi_clinic_patient_vitals')
                .insert(validPayloads)
                .select();
                
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'add_vitals', count: validPayloads.length }
            ));

            return { success: true, data: Array.isArray(body) || Array.isArray(body?.vitals) ? data : data?.[0] };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/vitals`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete(':id/vitals/:vitalId')
    @Permissions('can_view_patients')
    async deleteVitals(@Param('id') id: string, @Param('vitalId') vitalId: string) {
        if (!this.utils.isUuid(id) || !this.utils.isUuid(vitalId)) throw new HttpException({ success: false, error: 'Invalid id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { error } = await supabase.from('sakhi_clinic_patient_vitals')
                .delete()
                .eq('id', vitalId)
                .eq('patient_id', id); // Vitals table does not have clinic_id, isolated via patient_id which belongs to clinic
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'delete_vital', vital_id: vitalId }
            ));

            return { success: true, message: 'Vitals record deleted' };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`DELETE /api/patients/${id}/vitals/${vitalId}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/allergies')
    @Permissions('can_view_patients')
    async addAllergy(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            if (!body?.allergy_name) {
                throw new HttpException({ success: false, error: 'allergy_name is required' }, HttpStatus.BAD_REQUEST);
            }

            const payload = {
                patient_id: id,
                clinic_id,
                appointment_id: body.appointment_id || null,
                allergy_name: body.allergy_name,
                severity: body.severity || 'MEDIUM',
                reaction: body.reaction || null
            };

            const { data, error } = await supabase.from('sakhi_clinic_allergies').insert(payload).select().single();
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'add_allergy', allergy_name: body.allergy_name }
            ));

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/allergies`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id/allergies/:allergyId')
    @Permissions('can_view_patients')
    async updateAllergy(@Param('id') id: string, @Param('allergyId') allergyId: string, @Body() body: any) {
        if (!this.utils.isUuid(id) || !this.utils.isUuid(allergyId)) throw new HttpException({ success: false, error: 'Invalid id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const updates: any = {};
            if (body.severity) updates.severity = body.severity;
            if (body.reaction !== undefined) updates.reaction = body.reaction;

            if (Object.keys(updates).length === 0) {
                return { success: true, message: 'No updates provided' };
            }

            const { data, error } = await supabase.from('sakhi_clinic_allergies')
                .update(updates)
                .eq('id', allergyId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .select().single();
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'update_allergy', allergy_id: allergyId, severity: body.severity }
            ));

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/patients/${id}/allergies/${allergyId}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete(':id/allergies/:allergyId')
    @Permissions('can_view_patients')
    async deleteAllergy(@Param('id') id: string, @Param('allergyId') allergyId: string) {
        if (!this.utils.isUuid(id) || !this.utils.isUuid(allergyId)) throw new HttpException({ success: false, error: 'Invalid id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { error } = await supabase.from('sakhi_clinic_allergies')
                .delete()
                .eq('id', allergyId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id);
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'delete_allergy', allergy_id: allergyId }
            ));

            return { success: true, message: 'Allergy deleted' };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`DELETE /api/patients/${id}/allergies/${allergyId}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/medical-history')
    @Permissions('can_view_patients')
    async addMedicalHistory(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            if (!body?.condition_name) {
                throw new HttpException({ success: false, error: 'condition_name is required' }, HttpStatus.BAD_REQUEST);
            }

            // Check for duplicate active conditions
            const { data: existingConditions } = await supabase.from('sakhi_clinic_medical_history')
                .select('id')
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .eq('condition_name', body.condition_name)
                .eq('status', 'ACTIVE');

            if (existingConditions && existingConditions.length > 0) {
                return { success: true, message: 'Patient already has an active condition with this name', data: existingConditions[0] };
            }

            const payload = {
                patient_id: id,
                clinic_id,
                appointment_id: body.appointment_id || null,
                condition_name: body.condition_name,
                status: body.status || 'ACTIVE',
                diagnosis_date: body.diagnosis_date || null
            };

            const { data, error } = await supabase.from('sakhi_clinic_medical_history').insert(payload).select().single();
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'add_medical_history', condition_name: body.condition_name }
            ));

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/medical-history`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete(':id/medical-history/:historyId')
    @Permissions('can_view_patients')
    async deleteMedicalHistory(@Param('id') id: string, @Param('historyId') historyId: string) {
        if (!this.utils.isUuid(id) || !this.utils.isUuid(historyId)) throw new HttpException({ success: false, error: 'Invalid id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { error } = await supabase.from('sakhi_clinic_medical_history')
                .delete()
                .eq('id', historyId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id);
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'delete_medical_history', history_id: historyId }
            ));

            return { success: true, message: 'Medical history deleted' };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`DELETE /api/patients/${id}/medical-history/${historyId}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id/medical-history/:historyId/resolve')
    @Permissions('can_view_patients')
    async resolveMedicalHistory(@Param('id') id: string, @Param('historyId') historyId: string) {
        if (!this.utils.isUuid(id) || !this.utils.isUuid(historyId)) throw new HttpException({ success: false, error: 'Invalid id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase.from('sakhi_clinic_medical_history')
                .update({ status: 'RESOLVED' })
                .eq('id', historyId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .select().single();
            if (error) throw error;

            // Audit Log
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id,
                TenantContext.getUserId(),
                id,
                { action: 'resolve_medical_history', history_id: historyId }
            ));

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/patients/${id}/medical-history/${historyId}/resolve`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id/timeline')
    async getTimeline(
        @Param('id') id: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('types') types?: string
    ) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 20;
            const from = (pageNum - 1) * limitNum;
            const to = from + limitNum - 1;

            let query = supabase.from('sakhi_clinic_patient_timeline_view').select('*', { count: 'exact' })
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id);

            if (types) {
                const typeArray = types.split(',').map(t => t.trim().toUpperCase());
                if (typeArray.length > 0) {
                    query = query.in('event_type', typeArray);
                }
            }

            const { data, count, error } = await query
                .order('event_date', { ascending: false })
                .range(from, to);

            if (error) throw error;
            return { success: true, data: data ?? [], pagination: { page: pageNum, limit: limitNum, total: count ?? 0 } };
        } catch (error: any) {
            this.logger.error(`GET /api/patients/${id}/timeline`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id')
    @Permissions('can_manage_schedule')
    async update(@Param('id') id: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const tv = this.utils.toValue.bind(this.utils);
        try {
            const mobile = tv(body.mobile) ?? tv(body.phone);
            const updatedName = tv(body.name);

            // If both name and mobile are being set, check for exact duplicates (same name + same mobile)
            // to prevent accidentally creating a carbon-copy patient via update.
            if (mobile && updatedName) {
                const normalizedName = String(updatedName).trim().replace(/\s+/g, ' ');
                const { data: dupeCheck } = await supabase
                    .from('sakhi_clinic_patients').select('id').eq('clinic_id', clinic_id).eq('mobile', mobile).ilike('name', normalizedName).neq('id', id).limit(1);
                if (dupeCheck && dupeCheck.length > 0) {
                    throw new HttpException({ success: false, error: 'Another patient with this exact name and mobile number already exists' }, HttpStatus.CONFLICT);
                }
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
                registration_date: tv(body.registration_date) ?? tv(body.date), status: tv(body.status),
            });
            delete (sanitized as any).id;
            delete (sanitized as any).uhid;
            delete (sanitized as any).created_at;
            delete (sanitized as any).clinic_id; // don't allow changing clinic_id

            const { data, error } = await supabase.from('sakhi_clinic_patients').update(sanitized).eq('id', id).eq('clinic_id', clinic_id).select().single();
            if (error?.code === 'PGRST116') throw new HttpException({ success: false, error: 'Patient not found' }, HttpStatus.NOT_FOUND);
            if (error) throw error;

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_UPDATED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'update_patient' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            // Handle DB unique constraint violation gracefully
            if (error?.code === '23505') {
                this.logger.warn('DB unique constraint hit on mobile update — constraint needs to be dropped for family member support', { clinic_id, id });
                throw new HttpException({ success: false, error: 'A patient with this mobile number already exists. To allow shared numbers, the database constraint must be updated.' }, HttpStatus.CONFLICT);
            }
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
    @Permissions('can_write_clinical_notes')
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

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_NOTE_CREATED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'create_clinical_note', note_id: data.id }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

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
    @Permissions('can_write_clinical_notes')
    async createNote(@Param('id') id: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            if (!body?.doctor_id) throw new HttpException({ success: false, error: 'doctor_id is required' }, HttpStatus.BAD_REQUEST);
            const payload = this.utils.sanitizePayload({ clinic_id, patient_id: id, doctor_id: body.doctor_id, appointment_id: body.appointment_id, subjective: body.subjective, objective: body.objective, assessment: body.assessment, plan: body.plan });
            const { data, error } = await supabase.from('sakhi_clinical_notes').insert(payload).select().single();
            if (error) throw error;

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_NOTE_CREATED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'create_structured_note', note_id: data.id }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/notes`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Put(':id/notes/:noteId')
    @Permissions('can_write_clinical_notes')
    async updateNote(@Param('id') id: string, @Param('noteId') noteId: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const actor_id = TenantContext.getUserId();

            // Fetch original note for compliance checks
            const { data: originalNote, error: fetchError } = await supabase.from('sakhi_clinical_notes')
                .select('doctor_id, created_at')
                .eq('id', noteId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .single();

            if (fetchError || !originalNote) {
                throw new HttpException({ success: false, error: 'Note not found' }, HttpStatus.NOT_FOUND);
            }

            // Auth Check
            if (originalNote.doctor_id !== actor_id) {
                throw new HttpException({ success: false, error: 'Unauthorized to edit this note' }, HttpStatus.FORBIDDEN);
            }

            // Time Limit Check (48 hours)
            const hoursSinceCreation = (new Date().getTime() - new Date(originalNote.created_at).getTime()) / (1000 * 60 * 60);
            if (hoursSinceCreation > 48) {
                throw new HttpException({ success: false, error: 'Note is locked and cannot be edited after 48 hours' }, HttpStatus.FORBIDDEN);
            }

            const payload = this.utils.sanitizePayload({ subjective: body.subjective, objective: body.objective, assessment: body.assessment, plan: body.plan, updated_at: new Date().toISOString() });

            const { data, error } = await supabase.from('sakhi_clinical_notes')
                .update(payload)
                .eq('id', noteId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .select().single();
            if (error) throw error;

            await this.eventsQueue.add(DFO_EVENTS.PATIENT_NOTE_UPDATED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'update_structured_note', note_id: noteId }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PUT /api/patients/${id}/notes/${noteId}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete(':id/notes/:noteId')
    @Permissions('can_write_clinical_notes')
    async deleteNote(@Param('id') id: string, @Param('noteId') noteId: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const actor_id = TenantContext.getUserId();

            // Fetch original note for auth check
            const { data: originalNote, error: fetchError } = await supabase.from('sakhi_clinical_notes')
                .select('doctor_id')
                .eq('id', noteId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .single();

            if (fetchError || !originalNote) {
                throw new HttpException({ success: false, error: 'Note not found' }, HttpStatus.NOT_FOUND);
            }

            // Auth Check
            if (originalNote.doctor_id !== actor_id) {
                throw new HttpException({ success: false, error: 'Unauthorized to delete this note' }, HttpStatus.FORBIDDEN);
            }

            // Soft delete
            const { error } = await supabase.from('sakhi_clinical_notes')
                .update({ status: 'DELETED', updated_at: new Date().toISOString() })
                .eq('id', noteId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id);
            if (error) throw error;

            await this.eventsQueue.add(DFO_EVENTS.PATIENT_NOTE_DELETED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'delete_structured_note', note_id: noteId }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`DELETE /api/patients/${id}/notes/${noteId}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id/treatments')
    async getTreatments(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid patient id' }, HttpStatus.BAD_REQUEST);
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase.from('sakhi_clinic_treatments')
                .select('*')
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            this.logger.error(`GET /api/patients/${id}/treatments`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/treatments')
    @Permissions('can_write_clinical_notes')
    async createTreatment(@Param('id') id: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            if (!body?.treatment_name) throw new HttpException({ success: false, error: 'treatment_name is required' }, HttpStatus.BAD_REQUEST);

            // Parent Validation
            if (this.utils.isUuid(body.parent_treatment_id)) {
                const { data: parent, error: parentError } = await supabase.from('sakhi_clinic_treatments')
                    .select('id')
                    .eq('id', body.parent_treatment_id)
                    .eq('patient_id', id)
                    .eq('clinic_id', clinic_id)
                    .single();

                if (parentError || !parent) {
                    throw new HttpException({ success: false, error: 'Invalid parent_treatment_id: Treatment not found or belongs to another patient' }, HttpStatus.BAD_REQUEST);
                }
            }

            const payload = this.utils.sanitizePayload({
                clinic_id,
                patient_id: id,
                doctor_id: this.utils.isUuid(body.doctor_id) ? body.doctor_id : null,
                treatment_name: body.treatment_name,
                description: body.description,
                status: body.status || 'PLANNED',
                cost: body.cost || null,
                parent_treatment_id: this.utils.isUuid(body.parent_treatment_id) ? body.parent_treatment_id : null
            });

            const { data, error } = await supabase.from('sakhi_clinic_treatments').insert(payload).select().single();
            if (error) throw error;

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.TREATMENT_CREATED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'create_treatment', treatment_id: data.id }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/patients/${id}/treatments`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Put(':id/treatments/:treatmentId')
    @Permissions('can_write_clinical_notes')
    async updateTreatment(@Param('id') id: string, @Param('treatmentId') treatmentId: string, @Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            // State Machine Validation
            const { data: existing, error: existingError } = await supabase.from('sakhi_clinic_treatments')
                .select('status')
                .eq('id', treatmentId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .single();

            if (existingError || !existing) {
                throw new HttpException({ success: false, error: 'Treatment not found' }, HttpStatus.NOT_FOUND);
            }

            if (existing.status === 'COMPLETED' && body.status && body.status !== 'COMPLETED') {
                throw new HttpException({ success: false, error: 'Cannot change status of a completed treatment' }, HttpStatus.BAD_REQUEST);
            }
            if (existing.status === 'CANCELLED' && body.status && body.status !== 'CANCELLED') {
                throw new HttpException({ success: false, error: 'Cannot change status of a cancelled treatment' }, HttpStatus.BAD_REQUEST);
            }

            const payload = this.utils.sanitizePayload({
                treatment_name: body.treatment_name,
                description: body.description,
                status: body.status,
                cost: body.cost,
                updated_at: new Date().toISOString()
            });

            const { data, error } = await supabase.from('sakhi_clinic_treatments')
                .update(payload)
                .eq('id', treatmentId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id)
                .select().single();
            if (error) throw error;

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.TREATMENT_UPDATED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'update_treatment', treatment_id: treatmentId }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PUT /api/patients/${id}/treatments/${treatmentId}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete(':id/treatments/:treatmentId')
    @Permissions('can_write_clinical_notes')
    async deleteTreatment(@Param('id') id: string, @Param('treatmentId') treatmentId: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            // Soft delete
            const { error } = await supabase.from('sakhi_clinic_treatments')
                .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
                .eq('id', treatmentId)
                .eq('patient_id', id)
                .eq('clinic_id', clinic_id);
            if (error) throw error;

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.TREATMENT_DELETED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'delete_treatment', treatment_id: treatmentId }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true };
        } catch (error: any) {
            this.logger.error(`DELETE /api/patients/${id}/treatments/${treatmentId}`, error);
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
    @Permissions('can_view_patients')
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

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_DOCUMENT_UPLOADED, new PatientEvent(
                clinic_id, actor_id, id, { action: 'upload_patient_document', document_id: data.id, document_type }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

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

            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.PATIENT_PIN_RESET, new PatientEvent(
                clinic_id, actor_id, id, { action: 'reset_patient_pin' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

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
