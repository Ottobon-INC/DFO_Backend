import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../../infrastructure/audit/audit.service';
import { ConsentRepository } from './consent.repository';
import {
  ConsentCheckRequest,
  ConsentCheckResponse,
  ConsentPreferences
} from './consent.schema';

@Injectable()
export class ConsentEnforcementService {
  private readonly logger = new Logger(ConsentEnforcementService.name);

  constructor(
    private readonly repository: ConsentRepository,
    private readonly audit: AuditService
  ) { }

  /**
   * Validates a communication request against patient consent preferences.
   */
  async checkConsent(request: ConsentCheckRequest): Promise<ConsentCheckResponse> {
    const { patient_id, communication_channel, message_type, urgency_level, timestamp } = request;
    const checkTime = new Date(timestamp || new Date().toISOString());

    // 1. Fetch Consent Data
    const preferences = await this.repository.getConsentByPatientId(patient_id);

    // 2. Fail-safe: Deny if data is missing
    if (!preferences) {
      return this.logAndReturn(patient_id, false, `No consent record found for patient ${patient_id}. Denying by default.`, false);
    }

    // 3. Rule Check: Communication Channel
    const isChannelAllowed = preferences.allowed_channels[communication_channel];
    if (isChannelAllowed === false) {
      return this.logAndReturn(patient_id, false, `Channel '${communication_channel}' is explicitly disabled by patient.`, false);
    }

    // 4. Rule Check: Message Type
    const isTypeAllowed = preferences.allowed_message_types.includes(message_type);
    if (!isTypeAllowed) {
      return this.logAndReturn(patient_id, false, `Message type '${message_type}' is not in the allowed list.`, false);
    }

    // 5. Rule Check: Quiet Hours
    const isInsideQuietHours = this.isTimeInQuietHours(checkTime, preferences.quiet_hours.start_time, preferences.quiet_hours.end_time);

    // 6. Emergency Logic: Override quiet hours if critical
    if (isInsideQuietHours) {
      if (urgency_level === 'critical') {
        return this.logAndReturn(patient_id, true, `Emergency override: Critical urgency bypassed quiet hours.`, true);
      } else {
        return this.logAndReturn(patient_id, false, `Current time is within patient's quiet hours (${preferences.quiet_hours.start_time} - ${preferences.quiet_hours.end_time}).`, false);
      }
    }

    // 7. Final Success
    return this.logAndReturn(patient_id, true, 'Communication complies with all consent preferences.', false);
  }

  /**
   * Updates or creates consent preferences for a patient.
   */
  async saveConsent(patientId: string, clinicId: string, preferences: ConsentPreferences): Promise<boolean> {
    const success = await this.repository.saveConsent(patientId, clinicId, preferences);

    if (success) {
      this.audit.log(
        'system',
        'UPDATE',
        'PATIENT',
        patientId,
        'Patient communication consent preferences updated'
      );
      this.logger.log(`Consent preferences updated for patient ${patientId}`);
    }

    return success;
  }

  private isTimeInQuietHours(checkDate: Date, startStr: string, endStr: string): boolean {
    const timeToMinutes = (str: string) => {
      const [h, m] = str.split(':').map(Number);
      return h * 60 + m;
    };

    const currentMinutes = checkDate.getHours() * 60 + checkDate.getMinutes();
    const startMinutes = timeToMinutes(startStr);
    const endMinutes = timeToMinutes(endStr);

    if (startMinutes < endMinutes) {
      // Quiet hours in same day (e.g., 22:00 to 07:00 is NOT this case, 14:00 to 16:00 IS)
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Quiet hours spans midnight (e.g., 22:00 to 07:00)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  }

  private logAndReturn(patientId: string, allowed: boolean, reason: string, overridden: boolean): ConsentCheckResponse {
    const status = allowed ? 'GRANTED' : 'DENIED';

    // Audit Logging
    this.audit.log(
      'system',
      'READ',
      'PATIENT', // Using PATIENT resource type for consent checks
      patientId,
      `Consent ${status}: ${reason}`
    );

    if (!allowed) {
      this.logger.warn(`Consent Denied for patient ${patientId}: ${reason}`);
    } else {
      this.logger.log(`Consent Granted for patient ${patientId}: ${reason}`);
    }

    return { allowed, reason, overridden };
  }
}
