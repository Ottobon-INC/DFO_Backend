import { z } from 'zod';

export const AlertUrgencySchema = z.enum(['low', 'medium', 'high', 'critical']);

// Incoming request from clinical/bot module
export const AlertTriggerRequestSchema = z.object({
  patient_id: z.string().uuid(),
  symptoms: z.array(z.string()).default([]),
  risk_flags: z.array(z.string()).default([]),
  urgency_level: AlertUrgencySchema,
  timestamp: z.string().datetime().optional()
    .default(() => new Date().toISOString()),
});

// Outgoing webhook payload to external systems
export const WebhookPayloadSchema = z.object({
  event: z.literal('emergency_alert'),
  trace_id: z.string().uuid(), // For idempotency
  patient_id: z.string().uuid(),
  urgency_level: AlertUrgencySchema,
  risk_flags: z.array(z.string()),
  symptoms: z.array(z.string()),
  timestamp: z.string().datetime()
});

export type AlertUrgency = z.infer<typeof AlertUrgencySchema>;
export type AlertTriggerRequest = z.infer<typeof AlertTriggerRequestSchema>;
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
