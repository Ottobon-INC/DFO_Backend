import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { JanmasethuRepository } from '../janmasethu.repository';
import { AppointmentStatus, DFOAppointment, DFODoctor } from '../dfo.types';
import { EngagementEngineService } from '../engagement-engine/engine.service';
import { RealtimeEventsController } from '../api/realtime-events.controller';

@Injectable()
export class AppointmentService {
    private readonly logger = new Logger(AppointmentService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly engagementEngine: EngagementEngineService,
    ) { }

    /**
     * SLOT MANAGEMENT
     */
    async findSlots(doctorId: string): Promise<any[]> {
        return this.repository.findAvailabilitySlots(doctorId);
    }

    /**
     * BOOKING LIFECYCLE
     */
    async bookAppointment(dto: {
        patientId: string;
        doctorId: string;
        date: Date;
        notes?: string;
        clinicId?: string;
    }): Promise<DFOAppointment> {
        this.logger.log(`Booking appointment for patient ${dto.patientId} on ${dto.date}`);

        // 1. Availability Check
        const slots = await this.findSlots(dto.doctorId);
        if (slots.length === 0) throw new BadRequestException('Doctor not available');

        // 2. Create the Appointment
        const appt = await this.repository.createAppointment({
            patient_id: dto.patientId,
            doctor_id: dto.doctorId,
            appointment_date: dto.date,
            status: AppointmentStatus.SCHEDULED,
            notes: dto.notes,
            reminders_sent: 0,
            clinic_id: dto.clinicId,
        });

        // 3. INTEGRATION: Auto-schedule reminder via Engagement Engine (Gap 19)
        // Schedule it 2 hours AND 24 hours BEFORE the appointment date
        const reminderTime2h  = new Date(dto.date.getTime() - 2  * 60 * 60 * 1000);
        const reminderTime24h = new Date(dto.date.getTime() - 24 * 60 * 60 * 1000);
        await this.engagementEngine.processEvent('APPOINTMENT_BOOKED', {
            appointmentId:  appt.id,
            patientId:      dto.patientId,
            reminderTime:   reminderTime2h,
            reminderTime24: reminderTime24h,
        });

        // Gap 20: Audit log
        await this.repository.insertAuditLog({
            actor_id:   dto.patientId,
            actor_type: 'PATIENT',
            action:     'APPOINTMENT_BOOKED',
            payload:    { appointmentId: appt.id, doctorId: dto.doctorId, date: dto.date },
        });

        // 4. REALTIME: Broadcast event for frontend sync
        RealtimeEventsController.broadcast('APPOINTMENT_BOOKED', appt);

        return appt;
    }

    /**
     * Gap 17: CANCELLATION WORKFLOW
     * - Updates appointment status
     * - Releases the slot (marks slot as available)
     * - Cancels all pending reminders via Engagement Engine
     * - Notifies patient via dispatch service
     * - Writes audit entry
     */
    async cancelAppointment(id: string, reason: string): Promise<void> {
        this.logger.log(`Cancelling appointment ${id}: ${reason}`);

        const appt = await this.repository.findAppointmentById(id);
        if (!appt) throw new BadRequestException('Appointment not found');
        if (appt.status === AppointmentStatus.CANCELLED) {
            throw new BadRequestException('Appointment is already cancelled');
        }
        if (appt.status === AppointmentStatus.COMPLETED) {
            throw new BadRequestException('Cannot cancel a completed appointment');
        }

        // 1. Update appointment status + reason
        await this.repository.updateAppointment(id, {
            status: AppointmentStatus.CANCELLED,
            cancellation_reason: reason,
        });

        // 2. Release slot — mark availability record as available again
        try {
            await this.repository.releaseAppointmentSlot(
                appt.doctor_id,
                appt.appointment_date,
            );
        } catch (e) {
            this.logger.warn(`Slot release for ${id} failed (non-critical): ${e.message}`);
        }

        // 3. Cancel all pending reminders (Gap 19)
        await this.engagementEngine.processEvent('APPOINTMENT_CANCELLED', { appointmentId: id });

        // 4. Clinic-side cancellation → offer next available slot to patient
        if (reason.toLowerCase().includes('doctor') || reason.toLowerCase().includes('clinic')) {
            const nextSlots = await this.findSlots(appt.doctor_id);
            const recommendation = nextSlots.length > 0 ? nextSlots[0].start_time : null;
            await this.engagementEngine.processEvent('DOCTOR_CANCELLED_WITH_SUGGESTION', {
                patient_id:   appt.patient_id,
                doctor_id:    appt.doctor_id,
                originalDate: appt.appointment_date,
                suggestedDate: recommendation,
                reason,
            });
        }

        // 5. Gap 20: Audit
        await this.repository.insertAuditLog({
            actor_id:   appt.patient_id || 'system',
            actor_type: 'SYSTEM',
            action:     'APPOINTMENT_CANCELLED',
            payload:    { appointmentId: id, reason, doctorId: appt.doctor_id },
        });

        // 6. Realtime broadcast
        RealtimeEventsController.broadcast('APPOINTMENT_CANCELLED', { id, reason });
    }

