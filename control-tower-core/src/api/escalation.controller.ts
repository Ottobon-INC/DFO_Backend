import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { EscalationService } from '../kernel/escalations/escalation.service';

@Controller('api/escalations')
export class EscalationController {
    constructor(private readonly escalationService: EscalationService) {}

    @Get('doctor')
    async getDoctorEscalations(
        @Query('doctorId') doctorId: string,
        @Query('clinicId') clinicId?: string
    ) {
        return this.escalationService.getDoctorEscalations(doctorId, clinicId);
    }

    @Patch(':id/status')
    async updateEscalationStatus(
        @Param('id') id: string,
        @Body('status') status: string
    ) {
        return this.escalationService.updateEscalationStatus(id, status);
    }

    @Get(':id/messages')
    async getEscalationMessages(@Param('id') id: string) {
        const messages = await this.escalationService.getEscalationMessages(id);
        return { success: true, data: messages };
    }
}
