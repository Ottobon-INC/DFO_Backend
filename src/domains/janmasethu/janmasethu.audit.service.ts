import { Injectable, Logger } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuUserRole } from './janmasethu.types';
import { AuditService } from '../../kernel/audit/audit.service';

export enum AuditAction {
    PII_VIEW = 'PII_VIEW_ACCESS',
    RECORD_UPDATE = 'MEDICAL_RECORD_UPDATE',
    SECURITY_ALERT = 'SECURITY_THRESHOLD_EXCEEDED',
    SYSTEM_CONFIG = 'SYSTEM_CONFIGURATION_CHANGE'
}

@Injectable()
export class JanmasethuAuditService {
    private readonly logger = new Logger(JanmasethuAuditService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly kernelAudit: AuditService,
    ) { }

    /**
     * LOG PATIENT DATA ACCESS (PII Compliance)
     * Mandatory for HIPAA / Medical Laws.
     */
    async logPIIAccess(actorId: string, actorType: JanmasethuUserRole | 'AI' | 'SYSTEM', patientId: string, reason: string) {
        this.logger.warn(`AUDIT: [${actorType}] ${actorId} accessed PII for patient ${patientId}. Reason: ${reason}`);

        // Write 1: Centralized kernel permanent ledger with dynamic actor type mapping
        await this.kernelAudit.append({
            actor_id: actorId,
            actor_type: actorType,
            event_type: AuditAction.PII_VIEW,
            payload: { patient_id: patientId, reason, timestamp: new Date().toISOString() }
        } as any);

        // Write 2: Local Database SQL registry
        await this.repository.insertAuditLog({
            actor_id: actorId,
            actor_type: actorType,
            event_type: AuditAction.PII_VIEW,
            patient_id: patientId,
            payload: { reason, compliance: 'HIPAA_DPDP' }
        });
    }

    /**
     * LOG CLINICAL RECORD UPDATE
     */
    async logClinicalUpdate(actorId: string, action: string, patientId: string, change: any) {
        this.logger.log(`AUDIT: Clinical update for patient ${patientId} by ${actorId}: ${action}`);

        // Write 1: Centralized kernel permanent ledger
        await this.kernelAudit.append({
            actor_id: actorId,
            actor_type: 'HUMAN',
            event_type: AuditAction.RECORD_UPDATE,
            payload: { patient_id: patientId, action, change }
        } as any);

        // Write 2: Local Database SQL registry
        await this.repository.insertAuditLog({
            actor_id: actorId,
            actor_type: 'HUMAN',
            event_type: AuditAction.RECORD_UPDATE,
            patient_id: patientId,
            payload: { action, change }
        });
    }

    /**
     * FETCH AUDIT HISTORY (Compliance Review)
     */
    async getAuditHistory(limit: number = 100) {
        const logs = await this.kernelAudit.getAll();
        return logs.slice(0, limit);
    }
}

