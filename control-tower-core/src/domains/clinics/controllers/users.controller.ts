import { Controller, Post, Get, Patch, Put, Delete, Param, Body, Logger, HttpException, HttpStatus, Headers, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { StaffCacheService } from '../services/staff-cache.service';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { StaffEvent } from '../../../infrastructure/events/event-payloads';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';

@Controller('api/clinic/users')
@UseGuards(ClinicsAuthGuard)
export class UsersController {
    private readonly logger = new Logger(UsersController.name);
    private readonly jwtSecret: string;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
        private readonly staffCache: StaffCacheService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') as string;
        if (!this.jwtSecret) throw new Error('JWT_SECRET must be defined in environment configuration');
    }

    @Get()
    async listClinicUsers(@Headers('authorization') authHeader: string) {
        const decoded = TenantContext.getState() || {};

        if (!decoded.is_clinic_admin && !decoded.is_super_admin) {
            throw new HttpException({ success: false, error: 'Only Clinic Admins can view the staff list' }, HttpStatus.FORBIDDEN);
        }

        if (!decoded.clinic_id && !decoded.is_super_admin) {
            throw new HttpException({ success: false, error: 'Admin is not bound to a clinic' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .select('id, email, role, is_clinic_admin, created_at, first_name, last_name, middle_name, hospital_id, phone_number, department, designation, profile_image_url')
                .eq('clinic_id', decoded.clinic_id);

            if (error) throw error;
            const mapped = (data || []).map(u => ({
                id: u.id,
                email: u.email,
                role: u.role,
                is_clinic_admin: u.is_clinic_admin,
                created_at: u.created_at,
                name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email.split('@')[0],
                first_name: u.first_name,
                last_name: u.last_name,
                middle_name: u.middle_name,
                hospital_id: u.hospital_id,
                phone_number: u.phone_number,
                department: u.department,
                designation: u.designation,
                profile_image_url: u.profile_image_url
            }));
            return { success: true, data: mapped };
        } catch (error: any) {
            this.logger.error('GET /api/clinic/users', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post()
    async createClinicUser(@Headers('authorization') authHeader: string, @Body() body: any) {
        const decoded = TenantContext.getState() || {};

        // RBAC Enforcement: Must be a clinic admin
        if (!decoded.is_clinic_admin) {
            throw new HttpException({ success: false, error: 'Only Clinic Admins can create sub-accounts' }, HttpStatus.FORBIDDEN);
        }

        if (!decoded.clinic_id) {
            throw new HttpException({ success: false, error: 'Admin is not bound to a clinic' }, HttpStatus.BAD_REQUEST);
        }

        const { first_name, last_name, middle_name, hospital_id, phone_number, department, designation, email, password, role } = body;

        if (!first_name || !email || !password || !role) {
            throw new HttpException({ success: false, error: 'First name, email, password, and role are required' }, HttpStatus.BAD_REQUEST);
        }

        const allowedRoles = ['Doctor', 'CRO', 'Receptionist', 'Nurse'];
        if (!allowedRoles.includes(role)) {
            throw new HttpException({ success: false, error: 'Invalid role' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        try {
            // Hash password using bcrypt
            const password_hash = await bcrypt.hash(password, 10);

            // Force the new user to be in the same clinic as the admin who is creating them
            const payload = {
                first_name,
                last_name,
                middle_name,
                hospital_id,
                phone_number,
                department,
                designation,
                email,
                password_hash,
                role,
                clinic_id: decoded.clinic_id,
                is_clinic_admin: false, // sub-accounts default to non-admin
                is_super_admin: false,
            };

            const { data, error } = await supabase.from('sakhi_clinic_users').insert([payload]).select('id, email, role, clinic_id').single();

            if (error) {
                if (error.code === '23505') { // Unique violation
                    throw new HttpException({ success: false, error: 'Email already exists' }, HttpStatus.CONFLICT);
                }
                throw error;
            }

            // Emit event for cache invalidation
            await this.eventsQueue.add(DFO_EVENTS.USER_CREATED, new StaffEvent(
                decoded.clinic_id, decoded.user_id, { action: 'create_clinic_user', user_id: data.id }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/clinic/users', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    @Put('profile')
    async updateMyProfile(
        @Headers('authorization') authHeader: string,
        @Body() body: any
    ) {
        const decoded = TenantContext.getState() || {};
        if (!decoded.user_id) {
            throw new HttpException({ success: false, error: 'Invalid token payload' }, HttpStatus.UNAUTHORIZED);
        }

        const { first_name, last_name, middle_name, phone_number, email, profile_image_url } = body;
        const supabase = this.supabaseService.getClient();

        try {
            const payload: any = {
                first_name,
                last_name,
                middle_name,
                phone_number,
                email,
                profile_image_url,
            };
            // Clean undefined values
            Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .update(payload)
                .eq('id', decoded.user_id)
                .select()
                .single();

            if (error) {
                if (error.code === '23505') {
                    throw new HttpException({ success: false, error: 'Email already exists' }, HttpStatus.CONFLICT);
                }
                throw error;
            }
            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('PUT /api/clinic/users/profile', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id')
    async updateClinicUser(
        @Headers('authorization') authHeader: string,
        @Param('id') id: string,
        @Body() body: any
    ) {
        const decoded = TenantContext.getState() || {};

        // RBAC Enforcement: Must be a clinic admin
        if (!decoded.is_clinic_admin) {
            throw new HttpException({ success: false, error: 'Only Clinic Admins can edit team members' }, HttpStatus.FORBIDDEN);
        }

        if (!decoded.clinic_id) {
            throw new HttpException({ success: false, error: 'Admin is not bound to a clinic' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();

        try {
            // Ensure the user being edited belongs to the same clinic
            const { data: targetUser, error: targetError } = await supabase
                .from('sakhi_clinic_users')
                .select('clinic_id, is_clinic_admin')
                .eq('id', id)
                .single();

            if (targetError || !targetUser) {
                throw new HttpException({ success: false, error: 'User not found' }, HttpStatus.NOT_FOUND);
            }

            if (targetUser.clinic_id !== decoded.clinic_id) {
                throw new HttpException({ success: false, error: 'Cannot edit users outside your clinic' }, HttpStatus.FORBIDDEN);
            }

            // Prevent editing another clinic admin (unless needed, but usually safe to prevent)
            if (targetUser.is_clinic_admin && decoded.user_id !== id) {
                throw new HttpException({ success: false, error: 'Cannot modify another Clinic Admin' }, HttpStatus.FORBIDDEN);
            }

            const { role, password, name } = body;
            const updatePayload: any = {};

            if (name) updatePayload.name = name;

            if (role) {
                const allowedRoles = ['Doctor', 'CRO', 'Receptionist', 'Nurse'];
                if (!allowedRoles.includes(role)) {
                    throw new HttpException({ success: false, error: 'Invalid role' }, HttpStatus.BAD_REQUEST);
                }
                updatePayload.role = role;
            }

            if (password) {
                // Hash password using bcrypt
                updatePayload.password_hash = await bcrypt.hash(password, 10);
            }

            if (Object.keys(updatePayload).length === 0) {
                return { success: true, message: 'Nothing to update' };
            }

            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .update(updatePayload)
                .eq('id', id)
                .select('id, email, role, clinic_id')
                .single();

            if (error) throw error;

            // Emit event for cache invalidation
            await this.eventsQueue.add(DFO_EVENTS.USER_UPDATED, new StaffEvent(
                decoded.clinic_id, decoded.user_id, { action: 'update_clinic_user', user_id: id }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/clinic/users/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete(':id')
    async removeClinicUser(
        @Headers('authorization') authHeader: string,
        @Param('id') id: string
    ) {
        const decoded = TenantContext.getState() || {};

        // RBAC Enforcement: Must be a clinic admin
        if (!decoded.is_clinic_admin) {
            throw new HttpException({ success: false, error: 'Only Clinic Admins can remove team members' }, HttpStatus.FORBIDDEN);
        }

        if (!decoded.clinic_id) {
            throw new HttpException({ success: false, error: 'Admin is not bound to a clinic' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();

        try {
            // Ensure the user being deleted belongs to the same clinic
            const { data: targetUser, error: targetError } = await supabase
                .from('sakhi_clinic_users')
                .select('clinic_id, is_clinic_admin, email')
                .eq('id', id)
                .single();

            if (targetError || !targetUser) {
                throw new HttpException({ success: false, error: 'User not found' }, HttpStatus.NOT_FOUND);
            }

            if (targetUser.clinic_id !== decoded.clinic_id) {
                throw new HttpException({ success: false, error: 'Cannot remove users outside your clinic' }, HttpStatus.FORBIDDEN);
            }

            // Prevent deleting another clinic admin or yourself
            if (targetUser.is_clinic_admin) {
                throw new HttpException({ success: false, error: 'Cannot remove a Clinic Admin' }, HttpStatus.FORBIDDEN);
            }

            // Also explicitly delete from clinic_staff since a soft delete won't cascade
            await supabase
                .from('clinic_staff')
                .delete()
                .eq('user_id', id);

            const deletedEmail = `${targetUser.email}_deleted_${Date.now()}`;

            // Soft delete the user from sakhi_clinic_users and rename email
            const { error } = await supabase
                .from('sakhi_clinic_users')
                .update({ is_active: false, email: deletedEmail })
                .eq('id', id);

            if (error) throw error;

            // Invalidate staff cache via background listener
            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.USER_REMOVED, new StaffEvent(
                decoded.clinic_id, actor_id, { action: 'remove_clinic_user', user_id: id }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, message: 'Team member removed successfully' };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`DELETE /api/clinic/users/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/restore')
    async restoreUser(@Param('id') id: string, @Headers('authorization') authHeader: string) {
        if (!authHeader) throw new UnauthorizedException('Missing Authorization header');
        const decoded = TenantContext.getState() || {};

        // RBAC Enforcement: Must be a clinic admin
        if (!decoded.is_clinic_admin) {
            throw new HttpException({ success: false, error: 'Only Clinic Admins can restore team members' }, HttpStatus.FORBIDDEN);
        }

        if (!decoded.clinic_id) {
            throw new HttpException({ success: false, error: 'Admin is not bound to a clinic' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();

        try {
            // Ensure the user being restored belongs to the same clinic
            const { data: targetUser, error: targetError } = await supabase
                .from('sakhi_clinic_users')
                .select('clinic_id, email')
                .eq('id', id)
                .single();

            if (targetError || !targetUser) {
                throw new HttpException({ success: false, error: 'User not found' }, HttpStatus.NOT_FOUND);
            }

            if (targetUser.clinic_id !== decoded.clinic_id) {
                throw new HttpException({ success: false, error: 'Cannot restore users outside your clinic' }, HttpStatus.FORBIDDEN);
            }

            // Restore email by stripping _deleted_ suffix
            let restoredEmail = targetUser.email;
            const suffixMatch = targetUser.email.match(/_deleted_\d+$/);
            if (suffixMatch) {
                restoredEmail = targetUser.email.substring(0, suffixMatch.index);
            }

            // Update user to be active again
            const { error } = await supabase
                .from('sakhi_clinic_users')
                .update({ is_active: true, email: restoredEmail })
                .eq('id', id);

            if (error) throw error;

            return { success: true, message: 'Team member restored successfully' };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/clinic/users/${id}/restore`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
