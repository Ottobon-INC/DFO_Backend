import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export enum RoutingStatus {
    WAITING = 'waiting',
    ASSIGNED = 'assigned',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

@Injectable()
export class RoutingRepository {
    private readonly logger = new Logger(RoutingRepository.name);

    constructor(@Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient) { }

    /**
     * Idempotent creation of routing entry.
     * If an active entry exists (waiting/assigned), returns it instead of creating new.
     */
    async createIdempotent(data: {
        thread_id: string;
        required_role: string;
        priority?: number;
    }): Promise<{ entry: any; isNew: boolean }> {
        const { data: existing } = await this.supabase
            .from('routing_queue')
            .select('*')
            .eq('thread_id', data.thread_id)
            .in('status', [RoutingStatus.WAITING, RoutingStatus.ASSIGNED])
            .limit(1);

        if (existing && existing.length > 0) {
            this.logger.log(`Active routing already exists for thread ${data.thread_id}`);
            return { entry: existing[0], isNew: false };
        }

        const { data: created, error } = await this.supabase
            .from('routing_queue')
            .insert([{
                thread_id: data.thread_id,
                required_role: data.required_role,
                priority: data.priority || 1,
                status: RoutingStatus.WAITING,
                created_at: new Date(),
            }])
            .select()
            .single();

        if (error) throw error;
        return { entry: created, isNew: true };
    }

    async updateStatus(id: string, status: RoutingStatus, error_reason?: string): Promise<void> {
        const { error } = await this.supabase
            .from('routing_queue')
            .update({
                status,
                error_reason,
                updated_at: new Date()
            })
            .eq('id', id);

        if (error) throw error;
    }

    async findStaleAssigned(timeoutMs: number): Promise<any[]> {
        const threshold = new Date(Date.now() - timeoutMs);
        const { data, error } = await this.supabase
            .from('routing_queue')
            .select('*')
            .eq('status', RoutingStatus.ASSIGNED)
            .lt('updated_at', threshold.toISOString());

        if (error) throw error;
        return data || [];
    }
}
