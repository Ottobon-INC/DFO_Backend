import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EngagementService } from './engagement.service';
import { EngagementWorker, ReminderWorker } from './engagement.worker';
import { EngagementController } from './engagement.controller';
import { MessagingModule } from '../channel/messaging.module';

@Global()
@Module({
    imports: [
        MessagingModule,
        BullModule.registerQueue(
            { name: 'engagement_queue' },
            { name: 'reminder_queue' }
        ),
    ],
    controllers: [],
    providers: [
        EngagementService,
        EngagementWorker,
        ReminderWorker,
    ],
    exports: [EngagementService, BullModule],
})
export class EngagementModule { }
