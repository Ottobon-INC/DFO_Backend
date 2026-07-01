import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
    supabase: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_KEY,
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === 'true',
    },

    domains: {
        default: {
            sentimentThresholds: { red: 0.3, yellow: 0.6 },
            guardrailPolicy: { blockedKeywords: ['ssh', 'root', 'exec'], escalateOnKeyword: true },
            escalationMatrix: { defaultRole: 'SUPPORT_AGENT', criticalRole: 'SENIOR_ENGINEER' },
        },
        'e-commerce': {
            sentimentThresholds: { red: 0.4, yellow: 0.7 },
            guardrailPolicy: { blockedKeywords: ['refund', 'scam'], escalateOnKeyword: true },
            escalationMatrix: { defaultRole: 'RETAIL_SUPPORT', criticalRole: 'FINANCE_MANAGER' },
        },
    },
    hardening: {
        escalationSlaTimeout: parseInt(process.env.ESCALATION_SLA_TIMEOUT || '300000', 10), // 5 min
        workerRetryAttempts: parseInt(process.env.WORKER_RETRY_ATTEMPTS || '3', 10),
        routingStaleTimeout: parseInt(process.env.ROUTING_STALE_TIMEOUT || '600000', 10), // 10 min
    },
}));


