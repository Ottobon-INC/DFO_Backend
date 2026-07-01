import { Controller, Post, Get, Patch, Delete, Param, Body, Logger, HttpException, HttpStatus, Headers } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { StaffCacheService } from '../services/staff-cache.service';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { StaffEvent } from '../../../infrastructure/events/event-payloads';

@Controller('api/clinic/users')
export class UsersController {
    private readonly logger = new Logger(UsersController.name);
    private readonly jwtSecret: string;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
        private readonly staffCache: StaffCacheService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'fallback_secret_do_not_use_in_prod';
    }

    private verifyToken(authHeader?: string) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new HttpException({ success: false, error: 'Unauthorized' }, HttpStatus.UNAUTHORIZED);
        }
        const token = authHeader.split(' ')[1];
        try {
            return jwt.verify(token, this.jwtSecret) as any;
        } catch (error) {
            throw new HttpException({ success: false, error: 'Invalid or expired token' }, HttpStatus.UNAUTHORIZED);
        }
    }

    @Get()
    async listClinicUsers(@Headers('authorization') authHeader: string) {
        const decoded = this.verifyToken(authHeader);

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
                .select('id, name, email, role, is_clinic_admin, created_at')
                .eq('clinic_id', decoded.clinic_id);

            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            this.logger.error('GET /api/clinic/users', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post()
    async createClinicUser(@Headers('authorization') authHeader: string, @Body() body: any) {
        const decoded = this.verifyToken(authHeader);

        // RBAC Enforcement: Must be a clinic admin
        if (!decoded.is_clinic_admin) {
            throw new HttpException({ success: false, error: 'Only Clinic Admins can create sub-accounts' }, HttpStatus.FORBIDDEN);
        }

        if (!decoded.clinic_id) {
            throw new HttpException({ success: false, error: 'Admin is not bound to a clinic' }, HttpStatus.BAD_REQUEST);
        }

        const { name, email, password, role } = body;

        if (!name || !email || !password || !role) {
            throw new HttpException({ success: false, error: 'Name, email, password, and role are required' }, HttpStatus.BAD_REQUEST);
        }

        const allowedRoles = ['Doctor', 'CRO', 'Receptionist', 'Nurse'];
        if (!allowedRoles.includes(role)) {
            throw new HttpException({ success: false, error: 'Invalid role' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        try {
            // Hash password
            let password_hash = password;
            try {
                const passwordHash = require('password-hash');
                password_hash = passwordHash.generate(password);
            } catch {
                // dev fallback
            }

            // Force the new user to be in the same clinic as the admin who is creating them
            const payload = {
                name,
                email,
                password_hash,
                role,
                clinic_id: decoded.clinic_id,
                is_clinic_admin: false, // sub-accounts default to non-admin
                is_super_admin: false,
            };

            const { data, error } = await supabase.from('sakhi_clinic_users').insert([payload]).select('id, name, email, role, clinic_id').single();

            if (error) {
                if (error.code === '23505') { // Unique violation
                    throw new HttpException({ success: false, error: 'Email already exists' }, HttpStatus.CONFLICT);
                }
                throw error;
            }

            // Emit event for cache invalidation
            await this.eventsQueue.add(DFO_EVENTS.USER_CREATED, new StaffEvent(
                decoded.clinic_id, decoded.sub, { action: 'create_clinic_user', user_id: data.id }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/clinic/users', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id')
    async updateClinicUser(
        @Headers('authorization') authHeader: string, 
        @Param('id') id: string, 
        @Body() body: any
    ) {
        const decoded = this.verifyToken(authHeader);

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
            if (targetUser.is_clinic_admin && decoded.sub !== id) {
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
                let password_hash = password;
                try {
                    const passwordHash = require('password-hash');
                    password_hash = passwordHash.generate(password);
                } catch {
                    // dev fallback
                }
                updatePayload.password_hash = password_hash;
            }

            if (Object.keys(updatePayload).length === 0) {
                return { success: true, message: 'Nothing to update' };
            }

            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .update(updatePayload)
                .eq('id', id)
                .select('id, name, email, role, clinic_id')
                .single();

            if (error) throw error;

            // Emit event for cache invalidation
            await this.eventsQueue.add(DFO_EVENTS.USER_UPDATED, new StaffEvent(
                decoded.clinic_id, decoded.sub, { action: 'update_clinic_user', user_id: id }
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
        const decoded = this.verifyToken(authHeader);

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
                .select('clinic_id, is_clinic_admin')
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

            // Delete the user from sakhi_clinic_users (DB will cascade delete from clinic_staff)
            const { error } = await supabase
                .from('sakhi_clinic_users')
                .delete()
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
}
