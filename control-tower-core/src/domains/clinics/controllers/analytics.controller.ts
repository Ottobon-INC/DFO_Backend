import { Controller, Get, Query, Req, UseGuards, BadRequestException, Res } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { AnalyticsService } from '../services/analytics.service';
import { Response } from 'express';

@Controller('api/v1/clinics/analytics')
@UseGuards(ClinicsAuthGuard)
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) {}

    @Get('doctors')
    async getDoctorPerformance(
        @Req() req: any, 
        @Query('doctor_id') doctorId: string,
        @Query('start_date') startDate: string,
        @Query('end_date') endDate: string
    ) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        if (!doctorId || !startDate || !endDate) {
            throw new BadRequestException('doctor_id, start_date, and end_date are required');
        }
        return this.analyticsService.getDoctorPerformance(tenantId, doctorId, startDate, endDate);
    }

    @Get('clinic')
    async getClinicThroughput(
        @Req() req: any, 
        @Query('start_date') startDate: string,
        @Query('end_date') endDate: string
    ) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        if (!startDate || !endDate) {
            throw new BadRequestException('start_date and end_date are required');
        }
        return this.analyticsService.getClinicThroughput(tenantId, startDate, endDate);
    }

    @Get('export')
    async exportQueueReports(
        @Req() req: any, 
        @Query('start_date') startDate: string,
        @Query('end_date') endDate: string,
        @Res() res: Response
    ) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        if (!startDate || !endDate) {
            throw new BadRequestException('start_date and end_date are required');
        }
        
        const csv = await this.analyticsService.generateExport(tenantId, startDate, endDate);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', ttachment; filename="queue_export_\_to_\.csv");
        res.send(csv);
    }
}
