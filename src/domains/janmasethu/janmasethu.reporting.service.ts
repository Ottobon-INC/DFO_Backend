import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuEncryptionService } from './utils/encryption.service';
import { DFOPatient } from './dfo.types';

@Injectable()
export class JanmasethuReportingService {
    private readonly logger = new Logger(JanmasethuReportingService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly encryption: JanmasethuEncryptionService,
    ) { }

    /**
     * GENERATE COMPREHENSIVE JOURNEY REPORT
     * Aggregates Risk Logs, Appointments, Consultations and Prescriptions
     */
    async generateJourneyReport(patientId: string) {
        this.logger.log(`Generating Full Pregnancy Journey Report for patient ${patientId}`);

        // 1. Fetch Patient Profile (Decrypted for Report)
        const patientRaw = await this.repository.findPatientProfile(patientId);
        if (!patientRaw) throw new NotFoundException('Patient record not found for reporting.');

        const patient = {
            ...patientRaw,
            full_name: this.encryption.decrypt(patientRaw.full_name),
        };

        // 2. Aggregate Data Streams
        const riskLogs = await this.repository.findRiskLogsByPatient(patientId, 50);
        const { consultations, reports } = await this.repository.findPatientHistory(patientId);
        const workload = await this.repository.findWorkload();

        // 3. Assemble Medical Journey
        return {
            metadata: {
                reportId: `REP-${Date.now()}`,
                generatedAt: new Date(),
                clinicianContext: 'Janmasethu DFO Auto-Gen',
            },
            patient: {
                name: patient.full_name,
                id: patient.id,
                currentStage: patient.journey_stage,
                pregnancyWeek: patient.pregnancy_stage,
            },
            clinicalSummary: {
                totalUrgentAlerts: riskLogs.filter(l => l.risk_level === 'red').length,
                totalConsultations: consultations?.length || 0,
            },
            riskTrajectory: riskLogs.map(log => ({
                date: log.created_at,
                level: log.risk_level,
                finding: log.reasoning || 'N/A'
            })),
            medicationHistory: this.consolidatePrescriptions(consultations || []),
            consultationNotes: (consultations || []).map(c => ({
                date: c.start_time,
                doctor: workload.find(d => d.id === c.doctor_id)?.full_name || 'Clinic Staff',
                notes: c.clinical_notes || 'No notes recorded.'
            }))
        };
    }

    private consolidatePrescriptions(consultations: any[]) {
        const meds: any[] = [];
        consultations.forEach(c => {
            if (c.dfo_prescriptions) {
                meds.push(...c.dfo_prescriptions);
            }
        });
        return meds;
    }
}
