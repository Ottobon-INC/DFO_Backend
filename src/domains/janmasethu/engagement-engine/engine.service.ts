import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JanmasethuRepository } from '../janmasethu.repository';
import { ConsultationStatus } from '../dfo.types';

@Injectable()
export class EngagementEngineService {
    private readonly logger = new Logger(EngagementEngineService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        @InjectQueue('engagement_queue') private readonly engagementQueue: Queue,
    ) { }

    /**
     * CORE RULE ENGINE TRIGGER
     * Reacts to system events and executes mapped rules.
     */
    async processEvent(trigger: string, payload: any) {
        this.logger.log(`Processing Proactive Event: ${trigger}`);

        // 1. Fetch active rules for this trigger
        // For production, we query dfo_rules. For now, we use a hardcoded strategy.
        switch (trigger) {
            case 'CONSULTATION_CLOSED':
                await this.handleConsultationClosed(payload);
                break;
            case 'RISK_LEVEL_CHANGED':
                await this.handleRiskChange(payload);
                break;
            case 'PATIENT_INACTIVITY':
                await this.handleInactivity(payload);
                break;
            case 'APPOINTMENT_BOOKED':
                await this.handleApptBooked(payload);
                break;
            case 'APPOINTMENT_COMPLETED':
                await this.handleApptCompleted(payload);
                break;
            case 'APPOINTMENT_MISSED':
                await this.handleApptMissed(payload);
                break;
            case 'APPOINTMENT_CANCELLED':
                await this.handleApptCancelled(payload);
                break;
            case 'DOCTOR_CANCELLED_WITH_SUGGESTION':
                await this.handleDoctorCancelled(payload);
                break;
            case 'JOURNEY_PROGRESS_SYNC':
                await this.handleJourneyCare(payload);
                break;
        }
    }

    private async handleJourneyCare(payload: { patient_id: string, week: number }) {
        const { patient_id, week } = payload;
        this.logger.log(`Executing Engagement Policy for Patient ${patient_id} at week ${week}`);

        // CLINICAL ENGAGEMENT ROADMAP
        if (week === 12) {
            this.triggerProactiveMessage(patient_id, 'Week 12 Spotlight: It is time for your NT Scan to ensure fetal wellness. 🏥');
        } else if (week === 20) {
            this.triggerProactiveMessage(patient_id, 'Week 20 Milestone: Anatomy scan week! A big moment to see your little one’s development. ✨');
        } else if (week === 28) {
            this.triggerProactiveMessage(patient_id, 'Third Trimester begins! Time to monitor glucose levels and start kick-counts. 🤱');
        } else if (week === 36) {
            this.triggerProactiveMessage(patient_id, 'Final Stretch: Ensure your hospital bag is ready and discuss your birth plan with Dr. Divya. 🎒');
        }
    }

