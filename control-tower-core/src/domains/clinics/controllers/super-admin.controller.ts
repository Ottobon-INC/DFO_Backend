import { Controller, Post, Get, Body, Logger, HttpException, HttpStatus, Headers, Param } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

@Controller('api/super-admin')
export class SuperAdminController {
    private readonly logger = new Logger(SuperAdminController.name);
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

    private ensureSuperAdmin(authHeader?: string) {
        const decoded = this.verifyToken(authHeader);
        if (!decoded.is_super_admin) {
            throw new HttpException({ success: false, error: 'Access denied. Super Admin only.' }, HttpStatus.FORBIDDEN);
        }
        return decoded;
    }

    @Post('clinics')
    async createClinic(@Headers('authorization') authHeader: string, @Body() body: any) {
        this.ensureSuperAdmin(authHeader);

        const { name, address, contact_phone, contact_email } = body;
        if (!name) {
            throw new HttpException({ success: false, error: 'Clinic name is required' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        try {
            const { data, error } = await supabase
                .from('clinics')
                .insert([{ name, address, contact_phone, contact_email }])
                .select()
                .single();

            if (error) throw error;
            return { success: true, data };
        } catch (error: any) {
            this.logger.error('POST /api/super-admin/clinics', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('clinics/:clinicId/admin')
    async createClinicGenesisAdmin(@Headers('authorization') authHeader: string, @Body() body: any, @Param('clinicId') clinicId: string) {
        this.ensureSuperAdmin(authHeader);

        const { name, email, password, role } = body;
        if (!name || !email || !password || !role) {
            throw new HttpException({ success: false, error: 'Name, email, password, and role are required' }, HttpStatus.BAD_REQUEST);
        }

        const allowedRoles = ['DOCTOR', 'CRO']; // Usually the clinic admin is a Doctor or CRO
        if (!allowedRoles.includes(role)) {
            throw new HttpException({ success: false, error: 'Genesis admin role must be DOCTOR or CRO' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        try {
            // Verify clinic exists
            const { data: clinic, error: clinicError } = await supabase.from('clinics').select('id').eq('id', clinicId).single();
            if (clinicError || !clinic) {
                throw new HttpException({ success: false, error: 'Clinic not found' }, HttpStatus.NOT_FOUND);
            }

            let password_hash = password;
            try {
                const passwordHash = require('password-hash');
                password_hash = passwordHash.generate(password);
            } catch {}

            const payload = {
                name,
                email,
                password_hash,
                role,
                clinic_id: clinicId,
                is_clinic_admin: true, // This is the genesis admin
                is_super_admin: false,
            };

            const { data, error } = await supabase.from('sakhi_clinic_users').insert([payload]).select('id, name, email, role, clinic_id, is_clinic_admin').single();

            if (error) {
                if (error.code === '23505') throw new HttpException({ success: false, error: 'Email already exists' }, HttpStatus.CONFLICT);
                throw error;
            }

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/super-admin/clinics/:id/admin', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
