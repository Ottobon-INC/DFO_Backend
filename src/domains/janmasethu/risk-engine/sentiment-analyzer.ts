export class SentimentAnalyzer {
    /**
     * Basic sentiment scoring. 
     * In this implementation, we focus on identifying high-arousal negative sentiment 
     * that might indicate distress.
     */
    analyze(text: string): number {
        const lower = text.toLowerCase();

        const distressMarkers = [
            'help', 'urgent', 'scared', 'worried', 'pain',
            'severe', 'terrible', 'bad', 'please', 'emergency'
        ];

        let score = 0;
        distressMarkers.forEach(marker => {
            if (lower.includes(marker)) {
                score += 10;
            }
        });

        // Cap sentiment contribution to risk
        return Math.min(score, 100);
    }
}
