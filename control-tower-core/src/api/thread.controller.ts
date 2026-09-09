import { Controller, Post, Get, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { ThreadService } from '../kernel/thread/thread.service';
import { OwnershipService } from '../kernel/ownership/ownership.service';
import { SentimentService } from '../kernel/sentiment/sentiment.service';
import { GuardrailService } from '../kernel/guardrail/guardrail.service';
import { AuditService } from '../kernel/audit/audit.service';
import { RateLimiterService } from '../kernel/rate-limiter.service';
import { Channel, OwnershipType } from '../types';
import { AISuppressionGuard } from '../infrastructure/ai-suppression.guard';
import { IsString, IsEnum, IsOptional, IsObject, IsUUID } from 'class-validator';

class InitThreadDto {
    @IsString() domain: string;
    @IsUUID() user_id: string;
    @IsEnum(Channel) channel: Channel;
    @IsOptional() @IsObject() metadata?: Record<string, any>;
}

class EventMessageDto {
    @IsUUID() thread_id: string;
    @IsString() sender_id: string;
    @IsEnum(['USER', 'AI', 'HUMAN']) sender_type: 'USER' | 'AI' | 'HUMAN';
    @IsString() content: string;
}

class SwitchOwnershipDto {
    @IsUUID() thread_id: string;
    @IsEnum(OwnershipType) ownership: OwnershipType;
    @IsString() actor_id: string;
    @IsOptional() @IsString() assigned_role?: string;
}

@Controller('api/thread')
export class ThreadController {
    constructor(
        private readonly threadService: ThreadService,
        private readonly ownershipService: OwnershipService,
        private readonly sentimentService: SentimentService,
        private readonly guardrailService: GuardrailService,
        private readonly rateLimiter: RateLimiterService,
        private readonly auditService: AuditService,
    ) { }

    @Post('init')
    async init(@Body() dto: InitThreadDto) {
        if (dto.metadata) {
            dto.metadata = this.sanitizeMetadata(dto.metadata);
        }
        return this.threadService.initializeThread(dto);
    }

    @Get('all')
    async getAll() {
        return this.threadService.getAllThreads();
    }

    @Get('queue/doctor')
    async getDoctorQueue() {
        return this.threadService.getThreadsByStatus('red');
    }

    @Get('queue/nurse')
    async getNurseQueue() {
        return this.threadService.getThreadsByStatus('yellow');
    }

    @Get('queue/ai')
    async getAIQueue() {
        return this.threadService.getThreadsByStatus('green');
    }

    @Get('context/:id')
    async getContext(@Param('id') threadId: string) {
        return this.threadService.getMessages(threadId);
    }

    @Get('audit/all')
    async getAudits() {
        return this.auditService.getAll();
    }

    @Get(':id')
    async get(@Param('id') id: string) {
        return this.threadService.getThread(id);
    }

    @Post('event/message')
    @UseGuards(AISuppressionGuard)
    async appendMessage(@Body() dto: EventMessageDto) {
        // 0. Rate limiting
        await this.rateLimiter.checkRateLimit(dto.sender_id);

        // 1. Store message
        const message = await this.threadService.appendMessage(dto.thread_id, dto);

        // 2. Run sentiment (Fire and forget, tracked in DB)
        this.sentimentService.evaluateThreadSentiment(dto.thread_id, message.id, dto.content, 'default')
            .catch(err => console.error('Sentiment evaluation failed:', err));

        // 3. Run guardrail (Awaited for safety/blocking)
        await this.guardrailService.evaluate(dto.thread_id, dto.content);

        return message;
    }

    @Post('ownership/switch')
    async switchOwnership(@Body() dto: SwitchOwnershipDto) {
        return this.ownershipService.switchOwnership(dto.thread_id, dto.ownership, dto.actor_id, 'HUMAN', {
            assignedRole: dto.assigned_role,
        });
    }

    @Post('assign')
    async assign(@Body() body: { thread_id: string; assigned_user: string; assigned_role: string }) {
        return this.ownershipService.switchOwnership(
            body.thread_id,
            OwnershipType.HUMAN,
            'SYSTEM',
            'HUMAN',
            {
                assignedRole: body.assigned_role,
                assignedUserId: body.assigned_user
            }
        );
    }


    private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
        if (!metadata) return {};
        const sanitized = JSON.parse(JSON.stringify(metadata));
        const restrictedKeys = ['__internal', 'password', 'secret'];
        restrictedKeys.forEach(key => delete sanitized[key]);
        return sanitized;
    }
}
