import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { ThreadService } from '../kernel/thread/thread.service';
import { OwnershipType } from '../types';

@Injectable()
export class AISuppressionGuard implements CanActivate {
    private readonly logger = new Logger(AISuppressionGuard.name);
    constructor(private readonly threadService: ThreadService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const threadId = request.body.thread_id || request.params.id;

        if (!threadId) return true; // Let validation handle missing ID

        const thread = await this.threadService.getThread(threadId);
        const status = thread.status as string;

        // EMERGENCY SUPPRESSION: If thread is YELLOW or RED, AI is silenced immediately.
        const isEmergency = ['yellow', 'red'].includes(status.toLowerCase());

        // TAKEOVER SUPPRESSION: If thread is owned by HUMAN or explicitly locked.
        const isHumanOwned = thread.ownership !== OwnershipType.AI;
        const isLocked = thread.is_locked;
        const isSuppressed = (thread as any).ai_suppressed;

        if (isEmergency || isHumanOwned || isLocked || isSuppressed) {
            this.logger.warn(`AI processing suppressed for ${threadId}: emergency=${isEmergency}, humanOwned=${isHumanOwned}, locked=${isLocked}, suppressed=${isSuppressed}`);
            throw new ForbiddenException('AI processing suppressed due to clinical priority or human takeover');
        }

        return true;
    }
}
