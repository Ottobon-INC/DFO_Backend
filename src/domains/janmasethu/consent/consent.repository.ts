import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { EncryptionService } from '../../../infrastructure/security/encryption.service';
import { ConsentPreferences, ConsentPreferencesSchema } from './consent.schema';

@Injectable()
export class ConsentRepository {
  private readonly logger = new Logger(ConsentRepository.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    private readonly encryption: EncryptionService
  ) { }

  async getConsentByPatientId(patientId: string): Promise<ConsentPreferences | null> {
    const { data, error } = await this.supabase
      .from('patient_consents')
      .select('preferences_encrypted')
      .eq('patient_id', patientId)
      .maybeSingle();

    if (error) {
      this.logger.error(`Error fetching consent for patient ${patientId}: ${error.message}`);
      return null;
    }

    if (!data?.preferences_encrypted) {
      return null;
    }

    try {
      const decrypted = this.encryption.decrypt(data.preferences_encrypted);
      const parsed = JSON.parse(decrypted);
      const validated = ConsentPreferencesSchema.safeParse(parsed);

      if (!validated.success) {
        this.logger.warn(`Invalid consent data structure for patient ${patientId}`);
        return null;
      }

      return validated.data;
    } catch (err) {
      this.logger.error(`Failed to decrypt or parse consent for patient ${patientId}`, err);
      return null;
    }
  }

  async saveConsent(patientId: string, clinicId: string, preferences: ConsentPreferences): Promise<boolean> {
    const encrypted = this.encryption.encrypt(JSON.stringify(preferences));

    const { error } = await this.supabase
      .from('patient_consents')
      .upsert({
        patient_id: patientId,
        clinic_id: clinicId,
        preferences_encrypted: encrypted,
        updated_at: new Date().toISOString()
      }, { onConflict: 'patient_id' });

    if (error) {
      this.logger.error(`Error saving consent for patient ${patientId}: ${error.message}`);
      return false;
    }

    return true;
  }
}
