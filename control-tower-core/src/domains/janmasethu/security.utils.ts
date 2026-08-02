import * as crypto from 'crypto';

function deriveUserKey(userId: string): Buffer {
    let masterKeyRaw = process.env.CHAT_MASTER_KEY || '';
    let masterKey: Buffer;
    
    if (masterKeyRaw.length === 64) {
        try {
            masterKey = Buffer.from(masterKeyRaw, 'hex');
        } catch (e) {
            masterKey = Buffer.from(masterKeyRaw, 'utf8');
        }
    } else {
        masterKey = Buffer.from(masterKeyRaw, 'utf8');
    }

    if (masterKey.length === 0) {
        console.warn('CHAT_MASTER_KEY not found. Using temporary key.');
        masterKey = crypto.randomBytes(32);
    }

    // HKDF implementation in Node.js matches Python's cryptography HKDF
    return Buffer.from(crypto.hkdfSync(
        'sha256',
        masterKey,
        Buffer.from(userId, 'utf8'),
        Buffer.from('chat', 'utf8'),
        32
    ));
}

export function decryptMessage(userId: string, payloadB64: string): string {
    if (!payloadB64) return "";

    try {
        const key = deriveUserKey(userId);
        const combinedPayload = Buffer.from(payloadB64, 'base64');
        
        if (combinedPayload.length < 12) {
            return "[Invalid Encrypted Payload]";
        }

        const nonce = combinedPayload.subarray(0, 12);
        const cipherBytesWithTag = combinedPayload.subarray(12);
        
        if (cipherBytesWithTag.length < 16) {
            return "[Invalid Ciphertext Length]";
        }

        const ciphertext = cipherBytesWithTag.subarray(0, cipherBytesWithTag.length - 16);
        const authTag = cipherBytesWithTag.subarray(cipherBytesWithTag.length - 16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(authTag);

        let plaintext = decipher.update(ciphertext, undefined, 'utf8');
        plaintext += decipher.final('utf8');

        return plaintext;
    } catch (error) {
        console.error(`Decryption failed for user ${userId}:`, error);
        return "[Decryption Error]";
    }
}
