import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuScopePolicy } from './JanmasethuScopePolicy';
import { JanmasethuUserContext, JanmasethuRiskLog } from './janmasethu.types';

@Injectable()
export class JanmasethuContextService {
    private readonly logger = new Logger(JanmasethuContextService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly policy: JanmasethuScopePolicy,
    ) { }

    /**
     * GET FULL CONVERSATION CONTEXT
     * - Enforces RBAC visibility
     * - Returns chronological messages
     */
    async getThreadContext(threadId: string, user: JanmasethuUserContext) {
        // 1. Fetch thread (enforces domain)
        const thread = await this.repository.findThreadById(threadId);
        if (!thread) {
            throw new Error('Thread not found');
        }

        // 2. RBAC Enforcement
        if (!this.policy.canView(user, thread)) {
            this.logger.warn(`Context Access DENIED: User ${user.id} (${user.role}) attempted to access thread ${threadId} (Status: ${thread.status})`);
            throw new ForbiddenException('Access denied: You do not have permission to view the context for this thread status.');
        }

        // 3. Fetch Chronological Messages & Extension Metadata
        const messages = await this.repository.findMessagesByThreadId(threadId);
        const summary = await this.repository.findSummaryByThread(threadId);

        let patientId = thread.metadata?.patient_id;
        if (!patientId && thread.user_id) {
            const patient = await this.repository.findDFOPatientByPhone(thread.user_id);
            if (patient) patientId = patient.id;
        }

        let riskLogs: JanmasethuRiskLog[] = [];
        if (patientId) {
            riskLogs = await this.repository.findRiskLogsByPatient(patientId, 3);
        }

        return {
            threadId: thread.id,
            patientId: patientId,
            status: thread.status,
            structured_memory: {
                summary: summary?.summary_text || 'No summary available yet.',
                symptoms: summary?.structured_symptoms || [],
                timeline: summary?.timeline_json || {},
                recent_alerts: riskLogs.map(l => ({
                    level: l.risk_level,
                    reason: l.reasoning,
                    timestamp: l.created_at
                }))
            },
            messages: messages.map(m => ({
                sender_type: m.sender_type,
                content: m.content,
                created_at: m.created_at
            }))
        };
    }
}
