import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redisClient.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (error) {
      this.logger.error(`Failed to get or parse cache key ${key}`, error);
      // Fail gracefully on Redis errors or JSON parse errors
      // If parsing fails, try to delete the corrupted key
      if (error instanceof SyntaxError) {
        this.del(key).catch(() => {});
      }
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    try {
      const stringified = JSON.stringify(value);
      await this.redisClient.set(key, stringified, 'EX', ttlSeconds);
    } catch (error) {
      this.logger.error(`Failed to set cache key ${key}`, error);
      // Swallow error to not break the application flow
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
    } catch (error) {
      this.logger.error(`Failed to delete cache key ${key}`, error);
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const result = await this.redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        const keys = result[1];
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.error(`Failed to delete cache keys by pattern ${pattern}`, error);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.redisClient.ping();
      return res === 'PONG';
    } catch (error) {
      return false;
    }
  }
}
