import { Controller, Post, Get, Delete, Param, Body, Logger, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { CreateClinicDto } from '../dto/create-clinic.dto';

@Controller('api/v1/superadmin')
@UseGuards(SuperAdminGuard)
export class SuperAdminController {
    private readonly logger = new Logger(SuperAdminController.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
    ) {}

    @Post('clinics')
    async createClinic(@Body() body: CreateClinicDto) {
        const { clinic_name, owner_name, owner_email, owner_role } = body;
        const supabase = this.supabaseService.getClient();

        try {
            // Step 1: Insert Clinic
            const { data: clinic, error: clinicError } = await supabase
                .from('clinics')
                .insert([{ name: clinic_name }])
                .select()
                .single();

            if (clinicError) throw clinicError;

            // Step 2: Insert Genesis Admin (Owner)
            // Generate a random temporary password or leave it to be set later via email link
            let password_hash = 'Temporary123!';
            try {
                const passwordHash = require('password-hash');
                password_hash = passwordHash.generate(password_hash);
            } catch {}

            const adminPayload = {
                name: owner_name,
                email: owner_email,
                password_hash,
                role: owner_role || 'Doctor', // Use the user-provided role
                clinic_id: clinic.id,
                is_clinic_admin: true,
                is_super_admin: false,
            };

            const { data: adminUser, error: adminError } = await supabase
                .from('sakhi_clinic_users')
                .insert([adminPayload])
                .select('id, name, email, role, clinic_id, is_clinic_admin')
                .single();

            if (adminError) {
                // If it fails, log it, but the clinic was already created.
                this.logger.error('Failed to create genesis admin, but clinic was created', adminError);
                if (adminError.code === '23505') {
                   throw new HttpException({ success: false, error: 'Clinic created, but owner email already exists' }, HttpStatus.CONFLICT);
                }
                throw adminError;
            }

            return { 
                success: true, 
                message: 'Clinic and Admin created successfully',
                data: {
                    clinic,
                    admin: adminUser
                } 
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/v1/superadmin/clinics', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('clinics')
    async getClinics() {
        const supabase = this.supabaseService.getClient();
        try {
            const { data: clinics, error } = await supabase
                .from('clinics')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            
            const { data: users, error: usersError } = await supabase
                .from('sakhi_clinic_users')
                .select('clinic_id, id');
            
            if (usersError) throw usersError;

            const clinicsWithCounts = (clinics || []).map(clinic => ({
                ...clinic,
                users_count: (users || []).filter((u: any) => u.clinic_id === clinic.id).length
            }));

            return { success: true, data: clinicsWithCounts };
        } catch (error: any) {
            this.logger.error('GET /api/v1/superadmin/clinics', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Delete('clinics/:id')
    async deleteClinic(@Param('id') id: string) {
        const supabase = this.supabaseService.getClient();
        try {
            // 1. Delete all users belonging to this clinic
            const { error: usersError } = await supabase
                .from('sakhi_clinic_users')
                .delete()
                .eq('clinic_id', id);
            
            if (usersError) throw usersError;

            // 2. Delete the clinic
            const { error: clinicError } = await supabase
                .from('clinics')
                .delete()
                .eq('id', id);

            if (clinicError) throw clinicError;

            return { success: true, message: 'Clinic permanently deleted' };
        } catch (error: any) {
            this.logger.error(`DELETE /api/v1/superadmin/clinics/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
