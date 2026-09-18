import { RiskLevel } from './keyword-detector';

export class RiskScoringEngine {
    calculateScore(signals: {
        keywordLevel: RiskLevel;
        sentimentScore: number;
        contextRisk?: boolean;
    }): number {
        let totalScore = 0;

        // 1. Keyword Signals (Hardened Safety Net)
        if (signals.keywordLevel === RiskLevel.RED) totalScore += 80;
        else if (signals.keywordLevel === RiskLevel.YELLOW) totalScore += 40;

        // 2. Sentiment Signal (threshold based)
        if (signals.sentimentScore > 20) totalScore += 20;

        // 3. Context Signal
        if (signals.contextRisk) totalScore += 20;

        return totalScore;
    }
}
