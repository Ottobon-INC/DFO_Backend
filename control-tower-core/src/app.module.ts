import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { KernelModule } from './kernel/kernel.module';
import { DatabaseModule } from './infrastructure/database.module';
import { QueueModule } from './infrastructure/queue.module';
import { RedisCacheModule } from './infrastructure/cache/redis-cache.module';
import { JanmasethuModule } from './domains/janmasethu/janmasethu.module';
import { ClinicsModule } from './domains/clinics/clinics.module';
import { DebugController } from './api/debug.controller';
import { ThreadController } from './api/thread.controller';
import { HealthController } from './api/health.controller';
import { TenantInterceptor } from './infrastructure/interceptors/tenant.interceptor';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    TerminusModule,
    DatabaseModule,
    QueueModule,
    RedisCacheModule,
    JanmasethuModule,
    ClinicsModule,
    KernelModule, // Load without .register() to avoid the dynamic module masking bug
  ],
  controllers: [
    ThreadController,
    HealthController,
    DebugController
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
})
export class AppModule { }
