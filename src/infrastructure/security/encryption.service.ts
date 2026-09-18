import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
    private readonly logger = new Logger(EncryptionService.name);
    private readonly ALGORITHM = 'aes-256-gcm';
    private readonly IV_LENGTH = 16;
    private readonly TAG_LENGTH = 16;

    constructor(private readonly configService: ConfigService) { }

    private getKey(): Buffer {
        const secret = this.configService.get<string>('ENCRYPTION_KEY');
        if (!secret) {
            throw new Error('ENCRYPTION_KEY must be defined in environment configuration');
        }
        return Buffer.from(secret, 'hex');
    }

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
            this.logger.error('Encryption failed', error);
            throw error;
        }
    }

    decrypt(text: string): string {
        if (!text) return text;
        try {
            const parts = text.split(':');
            if (parts.length !== 3) return text;
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
            this.logger.warn('Decryption failed, returning original text');
            return text;
        }
    }
}
