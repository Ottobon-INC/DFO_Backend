import { Controller, Get, Query, UseGuards, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';

@Controller('api/control-tower')
@UseGuards(ClinicsAuthGuard)
export class ControlTowerController {
    private readonly logger = new Logger(ControlTowerController.name);

    constructor(private supabaseService: ClinicsSupabaseService) {}

    @Get('live-queue')
    async getLiveQueue(@Query('date') dateQuery?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        const targetDate = dateQuery || new Date().toISOString().split('T')[0];

        try {
            const { data: appointments, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('id, status, created_at, updated_at, patient_name_snapshot, doctor_name_snapshot, sakhi_clinic_patients (first_name, last_name)')
                .eq('clinic_id', clinic_id)
                .eq('appointment_date', targetDate)
                .in('status', ['Arrived', 'Checked-In', 'Checked In', 'In Consultation', 'Waiting']);

            if (error) {
                // If join fails, retry simple select
                const { data: simpleAppts, error: simpleError } = await supabase
                    .from('sakhi_clinic_appointments')
                    .select('id, status, created_at, updated_at, patient_name_snapshot, doctor_name_snapshot')
                    .eq('clinic_id', clinic_id)
                    .eq('appointment_date', targetDate)
                    .in('status', ['Arrived', 'Checked-In', 'Checked In', 'In Consultation', 'Waiting']);

                if (simpleError) throw simpleError;
                return this.mapLiveQueue(simpleAppts || []);
            }

            return this.mapLiveQueue(appointments || []);
        } catch (error: any) {
            this.logger.error('GET /api/control-tower/live-queue', error);
            return [];
        }
    }

    private mapLiveQueue(appointments: any[]) {
        const now = new Date();
        const liveQueue = appointments.map((appt: any) => {
            const patientObj = Array.isArray(appt.sakhi_clinic_patients) ? appt.sakhi_clinic_patients[0] : appt.sakhi_clinic_patients;
            const patientName = appt.patient_name_snapshot || (patientObj ? `${patientObj.first_name || ''} ${patientObj.last_name || ''}`.trim() : '') || 'Patient';
            const doctorName = (appt.doctor_name_snapshot || 'Doctor').replace(/^Dr\.\s*Dr\./i, 'Dr.');
            const statusTime = new Date(appt.updated_at || appt.created_at || now);
            const waitingMinutes = Math.max(0, Math.floor((now.getTime() - statusTime.getTime()) / 60000));

            return {
                id: appt.id,
                patientName,
                doctor: doctorName,
                status: appt.status === 'Checked In' ? 'Checked-In' : appt.status,
                waitingMinutes
            };
        });

        liveQueue.sort((a, b) => b.waitingMinutes - a.waitingMinutes);
        return liveQueue;
    }

    @Get('lead-summary')
    async getLeadSummary(@Query('date') dateQuery?: string) {
        const clinic_id = TenantContext.getClinicId();
        if (!clinic_id) throw new HttpException({ error: 'Tenant context missing' }, HttpStatus.BAD_REQUEST);

        const supabase = this.supabaseService.getClient();
        try {
            const { data: leads, error } = await supabase
                .from('sakhi_clinic_leads')
                .select('status')
                .eq('clinic_id', clinic_id);

            if (error) throw error;

            const counts = (leads || []).reduce<Record<string, number>>((acc, curr) => {
                const s = (curr.status || 'New').toLowerCase();
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {});

            const newCount = counts['new'] || counts['inquiry'] || counts['open'] || 0;
            const contactedCount = counts['contacted'] || counts['follow up'] || counts['follow_up'] || counts['visit'] || 0;
            const stallingCount = counts['stalling'] || counts['pending'] || counts['hold'] || 0;
            const convertedCount = counts['converted'] || counts['won'] || counts['booked'] || 0;

            return {
                new: newCount,
                contacted: contactedCount,
                stalling: stallingCount,
                converted: convertedCount
            };
        } catch (error: any) {
            this.logger.error('GET /api/control-tower/lead-summary', error);
            return { new: 0, contacted: 0, stalling: 0, converted: 0 };
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
                .select('id, status, created_at, updated_at, patient_name_snapshot, doctor_name_snapshot, sakhi_clinic_patients (first_name, last_name)')
                .eq('clinic_id', clinic_id)
                .eq('appointment_date', targetDate)
                .in('status', ['Arrived', 'Checked-In', 'Checked In', 'Waiting']);

            if (error) {
                return { thresholdMinutes, count: 0, patients: [] };
            }

            const now = new Date();
            const waitingPatients: any[] = [];

            (appointments || []).forEach((appt: any) => {
                const patientObj = Array.isArray(appt.sakhi_clinic_patients) ? appt.sakhi_clinic_patients[0] : appt.sakhi_clinic_patients;
                const patientName = appt.patient_name_snapshot || (patientObj ? `${patientObj.first_name || ''} ${patientObj.last_name || ''}`.trim() : '') || 'Patient';
                const doctorName = (appt.doctor_name_snapshot || 'Doctor').replace(/^Dr\.\s*Dr\./i, 'Dr.');
                const statusTime = new Date(appt.updated_at || appt.created_at || now);
                const waitingMinutes = Math.max(0, Math.floor((now.getTime() - statusTime.getTime()) / 60000));

                if (waitingMinutes >= thresholdMinutes) {
                    waitingPatients.push({
                        patientName,
                        doctorName,
                        status: appt.status,
                        waitingMinutes,
                        message: `Waiting > ${thresholdMinutes} mins`
                    });
                }
            });

            return { thresholdMinutes, count: waitingPatients.length, patients: waitingPatients };
        } catch (error: any) {
            this.logger.error('GET /api/control-tower/waiting-alerts', error);
            return { thresholdMinutes, count: 0, patients: [] };
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

            const counts = (appointments || []).reduce<Record<string, number>>((acc, curr) => {
                const s = curr.status || 'Scheduled';
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {});

            return {
                scheduled: (counts['Scheduled'] || 0) + (counts['Rescheduled'] || 0) + (counts['Confirmed'] || 0) + (counts['Arrived'] || 0) + (counts['Checked In'] || 0) + (counts['Checked-In'] || 0) + (counts['In Consultation'] || 0) + (counts['Completed'] || 0),
                arrived: counts['Arrived'] || 0,
                checkedIn: (counts['Checked In'] || 0) + (counts['Checked-In'] || 0) + (counts['In Consultation'] || 0),
                completed: counts['Completed'] || 0,
                cancelled: (counts['Cancelled'] || 0) + (counts['Canceled'] || 0),
                noShow: counts['No Show'] || counts['No-Show'] || 0,
            };
        } catch (error: any) {
            this.logger.error('GET /api/control-tower/patient-flow-summary', error);
            return { scheduled: 0, arrived: 0, checkedIn: 0, completed: 0, cancelled: 0, noShow: 0 };
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
                const docName = (appt.doctor_name_snapshot || 'Doctor').replace(/^Dr\.\s*Dr\./i, 'Dr.');
                const key = appt.doctor_id || docName;
                if (!statsByDoctor[key]) {
                    statsByDoctor[key] = { total: 0, completed: 0, pending: 0, name: docName };
                }
                statsByDoctor[key].total += 1;
                if (appt.status === 'Completed') {
                    statsByDoctor[key].completed += 1;
                } else {
                    statsByDoctor[key].pending += 1;
                }
            });

            return Object.values(statsByDoctor).map(stat => ({
                doctorName: stat.name,
                total: stat.total,
                completed: stat.completed,
                pending: stat.pending
            }));
        } catch (error: any) {
            this.logger.error('GET /api/control-tower/doctor-utilization', error);
            return [];
        }
    }
}
