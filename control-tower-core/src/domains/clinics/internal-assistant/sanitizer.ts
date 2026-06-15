import { Intent } from './types';
import { INTENT_CONFIG } from './config';

export class Sanitizer {
    static sanitize(data: any, intent: Intent): any {
        const config = INTENT_CONFIG[intent];

        if (!config || !data) {
            return null;
        }

        const allowedFields = config.sanitization.allowedFields;

        if (Array.isArray(data)) {
            return data.map(item => this.sanitizeItem(item, allowedFields));
        }

        return this.sanitizeItem(data, allowedFields);
    }

    private static sanitizeItem(item: any, allowedFields: string[]): any {
        if (typeof item !== 'object' || item === null) {
            return item;
        }

        const sanitized: any = {};

        for (const field of allowedFields) {
            if (item[field] !== undefined) {
                sanitized[field] = item[field];
            }
        }

        return sanitized;
    }
}
