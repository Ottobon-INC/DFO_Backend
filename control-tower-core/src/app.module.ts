import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { InMemoryRedisModule } from './infrastructure/in-memory-redis.module';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ...(isProduction ? [] : [InMemoryRedisModule]),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    TerminusModule,
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100, // Default 100 requests per minute
    }]),
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
