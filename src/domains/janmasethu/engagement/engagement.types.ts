export enum EngagementTriggerType {
    STAGED = 'STAGED',
    SCHEDULED = 'SCHEDULED',
    EVENT = 'EVENT',
}

export enum EngagementJobType {
    STAGED_MSG = 'STAGED_MSG',
    MED_REMINDER = 'MED_REMINDER',
    APPT_REMINDER = 'APPT_REMINDER',
    FOLLOW_UP = 'FOLLOW_UP',
}

export interface EngagementTemplate {
    id: string;
    template_key: string;
    journey_stage: string;
    trigger_type: EngagementTriggerType;
    content: string;
    metadata?: Record<string, any>;
}

export interface PatientReminder {
    id: string;
    patient_id: string;
    reminder_type: string;
    title: string;
    schedule: {
        times: string[]; // ['09:00', '21:00']
        frequency: 'DAILY' | 'WEEKLY' | 'ONCE';
        interval?: number;
    };
    is_active: boolean;
    last_sent_at?: Date;
}

export interface EngagementLog {
    id: string;
    patient_id: string;
    template_id?: string;
    job_id?: string;
    channel: string;
    content: string;
    status: 'SENT' | 'DELIVERED' | 'FAILED';
    sent_at: Date;
}
