import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { EncryptionService } from '../../../infrastructure/security/encryption.service';
import { AddVitalRequest, VitalRecord, VitalType } from './vitals.schema';

@Injectable()
export class VitalsRepository {
  private readonly logger = new Logger(VitalsRepository.name);
  private readonly TABLE_NAME = 'sakhi_clinic_patient_vitals';

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    private readonly encryptionService: EncryptionService,
  ) { }

  /**
   * Saves a new vital record into the database, natively encrypting the vital value.
   */
  async saveVital(data: AddVitalRequest): Promise<VitalRecord> {
    const encryptedValue = this.encryptionService.encrypt(String(data.value));

    const { data: savedData, error } = await this.supabase
      .from(this.TABLE_NAME)
      .insert({
        patient_id: data.patient_id,
        vital_type: data.vital_type,
        value_encrypted: encryptedValue,
        recorded_at: data.recorded_at,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error saving vital for patient ${data.patient_id}: ${error.message}`);
      throw new Error(`Failed to save vital: ${error.message}`);
    }

    return this.mapToEntity(savedData);
  }

  /**
   * Fetches the historical vitals for a patient, optionally filtering by vital type 
   * and returning up to `limit` records ordered by recorded_at DESC.
   */
  async getVitalsHistory(patientId: string, type?: VitalType, limit: number = 20): Promise<VitalRecord[]> {
    let query = this.supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq('vital_type', type);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to fetch vitals for patient ${patientId}: ${error.message}`);
      throw new Error(`Failed to fetch vitals: ${error.message}`);
    }

    return (data || []).map(row => this.mapToEntity(row));
  }

  private mapToEntity(row: any): VitalRecord {
    let decryptedValue = '***DECRYPTION_FAILED***';
    try {
      decryptedValue = this.encryptionService.decrypt(row.value_encrypted);
    } catch (error) {
      this.logger.error(`Failed to decrypt vital record ${row.id}`);
    }

    return {
      id: row.id,
      patient_id: row.patient_id,
      vital_type: row.vital_type as VitalType,
      value: decryptedValue,
      recorded_at: row.recorded_at,
      created_at: row.created_at,
    };
  }
}
