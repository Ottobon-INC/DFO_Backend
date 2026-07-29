import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ClinicsUtilsService {
    isUuid(value: string): boolean {
        return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
    }

    sanitizePayload<T extends Record<string, any>>(payload: T): T {
        const sanitized = { ...payload } as Record<string, any>;
        Object.keys(sanitized).forEach((key) => {
            if (sanitized[key] === undefined) {
                delete sanitized[key];
            }
        });
        return sanitized as T;
    }

    toValue(val: any): any {
        if (val === undefined || val === null) return undefined;
        if (typeof val === 'string' && val.trim() === '') return undefined;
        return val;
    }

    async generateUhid(supabase: SupabaseClient): Promise<string> {
        const now = new Date();
        const year = now.getFullYear();

        const { data, error } = await supabase
            .from('sakhi_clinic_patients')
            .select('uhid')
            .ilike('uhid', `JAN-${year}-%`);

        if (error) throw error;

        const nextNumber = (data?.length || 0) + 1;
        const sequence = String(nextNumber).padStart(3, '0');
        return `JAN-${year}-${sequence}`;
    }

    async backfillPatientSnapshot(supabase: SupabaseClient, appointmentId: string): Promise<void> {
        const { data: appointment, error: appointmentError } = await supabase
            .from('sakhi_clinic_appointments')
            .select('id, patient_id, patient_name_snapshot, patient_phone_snapshot, patient_dob_snapshot')
            .eq('id', appointmentId)
            .single();

        if (appointmentError) {
            if (appointmentError.code === 'PGRST116') return;
            throw appointmentError;
        }

        if (!appointment?.patient_id) return;

        const hasSnapshots =
            appointment.patient_name_snapshot &&
            appointment.patient_phone_snapshot &&
            appointment.patient_dob_snapshot;

        if (hasSnapshots) return;

        const { data: patient, error: patientError } = await supabase
            .from('sakhi_clinic_patients')
            .select('name, mobile, dob')
            .eq('id', appointment.patient_id)
            .single();

        if (patientError) {
            if (patientError.code === 'PGRST116') return;
            throw patientError;
        }

        if (!patient) return;

        const updates = this.sanitizePayload({
            patient_name_snapshot: appointment.patient_name_snapshot || patient.name,
            patient_phone_snapshot: appointment.patient_phone_snapshot || patient.mobile,
            patient_dob_snapshot: appointment.patient_dob_snapshot || patient.dob,
        });

        if (!Object.keys(updates).length) return;

        await supabase.from('sakhi_clinic_appointments').update(updates).eq('id', appointmentId);
    }

    async checkGlobalDoctorAvailability(
        supabase: SupabaseClient,
        doctorId: string,
        appointmentDate: string,
        startTime: string,
        endTime: string,
        excludeAppointmentId?: string
    ): Promise<{ isAvailable: boolean; conflictClinicId?: string; reason?: string }> {
        // 1. Check if the doctor has an open slot at this time
        const { data: slots, error: slotsError } = await supabase
            .from('sakhi_clinic_availability_slots')
            .select('*')
            .eq('doctor_id', doctorId)
            .eq('slot_date', appointmentDate)
            .lte('start_time', startTime);
        
        if (slotsError) throw slotsError;

        // Find a slot that fully encompasses the appointment time
        const matchingSlot = slots?.find(s => s.start_time <= startTime && s.end_time >= endTime);

        if (!matchingSlot) {
            return { isAvailable: false, reason: 'Doctor is not scheduled to work at this specific time.' };
        }

        // 2. Check overlapping appointments to ensure we haven't exceeded capacity
        let query = supabase
            .from('sakhi_clinic_appointments')
            .select('id, clinic_id, start_time, end_time')
            .eq('doctor_id', doctorId)
            .eq('appointment_date', appointmentDate)
            .not('status', 'in', '("Canceled","No Show")');

        if (excludeAppointmentId) {
            query = query.neq('id', excludeAppointmentId);
        }

        const { data: existingAppts, error } = await query;
        if (error) throw error;

        if (existingAppts && existingAppts.length > 0) {
            let overlappingCount = 0;
            let conflictClinicId = null;
            
            for (const appt of existingAppts) {
                // If the appointment overlaps exactly with our requested time
                if (startTime < appt.end_time && endTime > appt.start_time) {
                    overlappingCount++;
                    conflictClinicId = appt.clinic_id;
                }
            }

            if (overlappingCount >= matchingSlot.capacity) {
                return { isAvailable: false, conflictClinicId, reason: 'Maximum patient capacity reached for this time slot.' };
            }
        }

        return { isAvailable: true };
    }

    async incrementSlotBooking(supabase: SupabaseClient, doctorId: string, date: string, startTime: string): Promise<void> {
        const { data: slots } = await supabase
            .from('sakhi_clinic_availability_slots')
            .select('id, booked_count, start_time, end_time')
            .eq('doctor_id', doctorId)
            .eq('slot_date', date)
            .lte('start_time', startTime);
            
        const matchingSlot = slots?.find(s => s.start_time <= startTime && s.end_time > startTime);
        if (matchingSlot) {
            await supabase
                .from('sakhi_clinic_availability_slots')
                .update({ booked_count: matchingSlot.booked_count + 1 })
                .eq('id', matchingSlot.id);
        }
    }

    async decrementSlotBooking(supabase: SupabaseClient, doctorId: string, date: string, startTime: string): Promise<void> {
        const { data: slots } = await supabase
            .from('sakhi_clinic_availability_slots')
            .select('id, booked_count, start_time, end_time')
            .eq('doctor_id', doctorId)
            .eq('slot_date', date)
            .lte('start_time', startTime);
            
        const matchingSlot = slots?.find(s => s.start_time <= startTime && s.end_time > startTime);
        if (matchingSlot && matchingSlot.booked_count > 0) {
            await supabase
                .from('sakhi_clinic_availability_slots')
                .update({ booked_count: matchingSlot.booked_count - 1 })
                .eq('id', matchingSlot.id);
        }
    }
}
