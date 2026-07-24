import { Controller, Post, Body, Logger, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';

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
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') as string;
        if (!this.jwtSecret) throw new Error('JWT_SECRET must be defined in environment configuration');
        this.superAdminSecret = this.configService.get<string>('SUPER_ADMIN_SECRET') as string;
        if (!this.superAdminSecret) throw new Error('SUPER_ADMIN_SECRET must be defined in environment configuration');
    }

    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
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

            // 3. Crypto Verification & Transparent Upgrade
            let isMatch = false;
            let needsBcryptUpgrade = false;

            if (user.password_hash.startsWith('sha1$')) {
                try {
                    const passwordHash = require('password-hash');
                    if (passwordHash.verify(password, user.password_hash)) {
                        isMatch = true;
                        needsBcryptUpgrade = true;
                    }
                } catch (err) {
                    this.logger.error('Error verifying sha1 hash:', err);
                }
            } else {
                isMatch = await bcrypt.compare(password, user.password_hash);
            }

            // 4. Handle Failure & Counter
            if (!isMatch) {
                const newAttempts = (user.failed_attempts || 0) + 1;
                const updateData: any = { failed_attempts: newAttempts };
                if (newAttempts >= 5) {
                    const lockUntilDate = new Date(new Date().getTime() + 15 * 60000);
                    updateData.locked_until = lockUntilDate.toISOString();
                }
                await supabase.from('super_admins').update(updateData).eq('id', user.id);

                throw new HttpException({ success: false, error: 'Invalid super admin credentials' }, HttpStatus.UNAUTHORIZED);
            }

            // Successful login -> Reset lockout and upgrade hash if needed
            const updateSuccessData: any = { failed_attempts: 0, locked_until: null };
            if (needsBcryptUpgrade) {
                updateSuccessData.password_hash = await bcrypt.hash(password, 10);
            }
            await supabase.from('super_admins').update(updateSuccessData).eq('id', user.id);

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

            // Hash password using bcrypt
            const password_hash = await bcrypt.hash(password, 10);

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
