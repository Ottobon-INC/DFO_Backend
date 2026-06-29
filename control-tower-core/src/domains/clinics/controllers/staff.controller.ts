import { Controller, Post, Get, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsUtilsService } from '../services/clinics-utils.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';

@Controller('api/v1/clinics/staff')
export class StaffController {
    private readonly logger = new Logger(StaffController.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly utils: ClinicsUtilsService,
    ) {}

    @Get()
    async listStaff() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            // Join clinic_staff with sakhi_clinic_users
            const { data, error } = await supabase
                .from('clinic_staff')
                .select(`
                    id,
                    role,
                    is_active,
                    user_id,
                    sakhi_clinic_users (
                        id,
                        name,
                        email,
                        created_at
                    )
                `)
                .eq('clinic_id', clinic_id);

            if (error) throw error;

            // Flatten the response slightly for convenience
            const staffList = data.map((item: any) => ({
                assignment_id: item.id,
                user_id: item.user_id,
                role: item.role,
                is_active: item.is_active,
                name: item.sakhi_clinic_users?.name,
                email: item.sakhi_clinic_users?.email,
                joined_at: item.sakhi_clinic_users?.created_at
            }));

            return { success: true, data: staffList };
        } catch (error: any) {
            this.logger.error('GET /api/v1/clinics/staff', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post()
    async assignStaff(@Body() body: any) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        // RBAC Enforcement: Must be a clinic admin
        if (!TenantContext.getState()?.is_clinic_admin && !TenantContext.isSuperAdmin()) {
            throw new HttpException({ success: false, error: 'Only Clinic Admins can add staff to a clinic' }, HttpStatus.FORBIDDEN);
        }

        const supabase = this.supabaseService.getClient();
        const tv = this.utils.toValue.bind(this.utils);

        try {
            const user_id = tv(body?.user_id);
            const role = tv(body?.role);

            if (!user_id || !role) {
                throw new HttpException({ success: false, error: 'user_id and role are required' }, HttpStatus.BAD_REQUEST);
            }

            const allowedRoles = ['Doctor', 'CRO', 'Receptionist', 'Nurse', 'Admin'];
            if (!allowedRoles.includes(role)) {
                throw new HttpException({ success: false, error: `Invalid role. Must be one of: ${allowedRoles.join(', ')}` }, HttpStatus.BAD_REQUEST);
            }

            // Check if user exists
            const { data: userExists, error: checkError } = await supabase
                .from('sakhi_clinic_users')
                .select('id')
                .eq('id', user_id)
                .maybeSingle();

            if (checkError || !userExists) {
                throw new HttpException({ success: false, error: 'User does not exist' }, HttpStatus.NOT_FOUND);
            }

            // Insert into bridge table
            const payload = {
                user_id,
                clinic_id,
                role,
                is_active: true
            };

            const { data, error } = await supabase
                .from('clinic_staff')
                .insert([payload])
                .select()
                .single();

            if (error) {
                if (error.code === '23505') { // Unique constraint violation
                    throw new HttpException({ success: false, error: 'User is already assigned to this clinic' }, HttpStatus.CONFLICT);
                }
                throw error;
            }

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/v1/clinics/staff', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
