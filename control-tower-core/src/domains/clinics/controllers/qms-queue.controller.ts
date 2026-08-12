import { Controller, Post, Body, UseGuards, Req, Param, Get, Query, BadRequestException, Logger } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { QmsEngineService } from '../services/qms-engine.service';
import { SlotEngineService } from '../services/slot-engine.service';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';

@Controller('api/v1/clinics/qms/queue')
@UseGuards(ClinicsAuthGuard)
export class QMSQueueController {
    private readonly logger = new Logger(QMSQueueController.name);

    constructor(
        private readonly qmsEngine: QmsEngineService,
        private readonly slotEngine: SlotEngineService,
        private readonly supabaseService: ClinicsSupabaseService
    ) {}

    // --- ENQUEUE (WhatsApp Webhook / Direct) ---
    @Post('enqueue')
    async enqueuePatient(@Req() req: any, @Body('appointment_id') appointmentId: string) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        return await this.qmsEngine.enqueuePatient(tenantId, appointmentId);
    }

    // --- DASHBOARD API: STATE TRANSITIONS ---
    @Post(':id/transition')
    async transitionStatus(@Req() req: any, @Param('id') appointmentId: string, @Body('status') status: string) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        return await this.qmsEngine.transitionStatus(tenantId, appointmentId, status);
    }
    
    @Post(':id/skip')
    async skipPatient(@Req() req: any, @Param('id') appointmentId: string) {
        return this.transitionStatus(req, appointmentId, 'SKIPPED');
    }
    
    @Post(':id/resume')
    async resumePatient(@Req() req: any, @Param('id') appointmentId: string) {
        return this.transitionStatus(req, appointmentId, 'WAITING');
    }
    
    @Post(':id/complete')
    async completePatient(@Req() req: any, @Param('id') appointmentId: string) {
        return this.transitionStatus(req, appointmentId, 'COMPLETED');
    }

    // --- DASHBOARD API: QUEUE VISIBILITY ---
    @Get('live')
    async getLiveQueue(@Req() req: any, @Query('doctor_id') doctorId: string, @Query('date') date: string) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        if (!doctorId || !date) throw new BadRequestException('doctor_id and date are required');
        
        return await this.qmsEngine.getLiveQueueStatus(tenantId, doctorId, date);
    }

    @Get('stats')
    async getQueueStats(@Req() req: any, @Query('doctor_id') doctorId: string, @Query('date') date: string) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        if (!doctorId || !date) throw new BadRequestException('doctor_id and date are required');
        
        const supabase = this.supabaseService.getClient();
        
        const { data, error } = await supabase
            .from('sakhi_clinic_appointments')
            .select('queue_status')
            .eq('clinic_id', tenantId)
            .eq('doctor_id', doctorId)
            .gte('appointment_date', date + 'T00:00:00Z')
            .lte('appointment_date', date + 'T23:59:59Z');

        if (error) throw error;
        
        const stats = {
            WAITING: 0,
            COMPLETED: 0,
            SKIPPED: 0,
            NO_SHOW: 0,
            TOTAL: data.length
        };
        
        data.forEach(pt => {
            if (stats[pt.queue_status] !== undefined) stats[pt.queue_status]++;
        });
        
        return stats;
    }

    @Get('search')
    async searchQueue(@Req() req: any, @Query('doctor_id') doctorId: string, @Query('date') date: string, @Query('query') query: string) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        if (!query) return [];

        const supabase = this.supabaseService.getClient();
        
        // Search by token number or patient name (join)
        const { data, error } = await supabase
            .from('sakhi_clinic_appointments')
            .select('*, patient:sakhi_clinic_patients!inner(name, mobile)')
            .eq('clinic_id', tenantId)
            .eq('doctor_id', doctorId)
            .gte('appointment_date', date + 'T00:00:00Z')
            .lte('appointment_date', date + 'T23:59:59Z')
            .or(`token_number.ilike.%${query}%,patient.name.ilike.%${query}%,patient.mobile.ilike.%${query}%`);
            
        if (error) throw error;
        return data;
    }

    // --- DASHBOARD API: WALK-IN FLOW ---
    @Post('walk-in')
    async registerWalkIn(@Req() req: any, @Body() body: any) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        const { doctor_id, date, time, mobile, name, patient_id: providedPatientId } = body;
        
        if (!doctor_id || !date || !time || !mobile || !name) {
            throw new BadRequestException('doctor_id, date, time, mobile, and name are required');
        }

        const supabase = this.supabaseService.getClient();
        
        // 1. Search Patient / Create/Reuse
        let patientId = providedPatientId || null;
        
        let isNewPatient = false;
        
        if (!patientId) {
            const { data: existingPt } = await supabase
                .from('sakhi_clinic_patients')
                .select('id')
                .eq('clinic_id', tenantId)
                .eq('mobile', mobile)
                .limit(1)
                .maybeSingle();

            if (existingPt) {
                patientId = existingPt.id;
            } else {
                const { data: newPt, error: ptErr } = await supabase
                    .from('sakhi_clinic_patients')
                    .insert({ clinic_id: tenantId, mobile, name, source: 'WALK_IN' })
                    .select('id')
                    .single();
                    
                if (ptErr) {
                    if (ptErr.code === '23505') { // Unique violation
                        // Race condition! Another bot/user just created this patient. Reuse it.
                        const { data: racePt } = await supabase
                            .from('sakhi_clinic_patients')
                            .select('id')
                            .eq('clinic_id', tenantId)
                            .eq('mobile', mobile)
                            .limit(1)
                            .maybeSingle();
                        patientId = racePt?.id;
                    } else {
                        throw ptErr;
                    }
                } else {
                    patientId = newPt.id;
                    isNewPatient = true;
                }
            }
        }

        try {
            // 2. Slot Engine
        const nextAvailableSlot = await this.slotEngine.findNextAvailableSlot(tenantId, doctor_id, date, time);

        // 3. Appointment Creation
        const { data: appt, error: apptErr } = await supabase
            .from('sakhi_clinic_appointments')
            .insert({
                clinic_id: tenantId,
                patient_id: patientId,
                doctor_id: doctor_id,
                appointment_date: date,
                start_time: nextAvailableSlot,
                type: body.type || 'Consultation',
                status: 'Scheduled',
                source: 'WALK_IN',
                patient_name_snapshot: name,
                patient_phone_snapshot: mobile,
                doctor_name_snapshot: body.doctor_name_snapshot || null,
                visit_reason: body.visit_reason || 'Consultation',
                referral_doctor: body.referral_doctor || null,
                referral_doctor_phone: body.referral_doctor_phone || null,
                patient_email_snapshot: body.patient_email_snapshot || null,
                patient_age_snapshot: body.patient_age_snapshot || null,
                sex_snapshot: body.sex_snapshot || null,
                patient_marital_status_snapshot: body.patient_marital_status_snapshot || null,
                patient_address_snapshot: body.patient_address_snapshot || null
            })
            .select('id')
            .single();

        if (apptErr) throw apptErr;

        // 4. Queue Engine & Token Generation
        const enqueueResult = await this.qmsEngine.enqueuePatient(tenantId, appt.id);
        
        return enqueueResult;
        } catch (error) {
            // Rollback patient if we just created them
            if (isNewPatient && patientId) {
                console.warn(`Walk-in failed. Rolling back patient creation for ID: ${patientId}`);
                await supabase
                    .from('sakhi_clinic_patients')
                    .delete()
                    .eq('id', patientId);
            }
            throw error;
        }
    }

    // --- DASHBOARD API: NOTIFICATION HISTORY ---
    @Get('notifications/:appointment_id')
    async getNotificationHistory(@Req() req: any, @Param('appointment_id') appointmentId: string) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        const supabase = this.supabaseService.getClient();
        
        const { data, error } = await supabase
            .from('qms_notifications_outbox')
            .select('id, notification_type, channel, priority, status, attempts, last_error, created_at, next_attempt_at, expires_at')
            .eq('tenant_id', tenantId)
            .eq('appointment_id', appointmentId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data;
    }
}
