import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnalyticsService } from './analytics.service';

@Injectable()
export class QmsEngineService {
    private readonly logger = new Logger(QmsEngineService.name);

    private readonly ALLOWED_TRANSITIONS = {
        'BOOKED': ['ARRIVED', 'WAITING', 'CANCELLED', 'NO_SHOW'],
        'ARRIVED': ['WAITING', 'CANCELLED', 'NO_SHOW'],
        'WAITING': ['CALLED', 'SKIPPED', 'CANCELLED', 'NO_SHOW'],
        'CALLED': ['IN_CONSULTATION', 'SKIPPED', 'CANCELLED', 'NO_SHOW'],
        'IN_CONSULTATION': ['COMPLETED', 'CANCELLED'],
        'SKIPPED': ['WAITING', 'CANCELLED', 'NO_SHOW'],
        'COMPLETED': [],
        'CANCELLED': [],
        'NO_SHOW': ['WAITING']
    };

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly eventEmitter: EventEmitter2,
        private readonly analyticsService: AnalyticsService
    ) { }

    // --- ENQUEUE ENGINE (100% ATOMIC, IDEMPOTENT) ---
    async enqueuePatient(tenantId: string, appointmentId: string): Promise<any> {
        const supabase = this.supabaseService.getClient();

        // Single atomic call guarantees token generation, status update, and audit log!
        const { data, error } = await supabase.rpc('enqueue_qms_patient', {
            p_tenant_id: tenantId,
            p_appointment_id: appointmentId
        });

        if (error) {
            this.logger.error('Enqueue failed: ');
            throw new BadRequestException(error.message);
        }

        const token = data.token;

        this.eventEmitter.emit('queue.updated', {
            tenantId,
            appointmentId,
            status: 'WAITING',
            token
        });

        // Trigger heavy backend recalculation event for Notification Outbox
        this.triggerRecalculationEvent(tenantId, data.doctor_id || null, appointmentId);

        return data;
    }

    async transitionStatus(tenantId: string, appointmentId: string, newStatus: string): Promise<any> {
        const supabase = this.supabaseService.getClient();

        const { data: appt, error: fetchErr } = await supabase
            .from('sakhi_clinic_appointments')
            .select('queue_status, doctor_id, token_number')
            .eq('id', appointmentId)
            .eq('clinic_id', tenantId)
            .single();

        if (fetchErr || !appt) throw new BadRequestException('Appointment not found');

        const currentStatus = appt.queue_status || 'BOOKED';

        const allowedNextStates = this.ALLOWED_TRANSITIONS[currentStatus] || [];
        if (!allowedNextStates.includes(newStatus)) {
            throw new BadRequestException(`Invalid queue transition from ${currentStatus} to ${newStatus}`);
        }

        const updateData: any = { queue_status: newStatus };
        const now = new Date().toISOString();

        if (newStatus === 'CALLED') updateData.called_at = now;
        if (newStatus === 'IN_CONSULTATION') updateData.consultation_started_at = now;
        if (newStatus === 'COMPLETED') updateData.completed_at = now;

        const { data, error } = await supabase
            .from('sakhi_clinic_appointments')
            .update(updateData)
            .eq('id', appointmentId)
            .select()
            .single();

        if (error) throw error;

        // Log Audit
        await supabase.from('qms_audit_logs').insert({
            tenant_id: tenantId,
            appointment_id: appointmentId,
            action: 'TRANSITION',
            previous_status: currentStatus,
            new_status: newStatus
        });

        this.eventEmitter.emit('queue.updated', {
            tenantId,
            doctorId: appt.doctor_id,
            appointmentId,
            status: newStatus,
            token: appt.token_number
        });

        this.triggerRecalculationEvent(tenantId, appt.doctor_id, appointmentId);

        return data;
    }

    private async triggerRecalculationEvent(tenantId: string, doctorId: string, appointmentId: string) {
        if (!doctorId) return; // Fallback if missing
        try {
            const today = new Date().toISOString().split('T')[0];
            const liveQueue = await this.getLiveQueueStatus(tenantId, doctorId, today);
            this.eventEmitter.emit('queue.recalculated', {
                tenantId,
                doctorId,
                appointmentId,
                active_queue: liveQueue.active_queue
            });
        } catch (e) {
            this.logger.error(`Failed to trigger recalculation event: ${e.message}`);
        }
    }

    // --- QUEUE POSITION ENGINE (LIVE DYNAMIC STATUS) ---
    async getLiveQueueStatus(tenantId: string, doctorId: string, date: string): Promise<any> {
        const supabase = this.supabaseService.getClient();

        const { data, error } = await supabase.rpc('get_live_queue', {
            p_tenant_id: tenantId,
            p_doctor_id: doctorId,
            p_date: date
        });

        if (error) throw error;

        // Predictive ETA Engine (Phase 4 V1)
        const perf = await this.analyticsService.getDoctorPerformance(tenantId, doctorId, date, date);
        const avgConsultTime = perf.avg_consultation_time_mins > 0 ? perf.avg_consultation_time_mins : 15; // Fallback to 15m

        const activeQueue = data.filter(pt => ['WAITING', 'ARRIVED'].includes(pt.queue_status));

        // Adjust ETA for waiting patients based on real-time speed
        const predictiveQueue = activeQueue.map(pt => {
            return {
                ...pt,
                estimated_wait_mins: pt.patients_ahead * avgConsultTime
            };
        });

        return {
            current_serving_token: data.find(pt => pt.queue_status === 'CALLED' || pt.queue_status === 'IN_CONSULTATION')?.token_number || null,
            waiting_count: predictiveQueue.length,
            active_queue: predictiveQueue
        };
    }

    // --- SWEEPER RECOVERY CRON ---
    @Cron(CronExpression.EVERY_MINUTE)
    async sweepOrphanedAppointments() {
        this.logger.debug('Running sweeper for orphaned tokenless appointments...');
        const supabase = (this.supabaseService as any).getAdminClient ? (this.supabaseService as any).getAdminClient() : this.supabaseService.getClient();

        const { data: orphans } = await supabase
            .from('sakhi_clinic_appointments')
            .select('id, clinic_id')
            .eq('queue_status', 'BOOKED')
            .is('token_number', null)
            .lte('created_at', new Date(Date.now() - 2 * 60000).toISOString()); // Older than 2 mins

        if (!orphans || orphans.length === 0) return;

        for (const orphan of orphans) {
            try {
                await this.enqueuePatient(orphan.clinic_id, orphan.id);
                this.logger.log(`Sweeper successfully recovered and enqueued appointment ${orphan.id}`);
            } catch (err) {
                this.logger.error(`Sweeper failed for appointment ${orphan.id}: ${err.message}`);
            }
        }
    }

    // --- STALE APPOINTMENTS RECONCILIATION CRON ---
    @Cron(CronExpression.EVERY_HOUR)
    async sweepStaleAppointments() {
        this.logger.debug('Running sweeper for stale past-date appointments across clinics...');
        const supabase = (this.supabaseService as any).getAdminClient ? (this.supabaseService as any).getAdminClient() : this.supabaseService.getClient();

        const now = new Date();
        const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];

        try {
            const { data: staleAppts, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select('id, clinic_id, doctor_id, patient_id, appointment_date, start_time, status')
                .lt('appointment_date', todayStr)
                .in('status', ['Checked-In', 'Arrived', 'In-Consultation', 'Scheduled', 'Expected'])
                .limit(100);

            if (error || !staleAppts || staleAppts.length === 0) return;

            for (const appt of staleAppts) {
                try {
                    let hasClinicalData = false;
                    if (appt.patient_id) {
                        const [notes, rx, vitals] = await Promise.all([
                            supabase.from('sakhi_clinical_notes').select('id').eq('patient_id', appt.patient_id).limit(1),
                            supabase.from('sakhi_clinic_prescriptions').select('id').eq('patient_id', appt.patient_id).limit(1),
                            supabase.from('sakhi_clinic_patient_vitals').select('id').eq('patient_id', appt.patient_id).limit(1)
                        ]);
                        hasClinicalData = Boolean((notes.data && notes.data.length > 0) || (rx.data && rx.data.length > 0) || (vitals.data && vitals.data.length > 0));
                    }

                    const nextStatus = hasClinicalData ? 'Completed' : 'No Show';
                    const nextQueueStatus = hasClinicalData ? 'COMPLETED' : 'NO_SHOW';

                    const updatePayload: any = {
                        status: nextStatus,
                        queue_status: nextQueueStatus,
                        cancellation_reason: hasClinicalData ? undefined : 'Auto-closed: Unfinalized previous shift check-in',
                    };
                    if (hasClinicalData) {
                        updatePayload.completed_at = new Date().toISOString();
                    } else {
                        updatePayload.cancelled_at = new Date().toISOString();
                    }

                    await supabase.from('sakhi_clinic_appointments').update(updatePayload).eq('id', appt.id);
                } catch (innerErr: any) {
                    this.logger.error(`Failed to reconcile stale appointment ${appt.id}: ${innerErr.message}`);
                }
            }
            this.logger.log(`Sweeper reconciled ${staleAppts.length} past-date open appointments`);
        } catch (e: any) {
            this.logger.error(`Error in sweepStaleAppointments: ${e.message}`);
        }
    }
}
