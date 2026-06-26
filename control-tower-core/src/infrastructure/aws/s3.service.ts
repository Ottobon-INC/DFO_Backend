import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
    private readonly logger = new Logger(S3Service.name);
    private readonly s3Client: S3Client;
    private readonly bucketName: string;

    constructor(private configService: ConfigService) {
        const region = this.configService.get<string>('AWS_REGION', 'ap-south-2');
        const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
        this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME') || '';

        if (!accessKeyId || !secretAccessKey || !this.bucketName) {
            this.logger.warn('AWS credentials or bucket name are missing in environment variables. S3 uploads may fail.');
        }

        this.s3Client = new S3Client({
            region,
            credentials: {
                accessKeyId: accessKeyId || '',
                secretAccessKey: secretAccessKey || '',
            },
        });
    }

    /**
     * Generates a presigned URL that allows a client to upload a file directly to S3.
     * The URL will be valid for 5 minutes.
     * 
     * @param clinicId The ID of the clinic.
     * @param filename The name of the file being uploaded.
     * @param documentType The category of the document (e.g., 'prescriptions', 'lab-reports', 'notes'). Defaults to 'staging'.
     * @returns A promise that resolves to the presigned upload URL and the path.
     */
    async generatePresignedUploadUrl(clinicId: string, filename: string, documentType: string = 'staging'): Promise<{ uploadUrl: string; path: string }> {
        // Sanitize the filename to avoid unexpected behavior
        const safeFilename = filename.replace(/\s+/g, '_');
        
        // Sanitize the document type to avoid directory traversal
        const safeDocumentType = documentType.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'staging';
        
        // Define the exact S3 key (path) based on requirements
        const path = `clinics/${clinicId}/${safeDocumentType}/${Date.now()}-${safeFilename}`;

        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: path,
            // You can also restrict content type if needed
            // ContentType: 'application/pdf', 
        });

        try {
            // URL expires in 300 seconds (5 minutes)
            const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
            return { uploadUrl, path };
        } catch (error) {
            this.logger.error(`Failed to generate presigned URL for clinic ${clinicId}:`, error);
            throw new Error('Could not generate secure upload ticket.');
        }
    }

    /**
     * Generates a presigned URL that allows a client to download a file from S3.
     * The URL will be valid for 1 hour.
     * 
     * @param path The full S3 object key (path).
     * @returns A promise that resolves to the presigned download URL.
     */
    async generatePresignedDownloadUrl(path: string): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: path,
        });

        try {
            // URL expires in 3600 seconds (1 hour)
            return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
        } catch (error) {
            this.logger.error(`Failed to generate presigned download URL for path ${path}:`, error);
            throw new Error('Could not generate secure download link.');
        }
    }
    /**
     * Physically deletes a file from the S3 bucket.
     * 
     * @param path The full S3 object key (path).
     */
    async deleteFile(path: string): Promise<void> {
        if (!path) return;
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: path,
        });

        try {
            await this.s3Client.send(command);
            this.logger.log(`Successfully deleted file from S3: ${path}`);
        } catch (error) {
            this.logger.error(`Failed to delete file from S3 at path ${path}:`, error);
            // We log but don't strictly throw to avoid breaking the DB transaction
            // in case the file was already deleted or bucket policies blocked it.
        }
    }
}
