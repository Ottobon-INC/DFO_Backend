import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AppointmentService } from './appointment.service';

@Injectable()
@Processor('appointment_checker')
export class AppointmentNoShowWorker extends WorkerHost {
    private readonly logger = new Logger(AppointmentNoShowWorker.name);

    constructor(private readonly appointmentService: AppointmentService) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<number> {
        this.logger.log(`Worker ${job.id} starting periodic no-show scan...`);

        try {
            const count = await this.appointmentService.scanForMissedAppointments();
            if (count > 0) {
                this.logger.warn(`AUTOMATION: Identified and updated ${count} missed appointments.`);
            }
            return count;
        } catch (error) {
            this.logger.error(`NoShowWorker failure: ${error.message}`);
            throw error;
        }
    }
}
