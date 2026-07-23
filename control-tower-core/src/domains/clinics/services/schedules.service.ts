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
            .from('dfo_doctor_schedules')
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

    async saveSchedules(clinicId: string, doctorId: string, schedules: any[]): Promise<any[]> {
        const supabase = this.supabaseService.getClient();

        // 1. Delete existing schedules for this doctor in this clinic
        const { error: deleteError } = await supabase
            .from('dfo_doctor_schedules')
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
                is_active: true
            }));

            const { data, error: insertError } = await supabase
                .from('dfo_doctor_schedules')
                .insert(insertPayload)
                .select();

            if (insertError) {
                this.logger.error(`Failed to insert new schedules: ${insertError.message}`);
                throw new HttpException('Failed to save schedules', HttpStatus.INTERNAL_SERVER_ERROR);
            }
            
            // 3. Trigger async generation of availability slots
            this.generateAvailabilitySlots(clinicId, doctorId, data).catch(err => {
                this.logger.error(`Failed to generate async slots: ${err.message}`);
            });

            return data;
        }

        return [];
    }

    /**
     * Automatically generates individual 15-minute slots for the next 30 days based on the new rules.
     */
    async generateAvailabilitySlots(clinicId: string, doctorId: string, schedules: any[]) {
        if (!schedules || schedules.length === 0) return;
        
        const supabase = this.supabaseService.getClient();
        this.logger.log(`Generating slots for doctor ${doctorId} for next 30 days...`);

        const slotsToInsert: any[] = [];
        const today = new Date();
        
        // Loop through the next 30 days
        for (let i = 0; i < 30; i++) {
            const currentDate = new Date(today);
            currentDate.setDate(today.getDate() + i);
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
                        doctor_id: doctorId,
                        slot_date: dateStr,
                        start_time: slotStartTimeStr,
                        end_time: slotEndTimeStr,
                        is_booked: false
                    });
                }
            }
        }

        if (slotsToInsert.length > 0) {
            // Upsert or insert slots
            // Assuming (doctor_id, slot_date, start_time) is unique
            const { error } = await supabase
                .from('dfo_availability_slots')
                .upsert(slotsToInsert, { onConflict: 'doctor_id, slot_date, start_time', ignoreDuplicates: true });

            if (error) {
                this.logger.error(`Error inserting generated slots: ${error.message}`);
            } else {
                this.logger.log(`Successfully generated ${slotsToInsert.length} slots for doctor ${doctorId}`);
            }
        }
    }
}
