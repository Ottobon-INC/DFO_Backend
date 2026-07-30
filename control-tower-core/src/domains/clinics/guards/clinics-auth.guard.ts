import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';

@Injectable()
export class ClinicsAuthGuard implements CanActivate {
    private readonly logger = new Logger(ClinicsAuthGuard.name);
    private readonly jwtSecret: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly supabaseService: ClinicsSupabaseService,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') as string;
        if (!this.jwtSecret) throw new Error('JWT_SECRET must be defined in environment configuration');
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers['authorization'];

        if (!authHeader) {
            throw new UnauthorizedException('Missing Authorization header');
        }

        const token = authHeader.replace('Bearer ', '');

        try {
            const decoded = jwt.verify(token, this.jwtSecret) as any;
            
            // Query DB to verify the user is still active (blocks Zombie Tokens)
            const supabase = this.supabaseService.getClient();
            const { data: userRecord, error } = await supabase
                .from('sakhi_clinic_users')
                .select('is_active')
                .eq('id', decoded.sub)
                .single();

            if (error || !userRecord || userRecord.is_active === false) {
                this.logger.warn(`Rejected soft-deleted or non-existent user token for ID: ${decoded.sub}`);
                throw new UnauthorizedException('User account is disabled or deleted');
            }

            // Attach user info to request for downstream use
            request.user = {
                id: decoded.sub,
                email: decoded.email,
                role: decoded.user_role || decoded.role,
                name: decoded.name,
                ...decoded,
            };
            return true;
        } catch (err) {
            this.logger.warn('JWT validation failed');
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}
