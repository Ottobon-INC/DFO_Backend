import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsService } from './analytics.service';
import { AnalyticsWorker } from './analytics.worker';
import { AnalyticsController } from './analytics.controller';
import { JanmasethuRbacService } from '../janmasethu.rbac';
import { JanmasethuScopePolicy } from '../JanmasethuScopePolicy';
import { JanmasethuAuditService } from '../janmasethu.audit.service';
import { JanmasethuRepository } from '../janmasethu.repository';

@Module({
    imports: [
        BullModule.registerQueue({ name: 'janmasethu_analytics_queue' }),
    ],
    providers: [
        AnalyticsService,
        AnalyticsWorker,
        JanmasethuRbacService,
        JanmasethuScopePolicy,
        JanmasethuAuditService,
        JanmasethuRepository,
    ],
    controllers: [AnalyticsController],
    exports: [AnalyticsService],
})
export class AnalyticsModule { }
