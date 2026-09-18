import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { SchedulesService } from '../services/schedules.service';

@Controller('api/v1/clinics/schedules')
@UseGuards(ClinicsAuthGuard)
export class SchedulesController {
    private readonly logger = new Logger(SchedulesController.name);

    constructor(private readonly schedulesService: SchedulesService) {}

    @Get(':doctorId/slots')
    async getDoctorSlots(
        @Param('doctorId') doctorId: string,
        @Query('date') date?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        const clinicId = TenantContext.getClinicId() || '';
        const sDate = startDate || date;
        const eDate = endDate || date;
        this.logger.log(`Fetching available slots for doctor ${doctorId} from ${sDate || 'today'} to ${eDate || 'future'}`);
        const slots = await this.schedulesService.getAvailableSlots(clinicId, doctorId, sDate, eDate);
        return { success: true, data: slots };
    }

    @Get(':doctorId/leaves')
    async getDoctorLeaves(
        @Param('doctorId') doctorId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string
    ) {
        const clinicId = TenantContext.getClinicId() || '';
        this.logger.log(`Fetching leaves for doctor ${doctorId} in clinic ${clinicId}`);
        const leaves = await this.schedulesService.getDoctorLeaves(clinicId, doctorId, startDate, endDate);
        return { success: true, data: leaves };
    }

    @Post(':doctorId/leave')
    async setDoctorLeave(
        @Param('doctorId') doctorId: string,
        @Body() body: { leaveDate: string, leaveType?: string, reason?: string }
    ) {
        const clinicId = TenantContext.getClinicId() || '';
        this.logger.log(`Setting leave for doctor ${doctorId} on ${body.leaveDate}`);
        return this.schedulesService.setDoctorLeave(clinicId, doctorId, body.leaveDate, body.leaveType, body.reason);
    }

    @Delete(':doctorId/leave/:leaveDate')
    async removeDoctorLeave(
        @Param('doctorId') doctorId: string,
        @Param('leaveDate') leaveDate: string
    ) {
        const clinicId = TenantContext.getClinicId() || '';
        this.logger.log(`Removing leave for doctor ${doctorId} on ${leaveDate}`);
        return this.schedulesService.removeDoctorLeave(clinicId, doctorId, leaveDate);
    }

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
        @Body() body: { schedules: any[], startDate?: string, endDate?: string }
    ) {
        const clinicId = TenantContext.getClinicId() || '';
        this.logger.log(`Saving schedules for doctor ${doctorId} in clinic ${clinicId}`);
        return this.schedulesService.saveSchedules(clinicId, doctorId, body.schedules, body.startDate, body.endDate);
    }
}


