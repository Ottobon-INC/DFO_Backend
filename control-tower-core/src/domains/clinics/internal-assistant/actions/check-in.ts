import { SupabaseClient } from '@supabase/supabase-js';
import { AuditLogger } from '../audit-log';
import { Role } from '../types';

export class CheckInAction {
    static async search(supabase: SupabaseClient, nameHint: string) {
        const today = new Date().toISOString().split('T')[0];

        const { data: appointments, error } = await supabase
            .from('sakhi_clinic_appointments')
            .select(`
                id,
                appointment_date,
                start_time,
                status,
                patient_name_snapshot,
                doctor_name_snapshot,
                patient:sakhi_clinic_patients(name)
            `)
            .eq('appointment_date', today)
            .ilike('patient_name_snapshot', `%${nameHint}%`);

        if (error) throw error;

        const results = appointments?.map((appt: any) => ({
            id: appt.id,
            patientName: appt.patient_name_snapshot || appt.patient?.name || 'Patient',
            time: appt.start_time,
            doctorName: appt.doctor_name_snapshot || 'Doctor',
            currentStatus: appt.status
        })) || [];

        return results;
    }

    static async execute(supabase: SupabaseClient, appointmentId: string, userId: string, role: Role | string) {
        const { data: appt, error: fetchError } = await supabase
            .from('sakhi_clinic_appointments')
            .select('status, patient_name_snapshot, start_time, doctor_name_snapshot, patient:sakhi_clinic_patients(name)')
            .eq('id', appointmentId)
            .single();

        if (fetchError || !appt) {
            throw new Error('Appointment not found.');
        }

        const patientName = (appt.patient as any)?.name || appt.patient_name_snapshot || 'Patient';

        if (appt.status === 'Checked-In' || appt.status === 'Arrived') {
            return {
                success: false,
                message: `Patient ${patientName} is already checked in.`
            };
        }

        const { error: updateError } = await supabase
            .from('sakhi_clinic_appointments')
            .update({
                status: 'Checked-In',
                arrived_at: new Date().toISOString() // arrived_at maps to Checked-In/Arrived
            })
            .eq('id', appointmentId);

        if (updateError) throw updateError;

        await AuditLogger.log(supabase, {
            userId,
            role,
            action: 'CHECK_IN_PATIENT',
            targetId: appointmentId,
            details: { previousStatus: appt.status, newStatus: 'Checked-In' }
        });

        return {
            success: true,
            message: `Patient ${patientName} (${appt.start_time} with ${appt.doctor_name_snapshot || 'doctor'}) has been checked in successfully.`
        };
    }
}
