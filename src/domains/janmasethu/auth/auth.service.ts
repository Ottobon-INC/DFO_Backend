import { Injectable, UnauthorizedException, Logger, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly jwtService: JwtService,
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    ) { }

    async login(email: string, password: string, domain: string = 'janmasethu') {
        // 1. Fetch user from database
        const { data: user, error } = await this.supabase
            .from('users')
            .select('id, email, password_hash, role, domain, is_active, full_name')
            .eq('email', email.toLowerCase().trim())
            .eq('domain', domain)
            .single();

        if (error || !user) {
            throw new UnauthorizedException('Invalid email or password.');
        }

        if (!user.is_active) {
            throw new UnauthorizedException('Account is deactivated. Contact your administrator.');
        }

        // 2. Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid email or password.');
        }

        // 3. Generate JWT tokens
        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role,
            domain: user.domain,
        };

        const accessToken = this.jwtService.sign(payload, { expiresIn: '8h' });
        const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

        this.logger.log(`User ${user.email} [${user.role}] authenticated successfully.`);

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 28800, // 8 hours in seconds
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                domain: user.domain,
            },
        };
    }

    async refreshToken(refreshToken: string) {
        try {
            const payload = this.jwtService.verify(refreshToken);
            const newAccessToken = this.jwtService.sign({
                sub: payload.sub,
                email: payload.email,
                role: payload.role,
                domain: payload.domain,
            }, { expiresIn: '8h' });

            return { access_token: newAccessToken, expires_in: 28800 };
        } catch {
            throw new UnauthorizedException('Invalid or expired refresh token.');
        }
    }

    async validateToken(token: string) {
        try {
            return this.jwtService.verify(token);
        } catch {
            throw new UnauthorizedException('Invalid or expired token.');
        }
    }
}
