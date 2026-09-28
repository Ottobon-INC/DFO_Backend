import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class JanmasethuAssignmentEngine {
    private readonly logger = new Logger(JanmasethuAssignmentEngine.name);

    constructor(
        @Inject('ORG_SUPABASE_CLIENT') private readonly orgSupabase: SupabaseClient,
    ) { }

    /**
     * Resolve and assign the best clinic based on ZIP code
     */
    async resolveClinicForZip(zipCode: string, speciality?: string): Promise<string | null> {
        try {
            const cleanZip = String(zipCode).trim();
            if (!cleanZip) return null;

            // Search matches in clinics_coverage
            let query = this.orgSupabase
                .from('clinics_coverage')
                .select('*')
                .eq('is_available', true)
                .eq('zip_code', cleanZip);

            const { data, error } = await query;
            if (error) {
                this.logger.error(`Error querying clinics_coverage: ${error.message}`);
                return null;
            }

            if (!data || data.length === 0) {
                // Try prefix matching (first 3 digits of ZIP) as a fallback
                const zipPrefix = cleanZip.substring(0, 3);
                const { data: prefixData, error: prefixError } = await this.orgSupabase
                    .from('clinics_coverage')
                    .select('*')
                    .eq('is_available', true)
                    .like('zip_code', `${zipPrefix}%`);
                
                if (prefixError || !prefixData || prefixData.length === 0) {
                    this.logger.log(`No coverage matches found for ZIP ${cleanZip} or prefix ${zipPrefix}`);
                    return null;
                }
                return this.rankClinics(prefixData, speciality);
            }

            return this.rankClinics(data, speciality);
        } catch (e: any) {
            this.logger.error(`Failed resolving clinic for ZIP ${zipCode}`, e);
            return null;
        }
    }

    private rankClinics(clinics: any[], speciality?: string): string | null {
        // Sort by partner_rank (highest priority/rank first), filtering by speciality if specified
        let candidates = clinics;
        if (speciality) {
            const target = speciality.toLowerCase();
            candidates = clinics.filter(c => {
                const specs = Array.isArray(c.specialities) ? c.specialities : [];
                return specs.some((s: string) => s.toLowerCase() === target);
            });
            if (candidates.length === 0) {
                // Fallback to all candidates if speciality filter returns no coverage
                candidates = clinics;
            }
        }

        // Sort descending: highest partner_rank wins
        candidates.sort((a, b) => (b.partner_rank || 0) - (a.partner_rank || 0));
        return candidates[0]?.clinic_id || null;
    }
}
