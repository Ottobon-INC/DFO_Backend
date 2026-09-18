# Janmasethu Risk Engine & Sentiment Detection

## Overview
The Hybrid Sentiment Detection and Risk Scoring Engine evaluates incoming user messages and classifies the conversation thread's severity into `GREEN`, `YELLOW`, or `RED`. It combines multiple signals to make context-aware decisions rather than relying solely on simple keywords.

## Architecture Pipeline

1. **Keyword Detection (`keyword-detector.ts`)**
   Scans the message against predefined arrays of medical keywords.
   - `EMERGENCY_KEYWORDS` (e.g., "chest pain", "heart attack") → **RED** Signal
   - `MODERATE_KEYWORDS` (e.g., "fever", "headache") → **YELLOW** Signal

2. **Basic Sentiment Analysis (`sentiment-analyzer.ts`)**
   Looks for high-arousal distress markers (e.g., "help", "urgent", "scared", "emergency"). Each distress word found adds +10 to the sentiment risk score.

3. **Context Extraction (`context-extractor.ts`)**
   Fetches the last 5 messages from the database (`conversation_messages`) to provide historical context. This is useful for detecting repeated distress indicators across multiple consecutive messages.


5. **Risk Scoring Engine (`risk-scoring-engine.ts`)**
   Calculates a final numerical score by weighting each of the individual signals:
   - Emergency Keyword: `+50`
   - Moderate Keyword: `+30`
   - Negative Sentiment (>20 threshold): `+20`
   - Context Risk Present: `+20`

6. **Severity Classification (`risk-classifier.ts`)**
   Maps the final accumulated score to a standard Janmasethu threat level:
   - `0 - 39`: **GREEN**
   - `40 - 79`: **YELLOW**
   - `80+`: **RED**

7. **Main Orchestrator (`janmasethu-risk.service.ts`)**
   Implements the core framework's `SentimentProvider` contract. It runs the entire pipeline above sequentially when a new message is ingested, and returns the final `score` and `label` (severity) to the Control Tower kernel so it can handle Human/AI escalation policies.
