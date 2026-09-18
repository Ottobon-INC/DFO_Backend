import { Controller, Get, Logger } from '@nestjs/common';
import { JanmasethuRepository } from '../janmasethu.repository';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class JanmasethuHealthController {
    private readonly logger = new Logger(JanmasethuHealthController.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly configService: ConfigService,
        @InjectQueue('janmasethu_sla_queue') private readonly slaQueue: Queue,
        @InjectQueue('appointment_checker') private readonly apptQueue: Queue,
        @InjectQueue('janmasethu_analytics_queue') private readonly analyticsQueue: Queue,
    ) { }

    @Get('db')
    async checkDb() {
        try {
            // Simple ping check via repository (fetching count of patients)
            await this.repository.findAllPatients();
            return { success: true, status: 'connected', timestamp: new Date().toISOString() };
        } catch (error) {
            this.logger.error(`Health Check Failed [DB]: ${error.message}`);
            return { success: false, status: 'disconnected', error: error.message };
        }
    }

    @Get('queues')
    async checkQueues() {
        try {
            const [sla, appt, analytics] = await Promise.all([
                this.slaQueue.waitUntilReady().then(() => true).catch(() => false),
                this.apptQueue.waitUntilReady().then(() => true).catch(() => false),
                this.analyticsQueue.waitUntilReady().then(() => true).catch(() => false),
            ]);
            return {
                success: true,
                queues: {
                    sla: sla ? 'ready' : 'not_ready',
                    appointment: appt ? 'ready' : 'not_ready',
                    analytics: analytics ? 'ready' : 'not_ready',
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error(`Health Check Failed [Queues]: ${error.message}`);
            return { success: false, status: 'degraded', error: error.message };
        }
    }

    @Get('full')
    async fullCheck() {
        const db = await this.checkDb();
        const queues = await this.checkQueues();
        return {
            success: db.success && queues.success,
            components: { db, queues },
            timestamp: new Date().toISOString()
        };
    }
}
