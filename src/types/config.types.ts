import { ThreadStatus } from './index';

export interface DomainConfig {
    sentimentThresholds: {
        red: number;
        yellow: number;
    };
    guardrailPolicy: {
        blockedKeywords: string[];
        escalateOnKeyword: boolean;
    };
    escalationMatrix: {
        defaultRole: string;
        criticalRole: string;
    };
}

export type GlobalConfig = Record<string, DomainConfig>;
