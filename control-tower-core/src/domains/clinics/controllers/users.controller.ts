import { Controller, Post, Get, Patch, Param, Body, Logger, HttpException, HttpStatus, Headers } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

@Controller('api/clinic/users')
export class UsersController {
    private readonly logger = new Logger(UsersController.name);
    private readonly jwtSecret: string;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
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
                .select('id, email, role, is_clinic_admin, created_at')
                .eq('clinic_id', decoded.clinic_id);

            if (error) throw error;
            const mapped = (data || []).map(u => ({
                id: u.id,
                email: u.email,
                role: u.role,
                is_clinic_admin: u.is_clinic_admin,
                created_at: u.created_at,
                name: u.email ? u.email.split('@')[0].split('.')[0].charAt(0).toUpperCase() + u.email.split('@')[0].split('.')[0].slice(1) : 'User'
            }));
            return { success: true, data: mapped };
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
                .select('id, email, role, clinic_id')
                .single();

            if (error) throw error;

            const mapped = data ? {
                ...data,
                name: data.email ? data.email.split('@')[0].split('.')[0].charAt(0).toUpperCase() + data.email.split('@')[0].split('.')[0].slice(1) : 'User'
            } : null;

            return { success: true, data: mapped };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/clinic/users/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch(':id/availability')
    async setAvailability(
        @Headers('authorization') authHeader: string,
        @Param('id') id: string,
        @Body() body: { is_available: boolean }
    ) {
        const decoded = this.verifyToken(authHeader);

        // Users can only change their own availability, or an admin can change anyone's
        if (decoded.sub !== id && !decoded.is_clinic_admin && !decoded.is_super_admin) {
            throw new HttpException({ success: false, error: 'You can only change your own availability' }, HttpStatus.FORBIDDEN);
        }

        const supabase = this.supabaseService.getClient();
        try {
            const updatePayload: any = {
                is_available: body.is_available,
                last_seen_at: new Date().toISOString(),
            };

            // Set shift_started_at on first check-in of the day
            if (body.is_available) {
                updatePayload.shift_started_at = new Date().toISOString();
            }

            const { error } = await supabase
                .from('sakhi_clinic_users')
                .update(updatePayload)
                .eq('id', id);

            if (error) throw error;

            this.logger.log(`User ${id} availability set to ${body.is_available}`);
            return { success: true, is_available: body.is_available };
        } catch (error: any) {
            this.logger.error(`PATCH /api/clinic/users/${id}/availability`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('available')
    async getAvailableClinicians(@Headers('authorization') authHeader: string) {
        this.verifyToken(authHeader);
        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .select('id, name, role, is_available, last_seen_at, shift_started_at')
                .eq('is_available', true)
                .in('role', ['Doctor', 'Nurse', 'DOCTOR', 'NURSE', 'Receptionist', 'Front_Desk']);
            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error: any) {
            throw new HttpException({ success: false, error: error?.message }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
