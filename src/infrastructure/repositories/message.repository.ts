import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Message } from '../../types';
import axios from 'axios';

@Injectable()
export class MessageRepository {
    private readonly logger = new Logger(MessageRepository.name);

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
        // First try personalSupabase conversation_messages
        try {
            const { data: created, error } = await this.personalSupabase
                .from('conversation_messages')
                .insert([{
                    thread_id: data.thread_id,
                    sender_id: data.sender_id,
                    sender_type: data.sender_type,
                    content: data.content,
                    created_at: new Date(),
                }])
                .select()
                .single();

            if (!error && created) {
                return {
                    id: String(created.id),
                    thread_id: created.thread_id,
                    sender_id: created.sender_id,
                    sender_type: created.sender_type,
                    content: created.content,
                    created_at: new Date(created.created_at),
                };
            }
        } catch (e) {
            this.logger.warn(`Failed to insert into conversation_messages: ${e}`);
        }

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
        // 1. Check personalSupabase conversation_messages
        try {
            const { data: supaMsgs, error: supaErr } = await this.personalSupabase
                .from('conversation_messages')
                .select('*')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true });

            if (!supaErr && supaMsgs && supaMsgs.length > 0) {
                return supaMsgs.map((r: any) => ({
                    id: String(r.id),
                    thread_id: r.thread_id || threadId,
                    sender_id: r.sender_id || r.sender || 'USER',
                    sender_type: (r.sender_type || (r.sender === 'AI' || r.sender === 'BOT' ? 'AI' : (r.sender === 'DOCTOR' || r.sender === 'STAFF' || r.sender === 'HUMAN' ? 'HUMAN' : 'USER'))),
                    content: r.content || r.message || '',
                    created_at: new Date(r.created_at || Date.now()),
                }));
            }
        } catch (e) {
            this.logger.warn(`Supabase conversation_messages query error: ${e}`);
        }

        // 2. Fetch live WhatsApp messages from Hospital Backend (hospital.db)
        try {
            const resp = await axios.get(`http://127.0.0.1:8080/api/escalations/${threadId}/messages`, { timeout: 3000 });
            const list = resp.data?.data || resp.data;
            if (Array.isArray(list) && list.length > 0) {
                return list.map((item: any, idx: number) => {
                    const isUser = (item.role === 'patient' || (item.sender_type || '').toUpperCase() === 'USER');
                    const isBot = (item.role === 'triage_alert' || (item.sender_type || '').toUpperCase() === 'AI');
                    return {
                        id: String(item.id || `wa-${idx}`),
                        thread_id: threadId,
                        sender_id: isUser ? 'USER' : (isBot ? 'AI' : 'HUMAN'),
                        sender_type: isUser ? 'USER' : (isBot ? 'AI' : 'HUMAN'),
                        content: item.content || item.text || item.message || '',
                        created_at: new Date(item.created_at || item.timestamp || Date.now()),
                    };
                });
            }
        } catch (e) {
            // Local hospital backend may not have this specific thread
        }

        // 3. Fallback to orgSupabase sakhi_conversations_new
        try {
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
            if (!error && data && data.length > 0) {
                return data.map((row: any) => this.mapSakhiToMessage(row));
            }
        } catch (e) {
            this.logger.warn(`Fallback sakhi_conversations_new error: ${e}`);
        }

        return [];
    }
}
