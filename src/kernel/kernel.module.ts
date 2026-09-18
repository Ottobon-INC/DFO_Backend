import { Module, DynamicModule, Global, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { ThreadService } from './thread/thread.service';
import { OwnershipService } from './ownership/ownership.service';
import { RoutingService } from './routing/routing.service';
import { SentimentService } from './sentiment/sentiment.service';
import { AuditModule } from './audit/audit.module';
import { GuardrailModule } from './guardrail/guardrail.module';
import { MetricsModule } from './metrics/metrics.module';
import { ThreadRepository } from '../infrastructure/repositories/thread.repository';
import { MessageRepository } from '../infrastructure/repositories/message.repository';
import { SentimentRepository } from '../infrastructure/repositories/sentiment.repository';
import { RoutingRepository } from '../infrastructure/repositories/routing.repository';
import { DeadLetterRepository } from '../infrastructure/repositories/dead-letter.repository';
import { RateLimiterService } from './rate-limiter.service';
import { ProviderRegistry } from './services/provider-registry.service';
import { EscalationService } from './escalations/escalation.service';
import { KernelIngressController } from './api/ingress.controller';
import type { SentimentProvider, EscalationPolicy, DomainNotifier } from '../contracts';

export interface ControlTowerOptions {
    sentimentProvider: SentimentProvider;
    escalationPolicy: EscalationPolicy;
    domainNotifier: DomainNotifier;
}

@Global()
@Module({
    imports: [
        ConfigModule,
        AuditModule,
        GuardrailModule,
        MetricsModule
    ],
    providers: [
        ThreadService,
        OwnershipService,
        RoutingService,
        SentimentService,
        ThreadRepository,
        MessageRepository,
        SentimentRepository,
        RoutingRepository,
        DeadLetterRepository,
        RateLimiterService,
        ProviderRegistry,
        EscalationService,
    ],
    controllers: [
        KernelIngressController
    ],
    exports: [
        ThreadService,
        OwnershipService,
        RoutingService,
        SentimentService,
        AuditModule,
        GuardrailModule,
        MetricsModule,
        RateLimiterService,
        ProviderRegistry,
        EscalationService,
    ],
})
export class KernelModule implements OnModuleInit {
    private readonly logger = new Logger(KernelModule.name);

    constructor(
        private readonly configService: ConfigService,
    ) { }

    onModuleInit() {
        this.logger.log('Kernel Bootstrap: Generalizing Orchestration...');
        this.logger.log('Kernel Bootstrap: Governance Validated.');
    }

    static register(options: ControlTowerOptions): DynamicModule {
        // Legacy support for single domain registration
        return {
            module: KernelModule,
            controllers: [KernelIngressController],
            providers: [
                {
                    provide: 'INITIAL_REGISTRATION',
                    useFactory: (registry: ProviderRegistry) => {
                        registry.register('default', {
                            sentimentProvider: options.sentimentProvider,
                            escalationPolicy: options.escalationPolicy,
                            domainNotifier: options.domainNotifier
                        });
                    },
                    inject: [ProviderRegistry]
                }
            ],
            exports: [ProviderRegistry]
        };
    }
}