    /**
     * Gap 18: RESCHEDULE WORKFLOW
     * - Releases the OLD slot
     * - Creates a NEW appointment at the new date/time
     * - Updates reminders for new schedule (Gap 19)
     * - Marks old appointment as RESCHEDULED
     * - Full audit trail
     */
    async rescheduleAppointment(id: string, newDate: Date, reason: string): Promise<DFOAppointment> {
        this.logger.log(`Rescheduling appointment ${id} to ${newDate.toISOString()}`);

        const oldAppt = await this.repository.findAppointmentById(id);
        if (!oldAppt) throw new BadRequestException('Original appointment not found');
        if (oldAppt.status === AppointmentStatus.CANCELLED) {
            throw new BadRequestException('Cannot reschedule a cancelled appointment');
        }

        // 1. Cancel old reminders (Gap 19)
        await this.engagementEngine.processEvent('APPOINTMENT_CANCELLED', { appointmentId: id });

        // 2. Release old slot
        try {
            await this.repository.releaseAppointmentSlot(oldAppt.doctor_id, oldAppt.appointment_date);
        } catch (e) {
            this.logger.warn(`Old slot release for ${id} failed (non-critical): ${e.message}`);
        }

        // 3. Create new appointment (also schedules new reminders)
        const newAppt = await this.bookAppointment({
            patientId: oldAppt.patient_id,
            doctorId:  oldAppt.doctor_id,
            date:      newDate,
            clinicId:  oldAppt.clinic_id,
            notes:     `Rescheduled from ${id}: ${reason}`,
        });

        // 4. Mark old as RESCHEDULED
        await this.repository.updateAppointment(id, {
            status: AppointmentStatus.CANCELLED,
            cancellation_reason: `Rescheduled to appointment ${newAppt.id}`,
        });

        // 5. Gap 20: Audit
        await this.repository.insertAuditLog({
            actor_id:   oldAppt.patient_id || 'system',
            actor_type: 'SYSTEM',
            action:     'APPOINTMENT_RESCHEDULED',
            payload:    { oldId: id, newId: newAppt.id, reason, newDate },
        });

        // 6. Realtime
        RealtimeEventsController.broadcast('APPOINTMENT_RESCHEDULED', { oldId: id, newAppt });

        return newAppt;
    }

    async scanForMissedAppointments(): Promise<number> {
        this.logger.log('Scanning for missed (no-show) appointments...');
        const now = new Date();
        const missed = await this.repository.findPastDueAppointments(now);

        for (const appt of missed) {
            await this.repository.updateAppointment(appt.id, { status: AppointmentStatus.MISSED });
            await this.engagementEngine.processEvent('APPOINTMENT_MISSED', { patientId: appt.patient_id });
            await this.repository.insertAuditLog({
                actor_id:   appt.patient_id || 'system',
                actor_type: 'SYSTEM',
                action:     'APPOINTMENT_NO_SHOW',
                payload:    { appointmentId: appt.id },
            });
        }

        return missed.length;
    }

    async completeAppointment(id: string): Promise<void> {
        this.logger.log(`Marking appointment ${id} as COMPLETED.`);
        await this.repository.updateAppointment(id, { status: AppointmentStatus.COMPLETED });
        await this.engagementEngine.processEvent('APPOINTMENT_COMPLETED', { appointmentId: id });

        await this.repository.insertAuditLog({
            actor_id:   'system',
            actor_type: 'SYSTEM',
            action:     'APPOINTMENT_COMPLETED',
            payload:    { appointmentId: id },
        });

        RealtimeEventsController.broadcast('APPOINTMENT_COMPLETED', { id });
    }

    async findAll(): Promise<any[]> {
        this.logger.log('Fetching all appointments...');
        return this.repository.findAllAppointments();
    }
}
