import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { basename } from 'path';

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
        // Strictly sanitize the filename to prevent path traversal
        const baseFilename = basename(filename);
        const safeFilename = baseFilename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        
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
     * Uploads a file buffer directly to S3.
     * 
     * @param path The full S3 object key (path).
     * @param fileBuffer The file content as a Buffer.
     * @param mimeType The MIME type of the file.
     * @returns A promise that resolves to the size of the uploaded file.
     */
    async uploadFile(path: string, fileBuffer: Buffer, mimeType: string): Promise<number> {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: path,
            Body: fileBuffer,
            ContentType: mimeType,
        });

        try {
            await this.s3Client.send(command);
            this.logger.log(`Successfully uploaded file to S3: ${path}`);
            return fileBuffer.length;
        } catch (error) {
            this.logger.error(`Failed to upload file to S3 at path ${path}:`, error);
            throw new Error('Could not upload file to S3.');
        }
    }

    /**
     * Generates a presigned URL that allows a client to download a file from S3.
     * The URL will be valid for the specified duration (default 1 hour).
     * 
     * @param path The full S3 object key (path).
     * @param expiresIn Expiration time in seconds (default 3600).
     * @param downloadFilename Optional original filename to force as download attachment.
     * @returns A promise that resolves to the presigned download URL.
     */
    async generatePresignedDownloadUrl(path: string, expiresIn: number = 3600, downloadFilename?: string): Promise<string> {
        const commandParams: any = {
            Bucket: this.bucketName,
            Key: path,
        };

        if (downloadFilename) {
            // Sanitize filename to prevent HTTP header injection
            const safeName = downloadFilename.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
            // Use 'inline' instead of 'attachment' so the frontend can preview PDFs in iframes
            commandParams.ResponseContentDisposition = `inline; filename="${safeName}"`;
        }

        const command = new GetObjectCommand(commandParams);

        try {
            return await getSignedUrl(this.s3Client, command, { expiresIn });
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

    /**
     * Checks if a file exists in the S3 bucket using HeadObjectCommand.
     * 
     * @param path The full S3 object key (path).
     * @returns True if object exists, false otherwise.
     */
    async fileExists(path: string): Promise<boolean> {
        if (!path) return false;
        try {
            await this.s3Client.send(new HeadObjectCommand({
                Bucket: this.bucketName,
                Key: path,
            }));
            return true;
        } catch (error: any) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                return false;
            }
            this.logger.warn(`S3 fileExists check for ${path}: ${error?.message || error}`);
            return false;
        }
    }
}
