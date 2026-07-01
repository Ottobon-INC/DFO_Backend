import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';
import { ClinicsUtilsService } from './clinics-utils.service';

@Injectable()
export class RoomAllocationService {
    private readonly logger = new Logger(RoomAllocationService.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly utils: ClinicsUtilsService,
    ) {}

    // --- Room Categories ---
    async getCategories(clinic_id: string) {
        const supabase = this.supabaseService.getClient();
        const { data, error } = await supabase
            .from('sakhi_clinic_room_categories')
            .select('*')
            .eq('clinic_id', clinic_id)
            .order('name');
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    async createCategory(clinic_id: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        const sanitized = this.utils.sanitizePayload({ clinic_id, ...payload });
        const { data, error } = await supabase.from('sakhi_clinic_room_categories').insert(sanitized).select().single();
        if (error) {
            if (error.code === '23505') throw new HttpException('Category name already exists', HttpStatus.CONFLICT);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return data;
    }

    async updateCategory(clinic_id: string, id: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        
        // Edge Case: Deactivation Guard
        if (payload.is_active === false) {
            // Check if there are any occupied beds in this category
            const { data: occupiedBeds, error: bedError } = await supabase
                .from('sakhi_clinic_beds')
                .select('id, sakhi_clinic_rooms!inner(category_id)')
                .eq('status', 'occupied')
                .eq('sakhi_clinic_rooms.category_id', id);
            
            if (bedError) throw new HttpException(bedError.message, HttpStatus.INTERNAL_SERVER_ERROR);
            if (occupiedBeds && occupiedBeds.length > 0) {
                throw new HttpException('Cannot deactivate category: There are active patients in rooms of this category.', HttpStatus.CONFLICT);
            }
        }

        const sanitized = this.utils.sanitizePayload(payload);
        const { data, error } = await supabase
            .from('sakhi_clinic_room_categories')
            .update(sanitized)
            .eq('id', id)
            .eq('clinic_id', clinic_id)
            .select().single();
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    async deleteCategory(clinic_id: string, id: string) {
        const supabase = this.supabaseService.getClient();
        // Check if there are rooms
        const { count, error: countError } = await supabase
            .from('sakhi_clinic_rooms')
            .select('*', { count: 'exact', head: true })
            .eq('category_id', id)
            .eq('clinic_id', clinic_id);
        
        if (countError) throw new HttpException(countError.message, HttpStatus.INTERNAL_SERVER_ERROR);
        if (count && count > 0) throw new HttpException('Cannot delete category with existing rooms', HttpStatus.BAD_REQUEST);

        const { error } = await supabase.from('sakhi_clinic_room_categories').delete().eq('id', id).eq('clinic_id', clinic_id);
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return { success: true };
    }

    // --- Rooms ---
    async getRooms(clinic_id: string) {
        const supabase = this.supabaseService.getClient();
        const { data, error } = await supabase
            .from('sakhi_clinic_rooms')
            .select('*, sakhi_clinic_room_categories(name, daily_rate)')
            .eq('clinic_id', clinic_id)
            .order('room_number');
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    async createRoom(clinic_id: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        // Validate category belongs to clinic
        const { data: category } = await supabase.from('sakhi_clinic_room_categories').select('id').eq('id', payload.category_id).eq('clinic_id', clinic_id).single();
        if (!category) throw new HttpException('Invalid category', HttpStatus.BAD_REQUEST);

        const sanitized = this.utils.sanitizePayload({ clinic_id, ...payload });
        const { data, error } = await supabase.from('sakhi_clinic_rooms').insert(sanitized).select().single();
        if (error) {
             if (error.code === '23505') throw new HttpException('Room number already exists', HttpStatus.CONFLICT);
             throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return data;
    }

    async updateRoom(clinic_id: string, id: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        if (payload.category_id) {
             const { data: category } = await supabase.from('sakhi_clinic_room_categories').select('id').eq('id', payload.category_id).eq('clinic_id', clinic_id).single();
             if (!category) throw new HttpException('Invalid category', HttpStatus.BAD_REQUEST);
        }

        // Edge Case: Deactivation Guard
        if (payload.is_active === false) {
            // Check if there are any occupied beds in this room
            const { data: occupiedBeds, error: bedError } = await supabase
                .from('sakhi_clinic_beds')
                .select('id')
                .eq('status', 'occupied')
                .eq('room_id', id);
            
            if (bedError) throw new HttpException(bedError.message, HttpStatus.INTERNAL_SERVER_ERROR);
            if (occupiedBeds && occupiedBeds.length > 0) {
                throw new HttpException('Cannot deactivate room: There are active patients in this room.', HttpStatus.CONFLICT);
            }
        }

        // Edge Case: Capacity Reduction Guard
        if (payload.capacity !== undefined) {
            const { count, error: countError } = await supabase.from('sakhi_clinic_beds').select('*', { count: 'exact', head: true }).eq('room_id', id);
            if (countError) throw new HttpException(countError.message, HttpStatus.INTERNAL_SERVER_ERROR);
            if (count && count > payload.capacity) {
                throw new HttpException(`Cannot reduce capacity to ${payload.capacity}: This room already has ${count} beds.`, HttpStatus.BAD_REQUEST);
            }
        }

        const sanitized = this.utils.sanitizePayload(payload);
        const { data, error } = await supabase
            .from('sakhi_clinic_rooms')
            .update(sanitized)
            .eq('id', id)
            .eq('clinic_id', clinic_id)
            .select().single();
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    async deleteRoom(clinic_id: string, id: string) {
        const supabase = this.supabaseService.getClient();
        
        // Edge Case: Occupied Deletion Guard
        const { data: occupiedBeds, error: bedError } = await supabase
            .from('sakhi_clinic_beds')
            .select('id')
            .eq('status', 'occupied')
            .eq('room_id', id);
            
        if (bedError) throw new HttpException(bedError.message, HttpStatus.INTERNAL_SERVER_ERROR);
        if (occupiedBeds && occupiedBeds.length > 0) {
            throw new HttpException('Cannot delete room: There are active patients in this room.', HttpStatus.CONFLICT);
        }

        const { error } = await supabase.from('sakhi_clinic_rooms').delete().eq('id', id).eq('clinic_id', clinic_id);
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return { success: true };
    }

    async getAvailableRooms(clinic_id: string, tier?: string) {
        const supabase = this.supabaseService.getClient();
        let query = supabase
            .from('sakhi_clinic_rooms')
            .select(`
                id, room_number, floor, capacity,
                sakhi_clinic_room_categories!inner(id, name, daily_rate),
                sakhi_clinic_beds!inner(id, bed_identifier, status)
            `)
            .eq('clinic_id', clinic_id)
            .eq('sakhi_clinic_beds.status', 'available');

        if (tier) {
            query = query.ilike('sakhi_clinic_room_categories.name', `%${tier}%`);
        }

        const { data, error } = await query;
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    // --- Beds ---
    async getBeds(clinic_id: string, status?: string) {
        const supabase = this.supabaseService.getClient();
        let query = supabase
            .from('sakhi_clinic_beds')
            .select('*, sakhi_clinic_rooms!inner(id, room_number, clinic_id, sakhi_clinic_room_categories(id, name, daily_rate))')
            .eq('sakhi_clinic_rooms.clinic_id', clinic_id)
            .order('bed_identifier');
        
        if (status) {
            query = query.eq('status', status);
        }
        const { data, error } = await query;
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    async updateBed(clinic_id: string, id: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        
        // Validate bed belongs to clinic
        const { data: bed } = await supabase.from('sakhi_clinic_beds').select('id, status, sakhi_clinic_rooms!inner(clinic_id)').eq('id', id).eq('sakhi_clinic_rooms.clinic_id', clinic_id).single();
        if (!bed) throw new HttpException('Invalid bed', HttpStatus.BAD_REQUEST);

        // Edge Case: Deactivation Guard
        if (payload.is_active === false && bed.status === 'occupied') {
            throw new HttpException('Cannot deactivate bed: It is currently occupied by a patient.', HttpStatus.CONFLICT);
        }

        const sanitized = this.utils.sanitizePayload(payload);
        const { data, error } = await supabase
            .from('sakhi_clinic_beds')
            .update(sanitized)
            .eq('id', id)
            .select().single();
            
        if (error) {
             if (error.code === '23505') throw new HttpException('Bed identifier already exists in this room', HttpStatus.CONFLICT);
             throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return data;
    }

    async createBed(clinic_id: string, roomId: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        // Validate room belongs to clinic and check capacity
        const { data: room } = await supabase.from('sakhi_clinic_rooms').select('id, capacity').eq('id', roomId).eq('clinic_id', clinic_id).single();
        if (!room) throw new HttpException('Invalid room', HttpStatus.BAD_REQUEST);

        const { count } = await supabase.from('sakhi_clinic_beds').select('*', { count: 'exact', head: true }).eq('room_id', roomId);
        if (count && count >= room.capacity) {
            throw new HttpException('Room capacity exceeded', HttpStatus.BAD_REQUEST);
        }

        const sanitized = this.utils.sanitizePayload({ room_id: roomId, ...payload });
        const { data, error } = await supabase.from('sakhi_clinic_beds').insert(sanitized).select().single();
        if (error) {
            if (error.code === '23505') throw new HttpException('Bed identifier already exists in this room', HttpStatus.CONFLICT);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return data;
    }

    async updateBedStatus(clinic_id: string, id: string, status: string) {
        const supabase = this.supabaseService.getClient();
        // Validate bed belongs to clinic
        const { data: bed } = await supabase.from('sakhi_clinic_beds').select('id, status, sakhi_clinic_rooms!inner(clinic_id)').eq('id', id).eq('sakhi_clinic_rooms.clinic_id', clinic_id).single();
        if (!bed) throw new HttpException('Invalid bed', HttpStatus.BAD_REQUEST);

        // Edge Case: Manual Override Guard
        if (bed.status === 'occupied') {
            throw new HttpException('Cannot manually change status of an occupied bed. Please discharge or transfer the patient.', HttpStatus.CONFLICT);
        }
        if (status === 'maintenance') {
            // Ensure no active assignments exist (should be handled by the occupied check, but double-checking)
            const { count } = await supabase.from('sakhi_clinic_bed_assignments').select('*', { count: 'exact', head: true }).eq('bed_id', id).eq('is_current', true);
            if (count && count > 0) {
                 throw new HttpException('Cannot mark bed as maintenance: It has an active assignment.', HttpStatus.CONFLICT);
            }
        }

        const { data, error } = await supabase.from('sakhi_clinic_beds').update({ status }).eq('id', id).select().single();
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    async deleteBed(clinic_id: string, id: string) {
        const supabase = this.supabaseService.getClient();
        
        // Validate bed belongs to clinic
        const { data: bed } = await supabase.from('sakhi_clinic_beds').select('id, status, sakhi_clinic_rooms!inner(clinic_id)').eq('id', id).eq('sakhi_clinic_rooms.clinic_id', clinic_id).single();
        if (!bed) throw new HttpException('Invalid bed', HttpStatus.BAD_REQUEST);

        // Edge Case: Occupied Deletion Guard
        if (bed.status === 'occupied') {
            throw new HttpException('Cannot delete bed: It is currently occupied by a patient.', HttpStatus.CONFLICT);
        }

        const { error } = await supabase.from('sakhi_clinic_beds').delete().eq('id', id);
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return { success: true };
    }

    // --- Admissions ---
    async getAdmissions(clinic_id: string, status?: string) {
        const supabase = this.supabaseService.getClient();
        let query = supabase
            .from('sakhi_clinic_admissions')
            .select('*, patient:sakhi_clinic_patients(name, mobile), sakhi_clinic_bed_assignments(id, bed_id, daily_rate_snapshot, assigned_at, is_current, sakhi_clinic_beds(bed_identifier, room_id, sakhi_clinic_rooms(room_number, sakhi_clinic_room_categories(name))))')
            .eq('clinic_id', clinic_id)
            .order('admission_date', { ascending: false });
        
        if (status) {
            query = query.eq('status', status);
        }
        const { data, error } = await query;
        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }

    async createAdmission(clinic_id: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        const { patient_id, bed_id, admitting_doctor_id, diagnosis, notes } = payload;

        // 1. Validate patient belongs to clinic
        const { data: patient } = await supabase.from('sakhi_clinic_patients').select('id').eq('id', patient_id).eq('clinic_id', clinic_id).single();
        if (!patient) throw new HttpException('Invalid patient', HttpStatus.BAD_REQUEST);

        // 2. Validate bed belongs to clinic and get its rate via category
        const { data: bed } = await supabase
            .from('sakhi_clinic_beds')
            .select('id, status, sakhi_clinic_rooms!inner(clinic_id, sakhi_clinic_room_categories(daily_rate))')
            .eq('id', bed_id)
            .eq('sakhi_clinic_rooms.clinic_id', clinic_id)
            .single();
        
        if (!bed) throw new HttpException('Invalid bed', HttpStatus.BAD_REQUEST);
        if (bed.status === 'occupied') throw new HttpException('Bed is already occupied', HttpStatus.CONFLICT);

        // Need rate snapshot
        const daily_rate = (bed as any).sakhi_clinic_rooms?.sakhi_clinic_room_categories?.daily_rate || 0;

        // 3. Perform RPC / Transaction logic
        const { data: rpcData, error: rpcError } = await supabase.rpc('atomic_create_admission', {
            p_clinic_id: clinic_id,
            p_patient_id: patient_id,
            p_admitting_doctor_id: admitting_doctor_id || null,
            p_diagnosis: diagnosis || null,
            p_notes: notes || null,
            p_bed_id: bed_id,
            p_daily_rate: daily_rate
        });

        if (rpcError) {
             if (rpcError.code === '23505') throw new HttpException('Bed is already assigned or patient is already admitted to a bed', HttpStatus.CONFLICT);
             throw new HttpException(rpcError.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        // Fetch the newly created records to return
        const { data: admission } = await supabase.from('sakhi_clinic_admissions').select('*').eq('id', rpcData.admission_id).single();
        const { data: assignment } = await supabase.from('sakhi_clinic_bed_assignments').select('*').eq('id', rpcData.assignment_id).single();

        return { admission, assignment };
    }

    async dischargeAdmission(clinic_id: string, admission_id: string) {
         const supabase = this.supabaseService.getClient();
         // Validate admission
         const { data: admission } = await supabase.from('sakhi_clinic_admissions').select('id, status, admission_date').eq('id', admission_id).eq('clinic_id', clinic_id).single();
         if (!admission) throw new HttpException('Admission not found', HttpStatus.NOT_FOUND);
         if (admission.status !== 'admitted') throw new HttpException('Admission is not currently active', HttpStatus.BAD_REQUEST);

         const now = new Date();
         const nowIso = now.toISOString();

         // Compute total days spent
         const admissionDate = new Date(admission.admission_date);
         const diffTime = Math.abs(now.getTime() - admissionDate.getTime());
         const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Round up to count partial days as full days

         // 1. Update admission status
         const { error: admError } = await supabase.from('sakhi_clinic_admissions').update({ status: 'discharged', discharge_date: nowIso }).eq('id', admission_id);
         if (admError) throw new HttpException(admError.message, HttpStatus.INTERNAL_SERVER_ERROR);

         // 2. Find current bed assignment
         const { data: assignment } = await supabase.from('sakhi_clinic_bed_assignments').select('id, bed_id').eq('admission_id', admission_id).eq('is_current', true).single();
         if (assignment) {
             // 3. Release bed assignment
             await supabase.from('sakhi_clinic_bed_assignments').update({ is_current: false, released_at: nowIso }).eq('id', assignment.id);
             
             // 4. Update bed status
             await supabase.from('sakhi_clinic_beds').update({ status: 'available' }).eq('id', assignment.bed_id);
         }

         return { success: true, days_spent: diffDays };
    }

    async cancelAdmission(clinic_id: string, admission_id: string) {
        const supabase = this.supabaseService.getClient();
        
        // Validate admission
        const { data: admission } = await supabase.from('sakhi_clinic_admissions').select('id, status').eq('id', admission_id).eq('clinic_id', clinic_id).single();
        if (!admission) throw new HttpException('Admission not found', HttpStatus.NOT_FOUND);
        if (admission.status !== 'admitted') throw new HttpException('Only currently admitted patients can be cancelled', HttpStatus.BAD_REQUEST);

        const now = new Date().toISOString();

        // 1. Update admission status to cancelled (DO NOT set discharge_date)
        const { error: admError } = await supabase.from('sakhi_clinic_admissions').update({ status: 'cancelled', updated_at: now }).eq('id', admission_id);
        if (admError) throw new HttpException(admError.message, HttpStatus.INTERNAL_SERVER_ERROR);

        // 2. Find current bed assignment
        const { data: assignment } = await supabase.from('sakhi_clinic_bed_assignments').select('id, bed_id').eq('admission_id', admission_id).eq('is_current', true).single();
        if (assignment) {
            // 3. Release bed assignment
            await supabase.from('sakhi_clinic_bed_assignments').update({ is_current: false, released_at: now }).eq('id', assignment.id);
            
            // 4. Update bed status
            await supabase.from('sakhi_clinic_beds').update({ status: 'available' }).eq('id', assignment.bed_id);
        }

        return { success: true };
    }

    async transferBed(clinic_id: string, admission_id: string, payload: any) {
        const supabase = this.supabaseService.getClient();
        const { new_bed_id } = payload;
        
        // Validate admission
        const { data: admission } = await supabase.from('sakhi_clinic_admissions').select('id, status').eq('id', admission_id).eq('clinic_id', clinic_id).single();
        if (!admission) throw new HttpException('Admission not found', HttpStatus.NOT_FOUND);
        if (admission.status !== 'admitted') throw new HttpException('Admission is not currently active', HttpStatus.BAD_REQUEST);

        // Validate new bed
        const { data: newBed } = await supabase
            .from('sakhi_clinic_beds')
            .select('id, status, sakhi_clinic_rooms!inner(clinic_id, sakhi_clinic_room_categories(daily_rate))')
            .eq('id', new_bed_id)
            .eq('sakhi_clinic_rooms.clinic_id', clinic_id)
            .single();
        
        if (!newBed) throw new HttpException('Invalid new bed', HttpStatus.BAD_REQUEST);
        if (newBed.status === 'occupied') throw new HttpException('New bed is already occupied', HttpStatus.CONFLICT);

        const new_daily_rate = (newBed as any).sakhi_clinic_rooms?.sakhi_clinic_room_categories?.daily_rate || 0;

        // Perform RPC Transaction for safe transfer
        const { data: rpcData, error: rpcError } = await supabase.rpc('atomic_transfer_bed', {
            p_clinic_id: clinic_id,
            p_admission_id: admission_id,
            p_new_bed_id: new_bed_id,
            p_new_daily_rate: new_daily_rate
        });

        if (rpcError) {
             if (rpcError.code === '23505') throw new HttpException('New bed is already assigned', HttpStatus.CONFLICT);
             throw new HttpException(rpcError.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return { success: true, old_assignment_id: rpcData.old_assignment_id, new_assignment_id: rpcData.new_assignment_id };
    }

    async getDashboardSummary(clinic_id: string) {
        const supabase = this.supabaseService.getClient();
        
        // Get all beds in clinic
        const { data: beds, error: bedsError } = await supabase
            .from('sakhi_clinic_beds')
            .select('status, sakhi_clinic_rooms!inner(clinic_id, sakhi_clinic_room_categories(name))')
            .eq('sakhi_clinic_rooms.clinic_id', clinic_id);
            
        if (bedsError) throw new HttpException(bedsError.message, HttpStatus.INTERNAL_SERVER_ERROR);

        const summary = {
             total_beds: beds.length,
             occupied_beds: beds.filter(b => b.status === 'occupied').length,
             available_beds: beds.filter(b => b.status === 'available').length,
             by_category: {} as Record<string, { total: number; occupied: number; available: number }>
        };

        beds.forEach(bed => {
             const categoryName = (bed.sakhi_clinic_rooms as any)?.sakhi_clinic_room_categories?.name || 'Unknown';
             if (!summary.by_category[categoryName]) {
                 summary.by_category[categoryName] = { total: 0, occupied: 0, available: 0 };
             }
             summary.by_category[categoryName].total++;
             if (bed.status === 'occupied') summary.by_category[categoryName].occupied++;
             if (bed.status === 'available') summary.by_category[categoryName].available++;
        });

        return summary;
    }
}
