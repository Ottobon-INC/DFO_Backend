import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { JanmasethuRepository } from './janmasethu.repository';
import { ThreadStatus, OwnershipType, Thread } from '../../types';
import { JANMASETHU_DOMAIN, JANMASETHU_SLA, JanmasethuUserRole } from './janmasethu.types';
import { RealtimeEventsController } from './api/realtime-events.controller';

@Processor('janmasethu_sla_queue')
@Injectable()
export class JanmasethuSlaWorker extends WorkerHost {
    private readonly logger = new Logger(JanmasethuSlaWorker.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        @InjectQueue('janmasethu_sla_queue') private readonly slaQueue: Queue,
    ) {
        super();
    }

    /**
     * SCHEDULE SLA
     * - Triggered on Clinician Assignment or Takeover
     */
    async scheduleSla(threadId: string, category: 'red' | 'yellow', role: JanmasethuUserRole = JanmasethuUserRole.NURSE) {
        let delay = JANMASETHU_SLA.NURSE.YELLOW;

        if (category === 'red') {
            delay = role === JanmasethuUserRole.DOCTOR ? JANMASETHU_SLA.DOCTOR.RED : JANMASETHU_SLA.NURSE.RED;
        } else {
            delay = JANMASETHU_SLA.NURSE.YELLOW;
        }

        this.logger.log(`Scheduling ${category.toUpperCase()} SLA for ${role} (${delay / 1000}s) on thread ${threadId}`);

        await this.slaQueue.add('check_sla', { threadId, category, role }, {
            delay,
            jobId: threadId,
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
        });
    }

    /**
     * CANCEL SLA
     */
    async cancelSla(threadId: string) {
        const job = await this.slaQueue.getJob(threadId);
        if (job) {
            await job.remove();
            this.logger.log(`Cancelled existing SLA for thread ${threadId}`);
        }
    }

    /**
     * BULLMQ PROCESSOR ENTRY POINT
     */
    async process(job: Job): Promise<any> {
        const { threadId, category, role } = job.data;
        const thread = await this.repository.findThreadById(threadId);

        if (!thread || thread.domain !== JANMASETHU_DOMAIN) {
            return;
        }

        // 1. REVALIDATE STATE: Is the thread still in the same risk level?
        const isStillInRisk = thread.status === category;
        
        // Strict mapping verification: Ensure current queue/assigned role matches the expected target
        let isStillAssignedToSameRole = false;
        if (thread.assigned_user_id) {
            if (role === JanmasethuUserRole.NURSE && thread.assigned_role === 'NURSE_QUEUE') {
                isStillAssignedToSameRole = true;
            } else if (role === JanmasethuUserRole.DOCTOR && thread.assigned_role === 'DOCTOR_QUEUE') {
                isStillAssignedToSameRole = true;
            } else if (thread.assigned_role === role) {
                isStillAssignedToSameRole = true;
            }
        }

        const isHumanLocked = thread.ownership === OwnershipType.HUMAN && thread.is_locked;

        if (isStillInRisk && (isStillAssignedToSameRole || isHumanLocked)) {
            // Check if there was a recent human message after the SLA was scheduled
            const lastMessage = await this.repository.findLatestMessageByThread(threadId);
            if (lastMessage && lastMessage.created_at.getTime() > job.timestamp) {
                this.logger.log(`SLA safe: Human responded to ${threadId} since scheduling.`);
                return;
            }

            // ESCALATION LOGIC
            let targetRole = 'DOCTOR_QUEUE';
            let action = 'SLA_BREACH';

            if (category === 'red' && role === JanmasethuUserRole.NURSE) {
                this.logger.warn(`SLA BREACH: High-Risk (RED) case ${threadId} not handled by NURSE. Escalating to DOCTOR.`);
                targetRole = 'DOCTOR_QUEUE';
                action = 'STAFF_ESCALATION';
            } else if (category === 'red' && role === JanmasethuUserRole.DOCTOR) {
                this.logger.error(`SLA CRITICAL BREACH: High-Risk (RED) case ${threadId} not handled by DOCTOR. Paging CRO.`);
                targetRole = 'DOCTOR_QUEUE'; // Keep in doctor queue but notify CRO
                action = 'DOCTOR_TIMEOUT';
            } else {
                this.logger.warn(`SLA BREACH: ${category.toUpperCase()} case ${threadId} timeout for ${role}.`);
                targetRole = category === 'red' ? 'DOCTOR_QUEUE' : 'NURSE_QUEUE';
            }

            await this.repository.updateThreadAtomic(threadId, thread.version, {
                assigned_user_id: undefined, // Clear specific assignee to return to queue
                ownership: OwnershipType.AI,
                is_locked: false,
                assigned_role: targetRole,
            });

            await this.repository.insertAuditLog({
                thread_id: threadId,
                actor_id: 'SLA_SYSTEM',
                actor_type: 'SYSTEM',
                action: action,
                payload: {
                    previousAssignee: thread.assigned_user_id,
                    previousRole: role,
                    risk: category,
                    breachedAfterMs: job.opts?.delay || 0,
                    jobTimestamp: job.timestamp
                },
            });

            await this.repository.insertRoutingEvent({
                thread_id: threadId,
                actor_id: 'SLA_SYSTEM',
                target_role: 'CRO',
                reason: `ESCALATION_${action}`,
                payload: {
                    category,
                    role,
                    action,
                    thread_version: thread.version
                }
            });

            // REAL-TIME BROADCAST OF BREACH/ESCALATION
            RealtimeEventsController.broadcast('SLA_BREACH', {
                threadId,
                previous_role: role,
                reason: action,
                risk: category
            });

            this.logger.log(`Hardened Recovery: ${threadId} synchronized. Escalated to ${targetRole}.`);
        } else {
            this.logger.log(`SLA check: Thread ${threadId} is safe or already resolved.`);
        }
    }
}

