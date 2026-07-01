import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck } from '@nestjs/terminus';
import { RedisCacheService } from '../infrastructure/cache/redis-cache.service';

@Controller('health')
export class HealthController {
    constructor(
        private health: HealthCheckService,
        private redisCache: RedisCacheService,
    ) { }

    @Get()
    @HealthCheck()
    check() {
        return this.health.check([
            // Basic check to see if the server is responding
            () => ({ server: { status: 'up' } }),
            async () => {
                const isHealthy = await this.redisCache.isHealthy();
                return {
                    redis: {
                        status: isHealthy ? 'up' : 'down',
                    },
                };
            },
        ]);
    }
}
