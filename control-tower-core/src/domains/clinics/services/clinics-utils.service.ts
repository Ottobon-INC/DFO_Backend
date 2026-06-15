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
}
