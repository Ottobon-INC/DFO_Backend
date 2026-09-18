import { Injectable } from '@nestjs/common';
import { Thread, SentimentEvaluation } from '../../types';
import { EscalationPolicy } from '../../contracts';
import { JanmasethuRole } from './janmasethu.types';

@Injectable()
export class JanmasethuPolicy implements EscalationPolicy {
    async shouldEscalate(thread: Thread, evaluation: SentimentEvaluation): Promise<boolean> {
        // Red and Yellow both trigger escalation in Janmasethu
        return ['red', 'yellow'].includes(evaluation.label.toLowerCase());
    }

    getRequiredRole(thread: Thread): string {
        const label = (thread as any).status || 'green'; // Handle potential missing status in type if needed
        if (label === 'red') return JanmasethuRole.DOCTOR_QUEUE;
        if (label === 'yellow') return JanmasethuRole.NURSE_QUEUE;
        return 'AI';
    }
}
