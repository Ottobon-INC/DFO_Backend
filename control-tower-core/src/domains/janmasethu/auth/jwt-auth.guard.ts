import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JanmasethuUserRole } from '../janmasethu.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(private readonly jwtService: JwtService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        // System service token bypass — MUST be set via SUPER_ADMIN_SECRET env var.
        // If env var is absent, the bypass is disabled to fail securely.
        const systemToken = request.headers['x-system-token'];
        const superSecret = process.env.SUPER_ADMIN_SECRET;
        if (superSecret && systemToken && systemToken === superSecret) {
            request.user = {
                id: 'system-agent',
                email: 'system-agent@janmasethu.com',
                role: JanmasethuUserRole.CRO,
                domain: 'janmasethu',
                clinicId: null,
                clinic_id: null,
            };
            return true;
        }

        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Missing or invalid Authorization header');
        }

        const token = authHeader.split(' ')[1];

        try {
            const payload = this.jwtService.verify(token);
            // Attach user context to request
            request.user = {
                id: payload.sub,
                email: payload.email,
                role: (payload.role as string || '').toUpperCase() as JanmasethuUserRole,
                domain: payload.domain,
                clinicId: payload.clinicId || payload.clinic_id || null,
                clinic_id: payload.clinicId || payload.clinic_id || null,
            };
            return true;
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}
