import { z } from 'zod';

export const CommunicationChannelSchema = z.enum(['sms', 'whatsapp', 'email', 'call']);
export const MessageTypeSchema = z.enum(['alert', 'reminder', 'update']);
export const UrgencyLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const QuietHoursSchema = z.object({
  start_time: z.string().describe('Quiet hours start in HH:mm format'),
  end_time: z.string().describe('Quiet hours end in HH:mm format'),
});

export const ConsentPreferencesSchema = z.object({
  allowed_channels: z.record(CommunicationChannelSchema, z.boolean()),
  allowed_message_types: z.array(MessageTypeSchema),
  quiet_hours: QuietHoursSchema,
});

export const ConsentCheckRequestSchema = z.object({
  patient_id: z.string().uuid(),
  communication_channel: CommunicationChannelSchema,
  message_type: MessageTypeSchema,
  urgency_level: UrgencyLevelSchema,
  timestamp: z.string().datetime().optional()
    .default(() => new Date().toISOString()),
});

export const ConsentCheckResponseSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  overridden: z.boolean(),
});

export const ConsentSaveRequestSchema = z.object({
  patient_id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  preferences: ConsentPreferencesSchema,
});

export type CommunicationChannel = z.infer<typeof CommunicationChannelSchema>;
export type MessageType = z.infer<typeof MessageTypeSchema>;
export type UrgencyLevel = z.infer<typeof UrgencyLevelSchema>;
export type ConsentPreferences = z.infer<typeof ConsentPreferencesSchema>;
export type ConsentCheckRequest = z.infer<typeof ConsentCheckRequestSchema>;
export type ConsentCheckResponse = z.infer<typeof ConsentCheckResponseSchema>;
export type ConsentSaveRequest = z.infer<typeof ConsentSaveRequestSchema>;
