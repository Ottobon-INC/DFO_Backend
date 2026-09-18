import { z } from 'zod';

export const VitalTypeSchema = z.enum([
  'blood_pressure',
  'heart_rate',
  'temperature',
  'weight',
  'height',
  'blood_sugar'
]);

export const AddVitalRequestSchema = z.object({
  patient_id: z.string().uuid(),
  vital_type: VitalTypeSchema,
  value: z.string().or(z.number()),
  recorded_at: z.string().datetime().optional()
    .default(() => new Date().toISOString()),
}).refine(data => {
  // Complex validation based on vital_type
  const strValue = String(data.value);
  
  if (data.vital_type === 'blood_pressure') {
    // Must be in format xxx/xx (e.g. 120/80)
    return /^\d{2,3}\/\d{2,3}$/.test(strValue);
  }
  
  if (['heart_rate', 'temperature', 'weight', 'height', 'blood_sugar'].includes(data.vital_type)) {
    // Must be numeric
    return !isNaN(Number(strValue));
  }
  
  return true;
}, {
  message: "Invalid vital value format for the specified vital_type."
});

export type VitalType = z.infer<typeof VitalTypeSchema>;
export type AddVitalRequest = z.infer<typeof AddVitalRequestSchema>;

export interface VitalRecord {
  id: string;
  patient_id: string;
  vital_type: VitalType;
  value: string;
  recorded_at: string;
  created_at: string;
}

export interface VitalAnalysisResult {
  status: 'normal' | 'warning' | 'high_risk';
  reason: string;
}

export const BulkAddVitalRequestSchema = z.object({
  vitals: z.array(AddVitalRequestSchema).min(1),
});

export type BulkAddVitalRequest = z.infer<typeof BulkAddVitalRequestSchema>;
