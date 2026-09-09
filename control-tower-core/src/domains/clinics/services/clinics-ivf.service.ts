import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { SaveIvfCaseSheetDto } from '../dto/ivf-save.dto';

@Injectable()
export class ClinicsIvfService {
    private readonly logger = new Logger(ClinicsIvfService.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    async getCaseSheet(patientId: string) {
        const clinicId = TenantContext.getClinicId();
        if (!clinicId) throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);

        const client = this.supabaseService.getClient() as any;

        // 1. Get Active Cycle
        const { data: cycle, error: cycleError } = await client
            .from('sakhi_ivf_cycles')
            .select('id')
            .eq('patient_id', patientId)
            .eq('clinic_id', clinicId)
            .eq('status', 'ACTIVE')
            .eq('is_deleted', false)
            .maybeSingle();

        if (!cycle) return null; // No active cycle

        const cycleId = cycle.id;

        // 2. Fetch all related data in parallel
        const [
            femaleProfileReq,
            proceduresReq,
            femaleLabReq,
            maleLabReq,
            baselineUsgReq,
            maleProfileReq,
            semenAnalysisReq,
            treatmentTrackingReq
        ] = await Promise.all([
            // @ts-ignore
            client.from('sakhi_ivf_female_profile').select('*').eq('cycle_id', cycleId).maybeSingle(),
            // @ts-ignore
            client.from('sakhi_ivf_procedures').select('*').eq('cycle_id', cycleId).maybeSingle(),
            // @ts-ignore
            client.from('sakhi_ivf_lab_panels').select('*').eq('cycle_id', cycleId).eq('panel_type', 'FEMALE').maybeSingle(),
            // @ts-ignore
            client.from('sakhi_ivf_lab_panels').select('*').eq('cycle_id', cycleId).eq('panel_type', 'MALE').maybeSingle(),
            // @ts-ignore
            client.from('sakhi_ivf_baseline_usg').select('*').eq('cycle_id', cycleId).maybeSingle(),
            // @ts-ignore
            client.from('sakhi_ivf_male_profile').select('*').eq('cycle_id', cycleId).maybeSingle(),
            // @ts-ignore
            client.from('sakhi_ivf_semen_analysis').select('*').eq('cycle_id', cycleId).maybeSingle(),
            // @ts-ignore
            client.from('sakhi_ivf_treatment_tracking').select('*').eq('cycle_id', cycleId).maybeSingle()
        ]);

        return {
            cycle_id: cycleId,
            femaleProfile: femaleProfileReq.data || null,
            procedures: proceduresReq.data || null,
            femaleLabPanels: femaleLabReq.data || null,
            maleLabPanels: maleLabReq.data || null,
            baselineUsg: baselineUsgReq.data || null,
            maleProfile: maleProfileReq.data || null,
            semenAnalysis: semenAnalysisReq.data || null,
            treatmentTracking: treatmentTrackingReq.data || null,
        };
    }

    async saveCaseSheet(patientId: string, payload: SaveIvfCaseSheetDto) {
        const clinicId = TenantContext.getClinicId();
        const userId = TenantContext.getUserId();

        if (!clinicId) {
            throw new HttpException('Tenant context missing', HttpStatus.BAD_REQUEST);
        }

        const client = this.supabaseService.getClient() as any;

        // 1. Get or Create Active Cycle
        let { data: cycle, error: cycleError } = await client
            .from('sakhi_ivf_cycles')
            .select('id')
            .eq('patient_id', patientId)
            .eq('clinic_id', clinicId)
            .eq('status', 'ACTIVE')
            .eq('is_deleted', false)
            .maybeSingle();

        if (cycleError && cycleError.code !== 'PGRST116') {
            this.logger.error(`Error fetching active IVF cycle: ${cycleError.message}`);
            throw new HttpException('Failed to resolve IVF cycle', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        if (!cycle) {
            const { data: newCycle, error: createError } = await client
                .from('sakhi_ivf_cycles')
                .insert({
                    patient_id: patientId,
                    clinic_id: clinicId,
                    created_by: userId,
                    updated_by: userId,
                    start_date: new Date().toISOString()
                })
                .select('id')
                .single();

            if (createError) {
                this.logger.error(`Error creating new IVF cycle: ${createError.message}`);
                throw new HttpException('Failed to create new IVF cycle', HttpStatus.INTERNAL_SERVER_ERROR);
            }
            cycle = newCycle;
        }

        const cycleId = cycle.id;
        const upsertPromises = [];

        // 2. Queue Upserts for all provided sections
        if (payload.femaleProfile) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_female_profile').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    updated_by: userId,
                    ...payload.femaleProfile
                }, { onConflict: 'cycle_id' })
            );
        }

        if (payload.procedures) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_procedures').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    updated_by: userId,
                    ...payload.procedures
                }, { onConflict: 'cycle_id' })
            );
        }

        if (payload.femaleLabPanels) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_lab_panels').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    panel_type: 'FEMALE',
                    updated_by: userId,
                    ...payload.femaleLabPanels
                }, { onConflict: 'cycle_id, panel_type' })
            );
        }

        if (payload.maleLabPanels) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_lab_panels').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    panel_type: 'MALE',
                    updated_by: userId,
                    ...payload.maleLabPanels
                }, { onConflict: 'cycle_id, panel_type' })
            );
        }

        if (payload.baselineUsg) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_baseline_usg').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    updated_by: userId,
                    ...payload.baselineUsg
                }, { onConflict: 'cycle_id' })
            );
        }

        if (payload.maleProfile) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_male_profile').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    updated_by: userId,
                    ...payload.maleProfile
                }, { onConflict: 'cycle_id' })
            );
        }

        if (payload.semenAnalysis) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_semen_analysis').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    updated_by: userId,
                    ...payload.semenAnalysis
                }, { onConflict: 'cycle_id' })
            );
        }

        if (payload.treatmentTracking) {
            upsertPromises.push(
                // @ts-ignore
            client.from('sakhi_ivf_treatment_tracking').upsert({
                    cycle_id: cycleId,
                    clinic_id: clinicId,
                    updated_by: userId,
                    ...payload.treatmentTracking
                }, { onConflict: 'cycle_id' })
            );
        }

        // 3. Execute all upserts in parallel
        try {
            const results = await Promise.all(upsertPromises);
            // @ts-ignore
            const errors = results.filter(r => r.error);
            if (errors.length > 0) {
                this.logger.error(`Errors upserting IVF data: ${JSON.stringify(errors)}`);
                // Proceed with partial success but log the error
            }
        } catch (e) {
            this.logger.error(`Exception during IVF upserts: ${e.message}`);
            throw new HttpException('Failed to save IVF data', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return {
            success: true,
            message: 'IVF Case Sheet saved successfully',
            cycle_id: cycleId
        };
    }
}
