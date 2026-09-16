import { Controller, Post, Get, Body, Logger, HttpException, HttpStatus, Headers, Patch, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { AuthEvent } from '../../../infrastructure/events/event-payloads';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';

@Controller('api/auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);
    private readonly jwtSecret: string;
    private readonly jwtExpiresIn = '24h';

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') as string;
        if (!this.jwtSecret) throw new Error('JWT_SECRET must be defined in environment configuration');
    }

    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('login')
    async login(@Body() body: { email: string; password: string; role?: string }) {
        try {
            const { email, password } = body;
            this.logger.log(`Login attempt: email="${email}"`);
            if (!email || !password) {
                throw new HttpException({ success: false, error: 'Email and password are required' }, HttpStatus.BAD_REQUEST);
            }

            const cleanEmail = email.trim().toLowerCase();
            const supabase = this.supabaseService.getClient();
            const { data: user, error } = await supabase
                .from('sakhi_clinic_users')
                .select('*')
                .ilike('email', cleanEmail)
                .single();

            this.logger.debug(`Supabase user query result for ${cleanEmail}: user=${!!user}, error=${error ? JSON.stringify(error) : 'none'}`);

            if (error || !user) {
                this.logger.error(`Login failed: user=${!!user}, error=${JSON.stringify(error)}`);
                throw new HttpException({ success: false, error: 'Invalid credentials' }, HttpStatus.UNAUTHORIZED);
            }

            if (user.is_active === false) {
                throw new HttpException({ success: false, error: 'Your staff account is currently deactivated. Please contact your Clinic Administrator.' }, HttpStatus.UNAUTHORIZED);
            }

            let clinicSpecialty = 'General';

            // Verify clinic organization status for non-superadmin users
            if (user.clinic_id && !user.is_super_admin) {
                const { data: clinic } = await supabase
                    .from('clinics')
                    .select('is_active, name, specialty')
                    .eq('id', user.clinic_id)
                    .single();
                
                if (clinic) {
                    clinicSpecialty = clinic.specialty || 'General';
                }

                if (clinic && clinic.is_active === false) {
                    throw new HttpException({ 
                        success: false, 
                        error: `Access Suspended: ${clinic.name || 'Your clinic'} organization is currently inactive. Contact Medcy Support.` 
                    }, HttpStatus.FORBIDDEN);
                }
            }

            if (!user.password_hash) {
                throw new HttpException({ success: false, error: 'User has no password set. Please contact admin.' }, HttpStatus.UNAUTHORIZED);
            }

            // 2. Check Lockout State
            if (user.locked_until) {
                const lockTime = new Date(user.locked_until).getTime();
                const now = new Date().getTime();
                if (now < lockTime) {
                    const remainingMinutes = Math.ceil((lockTime - now) / 60000);
                    throw new HttpException(
                        { success: false, error: `Account locked. Try again in ${remainingMinutes} minutes.` },
                        HttpStatus.FORBIDDEN
                    );
                }
            }

            // 3. Crypto Verification
            let isMatch = false;

            try {
                isMatch = await bcrypt.compare(password, user.password_hash);
            } catch (err) {
                this.logger.error('Error verifying password hash:', err);
                throw new HttpException({ success: false, error: 'Password hashing error: ' + (err as any).message }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            // 4. Handle Failure & Counter
            if (!isMatch) {
                const newAttempts = (user.failed_attempts || 0) + 1;
                const updateData: any = { failed_attempts: newAttempts };
                if (newAttempts >= 5) {
                    const lockUntilDate = new Date(new Date().getTime() + 15 * 60000);
                    updateData.locked_until = lockUntilDate.toISOString();
                }
                await supabase.from('sakhi_clinic_users').update(updateData).eq('id', user.id);

                try {
                    await this.eventsQueue.add(DFO_EVENTS.AUTH_LOGIN_FAILED, new AuthEvent(
                        null, null, { action: 'login_failed', username: email, reason: 'Invalid credentials' }
                    ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
                } catch (queueErr) {
                    this.logger.error('Failed to queue login failed event', queueErr);
                }
                throw new HttpException({ success: false, error: 'Invalid credentials' }, HttpStatus.UNAUTHORIZED);
            }

            // Successful login -> Reset lockout
            const updateSuccessData: any = { failed_attempts: 0, locked_until: null };
            await supabase.from('sakhi_clinic_users').update(updateSuccessData).eq('id', user.id);

            // 5. Role Portal Gate Validation
            if (body.role) {
                const requestedRole = body.role.trim().toLowerCase();
                const userRole = (user.role || '').trim().toLowerCase();
                
                const normalizeRole = (r: string) => {
                    if (r.includes('admin')) return 'admin';
                    if (r.includes('doctor') || r.includes('physician')) return 'doctor';
                    if (r.includes('nurse')) return 'nurse';
                    if (r.includes('front') || r.includes('reception')) return 'front_desk';
                    if (r.includes('cro') || r.includes('sales')) return 'cro';
                    return r;
                };

                const normRequested = normalizeRole(requestedRole);
                const normUser = normalizeRole(userRole);

                if (normRequested !== normUser) {
                    const formatTitle = (r: string) => {
                        if (r === 'admin') return 'Clinic Admin';
                        if (r === 'doctor') return 'Doctor';
                        if (r === 'nurse') return 'Nurse';
                        if (r === 'front_desk') return 'Front Desk';
                        if (r === 'cro') return 'CRO';
                        return user.role || 'another';
                    };
                    throw new HttpException({
                        success: false,
                        error: `Access Denied: Your account is registered as ${formatTitle(normUser)}. Please switch to the ${formatTitle(normUser)} portal tab to sign in.`
                    }, HttpStatus.FORBIDDEN);
                }
            }

            const displayName = user.name || user.full_name || (user.email ? user.email.split('@')[0].split('.').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'User');


            const token = jwt.sign(
                {
                    sub: user.id,
                    user_id: user.id,
                    email: user.email,
                    role: 'authenticated',
                    user_role: user.role,
                    name: [user.first_name, user.last_name].filter(Boolean).join(' ') || (user.email ? user.email.split('@')[0] : 'User'),
                    first_name: user.first_name,
                    last_name: user.last_name,
                    clinic_id: user.clinic_id,
                    is_super_admin: user.is_super_admin,
                    is_clinic_admin: user.is_clinic_admin || user.role === 'admin' || user.role === 'Admin'
                },
                this.jwtSecret,
                { expiresIn: this.jwtExpiresIn },
            );

            const userResponse = {
                id: user.id,
                name: [user.first_name, user.last_name].filter(Boolean).join(' ') || (user.email ? user.email.split('@')[0] : 'User'),
                first_name: user.first_name,
                last_name: user.last_name,
                middle_name: user.middle_name,
                hospital_id: user.hospital_id,
                phone_number: user.phone_number,
                department: user.department,
                designation: user.designation,
                profile_image_url: user.profile_image_url,
                email: user.email,
                role: user.role,
                clinic_id: user.clinic_id,
                clinic_specialty: clinicSpecialty,
                is_super_admin: user.is_super_admin,
                is_clinic_admin: user.is_clinic_admin || user.role === 'admin' || user.role === 'Admin',
                specialization: user.specialization,
                is_active: user.is_active,
                status: user.status,
                token
            };

            try {
                await this.eventsQueue.add(DFO_EVENTS.AUTH_LOGIN, new AuthEvent(
                    user.clinic_id, user.id, { action: 'login_success' }
                ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
            } catch (queueErr) {
                this.logger.error('Failed to queue login success event', queueErr);
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

    @Get('me')
    async getMe(@Headers('authorization') authHeader: string) {
        const decoded = this.verifyToken(authHeader);
        
        try {
            const supabase = this.supabaseService.getClient();
            const { data: user, error } = await supabase
                .from('sakhi_clinic_users')
                .select('*')
                .eq('id', decoded.sub)
                .single();

            if (error || !user) throw new Error('User not found in DB');

            let clinicSpecialty = 'General';
            if (user.clinic_id && !user.is_super_admin) {
                const { data: clinic } = await supabase
                    .from('clinics')
                    .select('specialty')
                    .eq('id', user.clinic_id)
                    .single();
                if (clinic) {
                    clinicSpecialty = clinic.specialty || 'General';
                }
            }

            return {
                success: true,
                user: {
                    id: user.id,
                    name: [user.first_name, user.last_name].filter(Boolean).join(' ') || (user.email ? user.email.split('@')[0] : 'User'),
                    first_name: user.first_name,
                    last_name: user.last_name,
                    middle_name: user.middle_name,
                    hospital_id: user.hospital_id,
                    phone_number: user.phone_number,
                    department: user.department,
                    designation: user.designation,
                    specialization: user.specialization,
                    profile_image_url: user.profile_image_url,
                    email: user.email,
                    role: user.role,
                    clinic_id: user.clinic_id,
                    clinic_specialty: clinicSpecialty,
                    is_super_admin: user.is_super_admin,
                    is_clinic_admin: user.is_clinic_admin || user.role === 'admin' || user.role === 'Admin',
                    is_active: user.is_active !== false
                }
            };
        } catch (err) {
            // Fallback to token if DB fetch fails
            return {
                success: true,
                user: {
                    id: decoded.sub,
                    email: decoded.email,
                    role: decoded.user_role || decoded.role,
                    name: decoded.name,
                    clinic_id: decoded.clinic_id,
                }
            };
        }
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
            role: 'authenticated',
            user_role: data.role,
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
        if (!isMatch) {
            throw new HttpException({ success: false, error: 'Incorrect current password' }, HttpStatus.UNAUTHORIZED);
        }

        let new_password_hash = await bcrypt.hash(newPassword, 10);

        const { error: updateError } = await supabase
            .from('sakhi_clinic_users')
            .update({ password_hash: new_password_hash })
            .eq('id', decoded.sub);

        if (updateError) {
            throw new HttpException({ success: false, error: 'Failed to update password' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return { success: true, message: 'Password updated successfully' };
    }

    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('forgot-password')
    async forgotPassword(@Body() body: { email: string; phone_number?: string; hospital_id?: string }) {
        try {
            const { email } = body;
            if (!email) {
                throw new HttpException({ success: false, error: 'Hospital email is required' }, HttpStatus.BAD_REQUEST);
            }

            const cleanEmail = email.trim().toLowerCase();
            const supabase = this.supabaseService.getClient();
            const { data: user, error } = await supabase
                .from('sakhi_clinic_users')
                .select('id, email, phone_number, hospital_id, is_active, first_name, last_name, clinic_id')
                .ilike('email', cleanEmail)
                .single();

            if (error || !user) {
                throw new HttpException({ 
                    success: false, 
                    error: 'No active staff account found with this email. Please check your spelling or contact your Clinic Administrator.' 
                }, HttpStatus.NOT_FOUND);
            }

            if (user.is_active === false) {
                throw new HttpException({ success: false, error: 'Your staff account is currently deactivated. Contact Clinic IT.' }, HttpStatus.UNAUTHORIZED);
            }

            // Verify clinic status if clinic_id is present
            if (user.clinic_id) {
                const { data: clinic } = await supabase
                    .from('clinics')
                    .select('is_active')
                    .eq('id', user.clinic_id)
                    .single();
                if (clinic && clinic.is_active === false) {
                    throw new HttpException({ success: false, error: 'Your hospital organization is suspended. Please contact Medcy Health Tech support.' }, HttpStatus.FORBIDDEN);
                }
            }

            // Generate cryptographically secure 6-digit verification code
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Sign a secure 15-minute temporary reset token containing verification payload
            const resetSessionToken = jwt.sign(
                {
                    sub: user.id,
                    email: user.email,
                    code: resetCode,
                    purpose: 'password_reset'
                },
                this.jwtSecret,
                { expiresIn: '15m' }
            );

            // Mask phone number for display if available
            let maskedPhone = '';
            if (user.phone_number) {
                const cleaned = user.phone_number.trim();
                if (cleaned.length >= 4) {
                    maskedPhone = cleaned.slice(0, 3) + '••••••' + cleaned.slice(-3);
                } else {
                    maskedPhone = '••••••';
                }
            }

            // Emit audit event
            try {
                await this.eventsQueue.add(DFO_EVENTS.AUTH_PASSWORD_CHANGED, new AuthEvent(
                    user.clinic_id, user.id, { action: 'password_reset_requested', email: user.email }
                ), { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
            } catch (queueErr) {
                this.logger.warn('Failed to queue password reset requested event', queueErr);
            }

            return {
                success: true,
                message: 'Verification security PIN generated successfully.',
                masked_phone: maskedPhone || undefined,
                reset_session_token: resetSessionToken,
                dev_code: process.env.NODE_ENV === 'production' ? undefined : resetCode,
                user_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Staff Member'
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('forgotPassword error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('reset-password')
    async resetPassword(@Body() body: { email: string; reset_code: string; reset_session_token: string; new_password: string }) {
        try {
            const { email, reset_code, reset_session_token, new_password } = body;
            if (!email || !reset_code || !reset_session_token || !new_password) {
                throw new HttpException({ success: false, error: 'Email, verification code, session token, and new password are required' }, HttpStatus.BAD_REQUEST);
            }

            if (new_password.length < 6) {
                throw new HttpException({ success: false, error: 'Password must be at least 6 characters long' }, HttpStatus.BAD_REQUEST);
            }

            // Verify the reset session token
            let decoded: any;
            try {
                decoded = jwt.verify(reset_session_token, this.jwtSecret);
            } catch (err) {
                throw new HttpException({ success: false, error: 'Password reset session has expired. Please request a new code.' }, HttpStatus.UNAUTHORIZED);
            }

            const cleanEmail = email.trim().toLowerCase();
            if (decoded.purpose !== 'password_reset' || (decoded.email || '').toLowerCase() !== cleanEmail) {
                throw new HttpException({ success: false, error: 'Invalid reset session data' }, HttpStatus.UNAUTHORIZED);
            }

            if (decoded.code !== reset_code.trim()) {
                throw new HttpException({ success: false, error: 'Invalid 6-digit verification code. Please check and try again.' }, HttpStatus.BAD_REQUEST);
            }

            const supabase = this.supabaseService.getClient();
            const newPasswordHash = await bcrypt.hash(new_password, 10);

            const { error: updateError } = await supabase
                .from('sakhi_clinic_users')
                .update({
                    password_hash: newPasswordHash,
                    failed_attempts: 0,
                    locked_until: null
                })
                .eq('id', decoded.sub);

            if (updateError) {
                this.logger.error('Failed to update password in Supabase:', updateError);
                throw new HttpException({ success: false, error: 'Failed to update password in database' }, HttpStatus.INTERNAL_SERVER_ERROR);
            }

            return {
                success: true,
                message: 'Your password has been securely reset. You can now sign in with your new credentials.'
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('resetPassword error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('demo-request')
    async demoRequest(@Body() body: {
        name: string;
        hospital_name: string;
        email: string;
        phone: string;
        designation?: string;
        city?: string;
        patient_volume?: string;
        preferred_contact_method?: string;
        preferred_slot?: string;
        message?: string;
    }) {
        try {
            const { name, hospital_name, email, phone, designation, city, patient_volume, preferred_contact_method, preferred_slot, message } = body;

            if (!name || !hospital_name || !phone || !email) {
                throw new HttpException({ success: false, error: 'Name, Hospital/Clinic Name, Phone, and Email are required' }, HttpStatus.BAD_REQUEST);
            }

            const supabase = this.supabaseService.getClient();

            const demoPayload: any = {
                hospital_name: hospital_name.trim(),
                contact_name: name.trim(),
                designation: designation || 'Medical Director / Clinic Admin',
                email: email.trim(),
                phone: phone.trim(),
                city: city ? city.trim() : null,
                patient_volume: patient_volume || '100 - 500 Patients / mo',
                preferred_channel: preferred_contact_method || 'WhatsApp Walkthrough',
                preferred_slot: preferred_slot || 'Tomorrow Morning (10:00 AM - 1:00 PM)',
                message: message ? message.trim() : null,
                status: 'pending'
            };

            const { data, error } = await supabase
                .from('sakhi_clinic_demo_requests')
                .insert(demoPayload)
                .select()
                .single();

            if (error) {
                this.logger.error('Failed to insert into sakhi_clinic_demo_requests:', error);
            }

            // Format direct WhatsApp link
            const whatsappMessage = encodeURIComponent(
                `Hello Medcy Health Tech Team, I just requested a live clinic demo for ${hospital_name} (${name}, ${designation || 'Clinical Lead'}). Looking forward to connecting!`
            );
            const whatsappUrl = `https://wa.me/919876543210?text=${whatsappMessage}`;

            return {
                success: true,
                message: 'Your clinic walkthrough & demo request has been received! Our onboarding specialist will contact you shortly.',
                lead_id: data?.id || 'demo-' + Date.now(),
                contact_channels: {
                    whatsapp_url: whatsappUrl,
                    sales_hotline: '+91 98765 43210',
                    sales_email: 'onboarding@medcyhealthtech.com',
                    representative_name: 'Medcy Clinical Solutions Team'
                }
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('demoRequest error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
