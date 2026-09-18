import { Controller, Get, UseGuards, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { HierarchicalRolesGuard } from '../guards/hierarchical-roles.guard';
import { MinRoleTier } from '../../../infrastructure/security/role-tier.decorator';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { CONVERTED_STATUSES, LOST_STATUSES, NOT_INTERESTED_STATUSES, CRO_QUEUE_STATUS, FIRST_CONSULT_STATUSES, FOLLOW_UP_STATUSES, normalizeStatus } from '../helpers/leads.helpers';

@Controller('api/dashboard')
@UseGuards(ClinicsAuthGuard, HierarchicalRolesGuard)
@MinRoleTier(3) // Tier 3: Everyone can access the dashboard summary

export class DashboardController {
    private readonly logger = new Logger(DashboardController.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    @Get('summary')
    async getSummary() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data: todayAppointments, error: apptErr } = await supabase
                .from('sakhi_clinic_appointments')
                .select('*')
                .eq('clinic_id', clinic_id)
                .order('appointment_date', { ascending: true })
                .order('start_time', { ascending: true });
            if (apptErr) throw apptErr;

            const { data: recentLeads, error: leadsError } = await supabase
                .from('sakhi_clinic_leads')
                .select('*')
                .eq('clinic_id', clinic_id)
                .order('date_added', { ascending: false })
                .limit(5);
            if (leadsError) throw leadsError;

            const { data: leadStatuses, error: funnelError } = await supabase
                .from('sakhi_clinic_leads')
                .select('status')
                .eq('clinic_id', clinic_id);
            if (funnelError) throw funnelError;

            const funnelCounts = (leadStatuses || []).reduce<Record<string, number>>((acc, row) => {
                const key = row.status || 'Unknown';
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {});
            const leadFunnel = Object.entries(funnelCounts).map(([status, count]) => ({ status, count }));

            return { success: true, data: { todayAppointments, recentLeads, leadFunnel } };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('GET /api/dashboard/summary', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('cro')
    async getCro() {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ success: false, error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data: leads, error: leadsError } = await supabase
                .from('sakhi_clinic_leads')
                .select('id, status, date_added, created_at')
                .eq('clinic_id', clinic_id);
            if (leadsError) throw leadsError;
            const startOfMonth = new Date();
            startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0);
            const startOfMonthISO = startOfMonth.toISOString();
            
            // 1. Cohort Time-Window: Only look at leads generated this month
            const leadsInMonth = (leads ?? []).filter(l => { 
                const d = l.date_added || l.created_at; 
                return d ? new Date(d).toISOString() >= startOfMonthISO : false; 
            });

            // 2. Normalize and Map Statuses
            const normalizedLeads = leadsInMonth.map(l => ({
                ...l,
                normalizedStatus: normalizeStatus(l.status)
            }));

            const totalLeads = normalizedLeads.length;
            const convertedCount = normalizedLeads.filter(l => CONVERTED_STATUSES.includes(l.normalizedStatus)).length;
            const croQueue = normalizedLeads.filter(l => l.normalizedStatus === CRO_QUEUE_STATUS);
            const croQueueCount = croQueue.length;
            
            // 3. Include Not Interested in Churn Rate
            const lostCount = normalizedLeads.filter(l => 
                LOST_STATUSES.includes(l.normalizedStatus) || NOT_INTERESTED_STATUSES.includes(l.normalizedStatus)
            ).length;

            const conversionRate = totalLeads ? Number(((convertedCount / totalLeads) * 100).toFixed(2)) : 0;
            const croSuccessRate = croQueueCount ? Number(((convertedCount / croQueueCount) * 100).toFixed(2)) : 0;
            const churnRate = totalLeads ? Number(((lostCount / totalLeads) * 100).toFixed(2)) : 0;

            // Average time to convert
            let avgTimeToConvertDays = 0;
            const { data: patientLinks, error: patientLinksError } = await supabase
                .from('sakhi_clinic_patients')
                .select('lead_id, registration_date, created_at')
                .eq('clinic_id', clinic_id)
                .not('lead_id', 'is', null);
            if (patientLinksError) throw patientLinksError;

            const leadMap = new Map<string, any>();
            (leads ?? []).forEach(l => leadMap.set(l.id, l));
            const diffs: number[] = [];
            (patientLinks ?? []).forEach(p => {
                if (!p.lead_id) return;
                const lead = leadMap.get(p.lead_id);
                if (!lead?.date_added) return;
                const start = new Date(lead.date_added);
                const end = new Date(p.registration_date || p.created_at || start);
                const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                if (!Number.isNaN(diffDays) && diffDays >= 0) diffs.push(diffDays);
            });
            if (diffs.length) {
                avgTimeToConvertDays = diffs.reduce((a, b) => a + b, 0) / diffs.length;
                if (!Number.isFinite(avgTimeToConvertDays)) avgTimeToConvertDays = 0;
            }

            // Funnel (Cumulative Math)
            // Note: leadsInMonth is already cohort-filtered
            const strictConverted = convertedCount;
            const strictFollowUp = normalizedLeads.filter(l => FOLLOW_UP_STATUSES.includes(l.normalizedStatus)).length;
            const strictFirstConsult = normalizedLeads.filter(l => FIRST_CONSULT_STATUSES.includes(l.normalizedStatus)).length;

            const cumulativeConverted = strictConverted;
            const cumulativeFollowUp = strictFollowUp + cumulativeConverted;
            const cumulativeFirstConsult = strictFirstConsult + cumulativeFollowUp;

            const funnel = {
                newLeads: totalLeads,
                firstConsult: cumulativeFirstConsult,
                followUp: cumulativeFollowUp,
                converted: cumulativeConverted,
            };

            // Intervention queue
            const { data: queueDataRaw, error: queueError } = await supabase
                .from('sakhi_clinic_leads')
                .select('id, name, phone, status, date_added, created_at')
                .eq('clinic_id', clinic_id)
                .eq('status', CRO_QUEUE_STATUS)
                .order('date_added', { ascending: true });
            if (queueError) throw queueError;

            const now = Date.now();
            const queueData = queueDataRaw?.map(row => {
                const baseDate = row.date_added || row.created_at || new Date().toISOString();
                const stalledDays = Math.max(0, Math.floor((now - new Date(baseDate).getTime()) / (1000 * 60 * 60 * 24)));
                return { ...row, stalledDays, priority: 'High' };
            }) ?? [];

            return {
                success: true,
                data: {
                    kpis: { conversionRate, croSuccessRate, avgTimeToConvertDays, patientChurnRate: churnRate },
                    funnel,
                    interventionQueue: queueData,
                },
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('GET /api/dashboard/cro', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
