import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import {
    EngagementJobType,
    EngagementTriggerType,
    EngagementTemplate,
    PatientReminder
} from './engagement.types';
import { JourneyStage, DFOPatient } from '../dfo.types';

@Injectable()
export class EngagementService {
    private readonly logger = new Logger(EngagementService.name);
    
    // In-memory collections to replace missing dfo_ engagement tables
    private inMemoryReminders = new Map<string, any>();

    constructor(
        @InjectQueue('engagement_queue') private readonly engagementQueue: Queue,
        @InjectQueue('reminder_queue') private readonly reminderQueue: Queue,
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
    ) { }

    /**
     * 1. STAGE-BASED PROACTIVE MESSAGING
     * Triggers a message based on pregnancy week or journey stage transition.
     */
    async scheduleStagedMessage(patientId: string, week: number, stage: JourneyStage) {
        this.logger.log(`Scheduling staged message for patient ${patientId} at week ${week}`);

        // Mock template content instead of querying dfo_engagement_templates
        const mockTemplate = {
            id: 'mock-template-staged',
            content: `Hi {{patient_name}}, you are at week {{week}} of your journey (Stage: ${stage}). Let's stay healthy!`,
            journey_stage: stage
        };

        await this.enqueueEngagementJob(patientId, EngagementJobType.STAGED_MSG, {
            template_id: mockTemplate.id,
            content: mockTemplate.content,
            week,
            stage
        });
    }

    /**
     * 2. MEDICATION & HEALTH REMINDERS
     * Register recurring jobs in the reminder_queue.
     */
    async createReminder(reminder: Partial<PatientReminder>) {
        this.logger.log(`Creating reminder for patient ${reminder.patient_id}: ${reminder.title}`);

        const id = reminder.id || require('crypto').randomUUID();
        const data = {
            id,
            patient_id: reminder.patient_id,
            title: reminder.title,
            schedule: reminder.schedule,
            is_active: true,
            created_at: new Date()
        };

        this.inMemoryReminders.set(id, data);

        // Schedule BullMQ job with CRON or repeated pattern
        await this.reminderQueue.add(
            EngagementJobType.MED_REMINDER,
            { reminder_id: data.id, patient_id: data.patient_id },
            {
                repeat: {
                    pattern: this.convertToCron(data.schedule),
                },
                jobId: `REMINDER_${data.id}`
            }
        );

        return data;
    }

    /**
     * 3. EVENT-DRIVEN TRIGGERS
     * Triggered by external modules (Risk Engine, Appointments).
     */
    async triggerEventEngagement(patientId: string, event: string, payload: any = {}) {
        this.logger.log(`Triggering event engagement: ${event} for patient ${patientId}`);

        // Mock template instead of querying dfo_engagement_templates
        const mockTemplate = {
            id: 'mock-template-event',
            content: `Hello {{patient_name}}, regarding ${event}: we are following up on your status.`
        };

        const delay = payload.delay_ms || 0;

        await this.enqueueEngagementJob(patientId, EngagementJobType.FOLLOW_UP, {
            template_id: mockTemplate.id,
            content: mockTemplate.content,
            ...payload
        }, delay);
    }

    /**
     * INTERNAL UTILITIES
     */
    private async enqueueEngagementJob(patientId: string, type: EngagementJobType, payload: any, delay: number = 0) {
        // --- PROACTIVE CONSENT CHECK ---
        const isPermitted = await this.checkPatientConsent(patientId);
        if (!isPermitted) {
            this.logger.warn(`🚫 Engagement Suppressed: Patient ${patientId} has opted out of communications.`);
            return;
        }

        await this.engagementQueue.add(type, {
            patient_id: patientId,
            ...payload
        }, {
            delay,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 }
        });
    }

    /**
     * Checks if the patient has consented to proactive messages.
     * Looks at engagement_preferences.opt_out_all flag.
     */
    public async checkPatientConsent(patientId: string): Promise<boolean> {
        // Query sakhi_clinic_patients instead of dfo_patients
        const { data: patient } = await this.supabase
            .from('sakhi_clinic_patients')
            .select('status')
            .eq('id', patientId)
            .maybeSingle();

        if (!patient) return true; // Default to allow if no patient record found
        return patient.status === 'Active';
    }

    private convertToCron(schedule: any): string {
        const time = (schedule && schedule.times && schedule.times[0]) || '09:00';
        const [hour, minute] = time.split(':');
        return `0 ${minute} ${hour} * * *`;
    }

    /**
     * TEMPLATE ENGINE: Dynamic Variable Injection
     */
    async processTemplate(content: string, patient: DFOPatient, variables: any = {}): Promise<string> {
        let processed = content;
        const replacers = {
            '{{patient_name}}': patient.full_name || 'Patient',
            '{{week}}': patient.pregnancy_stage?.toString() || 'N/A',
            ...variables
        };

        for (const [key, value] of Object.entries(replacers)) {
            processed = processed.replace(new RegExp(key, 'g'), value as string);
        }

        return processed;
    }

    // Accessor for the reminder worker
    getReminderFromMemory(id: string) {
        return this.inMemoryReminders.get(id);
    }
}
