import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class RateLimiterService {
    private clients: Map<string, { count: number; expires: number }> = new Map();
    private readonly LIMIT = 100; // 100 requests
    private readonly WINDOW = 60000; // per 1 minute

    async checkRateLimit(clientId: string): Promise<void> {
        const now = Date.now();
        const record = this.clients.get(clientId);

        if (!record || now > record.expires) {
            this.clients.set(clientId, { count: 1, expires: now + this.WINDOW });
            return;
        }

        if (record.count >= this.LIMIT) {
            throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
        }

        record.count++;
    }
}
