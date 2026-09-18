import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());
        if (!requiredRoles) {
            // No roles defined, so anyone can access
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.role) {
            throw new HttpException(
                { success: false, error: 'Access Denied: You do not have the required role to perform this action.' },
                HttpStatus.FORBIDDEN
            );
        }

        const hasRole = () => requiredRoles.some((role) => user.role.toLowerCase() === role.toLowerCase());
        
        // Super Admins automatically bypass standard role restrictions
        if (user.is_super_admin || hasRole()) {
            return true;
        }

        throw new HttpException(
            { success: false, error: 'Access Denied: You do not have the required role to perform this action.' },
            HttpStatus.FORBIDDEN
        );
    }
}
