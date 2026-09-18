import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { CreateFollowUpDto, FollowUpsService, UpdateFollowUpDto } from '../services/follow-ups.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { HttpException, HttpStatus } from '@nestjs/common';

@ApiTags('Follow-Ups')
@ApiBearerAuth()
@UseGuards(ClinicsAuthGuard)
@Controller('api/v1/clinics/follow-ups')
export class FollowUpsController {
    constructor(private readonly followUpsService: FollowUpsService) {}

    @Post()
    @ApiOperation({ summary: 'Create a new follow-up' })
    async createFollowUp(@Req() req: any, @Body() payload: CreateFollowUpDto) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        return this.followUpsService.createFollowUp(clinic_id, payload);
    }

    @Get()
    @ApiOperation({ summary: 'Get follow-ups for a clinic' })
    async getFollowUps(
        @Req() req: any,
        @Query('patient_id') patientId?: string,
        @Query('date') date?: string,
        @Query('status') status?: string
    ) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        return this.followUpsService.getFollowUps(clinic_id, { patient_id: patientId, date, status });
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update a follow-up status or notes' })
    async updateFollowUp(
        @Req() req: any,
        @Param('id') followUpId: string,
        @Body() payload: UpdateFollowUpDto
    ) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        return this.followUpsService.updateFollowUp(clinic_id, followUpId, payload);
    }
}
