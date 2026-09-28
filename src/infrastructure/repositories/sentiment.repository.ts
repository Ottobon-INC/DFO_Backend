import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SentimentEvaluation } from '../../types';

@Injectable()
export class SentimentRepository {
    constructor(@Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient) { }

    async create(data: Omit<SentimentEvaluation, 'id' | 'created_at'>): Promise<SentimentEvaluation> {
        const { data: created, error } = await this.supabase
            .from('sentiment_evaluations')
            .insert([{
                thread_id: data.thread_id,
                message_id: data.message_id,
                score: data.score,
                label: data.label,
                tags: data.tags,
                provider: data.provider,
                created_at: new Date(),
            }])
            .select()
            .single();

        if (error) throw error;
        return created;
    }
}
