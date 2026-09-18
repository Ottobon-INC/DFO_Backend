import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuditLog } from '../../types';

@Injectable()
export class AuditService {
    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    ) { }

    async append(log: Omit<AuditLog, 'id' | 'created_at'>): Promise<void> {
        // --- ULTIMATE SCHEAMA COMPATIBILITY ---
        // Move all possible missing columns into the verified 'payload' JSON
        const dbLog = {
            thread_id: log.thread_id,
            event_type: log.event_type || (log as any).action || 'SYSTEM_EVENT',
            payload: {
                ...log.payload,
                actor_id: log.actor_id,
                actor_type: log.actor_type,
            },
            created_at: new Date(),
        };

        const { error } = await this.supabase
            .from('sakhi_audit_logs')
            .insert([dbLog]);

        if (error) {
            console.error('Failed to append audit log:', error);
        }
    }

    async getAll(): Promise<AuditLog[]> {
        const { data, error } = await this.supabase
            .from('sakhi_audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        return data || [];
    }
}
