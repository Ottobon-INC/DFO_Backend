import { Controller, Get, HttpException, HttpStatus, UseGuards, Logger } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';

@Controller('api/v1/clinics')
@UseGuards(ClinicsAuthGuard)
export class ClinicsController {
    private readonly logger = new Logger(ClinicsController.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService
    ) {}

    @Get('doctors')
    async getDoctors() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();

        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .select('id, first_name, last_name, specialization, role')
                .eq('clinic_id', clinic_id)
                .in('role', ['Doctor', 'Superadmin', 'Admin'])
                .order('first_name');
            if (error) throw error;
            
            const mappedData = (data || []).map(d => ({
                ...d,
                name: `${d.first_name || ''} ${d.last_name || ''}`.trim()
            }));
            
            return { success: true, data: mappedData };
        } catch (error: any) {
            this.logger.error('GET /api/v1/clinics/doctors', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
