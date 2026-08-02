import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';

@Injectable()
export class SlotEngineService {
    private readonly logger = new Logger(SlotEngineService.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    // Helper to convert "HH:mm" to minutes for easy math
    private timeToMins(t: string): number {
        const [h, m] = t.split(':').map(Number);
        return (h * 60) + m;
    }

    // Helper to convert minutes back to "HH:mm"
    private minsToTime(m: number): string {
        const h = Math.floor(m / 60);
        const mins = m % 60;
        return \:\;
    }

    private isWithinBreak(timeStr: string, breaks: any[]): boolean {
        if (!breaks || breaks.length === 0) return false;
        const targetMins = this.timeToMins(timeStr);
        for (const b of breaks) {
            const startMins = this.timeToMins(b.start_time);
            const endMins = this.timeToMins(b.end_time);
            if (targetMins >= startMins && targetMins < endMins) return true;
        }
        return false;
    }

    async findNextAvailableSlot(tenantId: string, doctorId: string, preferredDate: string, preferredTime: string, attempts: number = 0): Promise<string> {
        if (attempts > 20) {
            throw new BadRequestException('No slots available for the rest of the day.');
        }

        const supabase = this.supabaseService.getClient();

        // 1. Fetch Doctor Schedule Rules
        const { data: docConfig, error: configErr } = await supabase
            .from('doctor_schedules')
            .select('schedule')
            .eq('doctor_id', doctorId)
            .eq('tenant_id', tenantId)
            .single();

        if (configErr && configErr.code !== 'PGRST116') {
            throw new Error(Failed to fetch doctor schedule: \);
        }

        // Schema: { working_hours: { start: '09:00', end: '17:00' }, breaks: [{start_time: '13:00', end_time: '14:00'}], max_per_slot: 5, slot_duration: 15 }
        const schedule = docConfig?.schedule || {};
        const maxCapacity = schedule.max_per_slot || 5;
        const slotDuration = schedule.slot_duration || 15;
        const workStart = schedule.working_hours?.start || '09:00';
        const workEnd = schedule.working_hours?.end || '18:00';
        const breaks = schedule.breaks || [];

        // Validate working hours
        const targetMins = this.timeToMins(preferredTime);
        const endMins = this.timeToMins(workEnd);
        if (targetMins >= endMins) {
            throw new BadRequestException('Doctor is not available past this time today.');
        }

        // Validate if preferred time falls during a break
        if (this.isWithinBreak(preferredTime, breaks)) {
            // Push time to the end of the break
            const nextSlotMins = targetMins + slotDuration;
            const nextSlotStr = this.minsToTime(nextSlotMins);
            return this.findNextAvailableSlot(tenantId, doctorId, preferredDate, nextSlotStr, attempts + 1);
        }

        // 2. Check Capacity
        const { count, error } = await supabase
            .from('sakhi_clinic_appointments')
            .select('id', { count: 'exact' })
            .eq('clinic_id', tenantId)
            .eq('doctor_id', doctorId)
            .eq('appointment_date', preferredDate)
            .eq('appointment_time', preferredTime)
            .in('queue_status', ['BOOKED', 'ARRIVED', 'WAITING', 'CALLED', 'IN_CONSULTATION']);

        if (error) throw new Error('Failed to validate slot capacity');

        if ((count || 0) < maxCapacity) {
            return preferredTime; // Slot is valid and has capacity
        }

        // 3. Slot Overflow! Advance by duration and recurse
        const nextSlotMins = targetMins + slotDuration;
        const nextSlotStr = this.minsToTime(nextSlotMins);
        
        this.logger.log(Slot \ full (capacity \). Overflowing to \...);
        
        return this.findNextAvailableSlot(tenantId, doctorId, preferredDate, nextSlotStr, attempts + 1);
    }
}
