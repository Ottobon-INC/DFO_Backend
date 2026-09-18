import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { OwnershipType } from '../../types';
import { OwnershipService } from '../ownership/ownership.service';
import type { EscalationPolicy } from '../../contracts';
import { RoutingRepository, RoutingStatus } from '../../infrastructure/repositories/routing.repository';
import { MetricsService } from '../metrics/metrics.service';
import { ProviderRegistry } from '../services/provider-registry.service';
import { ThreadService } from '../thread/thread.service';


@Injectable()
export class RoutingService implements OnModuleInit {
    private readonly logger = new Logger(RoutingService.name);

    constructor(
        // @InjectQueue('routing_queue') private readonly routingQueue: Queue,
        private readonly ownershipService: OwnershipService,
        private readonly providerRegistry: ProviderRegistry,
        private readonly threadService: ThreadService,
        private readonly routingRepository: RoutingRepository,
        private readonly metricsService: MetricsService,
        private readonly configService: ConfigService,
    ) { }

    async onModuleInit() {
        // Disabling startup scan to investigate crash
        this.logger.log('RoutingService: Startup scan disabled for stability.');
    }

    async routeToHuman(threadId: string, actorId: string): Promise<void> {
        const thread = await this.threadService.getThread(threadId);
        const plugins = this.providerRegistry.getPlugins(thread.domain);

        if (!plugins) {
            throw new Error(`Orchestration: No plugins found for domain [${thread.domain}]`);
        }

        const requiredRole = await plugins.escalationPolicy.getRequiredRole(thread);

        // 1. Idempotent Update/Create routing_queue
        const { entry, isNew } = await this.routingRepository.createIdempotent({
            thread_id: threadId,
            required_role: requiredRole,
        });

        if (!isNew) {
            this.logger.log(`Escalation already in progress for thread ${threadId}. Skipping duplicate enqueue.`);
            return;
        }

        // 2. Enqueue BullMQ job
        await this.enqueueRoutingJob(entry.id, threadId, requiredRole);

        this.metricsService.incrementEscalationCount(threadId);

        // 3. Switch ownership to HUMAN
        await this.ownershipService.switchOwnership(threadId, OwnershipType.HUMAN, actorId, 'SYSTEM', {
            assignedRole: requiredRole,
        });
    }

    private async enqueueRoutingJob(id: string, threadId: string, requiredRole: string) {
        const retryAttempts = this.configService.get<number>('hardening.workerRetryAttempts') || 3;

        /*
        await this.routingQueue.add('process_escalation', {
            id,
            threadId,
            requiredRole,
        }, {
            attempts: retryAttempts,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
            removeOnComplete: true,
            removeOnFail: false,
        });
        */
    }
}
