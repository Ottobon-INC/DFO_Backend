import { SupabaseClient } from '@supabase/supabase-js';
import { AuditLogger } from '../audit-log';
import { Role } from '../types';

export class MarkNoShowAction {
    static async search(supabase: SupabaseClient, nameHint: string) {
        const today = new Date().toISOString().split('T')[0];
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 3);
        const minDate = pastDate.toISOString().split('T')[0];

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
            .gte('appointment_date', minDate)
            .lte('appointment_date', today)
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

        if (appt.status === 'No-Show' || appt.status === 'Cancelled') {
            return {
                success: false,
                message: `Appointment for ${patientName} is already marked as ${appt.status}.`
            };
        }

        if (appt.status === 'Checked-In' || appt.status === 'Completed' || appt.status === 'Arrived') {
            return {
                success: false,
                message: `Cannot mark as No-Show. Patient has already arrived/completed (Status: ${appt.status}).`
            };
        }

        const { error: updateError } = await supabase
            .from('sakhi_clinic_appointments')
            .update({
                status: 'No-Show'
            })
            .eq('id', appointmentId);

        if (updateError) throw updateError;

        await AuditLogger.log(supabase, {
            userId,
            role,
            action: 'MARK_PATIENT_NO_SHOW',
            targetId: appointmentId,
            details: { previousStatus: appt.status, newStatus: 'No-Show' }
        });

        return {
            success: true,
            message: `Appointment for ${patientName} has been marked as No-Show.`
        };
    }
}
