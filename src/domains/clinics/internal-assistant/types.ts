export enum Intent {
    GET_STALLING_LEADS = 'GET_STALLING_LEADS',
    GET_TODAY_APPOINTMENTS = 'GET_TODAY_APPOINTMENTS',
    GET_WAITING_PATIENTS = 'GET_WAITING_PATIENTS',
    GET_CLINIC_SUMMARY = 'GET_CLINIC_SUMMARY',
    ACTION_CHECK_IN_PATIENT = 'ACTION_CHECK_IN_PATIENT',
    ACTION_MARK_APPOINTMENT_COMPLETED = 'ACTION_MARK_APPOINTMENT_COMPLETED',
    ACTION_MARK_PATIENT_NO_SHOW = 'ACTION_MARK_PATIENT_NO_SHOW',
    UNKNOWN = 'UNKNOWN',
}

export type ActionIntent =
    | Intent.ACTION_CHECK_IN_PATIENT
    | Intent.ACTION_MARK_APPOINTMENT_COMPLETED
    | Intent.ACTION_MARK_PATIENT_NO_SHOW;

export type Role = 'admin' | 'cro' | 'doctor' | 'front_desk';

export interface ChatRequest {
    message: string;
    confirmationToken?: string;
}

export interface ChatResponse {
    reply: string;
    intent?: Intent;
    actionRequired?: boolean;
    options?: any[];
}

export interface SanitizationRule {
    allowedFields: string[];
    hashFields?: string[];
}

export interface IntentConfig {
    intent: Intent;
    allowedRoles: Role[];
    sanitization: SanitizationRule;
    description: string;
    confirmationRequired?: boolean;
}
