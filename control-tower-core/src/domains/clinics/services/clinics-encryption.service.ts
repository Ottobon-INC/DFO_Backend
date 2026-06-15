import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

@Injectable()
export class ClinicsEncryptionService {
    private readonly logger = new Logger(ClinicsEncryptionService.name);
    private readonly key: Buffer;

    constructor(private readonly configService: ConfigService) {
        const secret = this.configService.get<string>('ENCRYPTION_KEY');
        if (!secret) {
            this.logger.warn('ENCRYPTION_KEY is not defined — encryption/decryption will be passthrough');
            this.key = Buffer.alloc(32); // dummy key, encrypt/decrypt will be passthrough
        } else {
            this.key = Buffer.from(secret, 'hex');
            if (this.key.length !== 32) {
                this.logger.error(`Invalid ENCRYPTION_KEY length: expected 32 bytes, got ${this.key.length}`);
            }
        }
    }

    encrypt(text: string): string {
        if (!text) return text;
        if (this.key.every((b) => b === 0)) return text; // passthrough if no key

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const tag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    }

    decrypt(text: string): string {
        if (!text) return text;

        try {
            const parts = text.split(':');
            if (parts.length !== 3) {
                return text; // Legacy/plain text
            }

            const [ivHex, tagHex, encryptedHex] = parts;
            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');

            const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
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
