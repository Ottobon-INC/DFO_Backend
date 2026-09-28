import { Injectable, Inject, Logger, Global, Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    ) { }

    async log(actorId: string, action: string, resourceType: string, resourceId: string, details: string): Promise<void> {
        const dbLog = {
            actor_id: actorId,
            event_type: action,
            resource_type: resourceType,
            resource_id: resourceId,
            payload: { details },
            created_at: new Date(),
        };

        const { error } = await this.supabase
            .from('sakhi_audit_logs')
            .insert([dbLog]);

        if (error) {
            this.logger.error('Failed to append audit log:', error.message);
        }
    }
}

@Global()
@Module({
    providers: [AuditService],
    exports: [AuditService],
})
export class InfrastructureAuditModule { }
