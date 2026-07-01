import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { StaffCacheService } from '../services/staff-cache.service';
import { BaseEvent } from '../../../infrastructure/events/event-payloads';

@Processor('dfo_events_queue')
export class CacheEventProcessor extends WorkerHost {
  private readonly logger = new Logger(CacheEventProcessor.name);

  constructor(private readonly staffCache: StaffCacheService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const eventName = job.name;
    const event = job.data as BaseEvent;

    if (!event.clinicId) {
        return;
    }

    try {
      if (eventName.startsWith('staff.') || eventName.startsWith('user.') || eventName === 'clinic.created') {
        this.logger.log(`Invalidating staff cache for clinic ${event.clinicId} due to ${eventName}`);
        await this.staffCache.invalidateStaffList(event.clinicId);
      }
    } catch (error: any) {
      this.logger.error(`Error in CacheEventProcessor invalidating cache for ${eventName}:`, error.message);
      throw error; // Let BullMQ retry the invalidation if Redis is temporarily down
    }
  }
}
