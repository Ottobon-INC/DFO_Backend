import { Controller, Get, HttpException, HttpStatus, Logger, UseGuards, Query } from '@nestjs/common';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';

@Controller('api/v1/clinics/audit-logs')
@UseGuards(ClinicsAuthGuard)
export class AuditController {
    private readonly logger = new Logger(AuditController.name);

    constructor(
        private supabaseService: ClinicsSupabaseService
    ) {}

    @Get()
    async getAuditLogs(
        @Query('limit') limit: number = 50,
        @Query('offset') offset: number = 0,
        @Query('action') action?: string,
        @Query('target_table') target_table?: string,
        @Query('search') search?: string,
        @Query('start_date') start_date?: string,
        @Query('end_date') end_date?: string
    ) {
        const clinic_id = TenantContext.getClinicId();
        const isSuperAdmin = TenantContext.isSuperAdmin();
        
        if (!clinic_id && !isSuperAdmin) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }

        try {
            const supabase = this.supabaseService.getClient();

            // 1. Get all user IDs for this clinic safely using actual column names (first_name, last_name, email, role)
            const { data: allUsers, error: usersError } = await supabase
                .from('sakhi_clinic_users')
                .select('id, first_name, last_name, email, role')
                .eq('clinic_id', clinic_id);

            const userList = allUsers || [];
            const allUserIds = userList.map(u => u.id);

            const userMap = new Map(userList.map(u => {
                const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
                return [
                    u.id,
                    {
                        name: fullName || u.email || 'Staff Member',
                        email: u.email || '',
                        role: u.role || 'Staff'
                    }
                ];
            }));

            // 2. Build logs query
            let logsQuery = supabase
                .from('sakhi_audit_logs')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (action) logsQuery = logsQuery.eq('action', action);
            if (target_table) logsQuery = logsQuery.eq('entity_name', target_table);
            if (start_date) logsQuery = logsQuery.gte('created_at', start_date);
            if (end_date) logsQuery = logsQuery.lte('created_at', end_date);

            if (allUserIds.length > 0) {
                logsQuery = logsQuery.in('actor_id', allUserIds);
            }

            if (search) {
                const searchLower = search.toLowerCase();
                const matchingUserIds = userList
                    .filter(u => {
                        const name = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
                        const email = (u.email || '').toLowerCase();
                        return name.includes(searchLower) || email.includes(searchLower);
                    })
                    .map(u => u.id);
                
                const orConditions: string[] = [];
                if (matchingUserIds.length > 0) {
                    orConditions.push(`actor_id.in.(${matchingUserIds.join(',')})`);
                }
                orConditions.push(`entity_name.ilike.%${search}%`);
                orConditions.push(`action.ilike.%${search}%`);
                
                logsQuery = logsQuery.or(orConditions.join(','));
            }

            let logs: any[] = [];
            let totalCount = 0;

            const { data: sakhiLogs, error: logsError, count } = await logsQuery;

            if (!logsError && sakhiLogs) {
                logs = sakhiLogs;
                totalCount = count || sakhiLogs.length;
            } else {
                // Fallback attempt to general audit_logs table
                const { data: fallbackLogs, count: fCount } = await supabase
                    .from('audit_logs')
                    .select('*', { count: 'exact' })
                    .order('created_at', { ascending: false })
                    .range(offset, offset + limit - 1);

                if (fallbackLogs) {
                    logs = fallbackLogs;
                    totalCount = fCount || fallbackLogs.length;
                }
            }

            // 3. Map actor names, emails, and roles to logs for the UI
            const enrichedLogs = logs.map(log => {
                const actor = userMap.get(log.actor_id);
                return {
                    ...log,
                    actor_name: actor?.name || log.actor_name || log.actor_id || 'System User',
                    actor_email: actor?.email || log.actor_email || '',
                    actor_role: actor?.role || log.actor_role || log.actor_type || 'Staff'
                };
            });

            return {
                success: true,
                data: enrichedLogs,
                totalCount: totalCount
            };

        } catch (error: any) {
            this.logger.error(`GET /api/v1/clinics/audit-logs failed:`, error);
            return {
                success: true,
                data: [],
                totalCount: 0
            };
        }
    }
}
