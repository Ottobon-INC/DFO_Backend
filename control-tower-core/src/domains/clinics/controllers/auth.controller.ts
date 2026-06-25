import { Controller, Post, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';

@Controller('api/auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);
    private readonly jwtSecret: string;
    private readonly jwtExpiresIn = '7d';

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'fallback_secret_do_not_use_in_prod';
    }

    @Post('login')
    async login(@Body() body: { email: string; password: string }) {
        try {
            const { email, password } = body;
            this.logger.log(`Login attempt: email="${email}" (len=${email?.length}), password="${password}" (len=${password?.length})`);
            if (!email || !password) {
                throw new HttpException({ success: false, error: 'Email and password are required' }, HttpStatus.BAD_REQUEST);
            }

            const supabase = this.supabaseService.getClient();
            let user: any = null;
            let queryError: any = null;

            this.logger.log(`Supabase URL config: ${this.configService.get('SUPABASE_URL')} or app config: ${this.configService.get('app.supabase.url')}`);
            try {
                this.logger.log(`Querying sakhi_clinic_users table for email: ${email}`);
                const { data, error } = await supabase
                    .from('sakhi_clinic_users').select('*').eq('email', email).single();
                
                if (error) {
                    this.logger.error(`Supabase query error: ${JSON.stringify(error)}`);
                } else {
                    this.logger.log(`Supabase query success. User found: ${data ? data.email : 'null'}`);
                }
                user = data;
                queryError = error;
            } catch (err: any) {
                this.logger.error(`Supabase query exception: ${err.message || err}`);
                queryError = err;
            }

            // Fallback for development if the table is empty or cannot be queried/inserted
            if (!user) {
                const devUsers = [
                    { id: 'dev-admin-id', email: 'admin@medcyivf.com', password_hash: 'password123', name: 'Admin User', role: 'admin' },
                    { id: 'dev-doctor-id', email: 'doctor@medcyivf.com', password_hash: 'password123', name: 'Dr. Ragini', role: 'doctor' },
                    { id: 'dev-doctor-ragini', email: 'dr.ragini@medcy.com', password_hash: 'password123', name: 'Dr. Ragini', role: 'doctor' },
                    { id: 'dev-frontdesk-id', email: 'frontdesk@medcyivf.com', password_hash: 'password123', name: 'Front Desk User', role: 'frontdesk' },
                    { id: 'dev-cro-id', email: 'cro@medcyivf.com', password_hash: 'password123', name: 'CRO User', role: 'cro' },
                    { id: 'dev-nurse-id', email: 'nurse@medcyivf.com', password_hash: 'password123', name: 'Nurse User', role: 'nurse' }
                ];
                
                const foundDev = devUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
                if (foundDev && (password === 'password123' || password === foundDev.password_hash)) {
                    user = foundDev;
                }
            }

            if (!user) {
                throw new HttpException({ success: false, error: 'Invalid credentials' }, HttpStatus.UNAUTHORIZED);
            }

            if (!user.password_hash) {
                throw new HttpException({ success: false, error: 'User has no password set. Please contact admin.' }, HttpStatus.UNAUTHORIZED);
            }

            // Use password-hash verify, with plain text fallback for dev
            let isMatch = false;
            try {
                const passwordHash = require('password-hash');
                if (passwordHash.verify(password, user.password_hash)) {
                    isMatch = true;
                }
            } catch {
                // If password-hash isn't available, skip
            }

            if (!isMatch && user.password_hash === password) {
                isMatch = true; // Dev fallback
            }

            if (!isMatch) {
                throw new HttpException({ success: false, error: 'Invalid credentials' }, HttpStatus.UNAUTHORIZED);
            }

            const displayName = user.name || user.full_name || (user.email ? user.email.split('@')[0].split('.').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'User');

            const token = jwt.sign(
                { 
                    sub: user.id, 
                    email: user.email, 
                    role: user.role, 
                    name: displayName,
                    clinic_id: user.clinic_id,
                    is_super_admin: user.is_super_admin,
                    is_clinic_admin: user.is_clinic_admin
                },
                this.jwtSecret,
                { expiresIn: this.jwtExpiresIn },
            );

            const userResponse = { 
                id: user.id, 
                name: displayName, 
                email: user.email, 
                role: user.role, 
                clinic_id: user.clinic_id,
                is_super_admin: user.is_super_admin,
                is_clinic_admin: user.is_clinic_admin,
                token 
            };

            // Auto-check in the user upon successful login
            if (user.id && !user.id.startsWith('dev-')) {
                try {
                    await supabase.from('sakhi_clinic_users').update({
                        is_available: true,
                        shift_started_at: new Date().toISOString()
                    }).eq('id', user.id);
                    this.logger.log(`Auto check-in successful for user ${user.id}`);
                } catch (err: any) {
                    this.logger.error(`Failed to auto check-in user ${user.id}: ${err.message}`);
                }
            }

            return {
                success: true,
                token,
                user: userResponse,
                data: {
                    token,
                    user: userResponse,
                },
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('Login error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
