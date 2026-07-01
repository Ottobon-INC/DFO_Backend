import { Injectable, Logger } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuScopePolicy } from './JanmasethuScopePolicy';
import { JanmasethuSlaWorker } from './janmasethu.sla';
import { SentimentService } from '../../kernel/sentiment/sentiment.service';
import { RoutingService } from '../../kernel/routing/routing.service';
import { JANMASETHU_DOMAIN } from './janmasethu.types';
import { ThreadStatus, OwnershipType } from '../../types';
import { JourneyStage } from './dfo.types';
import { RealtimeEventsController } from './api/realtime-events.controller';
import { EngagementEngineService } from './engagement-engine/engine.service';
import { JanmasethuGuardrailService } from './risk-engine/janmasethu-guardrails';
import { EmergencyHotlineService } from './utils/emergency-hotline.service';
import { JanmasethuDispatchService } from './channel/janmasethu-dispatch.service';
import { ConsentRepository } from './consent/consent.repository';
@Injectable()
export class JanmasethuHandler {
    private readonly logger = new Logger(JanmasethuHandler.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly policy: JanmasethuScopePolicy,
        private readonly slaWorker: JanmasethuSlaWorker,
        private readonly sentimentService: SentimentService,
        private readonly routingService: RoutingService,
        private readonly engagementEngine: EngagementEngineService,
        private readonly guardrails: JanmasethuGuardrailService,
        private readonly hotline: EmergencyHotlineService,
        private readonly dispatchService: JanmasethuDispatchService,
        private readonly consentRepository: ConsentRepository,
    ) { }

