import { Injectable, Logger } from '@nestjs/common';
import { JanmasethuRepository } from '../janmasethu.repository';
import { ThreadService } from '../../../kernel/thread/thread.service';
import { SentimentService } from '../../../kernel/sentiment/sentiment.service';
import { GuardrailService } from '../../../kernel/guardrail/guardrail.service';
import { JANMASETHU_DOMAIN } from '../janmasethu.types';
import { ThreadStatus, Channel } from '../../../types';

@Injectable()
export class JanmasethuChannelService {
    private readonly logger = new Logger(JanmasethuChannelService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly threadService: ThreadService,
        private readonly sentimentService: SentimentService,
        private readonly guardrailService: GuardrailService,
    ) { }

    async handleIncomingMessage(channel: string, userId: string, message: string) {
        this.logger.log(`Incoming message from ${channel} user ${userId}: ${message}`);

        // 1. Ensure thread exists
        const threadId = await this.ensureThreadExists(userId, channel);

        // 2. Append message (Existing thread message ingestion)
        const msg = await this.threadService.appendMessage(threadId, {
            sender_id: userId,
            sender_type: 'USER',
            content: message,
        });

        // 3. Trigger Hybrid Risk Engine (Sentiment evaluation in kernel triggers domain provider)
        // mimics the event pipeline in ThreadController
        this.sentimentService.evaluateThreadSentiment(threadId, msg.id, message, JANMASETHU_DOMAIN)
            .catch(err => this.logger.error(`Risk Engine evaluation failed: ${err.message}`));

        // 4. Trigger Guardrail
        await this.guardrailService.evaluate(threadId, message);

        // 5. Return latest status
        const thread = await this.threadService.getThread(threadId);
        return {
            thread_id: thread.id,
            status: thread.status,
            ownership: thread.ownership
        };
    }

    private async ensureThreadExists(userId: string, channel: string): Promise<string> {
        // Check if thread exists for the user in janmasethu domain
        const { data, error } = await (this.repository as any).supabase
            .from('conversation_threads')
            .select('id')
            .eq('user_id', userId)
            .eq('domain', JANMASETHU_DOMAIN)
            .single();

        if (data) {
            return data.id;
        }

        // Create new thread
        this.logger.log(`Auto-creating new thread for user ${userId} on channel ${channel}`);
        const thread = await this.repository.createThread({
            user_id: userId,
            channel: channel as Channel,
            status: ThreadStatus.GREEN,
            ownership: 'AI' as any,
            is_locked: false,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
        });

        return thread.id;
    }
}
