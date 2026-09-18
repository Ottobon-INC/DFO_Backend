import { Injectable, Logger } from '@nestjs/common';
import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';

@Injectable()
export class StaffCacheService {
  private readonly logger = new Logger(StaffCacheService.name);
  
  // 24 hours TTL as requested by the user
  private readonly TTL_SECONDS = 86400; 

  constructor(private readonly redisCache: RedisCacheService) {}

  private getKey(clinicId: string): string {
    return `clinic:${clinicId}:staff`;
  }

  async getStaffList(clinicId: string): Promise<any | null> {
    const key = this.getKey(clinicId);
    return this.redisCache.get<any>(key);
  }

  async setStaffList(clinicId: string, data: any): Promise<void> {
    const key = this.getKey(clinicId);
    await this.redisCache.set(key, data, this.TTL_SECONDS);
  }

  async invalidateStaffList(clinicId: string): Promise<void> {
    const key = this.getKey(clinicId);
    this.logger.debug(`Invalidating staff list cache for clinic ${clinicId}`);
    await this.redisCache.del(key);
  }
}
