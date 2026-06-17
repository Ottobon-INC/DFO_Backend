import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Thread, Message, ThreadStatus } from '../../types';
import {
    JanmasethuPatientProfile, JanmasethuRiskLog, JanmasethuSummary, JanmasethuClinicianWorkload,
    JANMASETHU_DOMAIN, JanmasethuUserRole, JanmasethuUserContext
} from './janmasethu.types';
import {
    DFOPatient, DFODoctor, DFOAppointment, DFOConsultation, JourneyStage,
    DFOPrescription, DFOMedicalReport, DFOAnalytics, ConsultationStatus, AppointmentStatus
} from './dfo.types';

@Injectable()
export class JanmasethuRepository {
    private readonly logger = new Logger(JanmasethuRepository.name);

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
    ) { }

    // --- THREAD & MESSAGE CORE ---

    async findThreads(user: JanmasethuUserContext): Promise<Thread[]> {
        let query = this.supabase
            .from('conversation_threads')
            .select('*')
            .eq('domain', JANMASETHU_DOMAIN);

        if (user.role === JanmasethuUserRole.DOCTOR) {
            query = query.eq('status', 'red');
        } else if (user.role === JanmasethuUserRole.NURSE) {
            query = query.in('status', ['red', 'yellow']);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data || []) as Thread[];
    }

    async findThreadById(id: string, user?: JanmasethuUserContext): Promise<Thread | null> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) return null;
        return data as Thread;
    }

    async createThread(dto: Partial<Thread>): Promise<Thread> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .insert([{ ...dto, domain: JANMASETHU_DOMAIN }])
            .select()
            .single();
        if (error) throw error;
        return data as Thread;
    }

    async updateThreadAtomic(id: string, version: number, updates: Partial<Thread>, filters: Record<string, any> = {}): Promise<void> {
        let query = this.supabase
            .from('conversation_threads')
            .update({ ...updates, version: version + 1 })
            .eq('id', id)
            .eq('version', version);

        // Apply extra atomic filters (e.g. { is_locked: false })
        for (const [key, value] of Object.entries(filters)) {
            query = query.eq(key, value);
        }

        const { error } = await query;
        if (error) throw error;
    }

    async findMessageById(id: string): Promise<Message | null> {
        const { data, error } = await this.supabase
            .from('conversation_messages')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) return null;
        return data as Message;
    }

    async createMessage(dto: Partial<Message>): Promise<Message> {
        const { data, error } = await this.supabase
            .from('conversation_messages')
            .insert([dto])
            .select()
            .single();
        if (error) throw error;
        return data as Message;
    }

    async findMessagesByThreadId(threadId: string): Promise<Message[]> {
        const { data, error } = await this.supabase
            .from('conversation_messages')
            .select('*')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data as Message[];
    }

    async findRecentMessages(threadId: string, limit: number): Promise<Message[]> {
        const { data, error } = await this.supabase
            .from('conversation_messages')
            .select('*')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return (data || []) as Message[];
    }

    async findLatestMessageByThread(threadId: string): Promise<Message | null> {
        const msgs = await this.findRecentMessages(threadId, 1);
        return msgs.length > 0 ? msgs[0] : null;
    }

    async findLatestSentimentByThread(threadId: string): Promise<any | null> {
        const { data, error } = await this.supabase
            .from('sentiment_evaluations')
            .select('*')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) return null;
        return data;
    }

    // --- PATIENT & CLINICAL CORE ---

    async findDFOPatientByPhone(phone: string): Promise<DFOPatient | null> {
        const { data, error } = await this.supabase
            .from('dfo_patients')
            .select('*')
            .eq('phone_number', phone)
            .maybeSingle();
        if (error) return null;
        return data as DFOPatient;
    }

    async findPatientByResolution(phone?: string, authId?: string): Promise<DFOPatient | null> {
        let query = this.supabase.from('dfo_patients').select('*');

        if (authId) query = query.eq('auth_user_id', authId);
        else if (phone) query = query.eq('phone_number', phone);
        else return null;

        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        return data as DFOPatient;
    }

    async findAllPatients(includeArchived = false): Promise<DFOPatient[]> {
        let query = this.supabase
            .from('dfo_patients')
            .select('*');

        if (!includeArchived) {
            query = query.is('deleted_at', null);
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) {
            this.logger.error(`Failed to fetch patients: ${error.message}`);
            throw error;
        }
        this.logger.log(`Fetched ${data?.length || 0} patients from database.`);
        return (data || []) as DFOPatient[];
    }

    async linkThreadToPatient(threadId: string, patientId: string): Promise<void> {
        const { error } = await this.supabase
            .from('conversation_threads')
            .update({ patient_id: patientId })
            .eq('id', threadId);
        if (error) throw error;
    }

    async findPatientProfile(patientId: string): Promise<JanmasethuPatientProfile | null> {
        const { data, error } = await this.supabase
            .from('dfo_patients')
            .select('*')
            .eq('id', patientId)
            .maybeSingle();
        if (error) return null;
        return data as JanmasethuPatientProfile;
    }

    async upsertDFOPatient(dto: Partial<DFOPatient>): Promise<DFOPatient> {
        const { data, error } = await this.supabase
            .from('dfo_patients')
            .upsert([dto])
            .select()
            .single();
        if (error) throw error;
        return data as DFOPatient;
    }

    // --- RISK & SUMMARY ---

    async findRiskLogsByPatient(patientId: string, limit: number = 10): Promise<JanmasethuRiskLog[]> {
        const { data, error } = await this.supabase
            .from('dfo_risk_logs')
            .select('*')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data as JanmasethuRiskLog[];
    }

    async insertRiskLog(log: Partial<JanmasethuRiskLog>): Promise<void> {
        const { error } = await this.supabase
            .from('dfo_risk_logs')
            .insert([log]);
        if (error) throw error;
    }

    async findSummaryByThread(threadId: string): Promise<JanmasethuSummary | null> {
        const { data, error } = await this.supabase
            .from('dfo_summaries')
            .select('*')
            .eq('thread_id', threadId)
            .maybeSingle();
        if (error) return null;
        return data as JanmasethuSummary;
    }

    async upsertSummary(summary: JanmasethuSummary): Promise<void> {
        const { error } = await this.supabase.from('dfo_summaries').upsert([summary]);
        if (error) throw error;
    }

    async softDeletePatient(id: string): Promise<void> {
        const { error } = await this.supabase
            .from('dfo_patients')
            .update({ deleted_at: new Date() })
            .eq('id', id);
        if (error) throw error;
    }

    // --- AUDIT, ROUTING & FEEDBACK ---

    async insertRoutingEvent(event: any): Promise<void> {
        const { error } = await this.supabase.from('routing_events').insert([event]);
        if (error) throw error;
    }

    async insertFeedback(feedback: any): Promise<void> {
        const { error } = await this.supabase.from('dfo_feedback').insert([feedback]);
        if (error) throw error;
    }

    // --- WORKLOAD & AVAILABILITY ---

    async findAvailableClinicians(specialty?: string): Promise<JanmasethuClinicianWorkload[]> {
        let query = this.supabase.from('dfo_clinician_workload').select('*').eq('is_available', true);
        if (specialty) query = query.eq('specialty', specialty);
        const { data, error } = await query;
        if (error) throw error;
        return data as JanmasethuClinicianWorkload[];
    }

    async incrementClinicianWorkload(clinicianId: string): Promise<void> {
        this.supabase.rpc('increment_workload', { clinician_id: clinicianId });
    }

    // --- NEW DFO CLINICAL METHODS (RETAINED) ---

    async findAppointmentById(id: string): Promise<DFOAppointment> {
        const { data, error } = await this.supabase
            .from('dfo_appointments')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data as DFOAppointment;
    }

    async updateAppointment(id: string, dto: any): Promise<void> {
        const { error } = await this.supabase
            .from('sakhi_clinic_appointments')
            .update(dto)
            .eq('id', id);
        if (error) throw error;
    }

    async findPastDueAppointments(now: Date): Promise<DFOAppointment[]> {
        const { data, error } = await this.supabase
            .from('sakhi_clinic_appointments')
            .select('*')
            .eq('status', AppointmentStatus.SCHEDULED)
            .lt('appointment_date', now.toISOString());
        if (error) throw error;
        return (data || []) as DFOAppointment[];
    }

    async createAppointment(dto: Partial<DFOAppointment>): Promise<DFOAppointment> {
        this.logger.log(`Attempting to create appointment for patient: ${dto.patient_id} with doctor: ${dto.doctor_id}`);
        const { data, error } = await this.supabase.from('dfo_appointments').insert([dto]).select().single();
        if (error) {
            this.logger.error(`Appointment creation failed: ${error.message} | Patient: ${dto.patient_id} | Doctor: ${dto.doctor_id}`);
            throw error;
        }
        this.logger.log(`Successfully created appointment: ${data.id}`);
        return data as DFOAppointment;
    }

    async findAllAppointments(): Promise<any[]> {
        const { data, error } = await this.supabase
            .from('dfo_appointments')
            .select(`
                *,
                patient:dfo_patients!patient_id (full_name, phone_number),
                doctor:dfo_doctors!doctor_id (full_name, specialization)
            `)
            .order('appointment_date', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async findAllConsultations(): Promise<any[]> {
        const { data, error } = await this.supabase
            .from('dfo_consultations')
            .select(`
                *,
                patient:dfo_patients!patient_id (full_name),
                doctor:dfo_doctors!doctor_id (full_name)
            `)
            .order('start_time', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async findAllRiskLogs(): Promise<any[]> {
        const { data, error } = await this.supabase
            .from('dfo_risk_logs')
            .select(`
                *,
                patient:dfo_patients!patient_id (full_name)
            `)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async startConsultation(dto: Partial<DFOConsultation>): Promise<DFOConsultation> {
        const payload = {
            patient_id: dto.patient_id,
            doctor_id: dto.doctor_id,
            thread_id: dto.thread_id,
            status: dto.status || ConsultationStatus.OPEN, 
            start_time: dto.start_time || new Date(),
            clinical_notes: dto.clinical_notes || ''
        };

        this.logger.debug(`Supabase Payload [dfo_consultations]: ${JSON.stringify(payload)}`);

        const { data, error } = await this.supabase
            .from('dfo_consultations')
            .insert([payload])
            .select()
            .single();

        if (error) {
            this.logger.error(`Database failure starting consultation: ${error.message} (Payload: ${JSON.stringify(payload)})`);
            throw error;
        }
        return data as DFOConsultation;
    }

    async createNotificationLog(log: any): Promise<string> {
        const { data, error } = await this.supabase
            .from('dfo_notification_logs')
            .insert([log])
            .select('id')
            .single();
        if (error) throw error;
        return data.id;
    }

    async updateNotificationLog(id: string, update: any): Promise<void> {
        const { error } = await this.supabase
            .from('dfo_notification_logs')
            .update(update)
            .eq('id', id);
        if (error) throw error;
    }

    async insertAuditLog(log: {
        thread_id?: string;
        patient_id?: string;
        actor_id: string;
        actor_type: string;
        action?: string;
        event_type?: string;
        payload?: any
    }): Promise<void> {
        const { error } = await this.supabase
            .from('sakhi_audit_logs')
            .insert([{
                actor_id: log.actor_id || 'system',
                action: log.event_type || log.action || 'SYSTEM_EVENT',
                entity_name: 'conversation_threads',
                entity_id: log.thread_id,
                new_values: {
                    ...log.payload,
                    patient_id: log.patient_id,
                    actor_type: log.actor_type,
                }
            }]);

        if (error) throw error;
    }

    async findAuditLogs(limit: number = 100): Promise<any[]> {
        const { data, error } = await this.supabase
            .from('sakhi_audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data.map((log: any) => ({
            id: log.id,
            thread_id: log.entity_id,
            actor_id: log.actor_id,
            actor_type: log.new_values?.actor_type || 'SYSTEM',
            action: log.action,
            payload: log.new_values,
            created_at: log.created_at
        }));
    }

    async updateConsultation(id: string, updates: Partial<DFOConsultation>): Promise<void> {
        const { error } = await this.supabase.from('dfo_consultations').update(updates).eq('id', id);
        if (error) throw error;
    }

    async addPrescription(dto: DFOPrescription): Promise<DFOPrescription> {
        const { data, error } = await this.supabase.from('dfo_prescriptions').insert([dto]).select().single();
        if (error) throw error;
        return data as DFOPrescription;
    }

    async uploadReportMetadata(dto: DFOMedicalReport): Promise<DFOMedicalReport> {
        const { data, error } = await this.supabase.from('dfo_medical_reports').insert([dto]).select().single();
        if (error) throw error;
        return data as DFOMedicalReport;
    }

    async findPatientHistory(patientId: string): Promise<any> {
        const { data: consultations } = await this.supabase.from('dfo_consultations').select('*, dfo_prescriptions(*)').eq('patient_id', patientId);
        const { data: reports } = await this.supabase.from('dfo_medical_reports').select('*').eq('patient_id', patientId);
        return { consultations, reports };
    }

    /**
     * DFO ANALYTICS ENGINE (HARDENED)
     * 
     * Replaces hardcoded placeholders with real-time clinical data aggregations.
     * Performs multi-stage queries against threads, audit logs, and patient records.
     */
    async findAnalyticsMetrics(): Promise<DFOAnalytics> {
        const { count: totalPatients } = await this.supabase
            .from('dfo_patients')
            .select('*', { count: 'exact', head: true })
            .is('deleted_at', null);

        // 1. Thread Risk Distribution
        const { data: threads } = await this.supabase
            .from('conversation_threads')
            .select('status, ownership')
            .eq('domain', JANMASETHU_DOMAIN);

        const riskDistribution = (threads || []).reduce((acc, t) => {
            const status = (t.status || 'GREEN').toUpperCase();
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, { RED: 0, YELLOW: 0, GREEN: 0 } as any);

        // 2. Journey Funnel Distribution
        const { data: patients } = await this.supabase
            .from('dfo_patients')
            .select('journey_stage')
            .is('deleted_at', null);

        const journeyFunnel = (patients || []).reduce((acc, p) => {
            // Map database enum values to display keys
            let stageKey = 'TTC';
            if (p.journey_stage === JourneyStage.PREGNANT) stageKey = 'PREGNANT';
            if (p.journey_stage === JourneyStage.POSTPARTUM) stageKey = 'POSTPARTUM';

            acc[stageKey] = (acc[stageKey] || 0) + 1;
            return acc;
        }, { TTC: 0, PREGNANT: 0, POSTPARTUM: 0 } as any);

        // 3. SLA Performance Calculation
        // Formula: 100 - (Total_SLA_Breaches / Total_High_Risk_Threads * 100)
        const slaPerformance = await this.calculateSLAPerformance();

        const activeConversations = (threads || []).filter(t => t.ownership === 'HUMAN').length;

        this.logger.log(`📊 Analytics refreshed | Patients: ${totalPatients} | Human Threads: ${activeConversations} | Risk: [R:${riskDistribution.RED} Y:${riskDistribution.YELLOW} G:${riskDistribution.GREEN}]`);

        return {
            risk_distribution: riskDistribution,
            total_patients: totalPatients || 0,
            sla_performance: slaPerformance,
            active_conversations: activeConversations,
            patient_journey_funnel: journeyFunnel,
            average_consultation_time: 18 // Still fixed until consult close logic is hardened
        };
    }

    /**
     * Calculates the real-time SLA achievement rate.
     * Analyzes audit logs for 'SLA_BREACH' and 'SLA_CANCELED' (success) events.
     */
    private async calculateSLAPerformance(): Promise<number> {
        const { data: breachLogs } = await this.supabase
            .from('audit_logs')
            .select('id')
            .eq('event_type', 'SLA_BREACH');

        const { data: successLogs } = await this.supabase
            .from('audit_logs')
            .select('id')
            .eq('event_type', 'SLA_CANCELED'); // Successful human intervention before breach

        const totalTracked = (breachLogs?.length || 0) + (successLogs?.length || 0);
        if (totalTracked === 0) return 100.0; // Perfect score if no events yet

        const successRate = (successLogs?.length || 0) / totalTracked * 100;
        return Number(successRate.toFixed(1));
    }

    async upsertDoctor(dto: Partial<DFODoctor>): Promise<DFODoctor> {
        const { data, error } = await this.supabase.from('dfo_doctors').upsert([dto]).select().single();
        if (error) throw error;
        return data as DFODoctor;
    }

    async insertAvailabilitySlot(slot: any): Promise<void> {
        const { error } = await this.supabase.from('dfo_availability_slots').insert([slot]);
        if (error) throw error;
    }

    async findAvailabilitySlots(doctorId: string): Promise<any[]> {
        const { data, error } = await this.supabase
            .from('dfo_availability_slots')
            .select('*')
            .eq('doctor_id', doctorId)
            .eq('is_booked', false);
        if (error) throw error;
        return data || [];
    }

    async findDoctorAvailability(doctorId?: string): Promise<DFODoctor[]> {
        let query = this.supabase
            .from('dfo_doctors')
            .select('*')
            .eq('is_available', true);

        if (doctorId) query = query.eq('id', doctorId);

        const { data, error } = await query;
        if (error) throw error;
        return data as DFODoctor[];
    }

    async findWorkload(): Promise<any[]> {
        const { data: doctors } = await this.supabase.from('dfo_doctors').select('*');
        const { data: appointments } = await this.supabase.from('dfo_appointments').select('doctor_id');

        return (doctors || []).map(doc => ({
            ...doc,
            appointment_count: (appointments || []).filter(a => a.doctor_id === doc.id).length
        }));
    }

    /**
     * CLINIC LEADS - CORE MIGRATION
     */
    async findLeads(params: { page: number, limit: number, query?: string }) {
        const from = (params.page - 1) * params.limit;
        const to = from + params.limit - 1;

        let query = this.supabase
            .from('sakhi_clinic_leads')
            .select('*', { count: 'exact' })
            .order('date_added', { ascending: false })
            .range(from, to);

        if (params.query) {
            query = query.or(`name.ilike.%${params.query}%,phone.ilike.%${params.query}%`);
        }

        const { data, error, count } = await query;
        if (error) {
            this.logger.error('Failed to fetch lead registry:', error);
            throw error;
        }

        return { items: data || [], pagination: { total: count || 0 } };
    }

    async createLead(payload: any) {
        const { data, error } = await this.supabase
            .from('sakhi_clinic_leads')
            .insert(payload)
            .select()
            .single();

        if (error) {
            this.logger.error('Lead persistence failed:', error);
            throw error;
        }

        return data;
    }

    async findStalledLeads(hours: number = 24) {
        const cutoff = new Date();
        cutoff.setHours(cutoff.getHours() - hours);

        const { data, error } = await this.supabase
            .from('sakhi_clinic_leads')
            .select('*')
            .eq('status', 'New Inquiry')
            .lt('date_added', cutoff.toISOString());

        if (error) throw error;
        return data || [];
    }

    async updateLeadStatus(leadId: string, status: string, followUpNotes?: string) {
        const updates: any = { status };
        if (followUpNotes) updates.inquiry = followUpNotes;

        const { data, error } = await this.supabase
            .from('sakhi_clinic_leads')
            .update(updates)
            .eq('id', leadId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * CLINICAL REFERRALS
     * Allows a clinician to hand over a patient case to another doctor.
     */
    async referCase(threadId: string, targetDoctorId: string, actorId: string, reason: string): Promise<void> {
        const { data: thread, error: threadError } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .eq('id', threadId)
            .single();

        if (threadError || !thread) throw new Error('Thread not found for referral');

        // 1. Update Thread Assignment
        const { error: updateError } = await this.supabase
            .from('conversation_threads')
            .update({
                assigned_user_id: targetDoctorId,
                assigned_role: JanmasethuUserRole.DOCTOR,
                version: thread.version + 1,
                metadata: {
                    ...thread.metadata,
                    referral_history: [
                        ...(thread.metadata?.referral_history || []),
                        { from: actorId, to: targetDoctorId, date: new Date(), reason }
                    ]
                }
            })
            .eq('id', threadId)
            .eq('version', thread.version);

        if (updateError) throw updateError;

        // 2. Log Referral in Audit Ledger
        await this.insertAuditLog({
            thread_id: threadId,
            patient_id: thread.metadata?.patient_id,
            actor_id: actorId,
            actor_type: 'DOCTOR',
            event_type: 'CASE_REFERRAL',
            payload: { target_doctor: targetDoctorId, reason }
        });

        this.logger.log(`Case ${threadId} successfully referred to ${targetDoctorId} by ${actorId}`);
    }

    async findClinicalMetrics(date: string) {
        const { data, error } = await this.supabase
            .from('dfo_appointments')
            .select('status')
            .eq('appointment_date', date);

        if (error) throw error;

        const counts = (data || []).reduce<Record<string, number>>((acc, curr) => {
            const status = curr.status || 'Scheduled';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});

        return {
            scheduled: (counts['Scheduled'] || 0) + (counts['Rescheduled'] || 0),
            arrived: counts['Arrived'] || 0,
            checkedIn: counts['Checked In'] || counts['Checked-In'] || 0,
            completed: counts['Completed'] || 0,
            cancelled: counts['Cancelled'] || 0,
            noShow: counts['No Show'] || 0,
        };
    }

    // --- LEADS & ENGAGEMENT ---

    async findLeadById(id: string) {
        const { data, error } = await this.supabase
            .from('sakhi_clinic_leads')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    }

    async insertEngagementLog(log: any) {
        const { data, error } = await this.supabase
            .from('dfo_engagement_logs')
            .insert([log])
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async findAllEngagementLogs(): Promise<any[]> {
        const { data, error } = await this.supabase
            .from('dfo_engagement_logs')
            .select(`
                *,
                patient:dfo_patients!patient_id (full_name)
            `)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async findThreadByConsultationId(consultationId: string): Promise<string | null> {
        const { data, error } = await this.supabase
            .from('dfo_consultations')
            .select('thread_id')
            .eq('id', consultationId)
            .single();
        if (error) return null;
        return data.thread_id;
    }
}
