import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class ClinicsAuthGuard implements CanActivate {
    private readonly logger = new Logger(ClinicsAuthGuard.name);
    private readonly jwtSecret: string;

    constructor(private readonly configService: ConfigService) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'fallback_secret_do_not_use_in_prod';
    }

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers['authorization'];

        if (!authHeader) {
            throw new UnauthorizedException('Missing Authorization header');
        }

        const token = authHeader.replace('Bearer ', '');

        try {
            const decoded = jwt.verify(token, this.jwtSecret) as any;
            // Attach user info to request for downstream use
            request.user = {
                id: decoded.sub,
                email: decoded.email,
                role: decoded.role,
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
