import { Controller, Post, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';

@Controller('api/v1/superadmin/auth')
export class SuperAdminAuthController {
    private readonly logger = new Logger(SuperAdminAuthController.name);
    private readonly jwtSecret: string;
    private readonly jwtExpiresIn = '7d';
    private readonly superAdminSecret: string;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'fallback_secret_do_not_use_in_prod';
        this.superAdminSecret = this.configService.get<string>('SUPER_ADMIN_SECRET') || 'MedcyLaunch2026';
    }

    @Post('login')
    async login(@Body() body: { email: string; password: string }) {
        try {
            const { email, password } = body;
            if (!email || !password) {
                throw new HttpException({ success: false, error: 'Email and password are required' }, HttpStatus.BAD_REQUEST);
            }

            const supabase = this.supabaseService.getClient();
            
            // Query ONLY the decoupled super_admins table
            const { data: user, error } = await supabase
                .from('super_admins')
                .select('*')
                .eq('email', email)
                .single();

            if (error || !user) {
                throw new HttpException({ success: false, error: 'Invalid super admin credentials' }, HttpStatus.UNAUTHORIZED);
            }

            // Verify password
            let isMatch = false;
            try {
                const passwordHash = require('password-hash');
                if (passwordHash.verify(password, user.password_hash)) {
                    isMatch = true;
                }
            } catch {}

            if (!isMatch && user.password_hash === password) {
                isMatch = true; // Dev fallback
            }

            if (!isMatch) {
                throw new HttpException({ success: false, error: 'Invalid super admin credentials' }, HttpStatus.UNAUTHORIZED);
            }

            // Issue JWT with super admin claims
            const token = jwt.sign(
                { 
                    sub: user.id, 
                    user_id: user.id,
                    email: user.email, 
                    role: 'SUPER_ADMIN', 
                    name: user.name,
                    is_super_admin: true,
                    is_clinic_admin: false
                },
                this.jwtSecret,
                { expiresIn: this.jwtExpiresIn },
            );

            const userResponse = { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                is_super_admin: true,
            };

            return {
                success: true,
                data: {
                    token,
                    user: userResponse,
                },
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('SuperAdmin Login error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('signup')
    async signup(@Body() body: any) {
        try {
            const { name, email, password, secret_code } = body;

            if (!name || !email || !password || !secret_code) {
                throw new HttpException({ success: false, error: 'All fields including secret code are required' }, HttpStatus.BAD_REQUEST);
            }

            if (secret_code !== this.superAdminSecret) {
                throw new HttpException({ success: false, error: 'Invalid Secret Invite Code' }, HttpStatus.FORBIDDEN);
            }

            const supabase = this.supabaseService.getClient();

            // Hash password
            let password_hash = password;
            try {
                const passwordHash = require('password-hash');
                password_hash = passwordHash.generate(password);
            } catch {}

            // Insert into super_admins table
            const { data: newUser, error } = await supabase
                .from('super_admins')
                .insert([{ name, email, password_hash }])
                .select()
                .single();

            if (error) {
                if (error.code === '23505') {
                    throw new HttpException({ success: false, error: 'Email already registered as Super Admin' }, HttpStatus.CONFLICT);
                }
                throw error;
            }

            // Automatically log them in after signup
            const token = jwt.sign(
                { 
                    sub: newUser.id, 
                    user_id: newUser.id,
                    email: newUser.email, 
                    role: 'SUPER_ADMIN', 
                    name: newUser.name,
                    is_super_admin: true,
                    is_clinic_admin: false
                },
                this.jwtSecret,
                { expiresIn: this.jwtExpiresIn },
            );

            return {
                success: true,
                message: 'Super Admin created successfully',
                data: {
                    token,
                    user: { id: newUser.id, name: newUser.name, email: newUser.email, is_super_admin: true },
                },
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('SuperAdmin Signup error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