    private async triggerProactiveMessage(patientId: string, content: string) {
        // Enforce Consent at the Engine Level
        const profile = await this.repository.findPatientProfile(patientId);
        if (profile?.engagement_preferences?.opt_out_all) {
            this.logger.warn(`🚫 Proactive Dispatch Suppressed: Patient ${patientId} has opted out of communications.`);
            return;
        }

        this.logger.log(`[PROACTIVE DISPATCH] Patient ${patientId}: ${content}`);

        await this.engagementQueue.add('PROACTIVE_MSG', {
            patient_id: patientId,
            content,
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 }
        });
    }

    private async handleConsultationClosed(payload: { patientId: string, doctorId: string }) {
        // Rule: Schedule a follow-up engagement message 24 hours after closure
        await this.engagementQueue.add('FOLLOW_UP_MSG', {
            patient_id: payload.patientId,
            template: 'post_consultation_feedback'
        }, { delay: 24 * 60 * 60 * 1000 }); // 24 hours

        this.logger.log(`Scheduled follow-up for patient ${payload.patientId}`);
    }

    private async handleRiskChange(payload: { patient_id: string, from: string, to: string }) {
        this.logger.log(`Handling Risk Change: ${payload.from} -> ${payload.to} for ${payload.patient_id}`);

        if (payload.to === 'red') {
            // Rule: Immediate notification to notification system (Dashboard/WhatsApp)
            await this.engagementQueue.add('URGENT_ALERT', {
                target: 'DOCTOR_GROUP',
                priority: 'HIGH',
                content: `URGENT: Patient ${payload.patient_id} risk status is now RED.`,
                patient_id: payload.patient_id
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 }
            });
        }

        if (payload.from === 'red' && payload.to === 'green') {
            // Send a "Safe & Better" message after recovery
            await this.triggerProactiveMessage(payload.patient_id, 'Great news! You have been moved to the safe zone. Stay hydrated and rest well. 😊');
        }
    }

    private async handleInactivity(payload: { patientId: string }) {
        // Rule: If 3 days of no chat, send "How are you?" nudge
        await this.engagementQueue.add('NUDGE_MSG', {
            patientId: payload.patientId,
            template: 'inactivity_nudge'
        }, { delay: 3 * 24 * 60 * 60 * 1000 });
    }

    /**
     * MEDICATION SCHEDULER
     */
    async scheduleMedicationReminder(patient_id: string, medication: string, frequencyHours: number) {
        await this.engagementQueue.add('MED_REMINDER', {
            patient_id,
            medication
        }, {
            repeat: { every: frequencyHours * 60 * 60 * 1000 },
            jobId: `med_${patient_id}_${medication.replace(/\s/g, '_')}`
        });
    }

    /**
     * APPOINTMENT AUTOMATIONS
     */
    private async handleApptBooked(payload: { appointmentId: string, patient_id: string, reminderTime: Date, reminderTime24?: Date }) {
        this.logger.log(`Setting up reminders for appointment ${payload.appointmentId}`);

        // 1. Initial Confirmation
        await this.triggerProactiveMessage(payload.patient_id, 'Your appointment has been confirmed! Looking forward to seeing you. 🏥');

        // 2. Schedule 24-Hour Reminder Job (Using BullMQ delay)
        if (payload.reminderTime24) {
            const delay24 = payload.reminderTime24.getTime() - Date.now();
            if (delay24 > 0) {
                await this.engagementQueue.add('APPT_REMIND', {
                    patient_id: payload.patient_id,
                    content: `Friendly Care Reminder: Your appointment is tomorrow. See you then! 🏥`
                }, {
                    delay: delay24,
                    jobId: `appt_remind_24h_${payload.appointmentId}`
                });
            }
        }

        // 3. Schedule 2-Hour Reminder Job (Using BullMQ delay)
        const delay2h = payload.reminderTime.getTime() - Date.now();
        if (delay2h > 0) {
            await this.engagementQueue.add('APPT_REMIND', {
                patient_id: payload.patient_id,
                content: `Friendly Care Reminder: Your appointment is in 2 hours. See you soon! 😊`
            }, {
                delay: delay2h,
                jobId: `appt_remind_2h_${payload.appointmentId}`
            });
        }
    }

    private async handleApptMissed(payload: { patient_id: string }) {
        await this.triggerProactiveMessage(payload.patient_id, 'We missed you at your appointment! Is everything okay? You can reschedule anytime here. ❤️');
    }

    private async handleApptCancelled(payload: { appointmentId: string }) {
        // Remove both pending reminder jobs
        const job24 = await this.engagementQueue.getJob(`appt_remind_24h_${payload.appointmentId}`);
        if (job24) await job24.remove();

        const job2h = await this.engagementQueue.getJob(`appt_remind_2h_${payload.appointmentId}`);
        if (job2h) await job2h.remove();
    }

    private async handleDoctorCancelled(payload: { patient_id: string, suggestedDate?: Date, reason: string }) {
        this.logger.log(`Handling Doctor Cancellation for patient ${payload.patient_id}`);

        let content = `We apologize! Dr. Divya is unavailable today (${payload.reason}). 🏥`;
        if (payload.suggestedDate) {
            content += ` We recommend rescheduling for ${new Date(payload.suggestedDate).toLocaleString()}. Please visit the dashboard to confirm! ✨`;
        } else {
            content += ` Please visit our Janmasethu website to pick a new time that works for you. ❤️`;
        }

        await this.triggerProactiveMessage(payload.patient_id, content);
    }

    private async handleApptCompleted(payload: { appointmentId: string }) {
        this.logger.log(`Handling Appointment Completed for ${payload.appointmentId}`);

        // 1. Fetch appointment details to get patient_id
        const appt = await this.repository.findAppointmentById(payload.appointmentId);
        if (!appt) return;

        // 2. Immediate Follow-up / Guidance Nudge
        await this.triggerProactiveMessage(appt.patient_id, 'Thank you for your consultation today! 🏥 If your doctor recommended a follow-up scan or another appointment, would you like to schedule it now? Reply with *YES* to find available slots. 😊');

        // 3. Schedule a feedback survey after 24 hours
        await this.engagementQueue.add('FOLLOW_UP_MSG', {
            patient_id: appt.patient_id,
            template: 'post_consultation_feedback'
        }, { delay: 24 * 60 * 60 * 1000 });
    }
}
