import { Intent, Role } from './types';
import { INTENT_CONFIG } from './config';

export class Gatekeeper {
    static authorize(role: Role | string, intent: Intent): { allowed: boolean; reason?: string } {
        const config = INTENT_CONFIG[intent];

        if (!config) {
            return { allowed: false, reason: 'Unknown intent configuration' };
        }

        const normalizedRole = role.toLowerCase();

        if (config.allowedRoles.some(r => r.toLowerCase() === normalizedRole)) {
            return { allowed: true };
        }

        return {
            allowed: false,
            reason: `Access denied. Role '${role}' is not authorized for intent '${intent}'.`
        };
    }
}