    /**
     * MAIN EVENT HANDLER
     * - Handle Message Ingestion
     * - Trigger Sentiment
     * - Orchestrate State Transitions
     */
    async handleMessageCreated(event: any) {
        const { thread_id, message_id, user_id, message, domain } = event;

        if (domain !== JANMASETHU_DOMAIN) return;

        // 1. Idempotency Check
        const existingMsg = await this.repository.findMessageById(message_id);
        if (existingMsg) {
            this.logger.log(`Message ${message_id} already processed. Skipping.`);
            return;
        }

        // 1.5. Clinical Safety Guardrail Check
        const threadData = await this.repository.findThreadById(thread_id);
        const lastMsg = await this.repository.findLatestMessageByThread(thread_id);

        const safetyCheck = this.guardrails.isAIPermitted(
            threadData?.status || 'green',
            lastMsg?.sender_type || 'USER',
            threadData?.is_locked || false
        );

        if (!safetyCheck.permitted && event.sender_type === 'AI') {
            this.logger.warn(`🛑 AI SUPPRESSED for thread ${thread_id}: ${safetyCheck.reason}`);
            return; // STOP: AI is not allowed to talk right now.
        }

        // 2. Patient Identity Resolution (New DFO logic)
        // user_id is typically the WhatsApp Phone Number or Web UUID
        let patient = await this.repository.findDFOPatientByPhone(user_id);
        if (!patient) {
            // Auto-register patient on first contact
            patient = await this.repository.upsertDFOPatient({
                phone_number: user_id,
                full_name: 'New Patient',
                journey_stage: JourneyStage.TRYING_TO_CONCEIVE,
                medical_history: [],
            });
        }

        // --- CONVERSATIONAL CONSENT INTERCEPTOR ---
        const sakhiPatient = await this.repository.findSakhiPatientByPhone(user_id);
        
        if (sakhiPatient && sakhiPatient.clinic_id) {
            const consentRecord = await this.consentRepository.getConsentByPatientId(sakhiPatient.id);
            
            if (!consentRecord) {
                const lowerMsg = message.trim().toLowerCase();
                const isYes = lowerMsg === 'yes' || lowerMsg === 'i agree' || lowerMsg === 'y';
                const isNo = lowerMsg === 'no' || lowerMsg === 'i decline' || lowerMsg === 'n';

                if (isYes) {
                    // Opt-in
                    await this.consentRepository.saveConsent(sakhiPatient.id, sakhiPatient.clinic_id, {
                        allowed_channels: { whatsapp: true, sms: true, email: false, call: false },
                        quiet_hours: { start_time: "22:00", end_time: "06:00" },
                        allowed_message_types: ["alert", "update", "reminder"]
                    });
                    await this.dispatchService.dispatchResponse(
                        event.channel || 'whatsapp', 
                        user_id, 
                        "Great, thanks! How can we help you today?",
                        true // bypassConsent
                    );
                    return; // Stop processing this initial YES message
                } else if (isNo) {
                    // Opt-out
                    await this.consentRepository.saveConsent(sakhiPatient.id, sakhiPatient.clinic_id, {
                        allowed_channels: { whatsapp: false, sms: false, email: false, call: false },
                        quiet_hours: { start_time: "00:00", end_time: "23:59" },
                        allowed_message_types: []
                    });
                await this.dispatchService.dispatchResponse(
                    event.channel || 'whatsapp', 
                    user_id, 
                    "No problem, we won't send you updates here. If you need anything in the future, just let us know!",
                    true // bypassConsent
                );
                return; // Stop processing this NO message
            } else {
                // First interaction, no consent record, didn't reply yes/no
                await this.dispatchService.dispatchResponse(
                    event.channel || 'whatsapp', 
                    user_id, 
                    "Hi! Welcome to Janmasethu! Can we send you quick health updates and reminders here? Reply *YES* or *NO*.",
                    true // bypassConsent
                );
                return; // Block thread progression until they answer
            }
            }
        }
        // --- END INTERCEPTOR ---

        // 3. Fetch Thread & Track Previous State
        let thread = await this.repository.findThreadById(thread_id);
        const previousStatus = thread?.status || 'green';

        if (!thread) {
            this.logger.log(`Creating new GREEN thread for Janmasethu: ${thread_id}`);
            thread = await this.repository.createThread({
                id: thread_id,
                user_id,
                status: ThreadStatus.GREEN,
                ownership: OwnershipType.AI,
                version: 1,
                metadata: {
                    patient_id: patient.id,
                    journey_stage: patient.journey_stage,
                    pregnancy_week: patient.pregnancy_stage,
                }
            });
        } else if (!thread.metadata?.patient_id) {
            // Update existing thread with metadata if missing
            await this.repository.updateThreadAtomic(thread_id, thread.version, {
                metadata: {
                    ...thread.metadata,
                    patient_id: patient.id,
                    journey_stage: patient.journey_stage,
                    pregnancy_week: patient.pregnancy_stage,
                }
            });
            // Re-fetch updated thread
            thread = await this.repository.findThreadById(thread_id);
        }

        // 3. Append Message
        const senderType = event.sender_type || 'USER';
        const msg = await this.repository.createMessage({
            id: message_id,
            thread_id,
            sender_id: sakhiPatient?.id || patient.id,
            sender_type: senderType,
            content: message,
        });

        // SLA Cancellation on Human Reply
        if (senderType === 'HUMAN') {
            await this.slaWorker.cancelSla(thread_id);
        }

        // 4. Trigger Sentiment Evaluation (Triggers Escalation Policy in Core)
        await this.sentimentService.evaluateThreadSentiment(thread_id, msg.id, message, JANMASETHU_DOMAIN);

        // 5. Real-time Emergency Broadcast
        const latestThread = await this.repository.findThreadById(thread_id);
        if (latestThread?.status === 'red') {
            const latestRisk = await this.repository.findLatestSentimentByThread(thread_id);

            // 5a. Dashboard UI Alert
            RealtimeEventsController.broadcast('EMERGENCY_ALERT', {
                threadId: thread_id,
                patientId: patient.id,
                message: message.substring(0, 50) + '...',
                score: latestRisk?.score,
                tags: latestRisk?.tags || []
            });

            // 5b. PHYSICAL EMERGENCY HOTLINE (Out-of-band alert)
            await this.hotline.triggerRedAlertHotline(
                thread_id,
                patient.full_name,
                latestThread.assigned_user_id || 'ON_CALL'
            );
        }

        // 5. Orchestrate Transitions via Policy Engine
        const updatedThread = await this.repository.findThreadById(thread_id);
        if (!updatedThread) return;

        const currentStatus = updatedThread.status as string;
        const transition = this.policy.getTransitionActions(previousStatus as string, currentStatus);

        if (transition) {
            this.logger.log(`Janmasethu: Executing transition ${previousStatus} -> ${currentStatus} for ${thread_id}`);

            // Re-fetch to handle atomic version correctly
            const activeThread = await this.repository.findThreadById(thread_id);
            if (!activeThread) return;

            await this.repository.updateThreadAtomic(thread_id, activeThread.version, {
                assigned_user_id: transition.clearAssignment ? undefined : activeThread.assigned_user_id,
                assigned_role: transition.targetRole || activeThread.assigned_role,
                ownership: transition.unlockThread ? OwnershipType.AI : activeThread.ownership,
                is_locked: transition.unlockThread ? false : activeThread.is_locked,
            });

            if (transition.cancelSla) {
                await this.slaWorker.cancelSla(thread_id);
            }

            if (transition.notifyCRO) {
                // Determine target roles for notifications
                const targetRole = currentStatus === 'red' ? 'DOCTOR' : 'NURSE';

                await this.repository.insertRoutingEvent({
                    thread_id,
                    actor_id: 'SYSTEM',
                    target_role: 'CRO', // Always notify CRO
                    reason: `SEVERITY_${currentStatus.toUpperCase()}_ALERT`,
                });

                await this.repository.insertRoutingEvent({
                    thread_id,
                    actor_id: 'SYSTEM',
                    target_role: targetRole,
                    reason: `NEW_${currentStatus.toUpperCase()}_ASSIGNMENT_AVAILBLE`,
                });
            }

            if (transition.clearAlerts) {
                await this.repository.insertRoutingEvent({
                    thread_id,
                    actor_id: 'SYSTEM',
                    action: 'CLEAR_ALERTS',
                    reason: 'THREAD_RESOLVED_TO_GREEN',
                });
            }

            await this.repository.insertAuditLog({
                thread_id,
                actor_id: 'SYSTEM',
                actor_type: 'SYSTEM',
                event_type: 'STATE_TRANSITION',
                payload: { from: previousStatus, to: currentStatus, actions: transition },
            });
        }

        // 6. Proactive Engagement Triggers
        const finalThread = await this.repository.findThreadById(thread_id);
        if (finalThread && previousStatus !== finalThread.status) {
            await this.engagementEngine.processEvent('RISK_LEVEL_CHANGED', {
                patient_id: patient.id,
                from: previousStatus,
                to: finalThread.status,
                threadId: thread_id
            });
        }
    }
}
