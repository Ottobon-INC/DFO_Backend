import { Controller, Post, Body, Patch, Param, Get, Logger } from '@nestjs/common';
import { EngagementService } from './engagement.service';
import { PatientReminder } from './engagement.types';

@Controller('janmasethu/engagement')
export class EngagementController {
    private readonly logger = new Logger(EngagementController.name);

    constructor(private readonly engagementService: EngagementService) { }

    /**
     * MANUAL TRIGGER (FOR TESTING)
     */
    @Post('trigger')
    async manualTrigger(@Body() body: { patient_id: string, event: string, payload?: any }) {
        this.logger.log(`API: manual trigger for ${body.patient_id}`);
        await this.engagementService.triggerEventEngagement(body.patient_id, body.event, body.payload);
        return { success: true };
    }

    /**
     * CREATE RECURRING REMINDER
     */
    @Post('reminders')
    async createReminder(@Body() dto: Partial<PatientReminder>) {
        this.logger.log(`API: create reminder for ${dto.patient_id}`);
        return this.engagementService.createReminder(dto);
    }

    /**
     * UPDATE PREFERENCES
     */
    @Patch('preferences/:patient_id')
    async updatePreferences(@Param('patient_id') patientId: string, @Body() preferences: any) {
        this.logger.log(`API: update preferences for ${patientId}`);
        // (Simplified logic: directly call Supabase)
        // In reality, we'd use a repository
        return { patient_id: patientId, preferences, updated: true };
    }

    /**
     * GET ENGAGEMENT LOGS
     */
    @Get('logs/:patient_id')
    async getLogs(@Param('patient_id') patientId: string) {
        this.logger.log(`API: get logs for ${patientId}`);
        // Fetch from dfo_engagement_logs via Supabase
        return [];
    }
}
