import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { OwnershipType, Thread } from '../../types';
import { ThreadService } from '../thread/thread.service';
import { AuditService } from '../audit/audit.service';
import { ThreadRepository } from '../../infrastructure/repositories/thread.repository';
import { ProviderRegistry } from '../services/provider-registry.service';
import { MetricsService } from '../metrics/metrics.service';
import { ConcurrencyException } from '../../infrastructure/exceptions';

@Injectable()
export class OwnershipService {
    private readonly logger = new Logger(OwnershipService.name);

    constructor(
        private readonly threadService: ThreadService,
        private readonly auditService: AuditService,
        private readonly threadRepository: ThreadRepository,
        private readonly metricsService: MetricsService,
        private readonly providerRegistry: ProviderRegistry,
    ) { }

    async switchOwnership(
        threadId: string,
        ownershipType: OwnershipType,
        actorId: string,
        actorType: 'HUMAN' | 'AI' | 'SYSTEM',
        options: { assignedRole?: string; assignedUserId?: string } = {},
    ): Promise<Thread> {
        const thread = await this.threadService.getThread(threadId);

        // Validate ownership transition rules
        this.validateTransition(thread.ownership as OwnershipType, ownershipType);

        try {
            // Atomic switch via repository
            const updatedThread = await this.threadRepository.updateAtomic(threadId, thread.version, {
                ownership: ownershipType,
                assigned_role: options.assignedRole,
                assigned_user_id: options.assignedUserId,
                // MANDATE: When a thread is in HUMAN ownership, you must enforce is_locked = true.
                is_locked: ownershipType === OwnershipType.HUMAN ? true : false,
            });

            await this.auditService.append({
                thread_id: threadId,
                actor_id: actorId,
                actor_type: actorType,
                action: 'OWNERSHIP_SWITCHED',
                payload: {
                    previous_ownership: thread.ownership,
                    new_ownership: ownershipType,
                    assigned_role: options.assignedRole,
                },
            });

            this.metricsService.incrementOwnershipSwitchCount(threadId, thread.ownership, ownershipType);

            const plugins = this.providerRegistry.getPlugins(thread.domain);
            if (plugins?.domainNotifier) {
                await plugins.domainNotifier.notifyOwnershipSwitch(updatedThread, actorId);
            }

            return updatedThread;
        } catch (error) {
            if (error instanceof ConcurrencyException) {
                this.metricsService.incrementConcurrencyConflictCount(threadId);
            }
            throw error;
        }
    }

    async toggleLock(threadId: string, isLocked: boolean, actorId: string, actorType: 'HUMAN' | 'AI' | 'SYSTEM'): Promise<Thread> {
        const thread = await this.threadService.getThread(threadId);

        try {
            const updated = await this.threadRepository.updateAtomic(threadId, thread.version, {
                is_locked: isLocked,
            });

            await this.auditService.append({
                thread_id: threadId,
                actor_id: actorId,
                actor_type: actorType,
                action: isLocked ? 'THREAD_LOCKED' : 'THREAD_UNLOCKED',
                payload: { previous_version: thread.version },
            });

            return updated;
        } catch (error) {
            if (error instanceof ConcurrencyException) {
                this.metricsService.incrementConcurrencyConflictCount(threadId);
            }
            throw error;
        }
    }

    private validateTransition(from: OwnershipType, to: OwnershipType) {
        if (from === to) return;

        const allowed = (from === OwnershipType.AI && to === OwnershipType.HUMAN) ||
            (from === OwnershipType.HUMAN && to === OwnershipType.AI);

        if (!allowed) {
            this.logger.error(`Illegal ownership transition attempt: ${from} -> ${to}`);
            throw new BadRequestException(`Illegal ownership transition: ${from} -> ${to}`);
        }
    }
}
