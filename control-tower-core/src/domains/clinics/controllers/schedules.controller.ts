import { Controller, Get, Post, Body, Param, UseGuards, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { SchedulesService } from '../services/schedules.service';

@Controller('api/v1/clinics/schedules')
@UseGuards(ClinicsAuthGuard)
export class SchedulesController {
    private readonly logger = new Logger(SchedulesController.name);

    constructor(private readonly schedulesService: SchedulesService) {}

    @Get(':doctorId')
    async getDoctorSchedules(
        @Param('doctorId') doctorId: string
    ) {
        const clinicId = TenantContext.getClinicId() || '';
        this.logger.log(`Fetching schedules for doctor ${doctorId} in clinic ${clinicId}`);
        return this.schedulesService.getSchedules(clinicId, doctorId);
    }

    @Post(':doctorId')
    async saveDoctorSchedules(
        @Param('doctorId') doctorId: string,
        @Body() body: { schedules: any[] }
    ) {
        const clinicId = TenantContext.getClinicId() || '';
        this.logger.log(`Saving schedules for doctor ${doctorId} in clinic ${clinicId}`);
        return this.schedulesService.saveSchedules(clinicId, doctorId, body.schedules);
    }
}
