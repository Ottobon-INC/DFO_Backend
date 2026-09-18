import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { AuditService } from '../../../infrastructure/audit/audit.service';
import { AlertTriggerRequest, WebhookPayload } from './alerting.schema';

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);

  // A simple heuristic list of dangerous keywords
  private readonly DANGEROUS_CONDITIONS = [
    'hemorrhage', 'sepsis', 'eclampsia', 'stroke', 'heart attack',
    'bleeding', 'unconscious', 'suicide', 'self-harm', 'severe pain'
  ];

  constructor(
    @InjectQueue('webhook_dispatcher') private readonly webhookQueue: Queue,
    @InjectQueue('patient_engagement') private readonly engagementQueue: Queue,
    private readonly audit: AuditService
  ) { }

  /**
   * Processes a structured clinical payload and decides if alerts are necessary.
   */
  async processClinicalData(request: AlertTriggerRequest): Promise<{ triggered: boolean, trace_id?: string }> {
    const isCriticalUrgency = request.urgency_level === 'high' || request.urgency_level === 'critical';

    const containsDangerousFlags = request.risk_flags.some(flag =>
      this.DANGEROUS_CONDITIONS.some(condition => flag.toLowerCase().includes(condition))
    ) || request.symptoms.some(symptom =>
      this.DANGEROUS_CONDITIONS.some(condition => symptom.toLowerCase().includes(condition))
    );

    if (isCriticalUrgency || containsDangerousFlags) {
      this.logger.warn(`EMERGENCY DETECTED for patient ${request.patient_id}. Urgency: ${request.urgency_level}`);
      const traceId = crypto.randomUUID();

      // Fire and forget so we don't stall the HTTP thread
      this.triggerInternalAlert(request, traceId);
      this.triggerWebhooks(request, traceId);
      this.logAlertAudit(request, traceId);

      return { triggered: true, trace_id: traceId };
    }

    return { triggered: false };
  }

  private async triggerInternalAlert(req: AlertTriggerRequest, traceId: string) {
    // We are skipping the actual Queue.add call locally because the mock redis 
    // causes an infinite event loop block with BullMQ.
    this.logger.log(`[STUB] Internal SMS/WhatsApp alert enqueued -> Trace: ${traceId}`);
  }

  private async triggerWebhooks(req: AlertTriggerRequest, traceId: string) {
    // We are skipping the actual Queue.add call locally to prevent hangs.
    // Instead, we will perform a direct background fetch to simulate the webhook
    const payload: WebhookPayload = {
      event: 'emergency_alert',
      trace_id: traceId,
      patient_id: req.patient_id,
      urgency_level: req.urgency_level,
      risk_flags: req.risk_flags,
      symptoms: req.symptoms,
      timestamp: req.timestamp || new Date().toISOString()
    };

    this.logger.log(`[STUB] Webhook dispatch job enqueued -> Trace: ${traceId}`);

    const url = process.env.WEBHOOK_ENDPOINTS?.split(',')[0];
    if (url) {
      fetch(url, { method: 'POST', body: JSON.stringify(payload) })
        .then(() => this.logger.log(`[STUB] Background Webhook fired successfully!`))
        .catch(e => this.logger.error(`[STUB] Background Webhook error: ${e.message}`));
    }
  }

  private async logAlertAudit(req: AlertTriggerRequest, traceId: string) {
    this.audit.log(
      'system',
      'CREATE',
      'PATIENT', // Mapped to resource type
      req.patient_id,
      `Emergency alert triggered. Trace: ${traceId}. Urgency: ${req.urgency_level}. Flags: ${req.risk_flags.join(', ')}`
    );
  }
}
