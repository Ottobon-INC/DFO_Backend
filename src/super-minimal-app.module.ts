import { Module } from '@nestjs/common';
import { ThreadController } from './api/thread.controller';

@Module({
    controllers: [ThreadController],
    providers: [
        { provide: 'ThreadService', useValue: { initializeThread: (dto) => Promise.resolve({ id: 'mock-thread-id', ...dto }) } },
        { provide: 'OwnershipService', useValue: {} },
        { provide: 'SentimentService', useValue: {} },
        { provide: 'GuardrailService', useValue: {} },
        { provide: 'RateLimiterService', useValue: { checkRateLimit: () => Promise.resolve() } },
    ],
})
export class SuperMinimalModule { }
