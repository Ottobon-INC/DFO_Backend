import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Thread } from '../../types';
import { ConcurrencyException } from '../exceptions';

@Injectable()
export class ThreadRepository {
    private readonly logger = new Logger(ThreadRepository.name);

    constructor(@Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient) { }

    async findById(id: string): Promise<Thread | null> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) return null;
        return data;
    }

    /**
     * Enforced atomic update with version check.
     * EVERY update to conversation_threads must use: WHERE id = ? AND version = ?
     */
    async updateAtomic(id: string, version: number, updates: Partial<Thread>): Promise<Thread> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .update({
                ...updates,
                version: version + 1,
                updated_at: new Date(),
            })
            .eq('id', id)
            .eq('version', version)
            .select();

        if (error) {
            this.logger.error(`Database error during atomic update for thread ${id}: ${error.message}`);
            throw error;
        }

        if (!data || data.length === 0) {
            this.logger.warn(`Concurrency conflict detected for thread ${id}. Expected version: ${version}`);
            throw new ConcurrencyException();
        }

        return data[0];
    }

    async create(thread: Partial<Thread>): Promise<Thread> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .insert([thread])
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async findAll(): Promise<Thread[]> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return data || [];
    }

    async findByStatus(status: string): Promise<Thread[]> {
        let statusList = [status];
        if (status === 'red') statusList = ['red', 'DOCTOR_ASSIGNED'];
        else if (status === 'yellow') statusList = ['yellow', 'NURSE_ASSIGNED'];
        else if (status === 'green') statusList = ['green', 'AI_ACTIVE'];

        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .in('status', statusList)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return data || [];
    }
}
