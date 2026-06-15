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
                { sub: user.id, email: user.email, role: user.role, name: user.name },
                this.jwtSecret,
                { expiresIn: this.jwtExpiresIn },
            );

            return {
                success: true,
                token,
                user: { id: user.id, name: user.name, email: user.email, role: user.role, token },
                data: {
                    token,
                    user: { id: user.id, name: user.name, email: user.email, role: user.role, token },
                },
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('Login error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
