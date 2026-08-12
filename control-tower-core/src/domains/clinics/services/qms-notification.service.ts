import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ClinicsSupabaseService } from './clinics-supabase.service';

@Injectable()
export class QmsNotificationService {
    private readonly logger = new Logger(QmsNotificationService.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    // Evaluate quiet hours: returns a delayed timestamp if within quiet hours
    private calculateNextAttempt(quietHours: any, priority: number): string {
        const now = new Date();
        if (priority <= 2) return now.toISOString(); // Emergency/High bypasses quiet hours

        if (quietHours && quietHours.start && quietHours.end) {
            const currentHour = now.getHours();
            const start = parseInt(quietHours.start.split(':')[0], 10);
            const end = parseInt(quietHours.end.split(':')[0], 10);

            // Simple hour-based quiet check
            if (currentHour >= start || currentHour < end) {
                // Delay until 'end' time
                const nextAttempt = new Date();
                if (currentHour >= start) {
                    nextAttempt.setDate(nextAttempt.getDate() + 1); // Next day
                }
                nextAttempt.setHours(end, 0, 0, 0);
                return nextAttempt.toISOString();
            }
        }
        return now.toISOString();
    }

    private getExpiry(minutes: number): string {
        const date = new Date();
        date.setMinutes(date.getMinutes() + minutes);
        return date.toISOString();
    }

    @OnEvent('queue.recalculated')
    async handleQueueRecalculated(payload: { tenantId: string, doctorId: string, appointmentId: string, active_queue: any[] }) {
        this.logger.log(`Evaluating notifications for queue recalculation`);
        
        const supabase = this.supabaseService.getClient();
        
        const { data: config } = await supabase
            .from('tenant_configs')
            .select('notification_templates, quiet_hours, almost_turn_threshold')
            .eq('tenant_id', payload.tenantId)
            .single();
            
        if (!config || !config.notification_templates) return;

        const threshold = config.almost_turn_threshold || 2;

        for (const pt of payload.active_queue) {
            // Business Rule: Almost Your Turn
            if (pt.queue_position === threshold && pt.queue_status === 'WAITING') {
                
                // 1. Deduplication Rule
                const { data: existing } = await supabase
                    .from('qms_notifications_outbox')
                    .select('id')
                    .eq('appointment_id', pt.appointment_id)
                    .eq('notification_type', 'ALMOST_TURN')
                    .single();

                if (!existing) {
                    // Fetch patient mobile
                    const { data: ptData } = await supabase
                        .from('sakhi_clinic_appointments')
                        .select('patient:sakhi_clinic_patients(mobile, name)')
                        .eq('id', pt.appointment_id)
                        .single();

                    if (ptData && ptData.patient) {
                        const template = config.notification_templates.almost_turn || "It is almost your turn (Token: {{token}})";
                        const message = template.replace('{{token}}', pt.token_number);

                        // 2. Insert into Outbox (Queueing)
                        await supabase.from('qms_notifications_outbox').insert({
                            tenant_id: payload.tenantId,
                            appointment_id: pt.appointment_id,
                            recipient_mobile: Array.isArray(ptData.patient) ? (ptData.patient[0] as any)?.mobile : (ptData.patient as any).mobile,
                            notification_type: 'ALMOST_TURN',
                            priority: 2, // HIGH
                            message_payload: message,
                            expires_at: this.getExpiry(60), // Expires in 1 hour if not delivered
                            next_attempt_at: this.calculateNextAttempt(config.quiet_hours, 2)
                        });
                        
                        this.logger.log(`Inserted ALMOST_TURN notification for ${pt.appointment_id} into outbox.`);
                    }
                }
            }
        }
    }
}
