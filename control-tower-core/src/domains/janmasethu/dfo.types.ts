export enum JourneyStage {
    TRYING_TO_CONCEIVE = 'trying_to_conceive',
    PREGNANT = 'pregnant',
    POSTPARTUM = 'postpartum',
    NOT_SPECIFIED = 'not_specified',
}

export interface DFOPatient {
    id: string;
    auth_user_id?: string;
    full_name: string;
    phone_number: string;
    email?: string;
    age?: number;
    journey_stage: JourneyStage;
    pregnancy_stage?: number;
    medical_history: any[];
    last_menstrual_period?: Date;
    estimated_due_date?: Date;
    created_at: Date;
    updated_at: Date;
    last_thread_id?: string;
    last_channel?: string;
    engagement_preferences?: {
        opt_out_all: boolean;
        preferred_channel: 'whatsapp' | 'web';
        quiet_hours: { start: string; end: string };
    };
    metadata?: Record<string, any>;
}

export interface DFODoctor {
    id: string;
    auth_user_id?: string;
    full_name: string;
    specialization: string[];
    is_available: boolean;
    work_hours: Record<string, string[]>;
}

export enum AppointmentStatus {
    SCHEDULED = 'scheduled',
    CANCELLED = 'cancelled',
    COMPLETED = 'completed',
    RESCHEDULED = 'rescheduled',
    MISSED = 'missed'
}

export interface DFOAppointment {
    id: string;
    patient_id: string;
    doctor_id: string;
    appointment_date: Date;
    status: AppointmentStatus;
    notes?: string;
    reminders_sent: number;
    clinic_id?: string;
}

export enum ConsultationStatus {
    OPEN = 'open',
    CLOSED = 'closed',
    ONGOING = 'ongoing'
}

export interface DFOConsultation {
    id?: string;
    patient_id: string;
    doctor_id: string;
    thread_id?: string;
    clinical_notes?: string;
    diagnosis_tags?: string[];
    status: ConsultationStatus;
    start_time: Date;
    end_time?: Date;
    created_at?: Date;
}

export interface DFOPrescription {
    id?: string;
    consultation_id: string;
    medication_name: string;
    dosage: string;
    frequency: string;
    duration_days: number;
    special_instructions?: string;
}

export interface DFOMedicalReport {
    id?: string;
    patient_id: string;
    consultation_id?: string;
    report_type: string;
    file_url: string;
    uploaded_at?: Date;
}

export interface DFOAnalytics {
    risk_distribution: Record<string, number>;
    sla_performance: number;
    total_patients: number;
    active_conversations: number;
    patient_journey_funnel: Record<string, number>;
    average_consultation_time: number;
}
