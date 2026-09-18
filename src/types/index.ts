export enum ThreadStatus {
    GREEN = 'green',
    YELLOW = 'yellow',
    RED = 'red',
}

export enum OwnershipType {
    AI = 'AI',
    HUMAN = 'HUMAN',
}

export enum Channel {
    WEB = 'web',
    MOBILE = 'mobile',
    API = 'api',
}

export interface Thread {
    id: string;
    domain: string;
    user_id: string;
    channel: Channel;
    status: ThreadStatus;
    ownership: OwnershipType;
    assigned_role?: string;
    assigned_user_id?: string;
    is_locked: boolean;
    version: number;
    metadata?: Record<string, any>;
    created_at: Date;
    updated_at: Date;
}

export interface Message {
    id: string;
    thread_id: string;
    sender_id: string;
    sender_type: 'USER' | 'AI' | 'HUMAN';
    content: string;
    created_at: Date;
}

export interface SentimentEvaluation {
    id: string;
    thread_id: string;
    message_id: string;
    score: number;
    label: string;
    tags?: string[];
    provider: string;
    created_at: Date;
}

export interface AuditLog {
    id: string;
    thread_id?: string;
    actor_id: string;
    actor_type: 'HUMAN' | 'AI' | 'SYSTEM';
    action?: string;   // Deprecated: migrate to event_type
    event_type?: string; // The real database column
    payload: Record<string, any>;
    created_at: Date;
}
