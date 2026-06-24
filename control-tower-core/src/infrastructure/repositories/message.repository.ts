import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Message } from '../../types';

@Injectable()
export class MessageRepository {
    constructor(@Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient) { }

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
        const { data: created, error } = await this.supabase
            .from('sakhi_conversations')
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
        const { data: thread } = await this.supabase
            .from('conversation_threads')
            .select('user_id')
            .eq('id', threadId)
            .maybeSingle();

        let query = this.supabase
            .from('sakhi_conversations')
            .select('*');

        if (thread && thread.user_id) {
            query = query.eq('user_id', thread.user_id);
        } else {
            query = query.eq('chat_id', threadId);
        }

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) throw error;
        return (data || []).map(row => this.mapSakhiToMessage(row));
    }
}
