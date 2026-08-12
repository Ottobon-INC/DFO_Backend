import { Module, Global, Logger, OnApplicationShutdown, Inject } from '@nestjs/common';
import { RedisMemoryServer } from 'redis-memory-server';
import { Redis } from 'ioredis';

@Global()
@Module({
    providers: [
        {
            provide: 'REDIS_MEMORY_SERVER',
            useFactory: async () => {
                const logger = new Logger('InMemoryRedisModule');
                logger.log('Starting Redis Memory Server (Real Redis Binary) for development...');
                const redisServer = new RedisMemoryServer();
                await redisServer.getHost(); // Ensures it starts
                return redisServer;
            }
        },
        {
            provide: 'REDIS_MOCK_CLIENT',
            inject: ['REDIS_MEMORY_SERVER'],
            useFactory: async (redisServer: RedisMemoryServer) => {
                const host = await redisServer.getHost();
                const port = await redisServer.getPort();
                return new Redis(port, host);
            },
        },
        {
            provide: 'REDIS_MOCK_CONFIG',
            inject: ['REDIS_MEMORY_SERVER'],
            useFactory: async (redisServer: RedisMemoryServer) => {
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
    constructor(@Inject('REDIS_MEMORY_SERVER') private readonly redisServer: RedisMemoryServer) {}

    async onApplicationShutdown(signal?: string) {
        if (this.redisServer) {
            const logger = new Logger('InMemoryRedisModule');
            logger.log('Stopping Redis Memory Server...');
            await this.redisServer.stop();
        }
    }
}
