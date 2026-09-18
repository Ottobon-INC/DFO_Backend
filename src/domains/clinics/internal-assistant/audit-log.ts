import { SupabaseClient } from '@supabase/supabase-js';

interface AuditParams {
    userId: string;
    role: string;
    action: string;
    targetId?: string;
    details?: any;
}

export class AuditLogger {
    static async log(supabase: SupabaseClient, params: AuditParams) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            ...params,
            timestamp
        };

        // 1. Console Log
        console.log('[AUDIT_LOG]', JSON.stringify(logEntry));

        // 2. DB Log
        try {
            await supabase.from('sakhi_audit_logs').insert({
                actor_id: params.userId,
                action: params.action,
                entity_name: 'sakhi_clinic_appointments',
                entity_id: params.targetId,
                new_values: params.details || {}
            });
        } catch (err) {
            console.error('Failed to write audit log to database:', err);
        }
    }
}
