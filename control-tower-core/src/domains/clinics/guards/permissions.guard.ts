import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../infrastructure/security/permissions.decorator';

// Example minimal mapping of roles to permissions.
// In a full system, this would ideally be in a database.
const ROLE_PERMISSIONS: Record<string, string[]> = {
    'admin': ['can_manage_clinic', 'can_delete_users', 'can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions'],
    'cro': ['can_view_patients', 'can_manage_schedule'],
    'receptionist': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_manage_admissions'],
    'doctor': ['can_view_patients', 'can_write_clinical_notes', 'can_prescribe', 'can_update_bed_status', 'can_manage_admissions'],
    'nurse': ['can_view_patients', 'can_write_clinical_notes', 'can_update_bed_status', 'can_manage_admissions'],
};

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredPermissions = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler());
        if (!requiredPermissions) {
            // No permissions defined, so anyone can access
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.role) {
            throw new HttpException(
                { success: false, error: 'Access Denied: You do not have the required permissions.' },
                HttpStatus.FORBIDDEN
            );
        }

        const userRole = user.role.toLowerCase();
        const userPermissions = ROLE_PERMISSIONS[userRole] || [];

        // Check if the user has AT LEAST ONE of the required permissions
        const hasPermission = requiredPermissions.some(permission => userPermissions.includes(permission.toLowerCase()));
        
        // Note: Super Admins NO LONGER bypass this automatically. 
        // If a Super Admin needs medical permissions, they need a medical role in that clinic.
        if (hasPermission) {
            return true;
        }

        throw new HttpException(
            { success: false, error: 'Access Denied: You do not have the required permission to perform this action.' },
            HttpStatus.FORBIDDEN
        );
    }
}
