import { Module, Global, Logger, OnApplicationShutdown, Inject, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';

@Global()
@Module({
    providers: [
        {
            provide: 'REDIS_MEMORY_SERVER',
            useFactory: async () => {
                const logger = new Logger('InMemoryRedisModule');
                if (process.env.NODE_ENV === 'production') {
                    return null;
                }
                try {
                    // Dynamically require to avoid crash if devDependencies are pruned in production container
                    const { RedisMemoryServer } = require('redis-memory-server');
                    logger.log('Starting Redis Memory Server (Real Redis Binary) for development...');
                    const redisServer = new RedisMemoryServer();
                    await redisServer.getHost(); // Ensures it starts
                    return redisServer;
                } catch (err: any) {
                    logger.warn(`RedisMemoryServer not available: ${err?.message || err}`);
                    return null;
                }
            }
        },
        {
            provide: 'REDIS_MOCK_CLIENT',
            inject: ['REDIS_MEMORY_SERVER'],
            useFactory: async (redisServer: any) => {
                if (!redisServer) return null;
                const host = await redisServer.getHost();
                const port = await redisServer.getPort();
                return new Redis(port, host);
            },
        },
        {
            provide: 'REDIS_MOCK_CONFIG',
            inject: ['REDIS_MEMORY_SERVER'],
            useFactory: async (redisServer: any) => {
                if (!redisServer) return null;
                return {
                    host: await redisServer.getHost(),
                    port: await redisServer.getPort(),
                };
            },
        },
    ],
    exports: ['REDIS_MOCK_CLIENT', 'REDIS_MOCK_CONFIG'],
})
export class InMemoryRedisModule implements OnApplicationShutdown {
    constructor(@Optional() @Inject('REDIS_MEMORY_SERVER') private readonly redisServer: any) {}

    async onApplicationShutdown(signal?: string) {
        if (this.redisServer && typeof this.redisServer.stop === 'function') {
            const logger = new Logger('InMemoryRedisModule');
            logger.log('Stopping Redis Memory Server...');
            await this.redisServer.stop();
        }
    }
}

