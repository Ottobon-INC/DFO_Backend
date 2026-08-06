import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Message } from '../../types';

@Injectable()
export class MessageRepository {
    constructor(
        @Inject('SUPABASE_CLIENT') private readonly personalSupabase: SupabaseClient,
        @Inject('ORG_SUPABASE_CLIENT') private readonly orgSupabase: SupabaseClient
    ) { }

    private mapSakhiToMessage(row: any): Message {
        return {
            id: String(row.id),
            thread_id: row.chat_id || '',
            sender_id: row.user_id || '',
            sender_type: row.message_type === 'user' ? 'USER' : (row.message_type === 'sakhi' ? 'AI' : 'HUMAN'),
            content: row.message_text || '',
            created_at: new Date(row.created_at),
        };
    }

    async create(data: Omit<Message, 'id' | 'created_at'>): Promise<Message> {
        const { data: created, error } = await this.orgSupabase
            .from('sakhi_conversations_new')
            .insert([{
                chat_id: data.thread_id,
                user_id: data.sender_id,
                message_text: data.content,
                message_type: data.sender_type?.toLowerCase() || 'user',
                created_at: new Date(),
            }])
            .select()
            .single();

        if (error) throw error;
        return this.mapSakhiToMessage(created);
    }

    async findByThread(threadId: string): Promise<Message[]> {
        const { data: thread } = await this.personalSupabase
            .from('conversation_threads')
            .select('user_id')
            .eq('id', threadId)
            .maybeSingle();

        let query = this.orgSupabase
            .from('sakhi_conversations_new')
            .select('*');

        if (thread && thread.user_id) {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thread.user_id);
            if (isUuid) {
                query = query.eq('user_id', thread.user_id);
            } else {
                // If it is a phone number (not a UUID), resolve the user's UUID from sakhi_clinic_users
                const { data: userLink } = await this.orgSupabase
                    .from('sakhi_clinic_users')
                    .select('id')
                    .eq('mobile', thread.user_id)
                    .maybeSingle();

                if (userLink && userLink.id) {
                    query = query.eq('user_id', userLink.id);
                } else {
                    query = query.eq('chat_id', threadId);
                }
            }
        } else {
            query = query.eq('chat_id', threadId);
        }

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) throw error;
        return (data || []).map(row => this.mapSakhiToMessage(row));
    }
}
