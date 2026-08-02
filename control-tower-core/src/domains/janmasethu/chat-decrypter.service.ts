import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class ChatDecrypterService {
    private readonly logger = new Logger(ChatDecrypterService.name);
    private readonly masterKey: Buffer;

    constructor() {
        const envMasterKey = process.env.CHAT_MASTER_KEY || '';
        if (!envMasterKey) {
            this.logger.warn("CHAT_MASTER_KEY not found in environment. Using a temporary key (NOT SAFE FOR PROD).");
            this.masterKey = crypto.randomBytes(32);
        } else if (envMasterKey.length === 64) {
            this.masterKey = Buffer.from(envMasterKey, 'hex');
        } else {
            this.masterKey = Buffer.from(envMasterKey, 'utf8');
        }
    }

    private deriveUserKey(userId: string): Buffer {
        if (!userId) {
            throw new Error("User ID required for key derivation");
        }
        return Buffer.from(crypto.hkdfSync('sha256', this.masterKey, Buffer.from(userId, 'utf8'), Buffer.from('chat', 'utf8'), 32));
    }

    decrypt(userId: string, payloadB64: string): string {
        try {
            if (!payloadB64) return "";

            const key = this.deriveUserKey(userId);
            const combinedPayload = Buffer.from(payloadB64, 'base64');
            
            if (combinedPayload.length < 12) {
                return "[Invalid Encrypted Payload]";
            }

            const nonce = combinedPayload.subarray(0, 12);
            // AES-GCM includes a 16-byte auth tag at the end of the ciphertext
            const cipherBytes = combinedPayload.subarray(12, combinedPayload.length - 16);
            const authTag = combinedPayload.subarray(combinedPayload.length - 16);

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
            decipher.setAuthTag(authTag);
            
            let decrypted = decipher.update(cipherBytes);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            return decrypted.toString('utf8');
        } catch (e) {
            this.logger.error(`Decryption failed for user ${userId}:`, e);
            return "[Decryption Error]";
        }
    }

    encrypt(userId: string, text: string): string {
        try {
            if (!text) return "";

            const key = this.deriveUserKey(userId);
            const nonce = crypto.randomBytes(12);
            
            const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
            
            let ciphertext = cipher.update(Buffer.from(text, 'utf8'));
            ciphertext = Buffer.concat([ciphertext, cipher.final()]);
            const authTag = cipher.getAuthTag();
            
            // Append authTag to ciphertext to match Python's output
            const combinedPayload = Buffer.concat([nonce, ciphertext, authTag]);
            return combinedPayload.toString('base64');
        } catch (e) {
            this.logger.error(`Encryption failed for user ${userId}:`, e);
            throw e;
        }
    }
}
