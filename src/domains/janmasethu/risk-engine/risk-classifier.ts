import { RiskLevel } from './keyword-detector';

export class RiskClassifier {
    classify(score: number): RiskLevel {
        if (score >= 80) return RiskLevel.RED;
        if (score >= 40) return RiskLevel.YELLOW;
        return RiskLevel.GREEN;
    }
}
