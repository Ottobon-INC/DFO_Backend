import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DocumentService } from './document.service';
import { GenerateDocumentJobPayload } from './document.types';

/**
 * DocumentWorker
 *
 * BullMQ processor for the document_generation_queue.
 * Runs in the background — the API never blocks waiting for DOCX generation.
 *
 * Retry strategy: 3 attempts with exponential backoff (5s, 25s, 125s).
 * Failed jobs remain in the queue for inspection; the dfo_documents record
 * is marked as 'failed' with the error message for observability.
 */
@Processor('document_generation_queue')
@Injectable()
export class DocumentWorker extends WorkerHost {
    private readonly logger = new Logger(DocumentWorker.name);

    constructor(private readonly documentService: DocumentService) {
        super();
    }

    async process(job: Job<GenerateDocumentJobPayload>): Promise<any> {
        const { idempotency_key, prescription_id, patient_id, type } = job.data;

        this.logger.log(
            `📄 Processing Document Job | ID: ${job.id} | Key: ${idempotency_key} | Type: ${type}`
        );

        try {
            // Using the new HTML-to-PDF pipeline as requested
            await this.documentService.executePdfGeneration(job.data);

            this.logger.log(
                `✅ Document Job Completed | Prescription: ${prescription_id} | Patient: ${patient_id}`
            );

            return { success: true, prescription_id };

        } catch (error) {
            this.logger.error(
                `❌ Document Job Failed | Attempt ${job.attemptsMade + 1}/3 | Error: ${error.message}`
            );

            // Re-throw to trigger BullMQ retry mechanism
            throw error;
        }
    }
}
