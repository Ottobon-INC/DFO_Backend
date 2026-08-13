import { Controller, Post, Get, Delete, Param, Query, Body, Logger, HttpException, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { normalizeStatus } from '../helpers/leads.helpers';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { CreateClinicDto } from '../dto/create-clinic.dto';
import { StaffCacheService } from '../services/staff-cache.service';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { StaffEvent } from '../../../infrastructure/events/event-payloads';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

@Controller('api/v1/superadmin')
@UseGuards(SuperAdminGuard)
export class SuperAdminController {
    private readonly logger = new Logger(SuperAdminController.name);
    private analyticsCache: { total_clinics: number, total_patients: number, total_files: number } | null = null;
    private cacheExpiry: number = 0;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly staffCache: StaffCacheService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) {}

    @Post('clinics')
    async createClinic(@Req() req: any, @Body() body: CreateClinicDto) {
        const { clinic_name, owner_name, owner_email, owner_role, request_id } = body;
        const supabase = this.supabaseService.getClient();
        const super_admin_id = req.user?.sub;

        if (!super_admin_id) {
            throw new HttpException({ success: false, error: 'Unauthorized: Missing super admin identity' }, HttpStatus.UNAUTHORIZED);
        }

        try {
            const idempotency_key = request_id || uuidv4();
            const tempPassword = 'Temporary123!';
            const password_hash = await bcrypt.hash(tempPassword, 10);
            const role = owner_role || 'Doctor';

            // Call atomic RPC
            const { data: rpcData, error: rpcError } = await supabase.rpc('atomic_create_clinic', {
                p_request_id: idempotency_key,
                p_clinic_name: clinic_name,
                p_owner_name: owner_name,
                p_owner_email: owner_email,
                p_owner_role: role,
                p_password_hash: password_hash,
                p_super_admin_id: super_admin_id
            });

            if (rpcError) {
                this.logger.error('RPC execution failed', rpcError);
                throw new HttpException({ success: false, error: 'Internal Server Error during creation' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // Check structured response
            if (rpcData?.status === 'error') {
                if (rpcData.code === 'EMAIL_ALREADY_REGISTERED') {
                    // Log the conflict
                    this.logger.warn(`Clinic creation failed: Email ${owner_email} is already registered.`);
                    
                    // Emit event for observability
                    await this.eventsQueue.add('CLINIC_CREATION_FAILED', {
                        action: 'clinic_creation_conflict',
                        email: owner_email,
                        super_admin_id,
                        timestamp: new Date().toISOString()
                    }, { attempts: 3 });

                    throw new HttpException({ 
                        success: false, 
                        error: 'Owner email is already registered. Please use a different email address.',
                        code: 'EMAIL_ALREADY_REGISTERED',
                        conflict_email: owner_email
                    }, HttpStatus.CONFLICT);
                }
                
                if (rpcData.code === 'UNAUTHORIZED') {
                    throw new HttpException({ success: false, error: rpcData.message }, HttpStatus.FORBIDDEN);
                }
                
                throw new HttpException({ success: false, error: rpcData.message || 'Unknown error occurred' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // Success (either new creation or idempotent hit)
            const isIdempotent = rpcData.idempotent === true;
            if (isIdempotent) {
                this.logger.log(`Idempotent hit for clinic creation request ${idempotency_key}`);
            }

            return { 
                success: true, 
                message: isIdempotent ? 'Clinic already created (idempotent request)' : 'Clinic and Admin created successfully',
                data: {
                    clinic: { id: rpcData.clinic_id, name: clinic_name },
                    admin: { id: rpcData.admin_id, name: owner_name, email: owner_email, role, clinic_id: rpcData.clinic_id, is_clinic_admin: true }
                } 
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/v1/superadmin/clinics', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('clinics')
    async getClinics() {
        const supabase = this.supabaseService.getClient();
        try {
            const { data: clinics, error } = await supabase
                .from('clinics')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false });

            if (error) throw error;
            
            const { data: users, error: usersError } = await supabase
                .from('sakhi_clinic_users')
                .select('clinic_id, id');
            
            if (usersError) throw usersError;

            const clinicsWithCounts = (clinics || []).map(clinic => ({
                ...clinic,
                users_count: (users || []).filter((u: any) => u.clinic_id === clinic.id).length
            }));

            return { success: true, data: clinicsWithCounts };
        } catch (error: any) {
            this.logger.error('GET /api/v1/superadmin/clinics', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    @Get('analytics')
    async getAnalytics() {
        if (Date.now() < this.cacheExpiry && this.analyticsCache) {
            return { success: true, data: this.analyticsCache, cached: true };
        }

        const supabase = this.supabaseService.getClient();
        try {
            const results = await Promise.allSettled([
                supabase.from('clinics').select('*', { count: 'exact', head: true }).eq('is_active', true),
                supabase.from('sakhi_clinic_patients').select('*', { count: 'exact', head: true }),
                supabase.from('sakhi_clinic_documents').select('*', { count: 'exact', head: true })
            ]);

            const total_clinics = results[0].status === 'fulfilled' && !results[0].value.error ? results[0].value.count : 0;
            const total_patients = results[1].status === 'fulfilled' && !results[1].value.error ? results[1].value.count : 0;
            const total_files = results[2].status === 'fulfilled' && !results[2].value.error ? results[2].value.count : 0;

            if (results[0].status === 'rejected' || (results[0].status === 'fulfilled' && results[0].value.error)) {
                this.logger.warn('Failed to fetch clinics count: ' + JSON.stringify(results[0]));
            }
            if (results[1].status === 'rejected' || (results[1].status === 'fulfilled' && results[1].value.error)) {
                this.logger.warn('Failed to fetch patients count: ' + JSON.stringify(results[1]));
            }
            if (results[2].status === 'rejected' || (results[2].status === 'fulfilled' && results[2].value.error)) {
                this.logger.warn('Failed to fetch documents count: ' + JSON.stringify(results[2]));
            }

            this.analyticsCache = {
                total_clinics: total_clinics || 0,
                total_patients: total_patients || 0,
                total_files: total_files || 0
            };
            this.cacheExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes TTL

            return {
                success: true,
                data: this.analyticsCache
            };
        } catch (error: any) {
            this.logger.error('GET /api/v1/superadmin/analytics', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    // =========================================================
    // Per-Clinic Analytics Drill-down
    // =========================================================
    @Get('clinics/:id/analytics')
    async getClinicAnalytics(@Param('id') id: string, @Query('period') period?: string) {
        const supabase = this.supabaseService.getClient();
        try {
            // Validate clinic exists
            const { data: clinic, error: clinicError } = await supabase
                .from('clinics')
                .select('id, name, created_at')
                .eq('id', id)
                .single();

            if (clinicError?.code === 'PGRST116' || !clinic) {
                throw new HttpException({ success: false, error: 'Clinic not found' }, HttpStatus.NOT_FOUND);
            }
            if (clinicError) throw clinicError;

            const dateFilter = this.getDateFilter(period);

            // Parallel fetch all data for this clinic
            const results = await Promise.allSettled([
                // 0: Leads (all for pipeline, filtered by date)
                supabase.from('sakhi_clinic_leads')
                    .select('status, source, date_added')
                    .eq('clinic_id', id)
                    .gte('date_added', dateFilter),
                // 1: Patients count
                supabase.from('sakhi_clinic_patients')
                    .select('*', { count: 'exact', head: true })
                    .eq('clinic_id', id),
                // 2: Appointments (filtered by date)
                supabase.from('sakhi_clinic_appointments')
                    .select('source, queue_status, appointment_date')
                    .eq('clinic_id', id)
                    .gte('appointment_date', dateFilter),
                // 3: Staff count
                supabase.from('sakhi_clinic_users')
                    .select('*', { count: 'exact', head: true })
                    .eq('clinic_id', id)
                    .eq('is_active', true),
                // 4: All-time leads for total count
                supabase.from('sakhi_clinic_leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('clinic_id', id),
            ]);

            // Extract data safely
            const leads = results[0].status === 'fulfilled' && !results[0].value.error ? (results[0].value.data || []) : [];
            const totalPatients = results[1].status === 'fulfilled' && !results[1].value.error ? (results[1].value.count || 0) : 0;
            const appointments = results[2].status === 'fulfilled' && !results[2].value.error ? (results[2].value.data || []) : [];
            const totalStaff = results[3].status === 'fulfilled' && !results[3].value.error ? (results[3].value.count || 0) : 0;
            const totalLeadsAllTime = results[4].status === 'fulfilled' && !results[4].value.error ? (results[4].value.count || 0) : 0;

            // Build lead pipeline
            const leadPipeline: Record<string, number> = {};
            const leadSources: Record<string, number> = {};
            let convertedCount = 0;

            leads.forEach((lead: any) => {
                const status = normalizeStatus(lead.status);
                leadPipeline[status] = (leadPipeline[status] || 0) + 1;
                if (['Converted', 'Converted Patient', 'Converted - Active Patient'].includes(status)) {
                    convertedCount++;
                }

                const source = this.normalizeSource(lead.source);
                leadSources[source] = (leadSources[source] || 0) + 1;
            });

            // Build appointment source breakdown
            const appointmentSources: Record<string, number> = {};
            appointments.forEach((appt: any) => {
                const source = this.normalizeSource(appt.source);
                appointmentSources[source] = (appointmentSources[source] || 0) + 1;
            });

            const conversionRate = leads.length > 0 ? ((convertedCount / leads.length) * 100).toFixed(1) + '%' : '0%';

            return {
                success: true,
                data: {
                    clinic_id: clinic.id,
                    clinic_name: clinic.name,
                    period: period || 'all',
                    overview: {
                        total_leads: totalLeadsAllTime,
                        total_patients: totalPatients,
                        total_appointments: appointments.length,
                        total_staff: totalStaff,
                    },
                    lead_pipeline: leadPipeline,
                    lead_sources: leadSources,
                    appointment_sources: appointmentSources,
                    conversion_rate: conversionRate,
                    leads_in_period: leads.length,
                },
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`GET /api/v1/superadmin/clinics/${id}/analytics`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    // =========================================================
    // Enhanced Global Overview (with lead funnel data)
    // =========================================================
    @Get('analytics/overview')
    async getAnalyticsOverview(@Query('period') period?: string) {
        const supabase = this.supabaseService.getClient();
        try {
            const dateFilter = this.getDateFilter(period);

            const results = await Promise.allSettled([
                // 0: Active clinics
                supabase.from('clinics').select('id, name, created_at').eq('is_active', true),
                // 1: Total patients
                supabase.from('sakhi_clinic_patients').select('*', { count: 'exact', head: true }),
                // 2: All leads in period
                supabase.from('sakhi_clinic_leads')
                    .select('clinic_id, status, source, date_added')
                    .gte('date_added', dateFilter),
                // 3: All appointments in period
                supabase.from('sakhi_clinic_appointments')
                    .select('clinic_id, source, appointment_date')
                    .gte('appointment_date', dateFilter),
                // 4: Total leads all-time
                supabase.from('sakhi_clinic_leads').select('*', { count: 'exact', head: true }),
            ]);

            const clinics = results[0].status === 'fulfilled' && !results[0].value.error ? (results[0].value.data || []) : [];
            const totalPatients = results[1].status === 'fulfilled' && !results[1].value.error ? (results[1].value.count || 0) : 0;
            const leads = results[2].status === 'fulfilled' && !results[2].value.error ? (results[2].value.data || []) : [];
            const appointments = results[3].status === 'fulfilled' && !results[3].value.error ? (results[3].value.data || []) : [];
            const totalLeadsAllTime = results[4].status === 'fulfilled' && !results[4].value.error ? (results[4].value.count || 0) : 0;

            // Global lead source breakdown
            const globalLeadSources: Record<string, number> = {};
            let globalConverted = 0;

            leads.forEach((lead: any) => {
                const status = normalizeStatus(lead.status);
                const source = this.normalizeSource(lead.source);
                globalLeadSources[source] = (globalLeadSources[source] || 0) + 1;
                if (['Converted', 'Converted Patient', 'Converted - Active Patient'].includes(status)) {
                    globalConverted++;
                }
            });

            const globalConversionRate = leads.length > 0 ? ((globalConverted / leads.length) * 100).toFixed(1) + '%' : '0%';

            // Per-clinic summary
            const clinicLeadCounts: Record<string, number> = {};
            const clinicConvertedCounts: Record<string, number> = {};
            const clinicAppointmentCounts: Record<string, number> = {};

            leads.forEach((lead: any) => {
                const status = normalizeStatus(lead.status);
                if (lead.clinic_id) {
                    clinicLeadCounts[lead.clinic_id] = (clinicLeadCounts[lead.clinic_id] || 0) + 1;
                    if (['Converted', 'Converted Patient', 'Converted - Active Patient'].includes(status)) {
                        clinicConvertedCounts[lead.clinic_id] = (clinicConvertedCounts[lead.clinic_id] || 0) + 1;
                    }
                }
            });

            appointments.forEach((appt: any) => {
                if (appt.clinic_id) {
                    clinicAppointmentCounts[appt.clinic_id] = (clinicAppointmentCounts[appt.clinic_id] || 0) + 1;
                }
            });

            const clinicsSummary = clinics.map((clinic: any) => {
                const cLeads = clinicLeadCounts[clinic.id] || 0;
                const cConverted = clinicConvertedCounts[clinic.id] || 0;
                const cAppointments = clinicAppointmentCounts[clinic.id] || 0;
                return {
                    id: clinic.id,
                    name: clinic.name,
                    leads: cLeads,
                    appointments: cAppointments,
                    conversion_rate: cLeads > 0 ? ((cConverted / cLeads) * 100).toFixed(1) + '%' : '0%',
                };
            });

            return {
                success: true,
                data: {
                    period: period || 'all',
                    total_clinics: clinics.length,
                    total_patients: totalPatients,
                    total_leads: totalLeadsAllTime,
                    total_appointments: appointments.length,
                    global_lead_sources: globalLeadSources,
                    global_conversion_rate: globalConversionRate,
                    leads_in_period: leads.length,
                    clinics_summary: clinicsSummary,
                },
            };
        } catch (error: any) {
            this.logger.error('GET /api/v1/superadmin/analytics/overview', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    // =========================================================
    // Helper: Compute date filter from period param
    // =========================================================
    private getDateFilter(period?: string): string {
        const now = new Date();
        switch (period) {
            case 'day':
                now.setDate(now.getDate() - 1);
                break;
            case 'week':
                now.setDate(now.getDate() - 7);
                break;
            case 'month':
                now.setMonth(now.getMonth() - 1);
                break;
            case 'year':
                now.setFullYear(now.getFullYear() - 1);
                break;
            default:
                // All time - return a date far in the past
                return '2000-01-01T00:00:00Z';
        }
        return now.toISOString();
    }

    // =========================================================
    // Helper: Normalize Source (clean up CSV garbage)
    // =========================================================
    private normalizeSource(source: string | undefined | null): string {
        if (!source) return 'Unknown';
        const s = source.trim().toLowerCase();
        
        if (s.includes('walk')) return 'Walk-In';
        if (s.includes('web')) return 'Website';
        if (s.includes('whatsapp')) return 'WhatsApp';
        if (s.includes('social') || s.includes('fb') || s.includes('insta') || s.includes('facebook') || s.includes('instagram')) return 'Social Media';
        if (s.includes('refer')) return 'Referral';
        if (s.includes('camp')) return 'Camp';
        if (s.includes('practo')) return 'Practo';
        if (s.includes('phone') || s.includes('call')) return 'Phone Call';
        if (s.includes('online')) return 'Online';
        
        return 'Unknown';
    }

    @Delete('clinics/:id')
    async deleteClinic(@Param('id') id: string) {
        const supabase = this.supabaseService.getClient();
        try {
            // 1. Soft delete all users belonging to this clinic
            const { error: usersError } = await supabase
                .from('sakhi_clinic_users')
                .update({ is_active: false })
                .eq('clinic_id', id);
            
            if (usersError) throw usersError;

            // Also delete their clinic_staff assignments
            await supabase
                .from('clinic_staff')
                .delete()
                .eq('clinic_id', id);

            // 2. Soft delete the clinic
            const { error: clinicError } = await supabase
                .from('clinics')
                .update({ is_active: false })
                .eq('id', id);

            if (clinicError) throw clinicError;

            // Invalidate cache by triggering the background listener
            await this.eventsQueue.add(DFO_EVENTS.STAFF_UNASSIGNED, new StaffEvent(
                id, 'super_admin', { action: 'delete_clinic_clear_cache' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, message: 'Clinic completely deleted' };
        } catch (error: any) {
            this.logger.error(`DELETE /api/v1/superadmin/clinics/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
