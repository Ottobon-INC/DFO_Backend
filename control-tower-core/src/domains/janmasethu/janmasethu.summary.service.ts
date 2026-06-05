import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuSummary } from './janmasethu.types';
import { JanmasethuEncryptionService } from './utils/encryption.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JanmasethuSummaryService {
    private readonly logger = new Logger(JanmasethuSummaryService.name);
    private readonly slmUrl: string;

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly encryption: JanmasethuEncryptionService,
        private readonly config: ConfigService,
    ) {
        // Internal SLM Endpoint (Ollama/Local-Mistral/Phi-3)
        this.slmUrl = this.config.get<string>('SLM_SUMMARIZATION_URL') ?? 'http://localhost:11434/api/generate';
    }

    /**
     * Generates a clinical summary using a local SLM (e.g. Llama-3 or Mistral).
     * Secures data by running inference on-premise.
     */
    async generateSummary(threadId: string): Promise<JanmasethuSummary> {
        this.logger.log(`🧬 Generating Secure Clinical Summary for thread ${threadId}...`);

        const messages = await this.repository.findMessagesByThreadId(threadId);
        if (!messages || messages.length === 0) {
            throw new Error('Cannot summarize empty thread.');
        }

        // 1. Decrypt conversation history for AI processing
        const plainMessages = messages.map(msg => ({
            sender: msg.sender_type,
            text: this.encryption.decrypt(msg.content),
            timestamp: msg.created_at
        }));

        const conversationDump = plainMessages
            .map(m => `[${m.sender}]: ${m.text}`)
            .join('\n');

        let summaryText: string;
        let structuredSymptoms: string[] = [];

        try {
            // 2. Attempt Local SLM Inference
            summaryText = await this.callLocalSlm(conversationDump);
            structuredSymptoms = this.extractSymptomsFromText(summaryText);
            this.logger.log(`✅ SLM successfully summarized thread ${threadId}.`);
        } catch (error) {
            // 3. Robust Fallback (If SLM is down/not working as reported)
            this.logger.warn(`⚠️ Local SLM offline or failed. Using Clinical Rule-Based Fallback.`);
            summaryText = this.generateRuleBasedSummary(plainMessages);
            structuredSymptoms = this.extractSymptoms(plainMessages); // FIX: pass decrypted plainMessages
        }

        const summary: JanmasethuSummary = {
            thread_id: threadId,
            summary_text: summaryText,
            structured_symptoms: structuredSymptoms,
            timeline_json: {
                start: messages[0]?.created_at,
                last_message: messages[messages.length - 1]?.created_at,
                event_count: messages.length
            }
        };

        await this.repository.upsertSummary(summary);
        return summary;
    }

    /**
     * Calls the local SLM (Small Language Model). 
     * Defaulting to Ollama style API payload.
     */
    private async callLocalSlm(context: string): Promise<string> {
        this.logger.debug(`Calling SLM at ${this.slmUrl}...`);

        const prompt = `
            Analyze the following patient-clinician conversation. 
            Provide a concise clinical summary (max 3 sentences) focusing on:
            1. Primary Symptoms Reported.
            2. Duration/Severity.
            3. Recommended Next Steps.

            CONVERSATION:
            ${context}

            SUMMARY:
        `;

        const slmTimeout = this.config.get<number>('SLM_TIMEOUT') ?? 10000; // Inject dynamic configured timeout bounds

        const response = await axios.post(this.slmUrl, {
            model: 'phi3:mini', // Lightweight clinical-safe default
            prompt: prompt,
            stream: false
        }, { timeout: slmTimeout });

        return response.data?.response || // Ollama Completion format
               response.data?.message?.content || // Ollama/OpenAI Chat format
               response.data?.choices?.[0]?.message?.content || // OpenAI Chat format
               response.data?.choices?.[0]?.text; // OpenAI legacy / Llama.cpp Completion format
    }

    /**
     * A sophisticated fallback logic using regex and clinical logic.
     * Used when the AI/SLM is down.
     */
    private generateRuleBasedSummary(plainMessages: any[]): string {
        const symptoms = this.extractSymptoms(plainMessages);
        const userMessages = plainMessages.filter(m => m.sender === 'USER');

        let report = `RELIABILITY: RULE-BASED (SLM Offline). `;

        if (symptoms.length > 0) {
            report += `Suspected concerns: ${symptoms.join(', ')}. `;
        } else {
            report += `General inquiry detected. No specific pain/danger keywords matched. `;
        }

        report += `Conversation spans ${plainMessages.length} exchanges. Latest update at ${plainMessages[plainMessages.length - 1].timestamp}.`;

        return report;
    }

    private extractSymptoms(plainMessages: any[]): string[] {
        const symptoms = new Set<string>();
        const patterns = {
            'Abdominal Pain': /pain|cramp|ache|stomach/gi,
            'Bleeding': /bleeding|spotting|blood/gi,
            'Fever': /fever|chills|hot/gi,
            'Headache': /headache|dizzy|nausea/gi,
            'Movement': /movement|kicks|kicking/gi
        };

        plainMessages.forEach(msg => {
            const content = (msg.text || msg.content || '').toLowerCase();
            Object.entries(patterns).forEach(([name, regex]) => {
                if (regex.test(content)) symptoms.add(name);
            });
        });

        return Array.from(symptoms);
    }

    private extractSymptomsFromText(text: string): string[] {
        // Post-process SLM text to find key technical terms
        const clinicalTerms = ['Pre-eclampsia', 'Gestational Diabetes', 'Hyperemesis', 'Oligohydramnios'];
        return clinicalTerms.filter(term => text.includes(term));
    }
}

