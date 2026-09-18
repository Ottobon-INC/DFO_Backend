import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JanmasethuEncryptionService {
    private readonly logger = new Logger(JanmasethuEncryptionService.name);
    private readonly ALGORITHM = 'aes-256-gcm';
    private readonly IV_LENGTH = 16;
    private readonly TAG_LENGTH = 16;

    constructor(private readonly configService: ConfigService) { }

    private getKey(): Buffer {
        const secret = this.configService.get<string>('ENCRYPTION_KEY');
        if (!secret) {
            throw new Error('ENCRYPTION_KEY is not defined in environment');
        }

        const keyBuffer = Buffer.from(secret, 'hex');
        if (keyBuffer.length !== 32) {
            this.logger.error(`[CRITICAL] Invalid Key Length! Expected 32 bytes (64 hex chars), got ${keyBuffer.length}.`);
            throw new Error('Invalid ENCRYPTION_KEY length');
        }

        return keyBuffer;
    }

    /**
     * Encrypts plaintext using AES-256-GCM.
     * Format: iv:authTag:encrypted
     */
    encrypt(text: string): string {
        if (!text) return text;

        try {
            const iv = crypto.randomBytes(this.IV_LENGTH);
            const key = this.getKey();

            const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const tag = cipher.getAuthTag();

            return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
        } catch (error) {
            this.logger.error('Encryption failed:', error);
            throw error;
        }
    }

    /**
     * Decrypts ciphertext with fallback to plaintext (for migration).
     */
    decrypt(text: string): string {
        if (!text) return text;

        try {
            const parts = text.split(':');
            if (parts.length !== 3) {
                // Assuming it's legacy/plain text if doesn't match format
                return text;
            }

            const [ivHex, tagHex, encryptedHex] = parts;

            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            const key = this.getKey();

            const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
            decipher.setAuthTag(tag);

            let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            this.logger.warn(`Decryption failed for string beginning ${text.substring(0, 5)}... Falling back to original.`);
            return text;
        }
    }
}
