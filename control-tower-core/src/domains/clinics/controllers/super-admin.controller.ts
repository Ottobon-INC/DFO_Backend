import { Controller, Post, Get, Delete, Param, Body, Logger, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { CreateClinicDto } from '../dto/create-clinic.dto';
import { StaffCacheService } from '../services/staff-cache.service';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { StaffEvent } from '../../../infrastructure/events/event-payloads';

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
    async createClinic(@Body() body: CreateClinicDto) {
        const { clinic_name, owner_name, owner_email, owner_role } = body;
        const supabase = this.supabaseService.getClient();

        try {
            // Step 1: Insert Clinic
            const { data: clinic, error: clinicError } = await supabase
                .from('clinics')
                .insert([{ name: clinic_name }])
                .select()
                .single();

            if (clinicError) throw clinicError;

            // Step 2: Insert Genesis Admin (Owner)
            // Generate a random temporary password or leave it to be set later via email link
            let password_hash = 'Temporary123!';
            try {
                const passwordHash = require('password-hash');
                password_hash = passwordHash.generate(password_hash);
            } catch {}

            const adminPayload = {
                name: owner_name,
                email: owner_email,
                password_hash,
                role: owner_role || 'Doctor', // Use the user-provided role
                clinic_id: clinic.id,
                is_clinic_admin: true,
                is_super_admin: false,
            };

            const { data: adminUser, error: adminError } = await supabase
                .from('sakhi_clinic_users')
                .insert([adminPayload])
                .select('id, name, email, role, clinic_id, is_clinic_admin')
                .single();

            if (adminError) {
                // If it fails, log it, but the clinic was already created.
                this.logger.error('Failed to create genesis admin, but clinic was created', adminError);
                if (adminError.code === '23505') {
                   throw new HttpException({ success: false, error: 'Clinic created, but owner email already exists' }, HttpStatus.CONFLICT);
                }
                throw adminError;
            }

            return { 
                success: true, 
                message: 'Clinic and Admin created successfully',
                data: {
                    clinic,
                    admin: adminUser
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

    @Delete('clinics/:id')
    async deleteClinic(@Param('id') id: string) {
        const supabase = this.supabaseService.getClient();
        try {
            // 1. Delete all users belonging to this clinic
            const { error: usersError } = await supabase
                .from('sakhi_clinic_users')
                .delete()
                .eq('clinic_id', id);
            
            if (usersError) throw usersError;

            // 2. Delete the clinic
            const { error: clinicError } = await supabase
                .from('clinics')
                .delete()
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
