import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuScopePolicy } from './JanmasethuScopePolicy';
import { JanmasethuSlaWorker } from './janmasethu.sla';
import { JanmasethuUserContext } from './janmasethu.types';
import { OwnershipType } from '../../types';

@Injectable()
export class JanmasethuTakeoverService {
    private readonly logger = new Logger(JanmasethuTakeoverService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly policy: JanmasethuScopePolicy,
        private readonly slaWorker: JanmasethuSlaWorker,
    ) { }

    /**
     * TAKE CONTROL LOGIC
     * - ownership = HUMAN
     * - is_locked = true
     * - assigned_user_id must already match user
     */
    async takeControl(threadId: string, user: JanmasethuUserContext) {
        const thread = await this.repository.findThreadById(threadId, user);
        if (!thread) throw new Error('Thread not found or visibility restricted');

        // Enforcement: assigned_user_id must already match user per requirements
        if (!this.policy.canTakeControl(user, thread)) {
            this.logger.warn(`Takeover DENIED: User ${user.id} (${user.role}) for thread ${threadId}. (Status: ${thread.status}, AssignedTo: ${thread.assigned_user_id})`);
            throw new ForbiddenException(`You must be assigned to this ${thread.status} thread before taking control.`);
        }

        // Cancel previous SLA timer before starting takeover locking to avoid duplicate breach alerts
        await this.slaWorker.cancelSla(threadId);

        // Takeover Logic with AI Suppression & Lock (ownership=HUMAN, is_locked=true)
        // Hardening: Enforce is_locked = false at the DB level for atomic safety
        await this.repository.updateThreadAtomic(threadId, thread.version, {
            ownership: OwnershipType.HUMAN,
            is_locked: true,
        }, { is_locked: false });

        // Start SLA for Forced Unlock guardrail if thread is RED/YELLOW
        if (this.policy.shouldStartSLA({ ...thread, ownership: OwnershipType.HUMAN, is_locked: true, assigned_user_id: thread.assigned_user_id })) {
            const cat = thread.status === 'red' ? 'red' : 'yellow';
            await this.slaWorker.scheduleSla(threadId, cat as any, user.role);
        }

        await this.repository.insertAuditLog({
            thread_id: threadId,
            actor_id: user.id,
            actor_type: 'HUMAN',
            action: 'TAKE_CONTROL',
            payload: { role: user.role, userId: user.id },
        });

        await this.repository.insertRoutingEvent({
            thread_id: threadId,
            actor_id: user.id,
            reason: 'MANUAL_TAKEOVER_LOCK',
        });

        this.logger.log(`${user.role} ${user.id} took control of thread ${threadId}`);
    }

    /**
     * RELEASE CONTROL LOGIC
     * - ownership = AI
     * - is_locked = false
     */
    async releaseControl(threadId: string, user: JanmasethuUserContext) {
        const thread = await this.repository.findThreadById(threadId, user);
        if (!thread) throw new Error('Thread not found or visibility restricted');

        await this.repository.updateThreadAtomic(threadId, thread.version, {
            ownership: OwnershipType.AI,
            is_locked: false, // Return to AI managed
        });

        // Cancel SLA on release
        await this.slaWorker.cancelSla(threadId);

        await this.repository.insertAuditLog({
            thread_id: threadId,
            actor_id: user.id,
            actor_type: 'HUMAN',
            action: 'RELEASE_CONTROL',
        });

        this.logger.log(`${user.role} ${user.id} released control of thread ${threadId}`);
    }
}
