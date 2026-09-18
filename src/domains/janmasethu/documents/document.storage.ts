import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

const STORAGE_BUCKET = 'document';
const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * DocumentStorageService
 *
 * Handles all Supabase Storage interactions:
 *   - Uploading clinical document buffers
 *   - Generating short-lived signed URLs for access
 *   - Deleting files (for cleanup on failure)
 *
 * IMPORTANT: This service NEVER stores signed URLs — only file_path.
 * Signed URLs are generated dynamically on every access request.
 */
@Injectable()
export class DocumentStorageService {
    private readonly logger = new Logger(DocumentStorageService.name);

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
    ) { }

    /**
     * BUILD FILE PATH
     * Constructs a deterministic, hierarchical storage path.
     * Pattern: /patients/{patient_id}/consultations/{consultation_id}/{filename}
     */
    buildFilePath(patientId: string, consultationId: string, fileName: string): string {
        return `patients/${patientId}/consultations/${consultationId}/${fileName}`;
    }

    /**
     * UPLOAD FILE TO SUPABASE STORAGE
     * Uploads a Buffer to the private 'documents' bucket.
     * Returns the file path (NOT the URL).
     */
    async upload(
        filePath: string,
        fileBuffer: Buffer,
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ): Promise<{ path: string; size: number }> {
        this.logger.log(`Uploading document to Supabase Storage: ${filePath}`);

        const { data, error } = await this.supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, fileBuffer, {
                contentType: mimeType,
                upsert: true,   // Overwrite on re-generation (versioned at DB level)
            });

        if (error) {
            this.logger.error(`Storage upload failed: ${error.message}`);
            throw new Error(`Supabase Storage upload failed: ${error.message}`);
        }

        this.logger.log(`Upload successful: ${data.path}`);
        return { path: data.path, size: fileBuffer.length };
    }

    /**
     * GENERATE SIGNED URL
     * Creates a temporary, expiry-based access URL for a stored document.
     * Signed URLs are NEVER stored in the database.
     *
     * @param filePath The storage file_path from the dfo_documents table
     * @param expiresInSeconds Duration for signed URL validity (default: 1 hour)
     */
    async generateSignedUrl(
        filePath: string,
        expiresInSeconds: number = SIGNED_URL_EXPIRY_SECONDS
    ): Promise<{ signedUrl: string; expiresAt: Date }> {
        this.logger.log(`Generating signed URL for: ${filePath} (expires: ${expiresInSeconds}s)`);

        const { data, error } = await this.supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(filePath, expiresInSeconds);

        if (error || !data?.signedUrl) {
            this.logger.error(`Signed URL generation failed: ${error?.message}`);
            throw new Error(`Failed to generate signed URL: ${error?.message}`);
        }

        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
        return { signedUrl: data.signedUrl, expiresAt };
    }

    /**
     * DELETE FILE FROM STORAGE
     * Used only when document generation fails after partial upload,
     * or when a document is permanently removed.
     */
    async deleteFile(filePath: string): Promise<void> {
        const { error } = await this.supabase.storage
            .from(STORAGE_BUCKET)
            .remove([filePath]);

        if (error) {
            this.logger.warn(`Storage delete failed for ${filePath}: ${error.message}`);
        }
    }

    /**
     * CHECK IF FILE EXISTS
     * Used by the idempotency layer to confirm upload integrity.
     */
    async fileExists(filePath: string): Promise<boolean> {
        const { data } = await this.supabase.storage
            .from(STORAGE_BUCKET)
            .list(filePath.substring(0, filePath.lastIndexOf('/')));

        const fileName = filePath.split('/').pop();
        return (data || []).some(f => f.name === fileName);
    }
}
