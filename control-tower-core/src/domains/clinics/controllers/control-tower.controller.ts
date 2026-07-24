import { Controller, Get, Query, UseGuards, Req, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { TenantContext } from '../../../infrastructure/context/tenant.context';

@Controller('api/control-tower')
@UseGuards(ClinicsAuthGuard)
export class ControlTowerController {
    private readonly logger = new Logger(ControlTowerController.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    @Get('live-queue')
    async getLiveQueue(@Query('date') dateQuery?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const targetDate = dateQuery || new Date().toISOString().split('T')[0];
        try {
            const { data: appointments, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('id, status, updated_at, arrived_at, checked_in_at, created_at, patient_name_snapshot, doctor_name_snapshot, sakhi_clinic_patients (name)')
                .eq('clinic_id', clinic_id)
                .eq('appointment_date', targetDate)
                .in('status', ['Arrived', 'Checked-In']);
            if (error) throw error;
            const now = new Date();
            const liveQueue: any[] = [];
            (appointments || []).forEach((appt: any) => {
                const statusTime = new Date(appt.checked_in_at || appt.arrived_at || appt.created_at || new Date());
                const waitingMinutes = Math.floor((now.getTime() - statusTime.getTime()) / 60000);
                liveQueue.push({ patientName: appt.patient_name_snapshot || appt.sakhi_clinic_patients?.name || 'Unknown', doctorName: appt.doctor_name_snapshot || 'Unassigned', status: appt.status, waitingMinutes });
            });
            liveQueue.sort((a, b) => b.waitingMinutes - a.waitingMinutes);
            return liveQueue;
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('GET /api/control-tower/live-queue', error);
            throw new HttpException({ error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('lead-summary')
    async getLeadSummary(@Query('date') dateQuery?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const targetDate = dateQuery || new Date().toISOString().split('T')[0];
        try {
            const { data: leads, error } = await supabase
                .from('sakhi_clinic_leads')
                .select('status')
                .eq('clinic_id', clinic_id)
                .gte('date_added', targetDate);
            if (error) throw error;
            const counts = (leads || []).reduce<Record<string, number>>((acc, curr) => { const s = curr.status || 'New'; acc[s] = (acc[s] || 0) + 1; return acc; }, {});
            const sumMatches = (patterns: string[]) => { let sum = 0; Object.keys(counts).forEach(key => { if (patterns.some(p => key.toLowerCase().includes(p))) sum += counts[key]; }); return sum; };
            return { new: sumMatches(['new', 'inquiry', 'open']), contacted: sumMatches(['contacted', 'follow', 'visit']), stalling: sumMatches(['stalling', 'pending', 'hold']), converted: sumMatches(['converted', 'won', 'booked']) };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('GET /api/control-tower/lead-summary', error);
            throw new HttpException({ error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('waiting-alerts')
    async getWaitingAlerts(@Query('date') dateQuery?: string, @Query('threshold') thresholdQuery?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const targetDate = dateQuery || new Date().toISOString().split('T')[0];
        const thresholdMinutes = thresholdQuery ? parseInt(thresholdQuery, 10) : 30;
        try {
            const { data: appointments, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('id, status, updated_at, arrived_at, checked_in_at, created_at, patient_name_snapshot, doctor_name_snapshot, sakhi_clinic_patients (name)')
                .eq('clinic_id', clinic_id)
                .eq('appointment_date', targetDate)
                .in('status', ['Arrived', 'Checked-In']);
            if (error) throw error;
            const now = new Date();
            const waitingPatients: any[] = [];
            (appointments || []).forEach((appt: any) => {
                const statusTime = new Date(appt.checked_in_at || appt.arrived_at || appt.updated_at);
                const waitingMinutes = Math.floor((now.getTime() - statusTime.getTime()) / 60000);
                if (waitingMinutes > thresholdMinutes) {
                    waitingPatients.push({ patientName: appt.patient_name_snapshot || appt.sakhi_clinic_patients?.name || 'Unknown', doctorName: appt.doctor_name_snapshot || 'Unassigned', status: appt.status, waitingMinutes });
                }
            });
            return { thresholdMinutes, count: waitingPatients.length, patients: waitingPatients };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('GET /api/control-tower/waiting-alerts', error);
            throw new HttpException({ error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('patient-flow-summary')
    async getPatientFlowSummary(@Query('date') dateQuery?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const targetDate = dateQuery || new Date().toISOString().split('T')[0];
        try {
            const { data: appointments, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('status')
                .eq('clinic_id', clinic_id)
                .eq('appointment_date', targetDate);
            if (error) throw error;
            const counts = (appointments || []).reduce<Record<string, number>>((acc, curr) => { const s = curr.status || 'Scheduled'; acc[s] = (acc[s] || 0) + 1; return acc; }, {});
            return {
                scheduled: (counts['Scheduled'] || 0) + (counts['Rescheduled'] || 0),
                arrived: counts['Arrived'] || 0,
                checkedIn: counts['Checked In'] || counts['Checked-In'] || 0,
                completed: counts['Completed'] || 0,
                cancelled: counts['Cancelled'] || 0,
                noShow: counts['No Show'] || 0,
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('GET /api/control-tower/patient-flow-summary', error);
            throw new HttpException({ error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('doctor-utilization')
    async getDoctorUtilization(@Query('date') dateQuery?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const targetDate = dateQuery || new Date().toISOString().split('T')[0];
        try {
            const { data: appointments, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('id, status, doctor_id, doctor_name_snapshot')
                .eq('clinic_id', clinic_id)
                .eq('appointment_date', targetDate);
            if (error) throw error;
            const statsByDoctor: Record<string, { total: number; completed: number; pending: number; name: string }> = {};
            (appointments || []).forEach((appt: any) => {
                const doctorName = appt.doctor_name_snapshot || 'Unassigned';
                const key = appt.doctor_id || 'unassigned';
                if (!statsByDoctor[key]) statsByDoctor[key] = { total: 0, completed: 0, pending: 0, name: doctorName };
                if (statsByDoctor[key].name === 'Unassigned' && doctorName !== 'Unassigned') statsByDoctor[key].name = doctorName;
                statsByDoctor[key].total += 1;
                if (appt.status === 'Completed') statsByDoctor[key].completed += 1;
                else statsByDoctor[key].pending += 1;
            });
            return Object.values(statsByDoctor).map(stat => ({ doctorName: stat.name, totalAppointments: stat.total, completed: stat.completed, pending: stat.pending }));
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('GET /api/control-tower/doctor-utilization', error);
            throw new HttpException({ error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
