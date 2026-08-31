import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';

@Injectable()
export class SchedulesService {
    private readonly logger = new Logger(SchedulesService.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService
    ) {}

    async getSchedules(clinicId: string, doctorId: string): Promise<any[]> {
        const supabase = this.supabaseService.getClient();
        
        const { data, error } = await supabase
            .from('sakhi_clinic_doctor_schedules')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId)
            .eq('is_active', true)
            .order('day_of_week', { ascending: true })
            .order('start_time', { ascending: true });

        if (error) {
            this.logger.error(`Failed to fetch schedules: ${error.message}`);
            throw new HttpException('Failed to fetch schedules', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return data || [];
    }

    async saveSchedules(clinicId: string, doctorId: string, schedules: any[], startDate?: string, endDate?: string): Promise<any[]> {
        const supabase = this.supabaseService.getClient();

        // 1. Delete existing template schedules for this doctor in this clinic
        const { error: deleteError } = await supabase
            .from('sakhi_clinic_doctor_schedules')
            .delete()
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId);

        if (deleteError) {
            this.logger.error(`Failed to delete old schedules: ${deleteError.message}`);
            throw new HttpException('Failed to update schedules', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        // 2. Insert new schedules if any exist
        if (schedules && schedules.length > 0) {
            const insertPayload = schedules.map(s => ({
                clinic_id: clinicId,
                doctor_id: doctorId,
                day_of_week: s.day_of_week,
                start_time: s.start_time,
                end_time: s.end_time,
                slot_duration_minutes: s.slot_duration_minutes || 15,
                slot_capacity: s.slot_capacity || 1,
                session_name: s.session_name || (parseInt(s.start_time.split(':')[0]) < 14 ? 'Morning Session' : 'Evening Session'),
                room_number: s.room_number || null,
                is_active: true
            }));

            const { data, error: insertError } = await supabase
                .from('sakhi_clinic_doctor_schedules')
                .insert(insertPayload)
                .select();

            if (insertError) {
                this.logger.error(`Failed to insert new schedules: ${insertError.message}`);
                throw new HttpException('Failed to save schedules', HttpStatus.INTERNAL_SERVER_ERROR);
            }
            
            // 3. Synchronously generate availability slots so they are immediately available
            await this.generateAvailabilitySlots(clinicId, doctorId, data, startDate, endDate);

            return data || [];
        }

        return [];
    }

    /**
     * Generates individual consultation slots for a specific date range.
     */
    async generateAvailabilitySlots(clinicId: string, doctorId: string, schedules: any[], startDate?: string, endDate?: string) {
        if (!schedules || schedules.length === 0) return;
        
        const supabase = this.supabaseService.getClient();
        
        // Calculate date range (default 30 days starting from today)
        const now = new Date();
        const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = endDate ? new Date(endDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);

        const dateStrStart = this.formatLocalDate(start);
        const dateStrEnd = this.formatLocalDate(end);

        this.logger.log(`Generating availability slots for doctor ${doctorId} from ${dateStrStart} to ${dateStrEnd}`);

        // Fetch existing leaves for this doctor in this date range
        let doctorLeaves: string[] = [];
        try {
            const { data: leavesData } = await supabase
                .from('sakhi_clinic_doctor_leaves')
                .select('leave_date')
                .eq('clinic_id', clinicId)
                .eq('doctor_id', doctorId)
                .gte('leave_date', dateStrStart)
                .lte('leave_date', dateStrEnd);
            if (leavesData) {
                doctorLeaves = leavesData.map(l => l.leave_date);
            }
        } catch (e) {
            // Leave table might be optional
        }

        // Delete unbooked slots in the target range to prevent stale slot records
        await supabase
            .from('sakhi_clinic_availability_slots')
            .delete()
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId)
            .gte('slot_date', dateStrStart)
            .lte('slot_date', dateStrEnd)
            .eq('booked_count', 0);

        const slotsToInsert: any[] = [];
        
        // Loop through each calendar day in the date range
        const cursorDate = new Date(start);
        while (cursorDate <= end) {
            const dayOfWeek = cursorDate.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
            const dateStr = this.formatLocalDate(cursorDate);
            const isOnLeave = doctorLeaves.includes(dateStr);

            // Find matching schedules for this day of week
            const daySchedules = schedules.filter(s => s.day_of_week === dayOfWeek);

            for (const schedule of daySchedules) {
                const [startH, startM] = schedule.start_time.split(':').map(Number);
                const [endH, endM] = schedule.end_time.split(':').map(Number);
                
                let currentMinutes = startH * 60 + startM;
                const endMinutes = endH * 60 + endM;
                const slotDuration = schedule.slot_duration_minutes || 15;

                while (currentMinutes + slotDuration <= endMinutes) {
                    const sH = Math.floor(currentMinutes / 60);
                    const sM = currentMinutes % 60;
                    const nextMinutes = currentMinutes + slotDuration;
                    const eH = Math.floor(nextMinutes / 60);
                    const eM = nextMinutes % 60;

                    const startTimeStr = `${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:00`;
                    const endTimeStr = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}:00`;

                    slotsToInsert.push({
                        clinic_id: clinicId,
                        doctor_id: doctorId,
                        slot_date: dateStr,
                        start_time: startTimeStr,
                        end_time: endTimeStr,
                        capacity: schedule.slot_capacity || 1,
                        booked_count: 0,
                        status: isOnLeave ? 'LEAVE' : 'AVAILABLE',
                        block_reason: isOnLeave ? 'Doctor on Leave' : null
                    });

                    currentMinutes = nextMinutes;
                }
            }

            cursorDate.setDate(cursorDate.getDate() + 1);
        }

        if (slotsToInsert.length > 0) {
            // Batch insert generated slots (batches of 100 to avoid payload limits)
            const batchSize = 100;
            for (let i = 0; i < slotsToInsert.length; i += batchSize) {
                const batch = slotsToInsert.slice(i, i + batchSize);
                const { error: upsertErr } = await supabase
                    .from('sakhi_clinic_availability_slots')
                    .upsert(batch, { onConflict: 'doctor_id, slot_date, start_time', ignoreDuplicates: true });
                
                if (upsertErr) {
                    this.logger.error(`Error upserting slots batch: ${upsertErr.message}`);
                }
            }
            this.logger.log(`Successfully generated ${slotsToInsert.length} slots for doctor ${doctorId}`);
        }
    }

    async getAvailableSlots(clinicId: string, doctorId: string, startDate?: string, endDate?: string): Promise<any[]> {
        const supabase = this.supabaseService.getClient();
        let query = supabase
            .from('sakhi_clinic_availability_slots')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId)
            .order('slot_date', { ascending: true })
            .order('start_time', { ascending: true });

        if (startDate && endDate) {
            query = query.gte('slot_date', startDate).lte('slot_date', endDate);
        } else if (startDate) {
            query = query.eq('slot_date', startDate);
        } else {
            const today = this.formatLocalDate(new Date());
            query = query.gte('slot_date', today);
        }

        const { data, error } = await query;

        if (error) {
            this.logger.error(`Failed to fetch availability slots: ${error.message}`);
            throw new HttpException('Failed to fetch availability slots', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return data || [];
    }

    async setDoctorLeave(clinicId: string, doctorId: string, leaveDate: string, leaveType: string = 'Full Day', reason: string = 'Doctor on Leave') {
        const supabase = this.supabaseService.getClient();

        // 1. Record in leaves table
        try {
            await supabase
                .from('sakhi_clinic_doctor_leaves')
                .upsert({
                    clinic_id: clinicId,
                    doctor_id: doctorId,
                    leave_date: leaveDate,
                    leave_type: leaveType,
                    reason: reason,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'doctor_id, leave_date' });
        } catch (e) {
            this.logger.warn(`Leaves table upsert notice: ${e.message}`);
        }

        // 2. Mark unbooked slots on that day as 'LEAVE'
        await supabase
            .from('sakhi_clinic_availability_slots')
            .update({ status: 'LEAVE', block_reason: reason })
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId)
            .eq('slot_date', leaveDate)
            .eq('booked_count', 0);

        return { success: true, message: `Doctor marked on leave for ${leaveDate}` };
    }

    async removeDoctorLeave(clinicId: string, doctorId: string, leaveDate: string) {
        const supabase = this.supabaseService.getClient();

        // 1. Delete from leaves table
        try {
            await supabase
                .from('sakhi_clinic_doctor_leaves')
                .delete()
                .eq('clinic_id', clinicId)
                .eq('doctor_id', doctorId)
                .eq('leave_date', leaveDate);
        } catch (e) {}

        // 2. Reset unbooked slots on that day back to 'AVAILABLE'
        await supabase
            .from('sakhi_clinic_availability_slots')
            .update({ status: 'AVAILABLE', block_reason: null })
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId)
            .eq('slot_date', leaveDate)
            .eq('booked_count', 0);

        return { success: true, message: `Leave removed for ${leaveDate}` };
    }

    async getDoctorLeaves(clinicId: string, doctorId: string, startDate?: string, endDate?: string): Promise<any[]> {
        const supabase = this.supabaseService.getClient();
        try {
            let query = supabase
                .from('sakhi_clinic_doctor_leaves')
                .select('*')
                .eq('clinic_id', clinicId)
                .eq('doctor_id', doctorId)
                .order('leave_date', { ascending: true });

            if (startDate && endDate) {
                query = query.gte('leave_date', startDate).lte('leave_date', endDate);
            }

            const { data } = await query;
            return data || [];
        } catch (e) {
            return [];
        }
    }

    private formatLocalDate(d: Date): string {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

