import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AnalyticsService } from './analytics.service';
import { RealtimeEventsController } from '../api/realtime-events.controller';

/**
 * AnalyticsWorker
 *
 * Precomputes clinical metrics every 60 seconds.
 * 1. Triggers full SQL aggregation.
 * 2. Writes cached JSON snapshot to Postgres.
 * 
 * Pattern: Scheduled Refresh (Option A from architectural requirements)
 */
@Processor('janmasethu_analytics_queue')
@Injectable()
export class AnalyticsWorker extends WorkerHost implements OnModuleInit {
    private readonly logger = new Logger(AnalyticsWorker.name);

    constructor(
        private readonly analyticsService: AnalyticsService,
        @InjectQueue('janmasethu_analytics_queue') private readonly analyticsQueue: Queue
    ) {
        super();
    }

    // Schedule the recurring job on startup
    async onModuleInit() {
        this.logger.log('📅 Initializing Analytics Scheduler (60s cycle)...');

        // Remove existing jobs to avoid duplicates on restart
        try {
            await this.analyticsQueue.obliterate({ force: true });
        } catch (err: any) {
            this.logger.warn(`Could not obliterate queue: ${err.message}. Draining instead.`);
            try {
                await this.analyticsQueue.drain();
            } catch (drainErr) {
                // Ignore drain failures
            }
        }

        // Add recurring background job
        await this.analyticsQueue.add('REFRESH_DASHBOARD_ANALYTICS', {}, {
            repeat: { pattern: '*/1 * * * *' }, // Every minute
            removeOnComplete: true,
            removeOnFail: true
        });
    }

    async process(job: Job<any>): Promise<any> {
        this.logger.log(`⏳ Background Analytics Refresh Triggered: ${job.id}`);

        try {
            const stats = await this.analyticsService.recalculateAllMetrics();

            // BROADCAST: Update frontend dashboards in realtime
            RealtimeEventsController.broadcast('ANALYTICS_UPDATED', stats);

            this.logger.log(
                `💾 Dashboard Refresh Success | Threads: ${Object.values(stats.risk_distribution).reduce((a, b) => a + b, 0)}`
            );

            return { success: true };
        } catch (error) {
            this.logger.error(`❌ Background Analytics Refresh Failed: ${error.message}`);
            throw error; // Let BullMQ handle retry if DB is down
        }
    }
}
