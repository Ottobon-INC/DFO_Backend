// Trigger IDE reload
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisCacheService } from 'src/infrastructure/cache/redis-cache.service';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService, mockClient?: any) => {
        if (process.env.NODE_ENV !== 'production' && mockClient) {
          return mockClient;
        }

        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const password = configService.get<string>('REDIS_PASSWORD');
        const tlsStr = configService.get<string>('REDIS_TLS');
        const tls = tlsStr === 'true' ? {} : undefined;

        return new Redis({
          host,
          port,
          password: password || undefined,
          tls,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
        });
      },
      inject: [ConfigService, { token: 'REDIS_MOCK_CLIENT', optional: true }],
    },
    RedisCacheService,
  ],
  exports: ['REDIS_CLIENT', RedisCacheService],
})
export class RedisCacheModule {}
