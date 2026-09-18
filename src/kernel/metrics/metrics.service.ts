import { Injectable, Inject, Logger } from '@nestjs/common';

@Injectable()
export class MetricsService {
    private readonly logger = new Logger('Metrics');

    incrementEscalationCount(threadId: string) {
        this.logger.log(`Metric: [escalation_count] incremented for thread ${threadId}`);
    }

    incrementOwnershipSwitchCount(threadId: string, from: string, to: string) {
        this.logger.log(`Metric: [ownership_switch_count] ${from} -> ${to} for thread ${threadId}`);
    }

    incrementConcurrencyConflictCount(threadId: string) {
        this.logger.log(`Metric: [concurrency_conflict_count] incremented for thread ${threadId}`);
    }

    recordGuardrailTrigger(threadId: string, rule: string) {
        this.logger.log(`Metric: [guardrail_triggered] rule: ${rule} for thread ${threadId}`);
    }
}
