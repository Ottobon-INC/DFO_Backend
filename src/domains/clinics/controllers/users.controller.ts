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
                .select('id, email, role, is_clinic_admin, is_active, created_at, first_name, last_name, middle_name, hospital_id, phone_number, department, designation, specialization, profile_image_url')
                .eq('clinic_id', decoded.clinic_id);

            if (error) throw error;
            const mapped = (data || []).map(u => ({
                id: u.id,
                email: u.email,
                role: u.role,
                is_clinic_admin: u.is_clinic_admin,
                is_active: u.is_active !== false,
                created_at: u.created_at,
                name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email.split('@')[0],
                first_name: u.first_name,
                last_name: u.last_name,
                middle_name: u.middle_name,
                hospital_id: u.hospital_id,
                phone_number: u.phone_number,
                department: u.department,
                designation: u.designation,
                specialization: u.specialization,
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

        const { first_name, last_name, middle_name, hospital_id, phone_number, department, designation, specialization, profile_image_url, email, password, role, name } = body;

        // Fallback for frontend sending 'name' instead of 'first_name'/'last_name'
        const actualFirstName = first_name || (name ? name.split(' ')[0] : undefined);
        const actualLastName = last_name || (name && name.includes(' ') ? name.substring(name.indexOf(' ') + 1) : undefined);

        if (!actualFirstName || !email || !password || !role) {
            throw new HttpException({ success: false, error: 'First name, email, password, and role are required' }, HttpStatus.BAD_REQUEST);
        }

        const allowedRoles = ['Doctor', 'CRO', 'Receptionist', 'Nurse', 'Admin'];
        if (!allowedRoles.includes(role)) {
            throw new HttpException({ success: false, error: 'Invalid role' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        try {
            // Hash password using bcrypt
            const password_hash = await bcrypt.hash(password, 10);

            // Force the new user to be in the same clinic as the admin who is creating them
            const payload = {
                first_name: actualFirstName,
                last_name: actualLastName,
                middle_name: middle_name || null,
                hospital_id: hospital_id || null,
                phone_number: phone_number || null,
                department: department || null,
                designation: designation || null,
                specialization: specialization || null,
                profile_image_url: profile_image_url || null,
                email: email.toLowerCase().trim(),
                password_hash,
                role,
                clinic_id: decoded.clinic_id,
                is_clinic_admin: role === 'Admin',
                is_super_admin: false,
                is_active: true,
            };

            const { data, error } = await supabase.from('sakhi_clinic_users').insert([payload]).select('*').single();

            if (error) {
                if (error.code === '23505') { // Unique violation
                    throw new HttpException({ success: false, error: 'Email already exists' }, HttpStatus.CONFLICT);
                }
                throw error;
            }

            // Also keep clinic_staff bridge in sync
            try {
                await supabase.from('clinic_staff').upsert({
                    user_id: data.id,
                    clinic_id: decoded.clinic_id,
                    role: role,
                    is_active: true
                }, { onConflict: 'user_id, clinic_id' });
            } catch (bridgeErr) {
                this.logger.warn(`Failed to upsert clinic_staff bridge: ${bridgeErr}`);
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

        const {
            first_name,
            last_name,
            middle_name,
            phone_number,
            email,
            profile_image_url,
            hospital_id,
            department,
            designation,
            specialization,
            name
        } = body;
        const supabase = this.supabaseService.getClient();

        try {
            const actualFirstName = first_name || (name ? name.split(' ')[0] : undefined);
            const actualLastName = last_name || (name && name.includes(' ') ? name.substring(name.indexOf(' ') + 1) : undefined);

            const payload: any = {
                first_name: actualFirstName,
                last_name: actualLastName,
                middle_name,
                phone_number,
                email: email ? email.toLowerCase().trim() : undefined,
                profile_image_url,
                hospital_id,
                department,
                designation,
                specialization,
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

            const formattedUser = {
                id: data.id,
                name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.email.split('@')[0],
                first_name: data.first_name,
                last_name: data.last_name,
                middle_name: data.middle_name,
                hospital_id: data.hospital_id,
                phone_number: data.phone_number,
                department: data.department,
                designation: data.designation,
                specialization: data.specialization,
                profile_image_url: data.profile_image_url,
                email: data.email,
                role: data.role,
                clinic_id: data.clinic_id,
                is_super_admin: data.is_super_admin,
                is_clinic_admin: data.is_clinic_admin
            };

            return { success: true, data: formattedUser };
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
                .select('clinic_id, is_clinic_admin, role')
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

            const {
                role,
                password,
                name,
                first_name,
                last_name,
                middle_name,
                hospital_id,
                phone_number,
                department,
                designation,
                specialization,
                profile_image_url,
                email,
                is_active
            } = body;
            const updatePayload: any = {};

            if (first_name !== undefined) updatePayload.first_name = first_name;
            if (last_name !== undefined) updatePayload.last_name = last_name;
            if (middle_name !== undefined) updatePayload.middle_name = middle_name;

            if (name && (!first_name || !last_name)) {
                const parts = name.trim().split(' ');
                if (!updatePayload.first_name) updatePayload.first_name = parts[0];
                if (!updatePayload.last_name && parts.length > 1) updatePayload.last_name = parts.slice(1).join(' ');
            }

            if (hospital_id !== undefined) updatePayload.hospital_id = hospital_id;
            if (phone_number !== undefined) updatePayload.phone_number = phone_number;
            if (department !== undefined) updatePayload.department = department;
            if (designation !== undefined) updatePayload.designation = designation;
            if (specialization !== undefined) updatePayload.specialization = specialization;
            if (profile_image_url !== undefined) updatePayload.profile_image_url = profile_image_url;
            if (email !== undefined) updatePayload.email = email.toLowerCase().trim();
            if (is_active !== undefined) updatePayload.is_active = is_active;

            if (role) {
                const allowedRoles = ['Doctor', 'CRO', 'Receptionist', 'Nurse', 'Admin'];
                if (!allowedRoles.includes(role)) {
                    throw new HttpException({ success: false, error: 'Invalid role' }, HttpStatus.BAD_REQUEST);
                }
                updatePayload.role = role;
                updatePayload.is_clinic_admin = role === 'Admin';
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
                .select('*')
                .single();

            if (error) {
                if (error.code === '23505') {
                    throw new HttpException({ success: false, error: 'Email already exists' }, HttpStatus.CONFLICT);
                }
                throw error;
            }

            // Sync with clinic_staff table if role or is_active was updated
            if (role || is_active !== undefined) {
                try {
                    await supabase.from('clinic_staff').upsert({
                        user_id: id,
                        clinic_id: decoded.clinic_id,
                        role: role || targetUser.role || 'Doctor',
                        is_active: is_active !== undefined ? is_active : true
                    }, { onConflict: 'user_id, clinic_id' });
                } catch (bridgeErr) {
                    this.logger.warn(`Failed to update clinic_staff bridge: ${bridgeErr}`);
                }
            }

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
