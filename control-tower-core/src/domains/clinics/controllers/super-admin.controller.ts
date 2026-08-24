import { Controller, Post, Get, Delete, Param, Query, Body, Logger, HttpException, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
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

    @Get('analytics/overview')
    async getAnalyticsOverview(@Query('period') period: string = 'month') {
        const supabase = this.supabaseService.getClient();
        try {
            const [clinicsRes, patientsRes, leadsRes, appointmentsRes] = await Promise.all([
                supabase.from('clinics').select('id, name', { count: 'exact' }).eq('is_active', true),
                supabase.from('sakhi_clinic_patients').select('id', { count: 'exact' }),
                supabase.from('sakhi_clinic_leads').select('id, status, source, clinic_id'),
                supabase.from('sakhi_clinic_appointments').select('id, clinic_id')
            ]);

            const clinicsData = clinicsRes.data || [];
            const leadsData = leadsRes.data || [];
            const appointmentsData = appointmentsRes.data || [];
            const totalLeads = leadsData.length;

            const global_lead_sources = leadsData.reduce((acc, lead) => {
                const src = lead.source || 'Unknown';
                acc[src] = (acc[src] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            const convertedLeads = leadsData.filter(l => ['Converted', 'Won', 'Admitted', 'Patient', 'Converted - OPD'].includes(l.status)).length;
            const global_conversion_rate = totalLeads ? ((convertedLeads / totalLeads) * 100).toFixed(1) + '%' : '0%';

            const clinics_summary = clinicsData.map(c => {
                const clinicLeads = leadsData.filter(l => l.clinic_id === c.id);
                const clinicAppts = appointmentsData.filter(a => a.clinic_id === c.id);
                const clinicConverted = clinicLeads.filter(l => ['Converted', 'Won', 'Admitted', 'Patient', 'Converted - OPD'].includes(l.status)).length;
                return {
                    id: c.id,
                    name: c.name,
                    leads: clinicLeads.length,
                    appointments: clinicAppts.length,
                    conversion_rate: clinicLeads.length ? ((clinicConverted / clinicLeads.length) * 100).toFixed(1) + '%' : '0%'
                };
            });

            const data = {
                period,
                total_clinics: clinicsRes.count || 0,
                total_patients: patientsRes.count || 0,
                total_leads: totalLeads,
                total_appointments: appointmentsData.length,
                global_lead_sources,
                global_conversion_rate,
                leads_in_period: totalLeads,
                clinics_summary
            };

            return { success: true, data };
        } catch (error: any) {
            this.logger.error('GET /api/v1/superadmin/analytics/overview', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('clinics/:id/analytics')
    async getClinicAnalytics(@Param('id') id: string, @Query('period') period: string = 'month') {
        const supabase = this.supabaseService.getClient();
        try {
            const { data: clinic } = await supabase.from('clinics').select('name').eq('id', id).single();
            if (!clinic) throw new HttpException({ success: false, error: 'Clinic not found' }, HttpStatus.NOT_FOUND);

            const [patientsRes, leadsRes, appointmentsRes, usersRes] = await Promise.all([
                supabase.from('sakhi_clinic_patients').select('id', { count: 'exact' }).eq('clinic_id', id),
                supabase.from('sakhi_clinic_leads').select('id, status, source').eq('clinic_id', id),
                supabase.from('sakhi_clinic_appointments').select('id, source, appointment_type').eq('clinic_id', id),
                supabase.from('sakhi_clinic_users').select('id', { count: 'exact' }).eq('clinic_id', id)
            ]);

            const leadsData = leadsRes.data || [];
            const appointmentsData = appointmentsRes.data || [];
            const totalLeads = leadsData.length;

            const lead_pipeline = leadsData.reduce((acc, lead) => {
                const stat = lead.status || 'New';
                acc[stat] = (acc[stat] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            const lead_sources = leadsData.reduce((acc, lead) => {
                const src = lead.source || 'Unknown';
                acc[src] = (acc[src] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            const appointment_sources = appointmentsData.reduce((acc, appt) => {
                const src = appt.source || appt.appointment_type || 'Unknown';
                acc[src] = (acc[src] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            const convertedLeads = leadsData.filter(l => ['Converted', 'Won', 'Admitted', 'Patient', 'Converted - OPD'].includes(l.status)).length;
            const conversion_rate = totalLeads ? ((convertedLeads / totalLeads) * 100).toFixed(1) + '%' : '0%';

            const data = {
                clinic_id: id,
                clinic_name: clinic.name,
                period,
                overview: {
                    total_leads: totalLeads,
                    total_patients: patientsRes.count || 0,
                    total_appointments: appointmentsData.length,
                    total_staff: usersRes.count || 0
                },
                lead_pipeline,
                lead_sources,
                appointment_sources,
                conversion_rate,
                leads_in_period: totalLeads
            };

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`GET /api/v1/superadmin/clinics/${id}/analytics`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
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
