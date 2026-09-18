import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class EmergencyHotlineService {
    private readonly logger = new Logger(EmergencyHotlineService.name);

    // IVR / SMS Gateway (Exotel/Twilio)
    private readonly HOTLINE_GATEWAY_URL = process.env.IVR_GATEWAY_URL || 'http://localhost:5005/trigger-call';

    /**
     * Triggers a high-priority "Out-Of-Band" alert to the clinical team.
     * Use for RED alerts after hours.
     */
    async triggerRedAlertHotline(threadId: string, patientName: string, doctorId: string) {
        this.logger.warn(`🚨 EMERGENCY HOTLINE TRIGGERED for thread ${threadId} (Patient: ${patientName})`);

        // 1. Fetch on-call doctor's phone number
        // (Assuming you have a way to fetch doctor phone from DB)
        const doctorPhone = '+910000000000';

        try {
            // 2. Trigger Automated IVR Call (Voice Call to Doctor)
            await axios.post(this.HOTLINE_GATEWAY_URL, {
                to: doctorPhone,
                message: `URGENT RED ALERT for Janmasethu Patient ${patientName}. Please check your dashboard immediately.`,
                priority: 'HIGHEST',
                type: 'IVR_CALL'
            });

            this.logger.log(`📞 IVR Alert dispatched to lead clinician for thread ${threadId}`);
        } catch (error) {
            this.logger.error(`❌ FAILED to trigger emergency hotline: ${error.message}`);
            // Fallback to priority SMS if IVR fails
            await this.dispatchPriorityFallbackSms(doctorPhone, threadId);
        }
    }

    private async dispatchPriorityFallbackSms(phone: string, threadId: string) {
        this.logger.log(`📲 Dispatching emergency fallback SMS for thread ${threadId}`);
        // SMS Logic here
    }
}
