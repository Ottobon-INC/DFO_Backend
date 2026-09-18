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

        // Fetch patient for demographics
        const { data: patient } = await client
            .from('sakhi_clinic_patients')
            .select('name, age, gender, extra_details')
            .eq('id', patientId)
            .maybeSingle();

        const femalePartner = patient?.extra_details?.ivf_female_partner || {};
        const isPatientFemale = patient?.gender?.toLowerCase() === 'female';

        if (!cycle) {
            return {
                cycle_id: null,
                femaleProfile: {
                    name: femalePartner.name || (isPatientFemale ? (patient?.name || '') : ''),
                    date: femalePartner.date || '',
                    age: femalePartner.age || (isPatientFemale ? (patient?.age?.toString() || '') : '')
                },
                maleProfile: {
                    name: !isPatientFemale ? (patient?.name || '') : '',
                    age: !isPatientFemale ? (patient?.age?.toString() || '') : ''
                }
            };
        }

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

        const femaleProfile = femaleProfileReq.data ? { ...femaleProfileReq.data } : {};
        femaleProfile.name = femalePartner.name || (isPatientFemale ? (patient?.name || '') : '');
        femaleProfile.date = femalePartner.date || '';
        femaleProfile.age = femalePartner.age || (isPatientFemale ? (patient?.age?.toString() || '') : '');

        const maleProfile = maleProfileReq.data ? { ...maleProfileReq.data } : {};
        if (!maleProfile.name && !isPatientFemale) {
            maleProfile.name = patient?.name || '';
            maleProfile.age = patient?.age?.toString() || '';
        }

        return {
            cycle_id: cycleId,
            femaleProfile: Object.keys(femaleProfile).length > 0 ? femaleProfile : null,
            procedures: proceduresReq.data || null,
            femaleLabPanels: femaleLabReq.data || null,
            maleLabPanels: maleLabReq.data || null,
            baselineUsg: baselineUsgReq.data || null,
            maleProfile: Object.keys(maleProfile).length > 0 ? maleProfile : null,
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
        const operations: Promise<any>[] = [];

        // 2. Queue Resilient Upserts for all provided sections
        if (payload.femaleProfile) {
            const { name, date, age, ...cleanData } = payload.femaleProfile;

            // Persist female partner demographics in patient.extra_details
            if (name || age || date) {
                operations.push(
                    (async () => {
                        try {
                            const { data: currentPatient } = await client
                                .from('sakhi_clinic_patients')
                                .select('extra_details')
                                .eq('id', patientId)
                                .maybeSingle();

                            const extraDetails = currentPatient?.extra_details || {};
                            extraDetails.ivf_female_partner = {
                                name: name || extraDetails.ivf_female_partner?.name || '',
                                date: date || extraDetails.ivf_female_partner?.date || '',
                                age: age || extraDetails.ivf_female_partner?.age || '',
                            };

                            await client
                                .from('sakhi_clinic_patients')
                                .update({ extra_details: extraDetails })
                                .eq('id', patientId);
                        } catch (err) {
                            this.logger.warn(`Failed to update female partner extra_details: ${err.message}`);
                        }
                    })()
                );
            }

            operations.push(
                this.upsertSection(client, 'sakhi_ivf_female_profile', cycleId, clinicId, userId, {
                    ...cleanData,
                    lmp: this.sanitizeDate(cleanData.lmp),
                    exam_date: this.sanitizeDate(cleanData.exam_date),
                })
            );
        }

        if (payload.procedures) {
            operations.push(
                this.upsertSection(client, 'sakhi_ivf_procedures', cycleId, clinicId, userId, {
                    hsg_rows: payload.procedures.hsg_rows || [],
                    hysteroscopy_rows: payload.procedures.hysteroscopy_rows || [],
                    laparoscopy_rows: payload.procedures.laparoscopy_rows || [],
                })
            );
        }

        if (payload.femaleLabPanels) {
            operations.push(
                this.upsertSection(client, 'sakhi_ivf_lab_panels', cycleId, clinicId, userId, {
                    dates: payload.femaleLabPanels.dates || [],
                    lab_rows: payload.femaleLabPanels.lab_rows || [],
                    antithyroid_antibodies: payload.femaleLabPanels.antithyroid_antibodies || null,
                    antimicrosomial_antibodies: payload.femaleLabPanels.antimicrosomial_antibodies || null,
                }, { panel_type: 'FEMALE' })
            );
        }

        if (payload.maleLabPanels) {
            operations.push(
                this.upsertSection(client, 'sakhi_ivf_lab_panels', cycleId, clinicId, userId, {
                    dates: payload.maleLabPanels.dates || [],
                    lab_rows: payload.maleLabPanels.lab_rows || [],
                }, { panel_type: 'MALE' })
            );
        }

        if (payload.baselineUsg) {
            operations.push(
                this.upsertSection(client, 'sakhi_ivf_baseline_usg', cycleId, clinicId, userId, {
                    ...payload.baselineUsg,
                    usg_date: this.sanitizeDate(payload.baselineUsg.usg_date),
                })
            );
        }

        if (payload.maleProfile) {
            operations.push(
                this.upsertSection(client, 'sakhi_ivf_male_profile', cycleId, clinicId, userId, payload.maleProfile)
            );
        }

        if (payload.semenAnalysis) {
            operations.push(
                this.upsertSection(client, 'sakhi_ivf_semen_analysis', cycleId, clinicId, userId, {
                    ...payload.semenAnalysis,
                    male_usg_date: this.sanitizeDate(payload.semenAnalysis.male_usg_date),
                    testicular_biopsy_date: this.sanitizeDate(payload.semenAnalysis.testicular_biopsy_date),
                    semen_comparison_rows: payload.semenAnalysis.semen_comparison_rows || [],
                })
            );
        }

        if (payload.treatmentTracking) {
            operations.push(
                this.upsertSection(client, 'sakhi_ivf_treatment_tracking', cycleId, clinicId, userId, {
                    ...payload.treatmentTracking,
                    counselling_date: this.sanitizeDate(payload.treatmentTracking.counselling_date),
                    fm_date: this.sanitizeDate(payload.treatmentTracking.fm_date),
                    cost_explained: Boolean(payload.treatmentTracking.cost_explained),
                    risk_explained: Boolean(payload.treatmentTracking.risk_explained),
                    success_rate_explained: Boolean(payload.treatmentTracking.success_rate_explained),
                    protocol_steps: payload.treatmentTracking.protocol_steps || [],
                    follicular_rows: payload.treatmentTracking.follicular_rows || [],
                })
            );
        }

        // 3. Execute all upserts in parallel
        try {
            await Promise.all(operations);
        } catch (e) {
            this.logger.error(`Exception during IVF upserts: ${e.message}`);
            throw new HttpException(`Failed to save IVF data: ${e.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return {
            success: true,
            message: 'IVF Case Sheet saved successfully',
            cycle_id: cycleId
        };
    }

    private sanitizeDate(val?: string | null): string | null {
        if (!val || typeof val !== 'string') return null;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    private async upsertSection(client: any, table: string, cycleId: string, clinicId: string, userId: string | undefined, data: any, extraMatch?: Record<string, any>) {
        let query = client.from(table).select('id').eq('cycle_id', cycleId);
        if (extraMatch) {
            for (const [key, val] of Object.entries(extraMatch)) {
                query = query.eq(key, val);
            }
        }
        const { data: existing, error: selectErr } = await query.maybeSingle();
        if (selectErr && selectErr.code !== 'PGRST116') {
            this.logger.error(`Error querying existing row in ${table}: ${selectErr.message}`);
            throw selectErr;
        }

        if (existing?.id) {
            const { error: updateErr } = await client.from(table).update({
                ...data,
                ...extraMatch,
                updated_by: userId,
            }).eq('id', existing.id);
            if (updateErr) {
                this.logger.error(`Error updating row in ${table}: ${updateErr.message}`);
                throw updateErr;
            }
        } else {
            const { error: insertErr } = await client.from(table).insert({
                cycle_id: cycleId,
                clinic_id: clinicId,
                ...data,
                ...extraMatch,
                updated_by: userId,
                created_by: userId,
            });
            if (insertErr) {
                this.logger.error(`Error inserting row in ${table}: ${insertErr.message}`);
                throw insertErr;
            }
        }
    }
}
