import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';

export interface CreateFollowUpDto {
    patient_id: string;
    doctor_id?: string;
    follow_up_date: string;
    reason?: string;
}

export interface UpdateFollowUpDto {
    status?: 'Pending' | 'Called' | 'Appointment Booked' | 'Cancelled';
    notes?: string;
}

@Injectable()
export class FollowUpsService {
    private readonly logger = new Logger(FollowUpsService.name);

    constructor(private supabaseService: ClinicsSupabaseService) {}

    async createFollowUp(clinicId: string, payload: CreateFollowUpDto) {
        try {
            const { data, error } = await this.supabaseService.getClient()
                .from('follow_ups')
                .insert([{
                    clinic_id: clinicId,
                    patient_id: payload.patient_id,
                    doctor_id: payload.doctor_id,
                    follow_up_date: payload.follow_up_date,
                    reason: payload.reason,
                    status: 'Pending'
                }])
                .select()
                .single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            this.logger.error(`Failed to create follow-up: ${error.message}`, error.stack);
            throw new InternalServerErrorException(`Could not create follow-up: ${error.message || JSON.stringify(error)}`);
        }
    }

    async getFollowUps(clinicId: string, filters?: { patient_id?: string; date?: string; status?: string }) {
        try {
            let query = this.supabaseService.getClient()
                .from('follow_ups')
                .select(`
                    *,
                    patient:patient_id(name, mobile, uhid),
                    doctor:doctor_id(
                        role,
                        sakhi_clinic_users(
                            first_name,
                            last_name
                        )
                    )
                `)
                .eq('clinic_id', clinicId)
                .order('follow_up_date', { ascending: true });

            if (filters?.patient_id) {
                query = query.eq('patient_id', filters.patient_id);
            }
            if (filters?.date) {
                query = query.eq('follow_up_date', filters.date);
            }
            if (filters?.status) {
                query = query.eq('status', filters.status);
            }

            const { data, error } = await query;
            if (error) throw error;

            const mappedData = data.map((f: any) => ({
                ...f,
                patient: f.patient ? {
                    ...f.patient,
                    fullname: f.patient.name || 'Unknown Patient',
                    phone: f.patient.mobile || ''
                } : null,
                doctor: f.doctor ? {
                    ...f.doctor,
                    name: f.doctor.sakhi_clinic_users?.name || 
                          [f.doctor.sakhi_clinic_users?.first_name, f.doctor.sakhi_clinic_users?.last_name].filter(Boolean).join(' ') || 
                          'Unknown Doctor'
                } : null
            }));

            return { success: true, data: mappedData };
        } catch (error) {
            this.logger.error(`Failed to fetch follow-ups: ${error.message}`, error.stack);
            throw new InternalServerErrorException(`Could not fetch follow-ups: ${error.message || JSON.stringify(error)}`);
        }
    }

    async updateFollowUp(clinicId: string, followUpId: string, payload: UpdateFollowUpDto) {
        try {
            const updatePayload: any = { updated_at: new Date().toISOString() };
            if (payload.status) updatePayload.status = payload.status;
            if (payload.notes !== undefined) updatePayload.notes = payload.notes;

            const { data, error } = await this.supabaseService.getClient()
                .from('follow_ups')
                .update(updatePayload)
                .eq('id', followUpId)
                .eq('clinic_id', clinicId)
                .select()
                .single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            this.logger.error(`Failed to update follow-up: ${error.message}`, error.stack);
            throw new InternalServerErrorException('Could not update follow-up');
        }
    }
}
