import { Intent, IntentConfig } from './types';

export const INTENT_CONFIG: Record<Intent, IntentConfig> = {
    [Intent.GET_STALLING_LEADS]: {
        intent: Intent.GET_STALLING_LEADS,
        allowedRoles: ['admin', 'cro'],
        sanitization: {
            allowedFields: ['leads', 'total_count', 'status', 'reason', 'assigned_to_user_id', 'date_added', 'age', 'gender', 'inquiry', 'source'],
        },
        description: 'Fetch leads that are stalling or have not been followed up recently.',
    },
    [Intent.GET_TODAY_APPOINTMENTS]: {
        intent: Intent.GET_TODAY_APPOINTMENTS,
        allowedRoles: ['admin', 'cro', 'doctor', 'front_desk'],
        sanitization: {
            allowedFields: ['total_count', 'breakdown', 'my_appointments_count'],
        },
        description: 'Check schedule, count appointments, or see what is coming up today.',
    },
    [Intent.GET_WAITING_PATIENTS]: {
        intent: Intent.GET_WAITING_PATIENTS,
        allowedRoles: ['admin', 'cro', 'front_desk'],
        sanitization: {
            allowedFields: ['total_waiting', 'max_wait_time_minutes', 'long_wait_count'],
        },
        description: 'Check if anyone is waiting, who is waiting, or queue status.',
    },
    [Intent.GET_CLINIC_SUMMARY]: {
        intent: Intent.GET_CLINIC_SUMMARY,
        allowedRoles: ['admin', 'cro'],
        sanitization: {
            allowedFields: ['total_leads_today', 'total_appointments_today', 'total_waiting_patients', 'stalling_leads_count'],
        },
        description: 'Get a high-level overview or summary of the clinic status today.',
    },
    [Intent.ACTION_CHECK_IN_PATIENT]: {
        intent: Intent.ACTION_CHECK_IN_PATIENT,
        allowedRoles: ['cro', 'front_desk'],
        sanitization: {
            allowedFields: ['id', 'patientName', 'time', 'doctorName'],
        },
        description: 'Check in a patient who has arrived for their appointment.',
        confirmationRequired: true
    },
    [Intent.ACTION_MARK_APPOINTMENT_COMPLETED]: {
        intent: Intent.ACTION_MARK_APPOINTMENT_COMPLETED,
        allowedRoles: ['cro'],
        sanitization: {
            allowedFields: ['id', 'patientName', 'time', 'doctorName'],
        },
        description: 'Mark a checked-in appointment as completed.',
        confirmationRequired: true
    },
    [Intent.ACTION_MARK_PATIENT_NO_SHOW]: {
        intent: Intent.ACTION_MARK_PATIENT_NO_SHOW,
        allowedRoles: ['cro'],
        sanitization: {
            allowedFields: ['id', 'patientName', 'time', 'doctorName'],
        },
        description: 'Mark a scheduled appointment as a no-show.',
        confirmationRequired: true
    },
    [Intent.UNKNOWN]: {
        intent: Intent.UNKNOWN,
        allowedRoles: ['admin', 'cro', 'doctor', 'front_desk'],
        sanitization: { allowedFields: [] },
        description: 'Fallback when the intent is not recognized.',
    },
};
