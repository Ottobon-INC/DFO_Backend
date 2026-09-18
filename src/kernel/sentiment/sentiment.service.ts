import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SentimentEvaluation, ThreadStatus } from '../../types';
import { SentimentRepository } from '../../infrastructure/repositories/sentiment.repository';
import { ThreadService } from '../thread/thread.service';
import { RoutingService } from '../routing/routing.service';
import { ProviderRegistry } from '../services/provider-registry.service';

@Injectable()
export class SentimentService {
    private readonly logger = new Logger(SentimentService.name);

    constructor(
        private readonly threadService: ThreadService,
        private readonly routingService: RoutingService,
        private readonly sentimentRepository: SentimentRepository,
        private readonly providerRegistry: ProviderRegistry,
    ) { }

    async evaluateThreadSentiment(threadId: string, messageId: string, content: string, domain: string): Promise<void> {
        const plugins = this.providerRegistry.getPlugins(domain);
        if (!plugins) {
            this.logger.error(`SentimentEngine: No plugins for domain [${domain}]`);
            return;
        }

        const evaluation = await plugins.sentimentProvider.evaluate(content, { threadId });

        // Store evaluation
        await this.sentimentRepository.create({
            thread_id: threadId,
            message_id: messageId,
            score: evaluation.score,
            label: evaluation.label,
            tags: (evaluation as any).tags, // Capture new tags from provider
            provider: `DOMAIN_SPECIFIC_${domain.toUpperCase()}`,
        });

        const thread = await this.threadService.getThread(threadId);
        const currentStatus = thread.status;
        const newLabel = evaluation.label.toLowerCase();

        // Severity weight map for comparison
        const statusWeight: Record<string, number> = {
            [ThreadStatus.GREEN]: 0,
            [ThreadStatus.YELLOW]: 1,
            [ThreadStatus.RED]: 2,
        };

        const targetStatus = newLabel === 'red' ? ThreadStatus.RED : (newLabel === 'yellow' ? ThreadStatus.YELLOW : ThreadStatus.GREEN);

        // Only update if it's an upgrade (GREEN -> YELLOW, GREEN -> RED, YELLOW -> RED)
        if (statusWeight[targetStatus] > statusWeight[currentStatus]) {
            await this.threadService.updateThreadStatusWithVersionCheck(threadId, targetStatus, thread.version);
            this.logger.log(`SentimentEngine: Escalating status for thread ${threadId}: ${currentStatus} -> ${targetStatus}`);

            // If it becomes RED, trigger mandatory human routing
            if (targetStatus === ThreadStatus.RED) {
                this.logger.log(`SentimentEngine: Red sentiment detected for thread ${threadId}. Triggering mandatory human escalation.`);
                await this.routingService.routeToHuman(threadId, 'SENTIMENT_ENGINE');
            }
        }
    }
}
