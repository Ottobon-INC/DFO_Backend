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

        // Note: The UI currently uses a dummy 'dr_sireesha' user ID which won't match a UUID.
        // We might want to allow it for demo purposes, or fallback to returning all.
        // If doctorId is provided, and it's not the default demo id, filter by it.
        // TEMPORARY: Removing this filter so all escalations show up regardless of doctor_id assignment
        // if (doctorId && doctorId !== 'dr_sireesha') {
        //     query = query.eq('doctor_id', doctorId);
        // }

        if (clinicId) {
            query = query.eq('clinic_id', clinicId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Error fetching escalations: ${error.message}`, error.details);
            // Fallback for demo if table doesn't exist
            if (error.code === '42P01') {
                return this.getDemoEscalations();
            }
            throw new Error('Failed to fetch escalations');
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
            .select('user_id, patient_id')
            .eq('id', id)
            .single();

        if (escalationError || !escalation) {
            this.logger.error(`Error fetching escalation ${id}:`, escalationError);
            throw new Error('Failed to find escalation');
        }

        const userId = escalation.user_id;
        if (!userId) {
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

    private getDemoEscalations() {
        return [
            {
                id: 'demo-1',
                patient_name: 'Sara Johnson',
                reason: 'Critical vital signs anomaly detected.',
                status: 'PENDING',
                created_at: new Date().toISOString(),
                risk_score: 95
            },
            {
                id: 'demo-2',
                patient_name: 'Priya Nair',
                reason: 'Missed high-risk medication dose.',
                status: 'PENDING',
                created_at: new Date(Date.now() - 3600000).toISOString(),
                risk_score: 82
            }
        ];
    }
}
