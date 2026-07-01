import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DeadLetterRepository {
    private readonly logger = new Logger(DeadLetterRepository.name);

    async persist(data: {
        routing_id: string;
        thread_id: string;
        reason: string;
        payload?: any;
    }): Promise<void> {
        this.logger.warn(
            `[DEAD LETTER QUEUE] PERSISTED JOB: Routing ID: ${data.routing_id} | ` +
            `Thread ID: ${data.thread_id} | Reason: ${data.reason} | ` +
            `Payload: ${JSON.stringify(data.payload || {})}`
        );
    }
}
