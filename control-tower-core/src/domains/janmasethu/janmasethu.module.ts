import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JanmasethuHandler } from './janmasethu.handler';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuPolicy } from './janmasethu.policy';
import { JanmasethuScopePolicy } from './JanmasethuScopePolicy';
import { JanmasethuSlaWorker } from './janmasethu.sla';
import { JanmasethuContextService } from './janmasethu.context';
import { JanmasethuTakeoverService } from './janmasethu.takeover';
import { JanmasethuAssignmentService } from './janmasethu.assignment';
import { JanmasethuController } from './janmasethu.controller';
import { JanmasethuRiskService } from './risk-engine/janmasethu-risk.service';
import { JanmasethuGuardrailService } from './risk-engine/janmasethu-guardrails';
import { JanmasethuChannelService } from './channel/janmasethu-channel.service';
import { JanmasethuDispatchService } from './channel/janmasethu-dispatch.service';
import { JanmasethuChannelController } from './channel/janmasethu-channel.controller';
import { RealtimeEventsController } from './api/realtime-events.controller';
import { JanmasethuHealthController } from './api/health.controller';
import { JanmasethuMaintenanceService } from './utils/maintenance.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ProviderRegistry } from '../../kernel/services/provider-registry.service';
import { JANMASETHU_DOMAIN } from './janmasethu.types';

import { JanmasethuSummaryService } from './janmasethu.summary.service';
import { JanmasethuReportingService } from './janmasethu.reporting.service';
import { JanmasethuAuditService } from './janmasethu.audit.service';
import { JanmasethuFeedbackService } from './janmasethu.feedback.service';
import { JanmasethuDFOService } from './janmasethu.dfo.service';
import { EngagementModule } from './engagement/engagement.module';
import { AuditModule } from '../../kernel/audit/audit.module';
import { DocumentModule } from './documents/document.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { EngagementEngineService } from './engagement-engine/engine.service';
import { AppointmentService } from './appointments/appointment.service';
import { AppointmentNoShowWorker } from './appointments/no-show.worker';
import { NotificationService } from './notifications/notification.service';
import { JanmasethuLeadsService } from './janmasethu.leads.service';
import { JanmasethuEncryptionService } from './utils/encryption.service';
import { JanmasethuRbacService } from './janmasethu.rbac';
import { MessagingModule } from './channel/messaging.module';
import { EmergencyHotlineService } from './utils/emergency-hotline.service';
import { VitalsModule } from './vitals/vitals.module';
import { ClinicalIntelligenceModule } from './clinical-intelligence/clinical-intelligence.module';
import { AlertingModule } from './alerting/alerting.module';
import { AuthModule } from './auth/auth.module';
import { ConsentModule } from './consent/consent.module';
import { JanmasethuRepositoryModule } from './janmasethu-repository.module';
import { SupportEngagementModule } from './support-engagement/support-engagement.module';

import { ThreadOperationsController } from './thread-operations.controller';
import { ThreadOperationsRepository } from './thread-operations.repository';
import { PiiDecrypterService } from './pii-decrypter.service';

@Module({
    imports: [
        BullModule.registerQueue(
            { name: 'janmasethu_sla_queue' },
            { name: 'appointment_checker' },
            { name: 'document_generation_queue' },
            { name: 'janmasethu_analytics_queue' },
        ),
        EngagementModule,
        AuditModule,
        MessagingModule,
        DocumentModule,
        AnalyticsModule,
        VitalsModule,
        ClinicalIntelligenceModule,
        AlertingModule,
        AuthModule,
        ConsentModule,
        JanmasethuRepositoryModule,
        SupportEngagementModule,
    ],
    providers: [
        JanmasethuHandler,
        JanmasethuPolicy,
        JanmasethuScopePolicy,
        JanmasethuSlaWorker,
        JanmasethuContextService,
        JanmasethuTakeoverService,
        JanmasethuAssignmentService,
        JanmasethuRiskService,
        JanmasethuGuardrailService,
        JanmasethuChannelService,
        JanmasethuSummaryService,
        JanmasethuFeedbackService,
        JanmasethuDFOService,
        EngagementEngineService,
        JanmasethuReportingService,
        JanmasethuAuditService,
        AppointmentService,
        AppointmentNoShowWorker,
        NotificationService,
        JanmasethuLeadsService,
        JanmasethuEncryptionService,
        JanmasethuRbacService,
        EmergencyHotlineService,
        JanmasethuMaintenanceService,
        PiiDecrypterService,
        ThreadOperationsRepository,
    ],
    controllers: [
        JanmasethuController,
        JanmasethuChannelController,
        RealtimeEventsController,
        JanmasethuHealthController,
        ThreadOperationsController,
    ],
    exports: [
        JanmasethuHandler,
        JanmasethuAssignmentService,
        JanmasethuTakeoverService,
        JanmasethuScopePolicy,
        JanmasethuContextService,
        JanmasethuChannelService,
        JanmasethuSummaryService,
        JanmasethuFeedbackService,
        JanmasethuDFOService,
        JanmasethuReportingService,
        JanmasethuAuditService,
        JanmasethuLeadsService,
        JanmasethuEncryptionService,
        JanmasethuRbacService,
        EmergencyHotlineService,
    ],
})
export class JanmasethuModule implements OnModuleInit {
    private readonly logger = new Logger(JanmasethuModule.name);

    constructor(
        private readonly providerRegistry: ProviderRegistry,
        private readonly riskService: JanmasethuRiskService,
        private readonly escalationPolicy: JanmasethuPolicy,
        private readonly maintenanceService: JanmasethuMaintenanceService,
        @InjectQueue('appointment_checker') private readonly checkerQueue: Queue,
    ) { }

    async onModuleInit() {
        this.logger.log(`Initializing Janmasethu Domain Module for PRODUCTION...`);

        // 1. RUN BACKEND STABILIZATION (Health Checks, Queue Cleanup, Seeding)
        await this.maintenanceService.stabilizeBackend();

        this.providerRegistry.register(JANMASETHU_DOMAIN, {
            sentimentProvider: this.riskService,
            escalationPolicy: this.escalationPolicy,
            domainNotifier: {
                notifyOwnershipSwitch: async (thread, actorId) => {
                    this.logger.log(`Janmasethu: Ownership switch notified for thread ${thread.id}`);
                },
                notifyStatusChange: async (thread, previousStatus) => {
                    this.logger.log(`Janmasethu: Status change notified for thread ${thread.id}: ${previousStatus} -> ${thread.status}`);
                }
            }
        });

        // 2. Schedule Background Self-Healing (No-Show Check every 1 hour)
        this.checkerQueue.add('SCAN_NO_SHOWS', {}, {
            repeat: { pattern: '0 * * * *' }, // Every hour
            jobId: 'no_show_periodic_scanner'
        });

        this.logger.log(`Janmasethu Domain registered successfully with Real-time & SLA support.`);
    }
}
