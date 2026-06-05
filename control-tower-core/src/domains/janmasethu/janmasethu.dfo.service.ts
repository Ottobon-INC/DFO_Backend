import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuEncryptionService } from './utils/encryption.service';
import {
    DFOPatient, DFOAppointment, DFOConsultation, JourneyStage,
    AppointmentStatus, ConsultationStatus, DFOPrescription, DFOMedicalReport
} from './dfo.types';

import { EngagementService } from './engagement/engagement.service';
import { isValidPhoneNumber } from './janmasethu.leads.service';

@Injectable()
export class JanmasethuDFOService implements OnModuleInit {
    private readonly logger = new Logger(JanmasethuDFOService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly engagementService: EngagementService,
        private readonly encryption: JanmasethuEncryptionService,
    ) { }

    async onModuleInit() {
        this.logger.log('DFO Clinical Engine initialized (Seeding handled by Maintenance Engine).');
    }

    /**
     * OMNICHANNEL PATIENT IDENTITY (Continuity)
     */
    async registerOrUpdatePatient(dto: Partial<DFOPatient>): Promise<DFOPatient> {
        this.logger.debug(`Synchronizing patient identity: ${dto.phone_number || dto.id}`);
        
        // 1. Strict Phone Integrity Validation
        if (dto.phone_number && !isValidPhoneNumber(dto.phone_number)) {
            throw new Error(`Invalid Phone Number: "${dto.phone_number}" is fake or sequential.`);
        }

        const existing = await this.repository.findPatientByResolution(dto.phone_number, dto.auth_user_id);
        const payload = { ...dto, updated_at: new Date() };

        // 2. Symmetric Vault Encryption mapping to avoid plaintext leaks
        if (dto.full_name) {
            payload.full_name = this.encryption.encrypt(dto.full_name);
        }
        if (dto.phone_number) {
            payload.phone_number = this.encryption.encrypt(dto.phone_number);
        }

        const patient = await this.repository.upsertDFOPatient(payload);

        if (dto.last_thread_id) {
            await this.repository.linkThreadToPatient(dto.last_thread_id, patient.id);
        }
        return patient;
    }

    async getPatientProfile(patientId: string) {
        const profile = await this.repository.findPatientProfile(patientId);
        if (!profile) return null;

        // 3. CLEAR-TEXT DECRYPTION (For Clinician View)
        return {
            ...profile,
            full_name: this.encryption.decrypt(profile.full_name),
            phone_number: this.encryption.decrypt(profile.phone_number || ''),
        };
    }

    async getPatientHistory(patientId: string) {
        return this.repository.findPatientHistory(patientId);
    }

    async updateJourneyStage(patientId: string, stage: JourneyStage) {
        this.logger.log(`Updating patient ${patientId} journey stage to ${stage}`);
        const patient = await this.repository.upsertDFOPatient({ id: patientId, journey_stage: stage });
        await this.engagementService.scheduleStagedMessage(patientId, patient.pregnancy_stage || 0, stage);
    }

    async bookAppointment(dto: Partial<DFOAppointment>): Promise<DFOAppointment> {
        this.logger.log(`Booking appointment for patient ${dto.patient_id}`);
        const appt = await this.repository.createAppointment({
            ...dto,
            status: AppointmentStatus.SCHEDULED,
            reminders_sent: 0
        });
        await this.engagementService.triggerEventEngagement(dto.patient_id as string, 'APPT_REMINDER', {
            appointment_id: appt.id,
            delay_ms: new Date(appt.appointment_date).getTime() - Date.now() - 24 * 60 * 60 * 1000
        });
        return appt;
    }

    async startConsultation(threadId: string, doctorId: string): Promise<DFOConsultation> {
        this.logger.log(`Starting consultation: Thread ${threadId}`);
        
        // 4. Strict validation check boundaries on thread and linked patient
        const thread = await this.repository.findThreadById(threadId);
        if (!thread) {
            throw new Error(`Consultation startup failed: Thread "${threadId}" not found.`);
        }

        const patientId = thread.metadata?.patient_id;
        if (!patientId) {
            throw new Error(`Consultation startup failed: Thread "${threadId}" is not linked to any active patient profile.`);
        }

        return this.repository.startConsultation({
            thread_id: threadId,
            doctor_id: doctorId,
            patient_id: patientId,
            status: ConsultationStatus.OPEN,
            start_time: new Date()
        });
    }

    async createPatient(dto: any) {
        // 1. Strict Phone Integrity Validation
        if (dto.phone_number && !isValidPhoneNumber(dto.phone_number)) {
            throw new Error(`Invalid Phone Number: "${dto.phone_number}" is fake or sequential.`);
        }

        // 2. VAULT ENCRYPTION (For Database Safety)
        const securedDto = {
            ...dto,
            full_name: this.encryption.encrypt(dto.full_name),
            phone_number: this.encryption.encrypt(dto.phone_number),
        };
        return this.repository.upsertDFOPatient(securedDto);
    }

    async addPrescription(dto: DFOPrescription) {
        return this.repository.addPrescription(dto);
    }

    async uploadReport(dto: DFOMedicalReport) {
        return this.repository.uploadReportMetadata(dto);
    }

    async closeConsultation(consultationId: string, notes: string) {
        this.logger.log(`Closing consultation ${consultationId}`);
        await this.repository.updateConsultation(consultationId, {
            clinical_notes: notes,
            status: ConsultationStatus.CLOSED,
            end_time: new Date()
        });
    }

    async getDFOAnalytics() {
        return this.repository.findAnalyticsMetrics();
    }

    async getClinicalMetrics() {
        const today = new Date().toISOString().split('T')[0];
        return this.repository.findClinicalMetrics(today);
    }
}
