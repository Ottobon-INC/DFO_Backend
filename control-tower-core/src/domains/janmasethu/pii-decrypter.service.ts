import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class PiiDecrypterService {
    private readonly logger = new Logger(PiiDecrypterService.name);
    private fernetKey: Buffer | null = null;

    constructor() {
        this.initializeKey();
    }

    private initializeKey() {
        try {
            // Read Chatbot master key or PII secret key from env variables
            const secret = process.env.PII_SECRET_KEY || 'dev_static_secret_key_123_must_be_changed_in_prod';
            let keyStr = secret;
            if (keyStr.length < 32) {
                keyStr = keyStr.padEnd(32, '0');
            }

            let derivedKey: Buffer;
            if (keyStr.length === 44 && keyStr.endsWith('=')) {
                derivedKey = Buffer.from(keyStr, 'base64');
            } else {
                const salt = Buffer.from('sakhi_static_salt');
                derivedKey = crypto.pbkdf2Sync(Buffer.from(secret), salt, 100000, 32, 'sha256');
            }
            
            this.fernetKey = derivedKey;
        } catch (e) {
            this.logger.error('Failed to initialize PII decryption key:', e);
        }
    }

    public decrypt(cipherTextB64: string): string {
        if (!cipherTextB64 || !this.fernetKey) {
            return cipherTextB64;
        }
        try {
            const base64 = cipherTextB64.replace(/-/g, '+').replace(/_/g, '/');
            const token = Buffer.from(base64, 'base64');

            if (token.length < 57) {
                throw new Error('Token too short');
            }

            const version = token.readUInt8(0);
            if (version !== 0x80) {
                throw new Error('Invalid Fernet version: ' + version);
            }

            const timestamp = token.slice(1, 9);
            const iv = token.slice(9, 25);
            const ciphertext = token.slice(25, token.length - 32);
            const hmac = token.slice(token.length - 32);

            const signingKey = this.fernetKey.slice(0, 16);
            const encryptionKey = this.fernetKey.slice(16, 32);

            const hmacInput = Buffer.concat([token.slice(0, 1), timestamp, iv, ciphertext]);
            const calculatedHmac = crypto.createHmac('sha256', signingKey).update(hmacInput).digest();

            if (!crypto.timingSafeEqual(calculatedHmac, hmac)) {
                throw new Error('HMAC verification failed');
            }

            const decipher = crypto.createDecipheriv('aes-128-cbc', encryptionKey, iv);
            let decrypted = decipher.update(ciphertext);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            return decrypted.toString('utf8');
        } catch (e) {
            this.logger.warn(`PII Decryption failed: ${e.message}`);
            return '[Decryption Error]';
        }
    }
}
