import { Injectable, Logger } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuUserContext } from './janmasethu.types';

@Injectable()
export class JanmasethuFeedbackService {
    private readonly logger = new Logger(JanmasethuFeedbackService.name);

    constructor(private readonly repository: JanmasethuRepository) { }

    async submitFeedback(threadId: string, clinician: JanmasethuUserContext, dto: { accuracy_score: number; comment: string; risk_mismatch: boolean }) {
        this.logger.log(`Recording clinician feedback for thread ${threadId} from ${clinician.id}`);

        // 1. Persist the clinical critique
        await this.repository.insertFeedback({
            thread_id: threadId,
            clinician_id: clinician.id,
            ...dto
        });

        // 2. ACT: If doctor reported a risk mismatch OR low score, flag for AI Retraining
        if (dto.risk_mismatch || dto.accuracy_score < 3) {
            this.logger.error(`[AI_QUALITY_ALERT] Clinical Mismatch on Thread: ${threadId}! Status: High Priority for Retraining.`);

            // --- CLINICAL RETRAINING QUEUE ---
            // In a production environment, this would push JSON to a fine-tuning pipeline.
            await this.repository.insertAuditLog({
                actor_id: clinician.id,
                actor_type: 'DOCTOR',
                event_type: 'AI_RETRAINING_FLAGGED',
                payload: { thread_id: threadId, comment: dto.comment, original_score: dto.accuracy_score }
            });
        }
    }
}
