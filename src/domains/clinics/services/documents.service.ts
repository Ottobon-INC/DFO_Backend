import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from './clinics-supabase.service';

@Injectable()
export class DocumentsService {
    private readonly logger = new Logger(DocumentsService.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService
    ) {}

    /**
     * Executes the secure Postgres transaction to create a patient and link them to a document.
     * Uses the `link_new_patient_to_document` RPC.
     */
    async linkNewPatientTransaction(clinicId: string, documentId: string, patientPayload: any): Promise<any> {
        const supabase = this.supabaseService.getClient();

        try {
            const { data, error } = await supabase.rpc('link_new_patient_to_document', {
                p_clinic_id: clinicId,
                p_document_id: documentId,
                p_patient_payload: patientPayload
            });

            if (error) {
                this.logger.error(`RPC link_new_patient_to_document failed: ${error.message}`);
                throw new HttpException(
                    { success: false, error: 'Database transaction failed: ' + error.message },
                    HttpStatus.INTERNAL_SERVER_ERROR
                );
            }

            return data;
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`DocumentsService.linkNewPatientTransaction error: ${error.message}`);
            throw new HttpException(
                { success: false, error: 'Internal Server Error' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
