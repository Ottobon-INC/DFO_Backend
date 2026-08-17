import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
    imports: [
        BullModule.forRootAsync({
            inject: [ConfigService, { token: 'REDIS_MOCK_CONFIG', optional: true }],
            useFactory: (configService: ConfigService, mockConfig?: { host: string; port: number }) => {
                if (process.env.NODE_ENV !== 'production' && mockConfig) {
                    return { connection: mockConfig };
                }
                return {
                    connection: {
                        host: configService.get<string>('REDIS_HOST', 'localhost'),
                        port: configService.get<number>('REDIS_PORT', 6379),
                        password: configService.get<string>('REDIS_PASSWORD'),
                        tls: configService.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
                        maxRetriesPerRequest: null,
                        enableReadyCheck: false,
                    },
                };
            },
        }),
        BullModule.registerQueue(
            { name: 'routing_queue' },
            { name: 'engagement_queue' },
            { name: 'reminder_queue' },
        ),
    ],
    exports: [BullModule],
})
export class QueueModule { }
