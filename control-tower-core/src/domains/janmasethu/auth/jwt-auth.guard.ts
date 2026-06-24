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
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            // Fallback for current testing if no header is provided (optional, but safer to enforce)
            // For now, let's enforce it.
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
            };
            return true;
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}
