import { Injectable, Logger } from '@nestjs/common';
import { JanmasethuRepository } from '../janmasethu.repository';
import { JanmasethuDispatchService } from '../channel/janmasethu-dispatch.service';
import { RealtimeEventsController } from '../api/realtime-events.controller';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly dispatcher: JanmasethuDispatchService,
    ) { }

    /**
     * RESILIENT OMNICHANNEL DISPATCHER
     */
    async sendAlert(dto: {
        patientId?: string,
        target: string,
        channel: 'WHATSAPP' | 'DASHBOARD' | 'SMS',
        template: string,
        payload: any,
        priority?: 'HIGH' | 'MEDIUM' | 'LOW'
    }) {
        const priority = dto.priority || 'MEDIUM';
        this.logger.log(`[${priority}] Dispatching ${dto.channel} alert to ${dto.target}`);

        // 1. Create Initial Delivery Log
        const logId = await this.repository.createNotificationLog({
            patient_id: dto.patientId,
            channel: dto.channel,
            priority,
            template: dto.template,
            status: 'PENDING',
            payload: dto.payload
        });

        try {
            let success = false;
            switch (dto.channel) {
                case 'WHATSAPP': success = await this.deliverWhatsApp(dto.target, dto.template, dto.payload); break;
                case 'DASHBOARD': success = await this.deliverDashboardAlert(dto.target, dto.payload); break;
                case 'SMS': success = await this.deliverSMS(dto.target, dto.payload); break;
            }

            // 2. Update status on success
            await this.repository.updateNotificationLog(logId, {
                status: success ? 'SENT' : 'FAILED',
                updated_at: new Date()
            });

        } catch (error) {
            this.logger.error(`Notification failure: ${error.message}`);
            await this.repository.updateNotificationLog(logId, {
                status: 'FAILED',
                error_message: error.message,
                updated_at: new Date()
            });
        }
    }

    private async deliverWhatsApp(phone: string, template: string, data: any) {
        this.logger.log(`JanmaSethu: Triggering WhatsApp for ${phone} (Template: ${template})`);
        // 1. Process template (Mock implementation for now)
        const content = `[${template}] ${JSON.stringify(data)}`;

        // 2. Dispatch
        await this.dispatcher.dispatchResponse('whatsapp', phone, content);
        return true;
    }

    private async deliverDashboardAlert(userId: string, data: any) {
        this.logger.log(`JanmaSethu: Pushing REAL-TIME alert for clinician ${userId}`);

        // Integration point: Real-time broadcast to dashboard users
        RealtimeEventsController.broadcast('CLINICIAN_NOTIFICATION', {
            target_user: userId,
            payload: data,
            timestamp: new Date()
        });

        return true;
    }

    private async deliverSMS(phone: string, data: any) {
        this.logger.warn(`JanmaSethu: Triggering SMS for ${phone}`);
        const content = `JanmaSethu Alert: ${JSON.stringify(data)}`;
        await this.dispatcher.dispatchResponse('sms', phone, content);
        return true;
    }
}
