import { Controller, Post, Body, Logger, BadRequestException } from '@nestjs/common';
import { ThreadService } from '../thread/thread.service';
import { ProviderRegistry } from '../services/provider-registry.service';
import { SentimentService } from '../sentiment/sentiment.service';

export interface FrameworkEvent {
    domain: string;
    thread_id: string;
    user_id: string;
    channel: string;
    sender_type: 'user' | 'ai';
    message: string;
    metadata?: Record<string, any>;
}

@Controller('events')
export class KernelIngressController {
    private readonly logger = new Logger(KernelIngressController.name);

    constructor(
        private readonly threadService: ThreadService,
        private readonly sentimentService: SentimentService,
        private readonly providerRegistry: ProviderRegistry
    ) { }

    @Post()
    async handleEvent(@Body() event: FrameworkEvent) {
        this.logger.log(`Framework: Received event for domain [${event.domain}]`);

        const plugins = this.providerRegistry.getPlugins(event.domain);
        if (!plugins) {
            throw new BadRequestException(`No plugins registered for domain: ${event.domain}`);
        }

        // 1. Mirror message in kernel
        const message = await this.threadService.appendMessage(event.thread_id, {
            sender_id: event.user_id,
            content: event.message,
            sender_type: event.sender_type.toUpperCase() as any,
            domain: event.domain
        });

        // 2. Trigger Triage (Sentiment -> Escalation) using domain plugins
        this.sentimentService.evaluateThreadSentiment(
            event.thread_id,
            message.id,
            event.message,
            event.domain
        ).catch(err => this.logger.error(`Triage failed for domain [${event.domain}]: ${err.message}`));

        return {
            status: 'acknowledged',
            domain: event.domain,
            threadId: event.thread_id
        };
    }
}
