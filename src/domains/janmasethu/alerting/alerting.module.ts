import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AlertingController } from './alerting.controller';
import { AlertingService } from './alerting.service';
import { WebhookWorker } from './webhook.worker';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'webhook_dispatcher' }),
    BullModule.registerQueue({ name: 'patient_engagement' }),
  ],
  controllers: [AlertingController],
  providers: [
    AlertingService,
    WebhookWorker,
  ],
  exports: [AlertingService],
})
export class AlertingModule {}
