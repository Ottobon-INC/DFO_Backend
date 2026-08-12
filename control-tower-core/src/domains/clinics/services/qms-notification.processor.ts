import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClinicsSupabaseService } from './clinics-supabase.service';

@Injectable()
export class QmsNotificationProcessor {
    private readonly logger = new Logger(QmsNotificationProcessor.name);
    private isProcessing = false;

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    @Cron(CronExpression.EVERY_10_SECONDS)
    async processOutbox() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        const supabase = this.supabaseService.getClient();

        try {
            // 1. Mark expired notifications
            await supabase
                .from('qms_notifications_outbox')
                .update({ status: 'EXPIRED' })
                .eq('status', 'PENDING')
                .lt('expires_at', new Date().toISOString());

            // 2. Fetch up to 50 pending notifications (Rate Limit) ordered by priority
            // In a multi-instance env, use RPC with FOR UPDATE SKIP LOCKED
            const { data: messages, error } = await supabase
                .from('qms_notifications_outbox')
                .select('*')
                .eq('status', 'PENDING')
                .lte('next_attempt_at', new Date().toISOString())
                .order('priority', { ascending: true })
                .order('created_at', { ascending: true })
                .limit(50);

            if (error || !messages || messages.length === 0) {
                this.isProcessing = false;
                return;
            }

            this.logger.log(`Processing ${messages.length} notifications from outbox...`);

            for (const msg of messages) {
                try {
                    // Simulate WhatsApp/SMS API Call
                    this.logger.debug(`[WHATSAPP API] Sending to ${msg.recipient_mobile}: ${msg.message_payload}`);
                    
                    // On Success:
                    await supabase
                        .from('qms_notifications_outbox')
                        .update({ status: 'DELIVERED', attempts: msg.attempts + 1 })
                        .eq('id', msg.id);

                } catch (apiError) {
                    // Exponential backoff
                    const newAttempts = msg.attempts + 1;
                    const status = newAttempts >= 3 ? 'FAILED' : 'PENDING';
                    
                    const nextAttempt = new Date();
                    nextAttempt.setMinutes(nextAttempt.getMinutes() + (newAttempts * 2)); // 2m, 4m, 6m

                    await supabase
                        .from('qms_notifications_outbox')
                        .update({ 
                            status, 
                            attempts: newAttempts, 
                            next_attempt_at: nextAttempt.toISOString(),
                            last_error: apiError.message
                        })
                        .eq('id', msg.id);
                }
            }

        } catch (e) {
            this.logger.error(`Error processing outbox: ${e.message}`);
        } finally {
            this.isProcessing = false;
        }
    }
}
