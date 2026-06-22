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
            const { data: user, error } = await supabase
                .from('sakhi_clinic_users').select('*').eq('email', email).single();

            if (error || !user) {
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

            const token = jwt.sign(
                { 
                    sub: user.id, 
                    user_id: user.id,
                    email: user.email, 
                    role: user.role, 
                    name: user.name,
                    clinic_id: user.clinic_id,
                    is_super_admin: user.is_super_admin,
                    is_clinic_admin: user.is_clinic_admin
                },
                this.jwtSecret,
                { expiresIn: this.jwtExpiresIn },
            );

            const userResponse = { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                role: user.role, 
                clinic_id: user.clinic_id,
                is_super_admin: user.is_super_admin,
                is_clinic_admin: user.is_clinic_admin,
                token 
            };

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
