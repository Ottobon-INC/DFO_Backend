import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhookPayload } from './alerting.schema';

@Processor('webhook_dispatcher')
export class WebhookWorker extends WorkerHost {
  private readonly logger = new Logger(WebhookWorker.name);

  async process(job: Job<WebhookPayload, any, string>): Promise<any> {
    if (job.name === 'dispatch-webhook') {
      const payload = job.data;
      this.logger.log(`Processing webhook dispatch for trace: ${payload.trace_id}`);

      // Get configured endpoints (comma-separated if multiple)
      const endpointsStr = process.env.WEBHOOK_ENDPOINTS || '';
      const endpoints = endpointsStr.split(',').map(e => e.trim()).filter(e => e.length > 0);

      if (endpoints.length === 0) {
        this.logger.warn(`No webhook endpoints configured. Skipping dispatch for trace: ${payload.trace_id}.`);
        return { delivered: false, reason: 'No endpoints' };
      }

      // Track failures
      const failures: any[] = [];

      // Dispatch to all endpoints in parallel
      await Promise.all(endpoints.map(async (endpoint) => {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Janmasethu-Signature': 'STUB-SIGNATURE' // Stub for HMAC signature
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            throw new Error(`Endpoint returned status ${response.status}: ${response.statusText}`);
          }
          this.logger.log(`[HTTP ${response.status}] Webhook delivered to ${endpoint}`);
        } catch (error) {
          this.logger.error(`Failed to deliver webhook to ${endpoint}`, error instanceof Error ? error.stack : undefined);
          failures.push({ endpoint, error: error instanceof Error ? error.message : 'Unknown' });
        }
      }));

      // If there are failures, throw to trigger BullMQ's Retry mechanism
      if (failures.length > 0) {
        throw new Error(`Webhook partial/total failure: ${JSON.stringify(failures)}`);
      }

      return { delivered: true, count: endpoints.length };
    }
  }
}
