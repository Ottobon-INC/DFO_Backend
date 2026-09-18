import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MIN_ROLE_TIER_KEY } from '../../../infrastructure/security/role-tier.decorator';
import { getRoleTier } from '../../../infrastructure/security/roles.constants';

/**
 * HierarchicalRolesGuard
 *
 * A NestJS guard that enforces hierarchical, math-based RBAC.
 *
 * How it works:
 *   1. Reads the required tier from the @MinRoleTier(n) decorator on the route.
 *   2. Gets the user's string role from the JWT (attached by ClinicsAuthGuard).
 *   3. Translates the string role to a tier number using getRoleTier().
 *   4. Allows access if userTier <= requiredTier (lower number = more power).
 *
 * Super Admins automatically bypass all tier checks.
 */
@Injectable()
export class HierarchicalRolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredTier = this.reflector.get<number>(MIN_ROLE_TIER_KEY, context.getHandler());

        // If no @MinRoleTier decorator is applied, allow access (no restriction).
        if (requiredTier === undefined || requiredTier === null) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            throw new HttpException(
                { success: false, error: 'Access Denied: Authentication required.' },
                HttpStatus.FORBIDDEN,
            );
        }

        // Super Admins bypass all tier checks
        if (user.is_super_admin) {
            return true;
        }

        const userRole = user.role || user.user_role;
        const userTier = getRoleTier(userRole);

        // The core math: lower tier number = more power
        if (userTier <= requiredTier) {
            return true;
        }

        throw new HttpException(
            {
                success: false,
                error: `Access Denied: This action requires Tier ${requiredTier} access. Your role "${userRole}" is Tier ${userTier}.`,
            },
            HttpStatus.FORBIDDEN,
        );
    }
}
