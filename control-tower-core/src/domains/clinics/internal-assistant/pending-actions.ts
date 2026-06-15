import { ActionIntent } from './types';
import * as crypto from 'crypto';

export interface PendingAction {
    token: string;
    userId: string;
    actionType: ActionIntent;
    payload: any;
    createdAt: number;
}

const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 Minutes

class PendingActionStore {
    private store: Map<string, PendingAction> = new Map();

    createToken(userId: string, actionType: ActionIntent, payload: any): string {
        const token = crypto.randomUUID();
        const action: PendingAction = {
            token,
            userId,
            actionType,
            payload,
            createdAt: Date.now()
        };
        this.store.set(token, action);
        return token;
    }

    consumeToken(token: string): PendingAction | null {
        const action = this.store.get(token);

        if (!action) return null;

        if (Date.now() - action.createdAt > TOKEN_EXPIRY_MS) {
            this.store.delete(token);
            return null;
        }

        this.store.delete(token);
        return action;
    }

    cleanup() {
        const now = Date.now();
        for (const [key, val] of this.store.entries()) {
            if (now - val.createdAt > TOKEN_EXPIRY_MS) {
                this.store.delete(key);
            }
        }
    }
}

export const PendingActions = new PendingActionStore();
