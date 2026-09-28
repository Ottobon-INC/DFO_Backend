import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ClinicalIntelligenceRepository {
  private readonly logger = new Logger(ClinicalIntelligenceRepository.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
  ) {}

  async saveAnalysis(analysisRecord: {
    patient_conversation: string;
    structured_analysis: string;
    urgency_level: string;
    metadata?: any;
  }): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('clinical_analyses')
      .insert({
        patient_conversation: analysisRecord.patient_conversation,
        structured_analysis: analysisRecord.structured_analysis,
        urgency_level: analysisRecord.urgency_level,
        metadata: analysisRecord.metadata || {},
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error saving clinical analysis: ${error.message}`);
      throw new Error(`Persistence failure: ${error.message}`);
    }

    return data;
  }

  async getAnalysisById(id: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('clinical_analyses')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      this.logger.error(`Error fetching clinical analysis: ${error.message}`);
      return null;
    }

    return data;
  }
}
