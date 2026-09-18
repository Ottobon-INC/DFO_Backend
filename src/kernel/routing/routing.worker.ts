import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { RoutingRepository, RoutingStatus } from '../../infrastructure/repositories/routing.repository';
import { DeadLetterRepository } from '../../infrastructure/repositories/dead-letter.repository';
import { ThreadService } from '../thread/thread.service';

@Injectable()
@Processor('routing_queue')
export class RoutingWorker extends WorkerHost {
    private readonly logger = new Logger(RoutingWorker.name);

    constructor(
        private readonly routingRepository: RoutingRepository,
        private readonly deadLetterRepository: DeadLetterRepository,
        private readonly threadService: ThreadService,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        const { id, threadId, requiredRole } = job.data;

        switch (job.name) {
            case 'process_escalation':
                this.logger.log(`Processing escalation for thread ${threadId} with role ${requiredRole}`);

                // Worker-level Defense-in-Depth: Validate thread exists and isn't locked (though HUMAN ownership is expected)
                try {
                    await this.threadService.getThread(threadId);
                } catch (e) {
                    await this.handleFailure(job, `Thread ${threadId} not found or inaccessible`);
                    return;
                }

                await this.routingRepository.updateStatus(id, RoutingStatus.ASSIGNED);

                try {
                    // External integration logic (Mock success)
                    await this.routingRepository.updateStatus(id, RoutingStatus.COMPLETED);
                    return { success: true };
                } catch (error) {
                    await this.handleFailure(job, error.message);
                    throw error;
                }

            default:
                this.logger.warn(`Unknown job name: ${job.name}`);
        }
    }

    private async handleFailure(job: Job, reason: string) {
        const { id, threadId } = job.data;
        this.logger.error(`Escalation failed for job ${id}: ${reason}`);

        await this.routingRepository.updateStatus(id, RoutingStatus.FAILED, reason);

        // If final attempt, push to Dead Letter Office
        if (job.attemptsMade >= (job.opts.attempts || 1) - 1) {
            await this.deadLetterRepository.persist({
                routing_id: id,
                thread_id: threadId,
                reason,
                payload: job.data,
            });
        }
    }
}
