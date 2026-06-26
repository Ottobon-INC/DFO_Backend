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
        const role = TenantContext.getRole();
        
        if (!clinic_id) {
            throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);
        }
        if (role !== 'Admin') {
            throw new HttpException({ success: false, error: 'Forbidden. Admin access required.' }, HttpStatus.FORBIDDEN);
        }

        try {
            const supabase = this.supabaseService.getClient();

            // 1. Get all user IDs for this clinic, and their roles
            const { data: allUsers, error: usersError } = await supabase
                .from('sakhi_clinic_users')
                .select('id, name, email')
                .eq('clinic_id', clinic_id);

            const { data: staffRoles } = await supabase
                .from('clinic_staff')
                .select('user_id, role')
                .eq('clinic_id', clinic_id);

            if (usersError) throw new Error('Failed to fetch clinic users');

            const allUserIds = allUsers.map(u => u.id);
            if (allUserIds.length === 0) {
                return { success: true, data: [], totalCount: 0 };
            }

            // 2. Build logs query with pagination and exact count
            let logsQuery = supabase
                .from('sakhi_audit_logs')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            // 3. Apply basic filters
            if (action) logsQuery = logsQuery.eq('action', action);
            if (target_table) logsQuery = logsQuery.eq('entity_name', target_table);
            if (start_date) logsQuery = logsQuery.gte('created_at', start_date);
            if (end_date) logsQuery = logsQuery.lte('created_at', end_date);

            // 4. Apply search & security isolation
            logsQuery = logsQuery.in('actor_id', allUserIds); // Strict Tenant Isolation

            if (search) {
                const searchLower = search.toLowerCase();
                const matchingUserIds = allUsers
                    .filter(u => u.name?.toLowerCase().includes(searchLower) || u.email?.toLowerCase().includes(searchLower))
                    .map(u => u.id);
                
                const orConditions: string[] = [];
                if (matchingUserIds.length > 0) {
                    orConditions.push(`actor_id.in.(${matchingUserIds.join(',')})`);
                }
                orConditions.push(`entity_name.ilike.%${search}%`);
                
                logsQuery = logsQuery.or(orConditions.join(','));
            }

            const { data: logs, error: logsError, count } = await logsQuery;

            if (logsError) throw new Error('Failed to fetch audit logs');

            // 5. Map actor names and roles to logs for the UI
            const roleMap = new Map(staffRoles?.map(s => [s.user_id, s.role]));
            const userMap = new Map(allUsers.map(u => [
                u.id, 
                { name: u.name, role: roleMap.get(u.id) || 'Staff' }
            ]));

            const enrichedLogs = logs.map(log => {
                const actor = userMap.get(log.actor_id);
                return {
                    ...log,
                    actor_name: actor?.name || 'Unknown User',
                    actor_role: actor?.role || 'System'
                };
            });

            return {
                success: true,
                data: enrichedLogs,
                totalCount: count || 0
            };

        } catch (error: any) {
            this.logger.error(`GET /api/v1/clinics/audit-logs failed:`, error);
            throw new HttpException(
                { success: false, error: error?.message || 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
