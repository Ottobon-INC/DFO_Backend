import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SuperAdminGuard implements CanActivate {
    private readonly logger = new Logger(SuperAdminGuard.name);
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
            
            if (!decoded.is_super_admin) {
                throw new ForbiddenException('Access denied. Super Admin privileges required.');
            }

            request.user = {
                id: decoded.sub,
                email: decoded.email,
                role: decoded.role,
                name: decoded.name,
                is_super_admin: decoded.is_super_admin,
                ...decoded,
            };
            return true;
        } catch (err: any) {
            if (err instanceof ForbiddenException) throw err;
            this.logger.warn('JWT validation failed');
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}
