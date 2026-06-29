import { Controller, Post, Body, Logger, HttpException, HttpStatus, Headers, Patch } from '@nestjs/common';
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
            this.logger.log(`Login attempt: email="${email}"`);
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
                    user_id: user.id,
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

    @Post('logout')
    async logout() {
        // Since we are using stateless JWT, we don't need to invalidate anything on the server.
        // We just return success so the frontend can clear its local storage.
        return { success: true, message: 'Logged out successfully' };
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

    @Patch('profile')
    async updateProfile(@Headers('authorization') authHeader: string, @Body() body: any) {
        const decoded = this.verifyToken(authHeader);
        const { name, email } = body;

        if (!name && !email) {
            throw new HttpException({ success: false, error: 'Nothing to update' }, HttpStatus.BAD_REQUEST);
        }

        const updatePayload: any = {};
        if (name) updatePayload.name = name;
        if (email) updatePayload.email = email;

        const supabase = this.supabaseService.getClient();
        const { data, error } = await supabase
            .from('sakhi_clinic_users')
            .update(updatePayload)
            .eq('id', decoded.sub)
            .select('id, name, email, role, clinic_id')
            .single();

        if (error) {
            if (error.code === '23505') {
                throw new HttpException({ success: false, error: 'Email already exists' }, HttpStatus.CONFLICT);
            }
            throw new HttpException({ success: false, error: 'Failed to update profile' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const payloadToSign = {
            sub: data.id,
            user_id: data.id,
            email: data.email,
            role: data.role,
            name: data.name,
            clinic_id: data.clinic_id,
            is_super_admin: decoded.is_super_admin,
            is_clinic_admin: decoded.is_clinic_admin
        };
        const token = jwt.sign(payloadToSign, this.jwtSecret, { expiresIn: this.jwtExpiresIn });

        return { success: true, data, token };
    }

    @Post('change-password')
    async changePassword(@Headers('authorization') authHeader: string, @Body() body: any) {
        const decoded = this.verifyToken(authHeader);
        const { currentPassword, newPassword } = body;

        if (!currentPassword || !newPassword) {
            throw new HttpException({ success: false, error: 'Current password and new password are required' }, HttpStatus.BAD_REQUEST);
        }

        const supabase = this.supabaseService.getClient();
        
        const { data: user, error } = await supabase
            .from('sakhi_clinic_users')
            .select('*')
            .eq('id', decoded.sub)
            .single();

        if (error || !user) {
            throw new HttpException({ success: false, error: 'User not found' }, HttpStatus.NOT_FOUND);
        }

        let isMatch = false;
        try {
            const passwordHash = require('password-hash');
            if (user.password_hash && passwordHash.verify(currentPassword, user.password_hash)) {
                isMatch = true;
            }
        } catch {
            // fallback
        }
        if (!isMatch && user.password_hash === currentPassword) {
            isMatch = true; // Dev fallback
        }

        if (!isMatch) {
            throw new HttpException({ success: false, error: 'Incorrect current password' }, HttpStatus.UNAUTHORIZED);
        }

        let new_password_hash = newPassword;
        try {
            const passwordHash = require('password-hash');
            new_password_hash = passwordHash.generate(newPassword);
        } catch {
            // User requested strictly require hashed password, but if library is missing we might fail.
            // We'll throw an error if hashing fails instead of falling back to plain text.
            throw new HttpException({ success: false, error: 'Password hashing library missing. Cannot securely change password.' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const { error: updateError } = await supabase
            .from('sakhi_clinic_users')
            .update({ password_hash: new_password_hash })
            .eq('id', decoded.sub);

        if (updateError) {
            throw new HttpException({ success: false, error: 'Failed to update password' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return { success: true, message: 'Password updated successfully' };
    }
}
