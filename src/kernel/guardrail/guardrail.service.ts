import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { RoutingService } from '../routing/routing.service';
import { AuditService } from '../audit/audit.service';
import { ThreadService } from '../thread/thread.service';

@Injectable()
export class GuardrailService {
    constructor(
        private readonly configService: ConfigService,
        private readonly routingService: RoutingService,
        private readonly auditService: AuditService,
        private readonly threadService: ThreadService,
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    ) { }

    async evaluate(threadId: string, content: string): Promise<{ status: 'safe' | 'escalate'; triggeredRule?: string }> {
        const thread = await this.threadService.getThread(threadId);
        const domainConfig = this.configService.get(`app.domains.${thread.domain}`) || this.configService.get('app.domains.default');

        const blockedKeywords = domainConfig.guardrailPolicy.blockedKeywords;
        const triggeredRule = blockedKeywords.find(kw => content.toLowerCase().includes(kw.toLowerCase()));

        if (triggeredRule) {
            // Persist triggered guardrail metadata
            await this.supabase
                .from('guardrail_evaluations')
                .insert([{
                    thread_id: threadId,
                    content_snippet: content.substring(0, 100),
                    triggered_rule: triggeredRule,
                    action: 'escalate',
                    created_at: new Date(),
                }]);

            await this.auditService.append({
                thread_id: threadId,
                actor_id: 'GUARDRAIL_ENGINE',
                actor_type: 'SYSTEM',
                action: 'GUARDRAIL_TRIGGERED',
                payload: { triggeredRule },
            });

            if (domainConfig.guardrailPolicy.escalateOnKeyword) {
                // Only route if not already routing
                try {
                    await this.routingService.routeToHuman(threadId, 'GUARDRAIL_ENGINE');
                } catch (e) {
                    if (!(e instanceof ConflictException)) throw e;
                }
                return { status: 'escalate', triggeredRule };
            }
        }

        return { status: 'safe' };
    }
}
