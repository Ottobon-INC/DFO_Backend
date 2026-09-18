import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class JanmasethuGuardrailService {
    private readonly logger = new Logger('JanmasethuGuardrails');

    // Medical Instruction Filter
    private readonly dangerousPhrases = [
        /stop taking/i,
        /don't go to/i,
        /ignore the/i,
        /medical advice/i,
    ];

    /**
     * CLINICAL SAFETY CHECK
     */
    validate(text: string, riskScore: number, confidence: number): { safe: boolean; reason?: string } {
        // 1. Threshold check
        if (riskScore > 80 && confidence < 0.7) {
            return { safe: false, reason: 'High risk + low AI confidence. Escalating to human.' };
        }

        // 2. Dangerous medical suggestion test
        for (const phrase of this.dangerousPhrases) {
            if (phrase.test(text)) {
                return { safe: false, reason: 'AI attempted unauthorized clinical recommendation block.' };
            }
        }

        return { safe: true };
    }

    /**
     * AI PERMISSION CHECK (THE KILL-SWITCH)
     * Determines if the AI is allowed to "speak" to the patient right now.
     */
    isAIPermitted(threadStatus: string, lastActorType: string, takeoverActive: boolean): { permitted: boolean; reason?: string } {
        // 1. HARD BLOCK: Human doctor has manually taken over the thread.
        if (takeoverActive) {
            this.logger.warn(`AI MUTED: Active human takeover on thread.`);
            return { permitted: false, reason: 'DOCTOR_TAKEOVER_ACTIVE_AI_SAFETY_MUTE' };
        }

        // 2. SOFT BLOCK: Last person to speak was a human (doctor, nurse, staff).
        // We wait for the patient to reply before the AI can support again.
        if (lastActorType === 'DOCTOR' || lastActorType === 'STAFF' || lastActorType === 'HUMAN') {
            this.logger.debug(`AI PAUSED: Waiting for patient to reply to the clinician's message.`);
            return { permitted: false, reason: 'WAITING_FOR_PATIENT_RESPONSE_PREVENT_AI_INTERRUPT' };
        }

        // 3. SEVERITY BLOCK: Thread is in YELLOW or RED (Rising Risk) mode.
        // In elevated risk, humans should lead the care to avoid confusion.
        if (threadStatus === 'red' || threadStatus === 'yellow') {
            return { permitted: false, reason: 'ELEVATED_RISK_MANUAL_REVIEW_EXPECTED' };
        }

        return { permitted: true };
    }

    /**
     * ALIGNMENT CHECK
     * Ensures AI doesn't deviate from human-set status for a patient.
     */
    checkAlignment(status: string, aiRisk: string): boolean {
        // AI shouldn't say "green" if patient is already marked "red" by doctor.
        if (status === 'red' && aiRisk === 'green') {
            this.logger.warn('AI/Doctor misalignment detected. Ignoring AI risk score.');
            return false;
        }
        return true;
    }
}
