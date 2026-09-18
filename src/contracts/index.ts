import { SentimentEvaluation, Thread } from '../types';

export interface SentimentProvider {
    evaluate(text: string, options?: { threadId?: string }): Promise<{ score: number; label: string }>;
}

export interface EscalationPolicy {
    shouldEscalate(thread: Thread, evaluation: SentimentEvaluation): Promise<boolean>;
    getRequiredRole(thread: Thread): string;
}

export interface DomainNotifier {
    notifyOwnershipSwitch(thread: Thread, actorId: string): Promise<void>;
    notifyStatusChange(thread: Thread, previousStatus: string): Promise<void>;
}
