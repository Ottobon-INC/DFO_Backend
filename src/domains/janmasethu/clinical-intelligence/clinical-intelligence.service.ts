import { Injectable, Logger, InternalServerErrorException, Inject, Optional } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ClinicalInsight, ClinicalInsightSchema } from './clinical-intelligence.schema';
import { EncryptionService } from '../../../infrastructure/security/encryption.service';
import { AuditService } from '../../../infrastructure/audit/audit.service';
import { ClinicalIntelligenceRepository } from './clinical-intelligence.repository';
import retry from 'async-retry';

@Injectable()
export class ClinicalIntelligenceService {
  private readonly logger = new Logger(ClinicalIntelligenceService.name);
  private readonly genAI: GoogleGenerativeAI | null = null;
  private readonly model: any = null;
  private readonly provider: 'MOCK' | 'GEMINI' | 'CUSTOM';

  get isMockMode(): boolean {
    return this.provider === 'MOCK';
  }

  constructor(
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly repository: ClinicalIntelligenceRepository,
    @Optional() @Inject('GEMINI_MODEL') private readonly injectedModel?: any,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    const configProvider = process.env.AI_PROVIDER?.toUpperCase();

    // Determine the provider: CUSTOM if specified, GEMINI if key exists, otherwise MOCK
    if (configProvider === 'CUSTOM') {
      this.provider = 'CUSTOM';
    } else if (apiKey && apiKey !== 'MOCK_KEY') {
      this.provider = 'GEMINI';
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = injectedModel || this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    } else {
      this.provider = 'MOCK';
      if (!injectedModel) {
        this.logger.warn('No LLM Provider configured or API key missing. CLINICAL INTELLIGENCE IS RUNNING IN SECURE MOCK MODE.');
      } else {
        // Support for unit tests that inject a model
        this.model = injectedModel;
        this.provider = 'GEMINI'; // Treat as Gemini for test orchestration
      }
    }
  }

  async analyzeConversation(conversation: string, userId: string = 'system'): Promise<ClinicalInsight> {
    this.logger.log(`Starting clinical analysis of conversation (Mode: ${this.isMockMode ? 'MOCK' : 'LIVE'})...`);

    const systemPrompt = `
      You are a high-precision Clinical Intelligence assistant for Janmasethu, a maternal health platform.
      Analyze the following patient conversation and extract structured clinical insights.

      RULES:
      1. Return ONLY a strict valid JSON object. No markdown, no preamble, no tailing text.
      2. Infer symptom severity (mild, moderate, severe) from the patient's language.
      3. Determine urgency_level:
         - 'critical': Immediate life-threatening risks (e.g., heavy bleeding, severe breathlessness, sudden vision loss/preeclampsia signs).
         - 'high': Severe symptoms needing urgent attention (e.g., high fever, intense persistent pain).
         - 'medium': Moderate symptoms.
         - 'low': Mild symptoms or routine queries.
      4. List 'risk_flags', specifically highlighting pregnancy-related complications if applicable.
      5. Provide a clear 'summary' for a clinician.
      6. If no symptoms are detected, return an empty symptoms array.
      7. Be objective. Do NOT hallucinate conditions not supported by the text.

      JSON SCHEMA:
      {
        "symptoms": [{"name": "string", "severity": "mild|moderate|severe", "duration": "string"}],
        "risk_flags": ["string"],
        "urgency_level": "low|medium|high|critical",
        "summary": "string"
      }
    `;

    try {
      let result: ClinicalInsight;

      if (this.provider === 'MOCK') {
        result = this.generateMockInsight(conversation);
      } else if (this.provider === 'CUSTOM') {
        result = await this.callPrivateTeamAi(conversation);
      } else {
        // Standard LLM Orchestration (e.g., Gemini)
        result = await this.orchestrateLlmAnalysis(conversation, systemPrompt);
      }

      // Persistence & Security Layer
      const encryptedConversation = this.encryption.encrypt(conversation);
      const encryptedAnalysis = this.encryption.encrypt(JSON.stringify(result));

      const savedRecord = await this.repository.saveAnalysis({
        patient_conversation: encryptedConversation,
        structured_analysis: encryptedAnalysis,
        urgency_level: result.urgency_level,
      });

      // Audit Logging
      this.audit.log(
        userId,
        'CREATE',
        'MESSAGE', // Mapping to MESSAGE resource type for now or generic
        savedRecord?.id,
        `Clinical analysis completed. Urgency: ${result.urgency_level}`
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[ClinicalIntelligence] Analysis failed: ${errorMessage}`, error instanceof Error ? error.stack : undefined);

      // We throw a standardized error for the client but keep the detailed cause in server logs
      throw new InternalServerErrorException('Clinical analysis service failed. Please check server logs for details.');
    }
  }

  /**
   * Orchestrates the LLM analysis with retry logic and validation.
   */
  private async orchestrateLlmAnalysis(conversation: string, systemPrompt: string): Promise<ClinicalInsight> {
    return await retry(
      async (bail) => {
        try {
          const prompt = `${systemPrompt}\n\nPatient Conversation:\n"${conversation}"`;
          const llmResponse = await this.model.generateContent(prompt);
          if (!llmResponse || !llmResponse.response || typeof llmResponse.response.text !== 'function') {
            throw new Error('LLM returned an invalid response structure');
          }
          const text = llmResponse.response.text();

          const jsonStr = text.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(jsonStr);
          const validated = ClinicalInsightSchema.safeParse(parsed);

          if (!validated.success) {
            this.logger.error(`LLM output validation failed: ${JSON.stringify(validated.error.format())}`);
            throw new Error('Invalid LLM output structure');
          }

          return validated.data;
        } catch (err) {
          this.logger.warn(`Retrying LLM analysis due to error: ${err.message}`);
          throw err;
        }
      },
      { retries: 3, minTimeout: 1000, factor: 2 }
    );
  }

  /**
   * PLACEHOLDER: This is where your team will integrate their private API.
   * Add your team's fetch() or custom client call here.
   */
  private async callPrivateTeamAi(conversation: string): Promise<ClinicalInsight> {
    this.logger.log('Calling Custom Private Team AI API...');

    // TODO: Your team integrates their API here
    // For now, it will fallback to a secure local simulated insight
    return this.generateMockInsight(conversation);
  }

  /**
   * Generates a realistic mock insight for development without an API key.
   */
  private generateMockInsight(conversation: string): ClinicalInsight {
    const text = conversation.toLowerCase();
    const hasUrgentKeywords = text.includes('bleeding') || text.includes('severe') || text.includes('emergency');

    return {
      symptoms: [
        {
          name: text.includes('headache') ? 'headache' : 'reported discomfort',
          severity: hasUrgentKeywords ? 'severe' : 'mild',
          duration: 'not specified'
        }
      ],
      risk_flags: hasUrgentKeywords
        ? ['Urgent evaluation required - potential complication noted']
        : ['Routine monitoring recommended'],
      urgency_level: hasUrgentKeywords ? 'critical' : 'low',
      summary: `[MOCK MODE] Secure local analysis of conversation: "${conversation.substring(0, 50)}...". No data sent to external cloud providers.`
    };
  }
}
