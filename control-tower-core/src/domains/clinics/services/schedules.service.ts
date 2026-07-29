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

        // 1. Delete existing schedules for this doctor in this clinic (this acts as a "last saved template")
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
            
            // 3. Trigger async generation of availability slots
            this.generateAvailabilitySlots(clinicId, doctorId, data, startDate, endDate).catch(err => {
                this.logger.error(`Failed to generate async slots: ${err.message}`);
            });

            return data;
        }

        return [];
    }

    /**
     * Automatically generates individual slots for a specific date range (or 30 days if not provided).
     */
    async generateAvailabilitySlots(clinicId: string, doctorId: string, schedules: any[], startDate?: string, endDate?: string) {
        if (!schedules || schedules.length === 0) return;
        
        const supabase = this.supabaseService.getClient();
        
        let start = new Date();
        start.setHours(0,0,0,0);
        let end = new Date(start);
        end.setDate(start.getDate() + 29); // next 30 days default

        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
            this.logger.log(`Generating slots for doctor ${doctorId} from ${startDate} to ${endDate}...`);
        } else {
            this.logger.log(`Generating slots for doctor ${doctorId} for next 30 days...`);
        }

        const dateStrStart = start.toISOString().split('T')[0];
        const dateStrEnd = end.toISOString().split('T')[0];

        // First, delete any unbooked slots in the target range to prevent orphaned slots
        const { error: deleteSlotsError } = await supabase
            .from('sakhi_clinic_availability_slots')
            .delete()
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId)
            .gte('slot_date', dateStrStart)
            .lte('slot_date', dateStrEnd)
            .eq('booked_count', 0);

        if (deleteSlotsError) {
            this.logger.error(`Failed to delete unbooked slots: ${deleteSlotsError.message}`);
        }

        const slotsToInsert: any[] = [];
        
        // Loop through the dates
        for (let currentDate = new Date(start); currentDate <= end; currentDate.setDate(currentDate.getDate() + 1)) {
            const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
            const dateStr = currentDate.toISOString().split('T')[0];

            // Find matching schedules for this day of the week
            const daySchedules = schedules.filter(s => s.day_of_week === dayOfWeek);

            for (const schedule of daySchedules) {
                const startParts = schedule.start_time.split(':');
                const endParts = schedule.end_time.split(':');
                
                let currentSlotTime = new Date(currentDate);
                currentSlotTime.setHours(parseInt(startParts[0]), parseInt(startParts[1]), 0, 0);
                
                const endSlotTime = new Date(currentDate);
                endSlotTime.setHours(parseInt(endParts[0]), parseInt(endParts[1]), 0, 0);

                const slotDuration = schedule.slot_duration_minutes || 15;

                // Create slots in increments of slotDuration until endSlotTime
                while (currentSlotTime < endSlotTime) {
                    const slotStartTimeStr = `${String(currentSlotTime.getHours()).padStart(2, '0')}:${String(currentSlotTime.getMinutes()).padStart(2, '0')}:00`;
                    
                    // Increment
                    currentSlotTime.setMinutes(currentSlotTime.getMinutes() + slotDuration);
                    
                    const slotEndTimeStr = `${String(currentSlotTime.getHours()).padStart(2, '0')}:${String(currentSlotTime.getMinutes()).padStart(2, '0')}:00`;

                    // Push slot payload
                    slotsToInsert.push({
                        clinic_id: clinicId,
                        doctor_id: doctorId,
                        slot_date: dateStr,
                        start_time: slotStartTimeStr,
                        end_time: slotEndTimeStr,
                        capacity: schedule.slot_capacity || 1,
                        booked_count: 0
                    });
                }
            }
        }

        if (slotsToInsert.length > 0) {
            // Upsert or insert slots
            // Assuming (doctor_id, slot_date, start_time) is unique
            const { error } = await supabase
                .from('sakhi_clinic_availability_slots')
                .upsert(slotsToInsert, { onConflict: 'doctor_id, slot_date, start_time', ignoreDuplicates: true });

            if (error) {
                this.logger.error(`Error inserting generated slots: ${error.message}`);
            } else {
                this.logger.log(`Successfully generated ${slotsToInsert.length} slots for doctor ${doctorId}`);
            }
        }
    }

    async getAvailableSlots(clinicId: string, doctorId: string, date?: string): Promise<any[]> {
        const supabase = this.supabaseService.getClient();
        let query = supabase
            .from('sakhi_clinic_availability_slots')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('doctor_id', doctorId)
            .order('slot_date', { ascending: true })
            .order('start_time', { ascending: true });

        if (date) {
            query = query.eq('slot_date', date);
        } else {
            const today = new Date().toISOString().split('T')[0];
            query = query.gte('slot_date', today);
        }

        const { data, error } = await query;

        if (error) {
            this.logger.error(`Failed to fetch availability slots: ${error.message}`);
            throw new HttpException('Failed to fetch availability slots', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        // Only return slots that have capacity remaining
        return (data || []).filter(slot => slot.booked_count < slot.capacity);
    }
}
