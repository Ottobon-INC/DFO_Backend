import { Controller, Get, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';

const CONVERTED_STATUSES = ['Converted Patient', 'Converted - Active Patient'];
const LOST_STATUSES = ['Lost', 'Inactive', 'Dropped'];
const CRO_QUEUE_STATUS = 'Stalling - Sent to CRO';

@Controller('api/dashboard')
export class DashboardController {
    private readonly logger = new Logger(DashboardController.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    @Get('summary')
    async getSummary() {
        const supabase = this.supabaseService.getClient();
        try {
            const { data: todayAppointments, error: apptErr } = await supabase
                .from('sakhi_clinic_appointments').select('*')
                .order('appointment_date', { ascending: true })
                .order('start_time', { ascending: true });
            if (apptErr) throw apptErr;

            const { data: recentLeads, error: leadsError } = await supabase
                .from('sakhi_clinic_leads').select('*')
                .order('date_added', { ascending: false }).limit(5);
            if (leadsError) throw leadsError;

            const { data: leadStatuses, error: funnelError } = await supabase
                .from('sakhi_clinic_leads').select('status');
            if (funnelError) throw funnelError;

            const funnelCounts = (leadStatuses || []).reduce<Record<string, number>>((acc, row) => {
                const key = row.status || 'Unknown';
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {});
            const leadFunnel = Object.entries(funnelCounts).map(([status, count]) => ({ status, count }));

            return { success: true, data: { todayAppointments, recentLeads, leadFunnel } };
        } catch (error: any) {
            this.logger.error('GET /api/dashboard/summary', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('cro')
    async getCro() {
        const supabase = this.supabaseService.getClient();
        try {
            const { data: leads, error: leadsError } = await supabase
                .from('sakhi_clinic_leads').select('id, status, date_added, created_at');
            if (leadsError) throw leadsError;

            const totalLeads = leads?.length ?? 0;
            const convertedCount = (leads ?? []).filter(l => CONVERTED_STATUSES.includes(l.status || '')).length;
            const croQueue = (leads ?? []).filter(l => (l.status || '') === CRO_QUEUE_STATUS);
            const croQueueCount = croQueue.length;
            const lostCount = (leads ?? []).filter(l => LOST_STATUSES.includes(l.status || '')).length;

            const conversionRate = totalLeads ? Number(((convertedCount / totalLeads) * 100).toFixed(2)) : 0;
            const croSuccessRate = croQueueCount ? Number(((convertedCount / croQueueCount) * 100).toFixed(2)) : 0;
            const churnRate = totalLeads ? Number(((lostCount / totalLeads) * 100).toFixed(2)) : 0;

            // Average time to convert
            let avgTimeToConvertDays = 0;
            const { data: patientLinks, error: patientLinksError } = await supabase
                .from('sakhi_clinic_patients').select('lead_id, registration_date, created_at').not('lead_id', 'is', null);
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

            // Funnel (month-to-date)
            const startOfMonth = new Date();
            startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0);
            const startOfMonthISO = startOfMonth.toISOString();
            const leadsInMonth = (leads ?? []).filter(l => { const d = l.date_added || l.created_at; return d ? new Date(d).toISOString() >= startOfMonthISO : false; });
            const funnel = {
                newLeads: leadsInMonth.length,
                firstConsult: leadsInMonth.filter(l => ['Consultation Done', 'Visited'].includes(l.status || '')).length,
                followUp: leadsInMonth.filter(l => ['Stalling - Sent to CRO', 'Follow Up'].includes(l.status || '')).length,
                converted: leadsInMonth.filter(l => ['Converted', 'Converted Patient', 'Converted - Active Patient'].includes(l.status || '')).length,
            };

            // Intervention queue
            const { data: queueDataRaw, error: queueError } = await supabase
                .from('sakhi_clinic_leads').select('id, name, phone, status, date_added, created_at')
                .eq('status', CRO_QUEUE_STATUS).order('date_added', { ascending: true });
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
            this.logger.error('GET /api/dashboard/cro', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
