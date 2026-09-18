import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../infrastructure/security/permissions.decorator';
import { getRoleTier } from '../../../infrastructure/security/roles.constants';

const ROLE_PERMISSIONS: Record<string, string[]> = {
    'admin': ['can_manage_clinic', 'can_delete_users', 'can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_prescribe', 'can_record_vitals', 'can_edit_vitals'],
    'doctor': ['can_manage_clinic', 'can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_prescribe', 'can_record_vitals', 'can_edit_vitals'],
    'nurse': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'staff_nurse': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'staff nurse': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'triage_nurse': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'triage nurse': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'ivf_nurse': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'ivf nurse': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'lab_staff': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'lab staff': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_update_bed_status', 'can_manage_admissions', 'can_write_clinical_notes', 'can_record_vitals', 'can_edit_vitals'],
    'cro': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_manage_admissions'],
    'receptionist': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_manage_admissions'],
    'front_desk': ['can_view_patients', 'can_manage_schedule', 'can_manage_rooms', 'can_manage_admissions'],
};

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredPermissions = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler());
        if (!requiredPermissions || requiredPermissions.length === 0) {
            // No permissions defined, so anyone can access
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            throw new HttpException(
                { success: false, error: 'Access Denied: Authentication required.' },
                HttpStatus.FORBIDDEN
            );
        }

        // Super Admins and Clinic Admins bypass all checks
        if (user.is_super_admin || user.is_clinic_admin) {
            return true;
        }

        const rawRole = user.role || user.user_role;
        const userTier = getRoleTier(rawRole);

        // Tier 1 (Doctor / Admin): Absolute God-mode over all clinical & operational permissions
        if (userTier <= 1) {
            return true;
        }

        const userRole = (rawRole || '').toLowerCase();
        let userPermissions = ROLE_PERMISSIONS[userRole] || [];

        // Fallback tier-based permissions if custom string role wasn't directly in dictionary
        if (userPermissions.length === 0) {
            if (userTier === 2) {
                userPermissions = ROLE_PERMISSIONS['nurse'];
            } else if (userTier === 3) {
                userPermissions = ROLE_PERMISSIONS['front_desk'];
            }
        }

        // Check if the user has AT LEAST ONE of the required permissions
        const hasPermission = requiredPermissions.some(permission => 
            userPermissions.includes(permission.toLowerCase())
        );

        if (hasPermission) {
            return true;
        }

        throw new HttpException(
            { success: false, error: 'Access Denied: You do not have the required permission to perform this action.' },
            HttpStatus.FORBIDDEN
        );
    }
}
