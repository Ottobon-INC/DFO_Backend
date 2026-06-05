import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuScopePolicy } from './JanmasethuScopePolicy';
import { JanmasethuSlaWorker } from './janmasethu.sla';
import { JanmasethuUserContext, JanmasethuRole, JanmasethuUserRole } from './janmasethu.types';
import { OwnershipType } from '../../types';
import { RealtimeEventsController } from './api/realtime-events.controller';

@Injectable()
export class JanmasethuAssignmentService {
    private readonly logger = new Logger(JanmasethuAssignmentService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly policy: JanmasethuScopePolicy,
        private readonly slaWorker: JanmasethuSlaWorker,
    ) { }

    /**
     * CRO ASSIGNMENT LOGIC
     * - Only CRO allowed
     * - Status-Role check (RED->DOC, YELLOW->NURSE)
     * - Suppress AI
     * - SLA for RED + Doctor ID
     */
    async assignThread(
        threadId: string,
        targetUserId: string | null,
        targetRole: JanmasethuRole,
        performedBy: JanmasethuUserContext
    ) {
        // 1. Authorization
        if (performedBy.role !== JanmasethuUserRole.CRO) {
            throw new ForbiddenException('Only CROs can assign threads');
        }

        const thread = await this.repository.findThreadById(threadId);
        if (!thread) throw new Error('Thread not found');

        const threadStatus = thread.status as string;

        // 2. Policy-driven Validation
        if (!this.policy.validateAssignment(targetRole, threadStatus)) {
            this.logger.warn(`Invalid assignment attempt: ${targetRole} to ${threadStatus} thread.`);
            throw new ForbiddenException(`Assignment invalid: ${targetRole} cannot be assigned to a ${threadStatus} thread.`);
        }

        // 3. Idempotency Check
        if (thread.assigned_user_id === targetUserId && thread.assigned_role === targetRole) {
            this.logger.log(`Thread ${threadId} already assigned. No changes needed.`);
            return;
        }

        // 4. Reset previous state if reassigned
        await this.slaWorker.cancelSla(threadId);

        // 5. Update Thread (Separated from Takeover)
        await this.repository.updateThreadAtomic(threadId, thread.version, {
            assigned_user_id: targetUserId || undefined,
            assigned_role: targetRole,
            // Per Requirement: "Assignment: ownership remains AI, is_locked remains false"
            ownership: OwnershipType.AI,
            is_locked: false,
        });

        // 6. Start SLA ONLY when RED/YELLOW thread assigned to specific clinician
        const updatedThread = await this.repository.findThreadById(threadId);
        if (updatedThread && targetUserId) {
            const cat = updatedThread.status === 'red' ? 'red' : 'yellow';
            const role = targetRole === JanmasethuRole.DOCTOR_QUEUE ? JanmasethuUserRole.DOCTOR : JanmasethuUserRole.NURSE;
            await this.slaWorker.scheduleSla(threadId, cat as any, role);
        }

        // 7. Audit & Logs
        await this.repository.insertAuditLog({
            thread_id: threadId,
            actor_id: performedBy.id,
            actor_type: 'HUMAN',
            action: 'THREAD_ASSIGNED',
            payload: { targetUserId, targetRole, status: threadStatus },
        });

        // 8. Real-time Assignment Broadcast
        RealtimeEventsController.broadcast('THREAD_ASSIGNED', {
            threadId,
            targetUserId: targetUserId,
            targetRole,
            assignedBy: performedBy.id
        });

        await this.repository.insertRoutingEvent({
            thread_id: threadId,
            actor_id: performedBy.id,
            target_role: targetRole,
            reason: 'CRO_ASSIGNMENT',
        });

        this.logger.log(`Thread ${threadId} assigned to ${targetUserId} by ${performedBy.id}`);
    }

    async autoAssignThread(threadId: string) {
        this.logger.log(`Performing Smart Auto-Assignment for thread ${threadId}...`);

        const thread = await this.repository.findThreadById(threadId);
        if (!thread) throw new Error('Thread not found');

        // 1. Detect required specialty (simplification: from thread metadata or first symptoms)
        const summary = await this.repository.findSummaryByThread(threadId);
        const specialty = summary?.structured_symptoms?.[0] || 'GENERAL';

        // 2. Find available clinicians with capacity
        const available = await this.repository.findAvailableClinicians(specialty);
        if (available.length === 0) {
            this.logger.warn('No available clinicians with capacity for specialty ' + specialty);
            return;
        }

        // 3. Assign to a candidate from the top-tier lowest workloads to mitigate back-to-back concurrency race conditions
        const minWorkload = Math.min(...available.map(c => c.active_threads));
        const topCandidates = available.filter(c => c.active_threads <= minWorkload + 1);
        const bestClinician = topCandidates[Math.floor(Math.random() * topCandidates.length)];

        const targetRole = thread.status === 'red' ? JanmasethuRole.DOCTOR_QUEUE : JanmasethuRole.NURSE_QUEUE;

        await this.repository.updateThreadAtomic(threadId, thread.version, {
            assigned_user_id: bestClinician.clinician_id,
            assigned_role: targetRole,
            ownership: OwnershipType.AI,
            is_locked: false,
        });

        // 4. Update Workload counter
        await this.repository.incrementClinicianWorkload(bestClinician.clinician_id);

        // 5. Real-time Broadcast
        RealtimeEventsController.broadcast('THREAD_ASSIGNED', {
            threadId,
            targetUserId: bestClinician.clinician_id,
            targetRole,
            assignedBy: 'SYSTEM_AUTO'
        });

        // 6. Start SLA
        const cat = thread.status === 'red' ? 'red' : 'yellow';
        const role = targetRole === JanmasethuRole.DOCTOR_QUEUE ? JanmasethuUserRole.DOCTOR : JanmasethuUserRole.NURSE;
        await this.slaWorker.scheduleSla(threadId, cat as any, role);

        this.logger.log(`Thread ${threadId} auto-assigned to ${bestClinician.clinician_id} (${specialty})`);
    }
}
