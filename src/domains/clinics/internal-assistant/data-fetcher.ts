import { SupabaseClient } from '@supabase/supabase-js';
import { Intent, Role } from './types';

export class DataFetcher {
    static async fetchData(
        supabase: SupabaseClient,
        intent: Intent,
        userRole: Role,
        userId: string,
        decrypter: (text: string) => string
    ): Promise<any> {
        switch (intent) {
            case Intent.GET_STALLING_LEADS:
                return this.getStallingLeads(supabase, decrypter);
            case Intent.GET_TODAY_APPOINTMENTS:
                return this.getTodayAppointments(supabase, userRole, userId);
            case Intent.GET_WAITING_PATIENTS:
                return this.getWaitingPatients(supabase);
            case Intent.GET_CLINIC_SUMMARY:
                return this.getClinicSummary(supabase);
            case Intent.UNKNOWN:
            default:
                return null;
        }
    }

    private static async getStallingLeads(supabase: SupabaseClient, decrypter: (text: string) => string) {
        const { data, error, count } = await supabase
            .from('sakhi_clinic_leads')
            .select('id, name, status, age, gender, inquiry, source, date_added', { count: 'exact' })
            .in('status', ['New Inquiry', 'Follow Up'])
            .order('date_added', { ascending: true })
            .limit(10);

        if (error) throw error;

        // Decrypt inquiry field if encrypted
        const decryptedLeads = (data || []).map(lead => ({
            ...lead,
            inquiry: lead.inquiry ? decrypter(lead.inquiry) : null
        }));

        return {
            leads: decryptedLeads,
            total_count: count || 0
        };
    }

    private static async getTodayAppointments(supabase: SupabaseClient, userRole: Role, userId: string) {
        const today = new Date().toISOString().split('T')[0];

        let query = supabase
            .from('sakhi_clinic_appointments')
            .select('status, doctor_id, type')
            .eq('appointment_date', today);

        if (userRole === 'doctor') {
            query = query.eq('doctor_id', userId);
        }

        const { data: appointments, error } = await query;
        if (error) throw error;

        const total_count = appointments?.length || 0;

        const breakdown = (appointments || []).reduce<Record<string, number>>((acc, curr) => {
            const status = curr.status || 'Scheduled';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});

        return {
            total_count,
            breakdown,
            my_appointments_count: userRole === 'doctor' ? total_count : undefined
        };
    }

    private static async getWaitingPatients(supabase: SupabaseClient) {
        const today = new Date().toISOString().split('T')[0];
        const { data: appointments, error } = await supabase
            .from('sakhi_clinic_appointments')
            .select('status, created_at') // fall back to created_at if checked_in_at/arrived_at is not standard
            .eq('appointment_date', today)
            .in('status', ['Arrived', 'Checked-In']);

        if (error) throw error;

        const now = new Date();
        let max_wait_time_minutes = 0;
        let long_wait_count = 0;

        appointments?.forEach((appt: any) => {
            const timeRef = appt.checked_in_at || appt.arrived_at || appt.created_at;
            if (timeRef) {
                const waitTime = Math.floor((now.getTime() - new Date(timeRef).getTime()) / 60000);
                if (waitTime > max_wait_time_minutes) max_wait_time_minutes = waitTime;
                if (waitTime > 30) long_wait_count++;
            }
        });

        return {
            total_waiting: appointments?.length || 0,
            max_wait_time_minutes,
            long_wait_count
        };
    }

    private static async getClinicSummary(supabase: SupabaseClient) {
        const today = new Date().toISOString().split('T')[0];

        // 1. Leads Summary
        const { count: leadsCount, error: leadError } = await supabase
            .from('sakhi_clinic_leads')
            .select('*', { count: 'exact', head: true })
            .gte('date_added', today);

        if (leadError) throw leadError;

        // 2. Stalling Leads Count
        const { count: stallingCount, error: stallingError } = await supabase
            .from('sakhi_clinic_leads')
            .select('*', { count: 'exact', head: true })
            .in('status', ['New Inquiry', 'Follow Up']);

        if (stallingError) throw stallingError;

        // 3. Appointments Summary
        const { count: apptCount, error: apptError } = await supabase
            .from('sakhi_clinic_appointments')
            .select('*', { count: 'exact', head: true })
            .eq('appointment_date', today);

        if (apptError) throw apptError;

        // 4. Waiting Patients
        const { count: waitingCount, error: waitingError } = await supabase
            .from('sakhi_clinic_appointments')
            .select('*', { count: 'exact', head: true })
            .eq('appointment_date', today)
            .in('status', ['Arrived', 'Checked-In']);

        if (waitingError) throw waitingError;

        return {
            total_leads_today: leadsCount || 0,
            total_appointments_today: apptCount || 0,
            total_waiting_patients: waitingCount || 0,
            stalling_leads_count: stallingCount || 0
        };
    }
}
