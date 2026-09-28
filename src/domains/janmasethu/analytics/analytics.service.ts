import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export interface DashboardAnalytics {
    risk_distribution: Record<string, number>;
    sla_breach_rate: number;
    clinician_load: Array<{ doctor_id: string; doctor_name: string; active_threads: number }>;
    appointment_stats: { completed: number; no_show: number; fulfillment_rate: number };
    updated_at: Date;
}

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);
    private readonly CACHE_KEY = 'DFO_DASHBOARD_STATS';

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
    ) { }

    // ============================================================
    // 1. PUBLIC API — FAST CACHE-READ (0ms blocking)
    // ============================================================

    async getCachedDashboardStats(): Promise<DashboardAnalytics> {
        const { data, error } = await this.supabase
            .from('dfo_analytics_cache')
            .select('value, updated_at')
            .eq('key', this.CACHE_KEY)
            .maybeSingle();

        if (error || !data) {
            this.logger.warn('Analytics cache miss. Triggering fallback recalculation.');
            return this.recalculateAllMetrics(); // Fallback if cache is empty
        }

        return {
            ...data.value,
            updated_at: data.updated_at
        } as DashboardAnalytics;
    }

    // ============================================================
    // 2. BACKGROUND WORKER — HEAVY LIFTING (Scheduled)
    // ============================================================

    /**
     * Executes all heavy SQL aggregations, computes the final JSON,
     * and persists it to the analytics_cache table.
     */
    async recalculateAllMetrics(): Promise<DashboardAnalytics> {
        this.logger.log('📈 Starting full analytics re-computation...');

        try {
            const [risk, sla, load, apps] = await Promise.all([
                this.calculateRiskDistribution().catch(e => ({ RED: 0, YELLOW: 0, GREEN: 0 })),
                this.calculateSLABreachRate().catch(e => 0),
                this.calculateClinicianLoad().catch(e => []),
                this.calculateAppointmentStats().catch(e => ({ completed: 0, no_show: 0, fulfillment_rate: 0 }))
            ]);

            const dashboardData: DashboardAnalytics = {
                risk_distribution: risk,
                sla_breach_rate: sla,
                clinician_load: load,
                appointment_stats: apps,
                updated_at: new Date()
            };

            // Persist to cache (Upsert)
            const { error } = await this.supabase
                .from('dfo_analytics_cache')
                .upsert({
                    key: this.CACHE_KEY,
                    value: dashboardData,
                    updated_at: new Date()
                });

            if (error) throw error;

            this.logger.log('✅ Dashboard analytics successfully refreshed in cache.');
            return dashboardData;
        } catch (error) {
            this.logger.error(`❌ Analytics recalculation failed: ${error.message}`);
            return {
                risk_distribution: { RED: 0, YELLOW: 0, GREEN: 0 },
                sla_breach_rate: 0,
                clinician_load: [],
                appointment_stats: { completed: 0, no_show: 0, fulfillment_rate: 0 },
                updated_at: new Date()
            };
        }
    }

    // ============================================================
    // 3. CORE CALCULATION LOGIC
    // ============================================================

    private async calculateRiskDistribution(): Promise<Record<string, number>> {
        const { data } = await this.supabase
            .from('conversation_threads')
            .select('status') // Map: status is the risk level (red, yellow, green)
            .is('deleted_at', null);

        return (data || []).reduce((acc, t) => {
            const risk = (t.status || 'GREEN').toUpperCase();
            acc[risk] = (acc[risk] || 0) + 1;
            return acc;
        }, { RED: 0, YELLOW: 0, GREEN: 0 } as any);
    }

    private async calculateSLABreachRate(): Promise<number> {
        // Find audit logs for breaches and cancellations (successes)
        const { data: logs } = await this.supabase
            .from('audit_logs')
            .select('event_type')
            .in('event_type', ['SLA_BREACH', 'SLA_CANCELED']);

        const total = logs?.length || 0;
        if (total === 0) return 0.0;

        const breaches = logs?.filter(l => l.event_type === 'SLA_BREACH').length || 0;
        return Number(((breaches / total) * 100).toFixed(1));
    }

    private async calculateClinicianLoad() {
        const { data: threads } = await this.supabase
            .from('conversation_threads')
            .select('assigned_user_id')
            .eq('ownership', 'HUMAN')
            .not('assigned_user_id', 'is', null);

        const counts = (threads || []).reduce((acc, t) => {
            acc[t.assigned_user_id] = (acc[t.assigned_user_id] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        // Map IDs to Doctor Names (Join logic simplified for POC)
        const { data: doctors } = await this.supabase.from('dfo_doctors').select('id, full_name');

        return (doctors || []).map(doc => ({
            doctor_id: doc.id,
            doctor_name: doc.full_name,
            active_threads: counts[doc.id] || 0
        })).sort((a, b) => b.active_threads - a.active_threads);
    }

    private async calculateAppointmentStats() {
        const { data: appointments } = await this.supabase
            .from('dfo_appointments')
            .select('status');

        const counts = (appointments || []).reduce((acc, a) => {
            acc[a.status] = (acc[a.status] || 0) + 1;
            return acc;
        }, { completed: 0, no_show: 0 } as any);

        const total = (appointments || []).length;
        const fulfillmentRate = total > 0 ? (counts.completed / total) * 100 : 0;

        return {
            completed: counts.completed || 0,
            no_show: counts.no_show || 0,
            fulfillment_rate: Number(fulfillmentRate.toFixed(1))
        };
    }
}
