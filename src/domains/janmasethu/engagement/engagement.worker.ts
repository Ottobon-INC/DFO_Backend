import { Injectable, Logger, Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { JanmasethuDispatchService } from '../channel/janmasethu-dispatch.service';
import { EngagementService } from './engagement.service';
import { EngagementJobType } from './engagement.types';
import { DFOPatient } from '../dfo.types';
import { JanmasethuRepository } from '../janmasethu.repository';

@Processor('engagement_queue')
@Injectable()
export class EngagementWorker extends WorkerHost {
    private readonly logger = new Logger(EngagementWorker.name);

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
        @Inject('ORG_SUPABASE_CLIENT') private readonly orgSupabase: SupabaseClient,
        private readonly dispatcher: JanmasethuDispatchService,
        private readonly engagementService: EngagementService,
        private readonly repository: JanmasethuRepository
    ) { super(); }

    async process(job: Job<any, any, string>): Promise<any> {
        const { patient_id, template_id, content, variables } = job.data;
        this.logger.log(`Processing engagement job ${job.id} for patient ${patient_id}`);

        try {
            // 1. Fetch Patient Profile & Preferences
            const { data: patient, error } = await this.orgSupabase
                .from('sakhi_clinic_patients')
                .select('*')
                .eq('id', patient_id)
                .maybeSingle();

            if (error || !patient) throw new Error(`Patient ${patient_id} not found.`);

            const dfoPatient: DFOPatient = {
                id: patient.id,
                full_name: patient.name,
                phone_number: patient.mobile,
                journey_stage: patient.status === 'Active' ? 'Active' : 'Inactive'
            } as any;

            let messageContent = content || job.data.message;

            // 2. Process Template Variables if content is template-driven
            if (!messageContent && template_id) {
                // Use default message pattern since templates table is missing
                const templateText = content || `Hi {{patient_name}}, we are following up on your journey.`;
                messageContent = await this.engagementService.processTemplate(templateText, dfoPatient, variables);
            }

            if (!messageContent) throw new Error('No message content found for engagement job.');

            // 3. Dispatch via Selected Channel
            const channel = 'whatsapp';
            const userId = dfoPatient.phone_number;

            await this.dispatcher.dispatchResponse(channel, userId, messageContent);

            // 4. Log Engagement via repository (in-memory)
            await this.repository.insertEngagementLog({
                patient_id,
                template_id,
                job_id: job.id,
                channel,
                content: messageContent,
                status: 'SENT',
                sent_at: new Date()
            });

            return { success: true, channel };
        } catch (err) {
            this.logger.error(`Engagement job failed: ${err.message}`);
            throw err;
        }
    }
}

/**
 * Separate worker for recurring reminders
 */
@Processor('reminder_queue')
@Injectable()
export class ReminderWorker extends WorkerHost {
    private readonly logger = new Logger(ReminderWorker.name);

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
        @Inject('ORG_SUPABASE_CLIENT') private readonly orgSupabase: SupabaseClient,
        private readonly dispatcher: JanmasethuDispatchService,
        private readonly engagementService: EngagementService
    ) { super(); }

    async process(job: Job<any>): Promise<any> {
        const { reminder_id, patient_id } = job.data;
        this.logger.log(`Processing reminder ${reminder_id} for patient ${patient_id}`);

        const reminder = this.engagementService.getReminderFromMemory(reminder_id);
        if (!reminder || !reminder.is_active) return;

        const { data: patient } = await this.orgSupabase
            .from('sakhi_clinic_patients')
            .select('*')
            .eq('id', patient_id)
            .maybeSingle();

        if (!patient) return;

        // Dispatch
        const message = `⏰ Reminder: ${reminder.title}`;
        await this.dispatcher.dispatchResponse('whatsapp', patient.mobile, message);
    }
}
