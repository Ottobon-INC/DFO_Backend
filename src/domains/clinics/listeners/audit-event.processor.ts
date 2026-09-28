import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { BaseEvent, DocumentEvent, PatientEvent, AppointmentEvent, LeadEvent, StaffEvent, AuthEvent, AdmissionEvent } from '../../../infrastructure/events/event-payloads';

@Processor('dfo_events_queue')
export class AuditEventProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditEventProcessor.name);

  constructor(private readonly supabaseService: ClinicsSupabaseService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const eventName = job.name;
    const event = job.data as BaseEvent;

    // We allow system actor for background jobs
    const actorId = event.actorId || 'system';
    
    // Auth events might not have a clinic_id immediately (e.g. failed login)
    if (!event.clinicId && eventName !== 'auth.login.failed' && eventName !== 'auth.login.success' && eventName !== 'clinic.created') {
        this.logger.warn(`Skipping audit for event ${eventName} due to missing clinicId`);
        return;
    }

    try {
      let entityName = 'unknown';
      let entityId: string | null = null;
      let newValues = {};
      let action = 'unknown_event';

      if (event instanceof DocumentEvent || (event as any).documentId) {
        entityName = 'document';
        entityId = (event as any).documentId;
        newValues = (event as any).payload || {};
        action = newValues['action'] || eventName;
      } else if (event instanceof PatientEvent || (event as any).patientId) {
        entityName = 'patient';
        entityId = (event as any).patientId;
        newValues = (event as any).payload || {};
        action = newValues['action'] || eventName;
      } else if (event instanceof AppointmentEvent || (event as any).appointmentId) {
        entityName = 'appointment';
        entityId = (event as any).appointmentId;
        newValues = (event as any).payload || {};
        action = newValues['action'] || eventName;
      } else if (event instanceof LeadEvent || (event as any).leadId) {
        entityName = 'lead';
        entityId = (event as any).leadId;
        newValues = (event as any).payload || {};
        action = newValues['action'] || eventName;
      } else if (event instanceof AdmissionEvent || (event as any).admissionId) {
        entityName = 'admission';
        entityId = (event as any).admissionId;
        newValues = (event as any).payload || {};
        action = newValues['action'] || eventName;
      } else if (event instanceof StaffEvent || event instanceof AuthEvent || (event as any).payload) {
        entityName = event instanceof StaffEvent ? 'staff' : 'auth';
        newValues = (event as any).payload || {};
        action = newValues['action'] || eventName;
      }

      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.from('sakhi_audit_logs').insert([{
        clinic_id: event.clinicId || null, // null for some auth events
        actor_id: actorId,
        action,
        entity_name: entityName,
        entity_id: entityId,
        new_values: newValues,
        ip_address: '127.0.0.1', // Placeholder, could be captured in payload if needed
      }]);

      if (error) {
        this.logger.error(`Failed to insert audit log for ${eventName}:`, error);
        throw new Error(error.message); // Throw to trigger BullMQ retry
      }

      this.logger.log(`Audit log created for ${eventName} [${entityName}:${entityId}]`);
    } catch (error: any) {
      this.logger.error(`Error in AuditEventProcessor for ${eventName}:`, error.message);
      throw error; // Let BullMQ handle the retry mechanism
    }
  }
}
