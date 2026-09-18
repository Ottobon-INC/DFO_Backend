import { z } from 'zod';

export const SymptomSchema = z.object({
  name: z.string().describe('Name of the symptom (e.g., headache, abdominal pain)'),
  severity: z.enum(['mild', 'moderate', 'severe']).describe('Severity level inferred from patient language'),
  duration: z.string().describe('How long the patient has had the symptom'),
});

export const ClinicalInsightSchema = z.object({
  symptoms: z.array(SymptomSchema),
  risk_flags: z.array(z.string()).describe('List of potential medical risks based on symptoms'),
  urgency_level: z.enum(['low', 'medium', 'high', 'critical']).describe('Overall urgency recommended for this case'),
  summary: z.string().describe('Clear clinical summary for doctors'),
});

export type Symptom = z.infer<typeof SymptomSchema>;
export type ClinicalInsight = z.infer<typeof ClinicalInsightSchema>;

/**
 * Normalized response format for the analysis service.
 */
export interface AnalysisResponse {
  insight: ClinicalInsight;
  analysisId: string;
}
