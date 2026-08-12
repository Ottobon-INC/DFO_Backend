import { Injectable, Logger } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    async getDoctorPerformance(tenantId: string, doctorId: string, startDate: string, endDate: string) {
        const supabase = this.supabaseService.getClient();

        // 1. Total Patients Served
        const { count: patientsServed } = await supabase
            .from('sakhi_clinic_appointments')
            .select('id', { count: 'exact' })
            .eq('clinic_id', tenantId)
            .eq('doctor_id', doctorId)
            .eq('queue_status', 'COMPLETED')
            .gte('appointment_date', startDate + 'T00:00:00Z')
            .lte('appointment_date', endDate + 'T23:59:59Z');

        // 2. Average Consultation Time (Approximation via audit logs)
        const { data: appointments } = await supabase
            .from('sakhi_clinic_appointments')
            .select('id')
            .eq('clinic_id', tenantId)
            .eq('doctor_id', doctorId)
            .eq('queue_status', 'COMPLETED')
            .gte('appointment_date', startDate + 'T00:00:00Z')
            .lte('appointment_date', endDate + 'T23:59:59Z');

        let totalConsultationMins = 0;
        let validConsultations = 0;

        if (appointments && appointments.length > 0) {
            const apptIds = appointments.map(a => a.id);
            const { data: logs } = await supabase
                .from('qms_audit_logs')
                .select('appointment_id, new_status, created_at')
                .in('appointment_id', apptIds)
                .in('new_status', ['CALLED', 'IN_CONSULTATION', 'COMPLETED'])
                .order('created_at', { ascending: true });

            if (logs) {
                const logMap = {};
                logs.forEach(log => {
                    if (!logMap[log.appointment_id]) logMap[log.appointment_id] = [];
                    logMap[log.appointment_id].push(log);
                });

                for (const apptId of apptIds) {
                    const ptLogs = logMap[apptId] || [];
                    const startLog = ptLogs.find(l => l.new_status === 'CALLED' || l.new_status === 'IN_CONSULTATION');
                    const endLog = ptLogs.find(l => l.new_status === 'COMPLETED');

                    if (startLog && endLog) {
                        const start = new Date(startLog.created_at).getTime();
                        const end = new Date(endLog.created_at).getTime();
                        totalConsultationMins += (end - start) / 60000;
                        validConsultations++;
                    }
                }
            }
        }

        const avgConsultationMins = validConsultations > 0 ? (totalConsultationMins / validConsultations) : 0;

        return {
            doctor_id: doctorId,
            patients_served: patientsServed || 0,
            avg_consultation_time_mins: Math.round(avgConsultationMins)
        };
    }

    async getClinicThroughput(tenantId: string, startDate: string, endDate: string) {
        const supabase = this.supabaseService.getClient();

        const { data: appointments, error } = await supabase
            .from('sakhi_clinic_appointments')
            .select('id, queue_status, source, appointment_time')
            .eq('clinic_id', tenantId)
            .gte('appointment_date', startDate + 'T00:00:00Z')
            .lte('appointment_date', endDate + 'T23:59:59Z');

        if (error) throw error;

        const total = appointments.length;
        let noShows = 0;
        let walkIns = 0;
        let whatsapp = 0;
        const hoursDistribution = {};

        appointments.forEach(a => {
            if (a.queue_status === 'NO_SHOW' || a.queue_status === 'SKIPPED') noShows++;
            if (a.source === 'WALK_IN') walkIns++;
            if (a.source === 'WHATSAPP') whatsapp++;
            
            const hour = a.appointment_time?.split(':')[0];
            if (hour) {
                hoursDistribution[hour] = (hoursDistribution[hour] || 0) + 1;
            }
        });

        const peakHour = Object.keys(hoursDistribution).reduce((a: string | null, b: string) => (a === null || hoursDistribution[a] < hoursDistribution[b]) ? b : a, null as string | null);

        return {
            total_appointments: total,
            no_show_rate: total > 0 ? ((noShows / total) * 100).toFixed(2) + '%' : '0%',
            walk_in_ratio: total > 0 ? ((walkIns / total) * 100).toFixed(2) + '%' : '0%',
            whatsapp_ratio: total > 0 ? ((whatsapp / total) * 100).toFixed(2) + '%' : '0%',
            peak_hour: peakHour ? `${peakHour}:00` : 'N/A'
        };
    }

    async generateExport(tenantId: string, startDate: string, endDate: string): Promise<string> {
        const supabase = this.supabaseService.getClient();
        
        const { data, error } = await supabase
            .from('sakhi_clinic_appointments')
            .select('token_number, appointment_date, appointment_time, queue_status, source, doctor_id')
            .eq('clinic_id', tenantId)
            .gte('appointment_date', startDate + 'T00:00:00Z')
            .lte('appointment_date', endDate + 'T23:59:59Z')
            .order('appointment_date', { ascending: true })
            .order('appointment_time', { ascending: true });

        if (error) throw error;

        let csv = 'Token,Date,Time,Status,Source,DoctorID\\n';
        data.forEach(row => {
            csv += `${row.token_number},${row.appointment_date},${row.appointment_time},${row.queue_status},${row.source},${row.doctor_id}\n`;
        });
        
        return csv;
    }
}
