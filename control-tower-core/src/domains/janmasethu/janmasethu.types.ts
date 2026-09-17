export interface JanmasethuPatientProfile {
    id: string;
    full_name: string;
    phone_number?: string;
    pregnancy_stage: number;
    journey_stage: string;
    clinical_risk_category: 'high' | 'low' | 'gestational_diabetes';
    medical_history: any[];
    engagement_preferences?: { opt_out_all: boolean };
}

export interface JanmasethuRiskLog {
    id: string;
    patient_id: string;
    thread_id: string;
    message_id?: string;
    risk_score: number;
    risk_level: string;
    signals: Record<string, number>;
    reasoning: string;
    created_at: Date;
}

export interface JanmasethuSummary {
    thread_id: string;
    summary_text: string;
    structured_symptoms: string[];
    timeline_json: any;
}

export interface JanmasethuClinicianWorkload {
    clinician_id: string;
    specialization: string[];
    active_threads: number;
    max_capacity: number;
}

export enum JanmasethuUserRole {
    CRO = 'CRO',
    DOCTOR = 'DOCTOR',
    NURSE = 'NURSE',
    FRONTDESK = 'FRONTDESK',
}

export enum JanmasethuPermission {
    VIEW_THREAD = 'VIEW_THREAD',
    ASSIGN_THREAD = 'ASSIGN_THREAD',
    TAKE_CONTROL = 'TAKE_CONTROL',
    REPLY = 'REPLY',
    OVERRIDE_SLA = 'OVERRIDE_SLA',
    VIEW_PII = 'VIEW_PII',
}

export interface JanmasethuUserContext {
    id: string;
    role: JanmasethuUserRole;
    clinicId?: string;
    clinic_id?: string;
}

export enum JanmasethuRole {
    DOCTOR_QUEUE = 'DOCTOR_QUEUE',
    NURSE_QUEUE = 'NURSE_QUEUE',
}

export const JANMASETHU_DOMAIN = 'janmasethu';

export interface JanmasethuEscalationRule {
    status: 'green' | 'yellow' | 'red';
    targetRole?: JanmasethuRole;
    ownership: 'AI' | 'HUMAN';
}

export const ESCALATION_RULES: Record<string, JanmasethuEscalationRule> = {
    red: { status: 'red', targetRole: JanmasethuRole.DOCTOR_QUEUE, ownership: 'HUMAN' },
    yellow: { status: 'yellow', targetRole: JanmasethuRole.NURSE_QUEUE, ownership: 'HUMAN' },
    green: { status: 'green', ownership: 'AI' },
};

/**
 * SLA CONFIGURATION
 * NURSE_RESPONSE: 10 mins (Yellow), 3 mins (Red - first response)
 * DOCTOR_RESPONSE: 5 mins (Red - escalation)
 */
export const JANMASETHU_SLA = {
    NURSE: {
        YELLOW: 10 * 60 * 1000,
        RED: 3 * 60 * 1000,
    },
    DOCTOR: {
        RED: 5 * 60 * 1000,
    }
};
