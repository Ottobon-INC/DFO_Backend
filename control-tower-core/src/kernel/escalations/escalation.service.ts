import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ChatDecrypterService } from '../../domains/janmasethu/chat-decrypter.service';

@Injectable()
export class EscalationService {
    private readonly logger = new Logger(EscalationService.name);

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
    ) {}

    async getDoctorEscalations(doctorId: string, clinicId?: string) {
        let query = this.supabase
            .from('sakhi_escalations')
            .select('*')
            .eq('status', 'PENDING');

        if (doctorId && doctorId !== 'all') {
            query = query.eq('doctor_id', doctorId);
        }

        if (clinicId && clinicId !== 'all') {
            query = query.eq('clinic_id', clinicId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Error fetching escalations: ${error.message}`, error.details);
            return [];
        }

        // If no escalations directly assigned to this doctor, show all pending escalations in clinic
        if ((!data || data.length === 0) && doctorId && doctorId !== 'all') {
            const { data: fallbackData } = await this.supabase
                .from('sakhi_escalations')
                .select('*')
                .eq('status', 'PENDING')
                .order('created_at', { ascending: false });
            return fallbackData || [];
        }

        return data || [];
    }

    async updateEscalationStatus(id: string, status: string) {
        const { data, error } = await this.supabase
            .from('sakhi_escalations')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select();

        if (error) {
            this.logger.error(`Error updating escalation: ${error.message}`, error.details);
            throw new Error('Failed to update escalation');
        }

        return data ? data[0] : null;
    }

    async getEscalationMessages(id: string) {
        // 1. Get the escalation to find the user_id
        const { data: escalation, error: escalationError } = await this.supabase
            .from('sakhi_escalations')
            .select('user_id, patient_id, conversation_context')
            .eq('id', id)
            .single();

        if (escalationError || !escalation) {
            this.logger.error(`Error fetching escalation ${id}:`, escalationError);
            throw new Error('Failed to find escalation');
        }

        const userId = escalation.user_id;
        if (!userId) {
            // Fallback: If conversation_context has embedded messages, return them
            if (Array.isArray(escalation.conversation_context)) {
                return escalation.conversation_context.map((m: any, idx: number) => ({
                    id: `ctx-${idx}`,
                    role: m.role || 'user',
                    content: m.content || '',
                    created_at: new Date().toISOString()
                }));
            }
            return []; // No user ID to fetch messages for
        }

        // 2. Fetch the last 50 encrypted messages for this user
        const { data: messages, error: messagesError } = await this.supabase
            .from('sakhi_encrypted_chats')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (messagesError) {
            this.logger.error(`Error fetching messages for user ${userId}:`, messagesError);
            throw new Error('Failed to fetch messages');
        }

        // 3. Decrypt messages and order chronologically
        const chatDecrypter = new ChatDecrypterService();
        const decryptedMessages = (messages || []).map(m => {
            const content = chatDecrypter.decrypt(userId, m.message_content || '');
            return {
                id: m.id,
                role: m.role || m.sender_type || (m.is_bot ? 'assistant' : 'user'),
                content: content,
                created_at: m.created_at
            };
        }).reverse();

        return decryptedMessages;
    }
}
