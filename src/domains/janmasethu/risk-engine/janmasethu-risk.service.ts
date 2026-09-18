import { Injectable, Logger } from '@nestjs/common';
import { SentimentProvider } from '../../../contracts';
import { JanmasethuRepository } from '../janmasethu.repository';
import { KeywordDetector, RiskLevel } from './keyword-detector';
import { SentimentAnalyzer } from './sentiment-analyzer';
import { ContextExtractor } from './context-extractor';
import { RiskScoringEngine } from './risk-scoring-engine';
import { RiskClassifier } from './risk-classifier';

@Injectable()
export class JanmasethuRiskService implements SentimentProvider {
    private readonly logger = new Logger(JanmasethuRiskService.name);

    // Internal modules (could be injected as providers if needed)
    private readonly keywordDetector = new KeywordDetector();
    private readonly sentimentAnalyzer = new SentimentAnalyzer();
    private readonly contextExtractor: ContextExtractor;
    private readonly scoringEngine = new RiskScoringEngine();
    private readonly classifier = new RiskClassifier();

    constructor(private readonly repository: JanmasethuRepository) {
        this.contextExtractor = new ContextExtractor(repository);
    }

    /**
     * Orchestrates the Hybrid Sentiment Detection + Risk Scoring pipeline.
     */
    async evaluate(text: string, options?: { threadId?: string; patientId?: string }): Promise<{ score: number; label: string; tags: string[] }> {
        this.logger.log(`JanmasethuRiskEngine: Analyzing message for patient ${options?.patientId || 'unknown'}`);

        // 1. Keyword Detection
        const { level: keywordLevel, tags: detectedTags } = this.keywordDetector.detect(text);

        // 2. Sentiment Analysis
        const sentimentScore = this.sentimentAnalyzer.analyze(text);

        // 3. Context Extraction & History
        let contextRisk = false;
        if (options?.threadId) {
            const context = await this.contextExtractor.extract(options.threadId);
            const distressCount = (context.match(/help|urgent|pain|severe/gi) || []).length;
            if (distressCount >= 2) contextRisk = true;
        }

        // 5. Patient Profile Awareness (NEW)
        let profileMultiplier = 1.0;
        let reasoning = 'Base clinical assessment.';
        if (options?.patientId) {
            const profile = await this.repository.findPatientProfile(options.patientId);
            if (profile) {
                // Late pregnancy (36+ weeks) or high risk profile increases sensitivity
                if (profile.pregnancy_stage >= 36 || profile.clinical_risk_category === 'high') {
                    profileMultiplier = 1.25;
                    reasoning += ` Adjusted for high-risk category/late pregnancy stage (${profile.pregnancy_stage}w).`;
                }

                // Trend detection: Check for repeated distress
                const lastLogs = await this.repository.findRiskLogsByPatient(options.patientId, 3);
                const yellowCount = lastLogs.filter(l => l.risk_level === 'yellow').length;
                if (yellowCount >= 2) {
                    profileMultiplier *= 1.15;
                    reasoning += ' Proactive escalation due to repeated medium-risk pattern.';
                }
            }
        }

        // 6. Risk Scoring
        let finalScore = this.scoringEngine.calculateScore({
            keywordLevel,
            sentimentScore,
            contextRisk,
        });

        finalScore = Math.min(100, finalScore * profileMultiplier);

        // 7. Severity Classification
        const riskLevel = this.classifier.classify(finalScore).toLowerCase();

        // 10. Longitudinal Tracking (NEW)
        if (options?.patientId && options?.threadId) {
            await this.repository.insertRiskLog({
                patient_id: options.patientId,
                thread_id: options.threadId,
                risk_score: finalScore,
                risk_level: riskLevel,
                reasoning,
                signals: {
                    keyword: keywordLevel === RiskLevel.RED ? 100 : keywordLevel === RiskLevel.YELLOW ? 50 : 0,
                    sentiment: sentimentScore * 100
                }
            });
        }

        this.logger.log(`JanmasethuRiskEngine: Result - Score: ${finalScore}, Risk: ${riskLevel}. ${reasoning}`);

        return {
            score: finalScore / 100,
            label: riskLevel,
            tags: detectedTags
        };
    }
}
