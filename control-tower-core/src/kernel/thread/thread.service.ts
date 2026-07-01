import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { Thread, ThreadStatus, Channel, Message } from '../../types';
import { AuditService } from '../audit/audit.service';
import { MessageRepository } from '../../infrastructure/repositories/message.repository';
import { ThreadRepository } from '../../infrastructure/repositories/thread.repository';
import { MetricsService } from '../metrics/metrics.service';
import { AISuppressionException } from '../../infrastructure/exceptions';

@Injectable()
export class ThreadService {
    private readonly logger = new Logger(ThreadService.name);

    constructor(
        private readonly auditService: AuditService,
        private readonly messageRepository: MessageRepository,
        private readonly threadRepository: ThreadRepository,
        private readonly metricsService: MetricsService,
    ) { }

    async initializeThread(dto: {
        domain: string;
        user_id: string;
        channel: Channel;
        metadata?: Record<string, any>;
    }): Promise<Thread> {
        const thread = await this.threadRepository.create({
            domain: dto.domain,
            user_id: dto.user_id,
            channel: dto.channel,
            status: ThreadStatus.GREEN,
            ownership: 'AI' as any, // Using string to bypass direct OwnershipType dependency if needed, but should match
            is_locked: false,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
        });

        await this.auditService.append({
            thread_id: thread.id,
            actor_id: 'SYSTEM',
            actor_type: 'SYSTEM',
            action: 'THREAD_INITIALIZED',
            payload: { domain: dto.domain, user_id: dto.user_id },
        });

        return thread;
    }

    async getThread(id: string): Promise<Thread> {
        const thread = await this.threadRepository.findById(id);
        if (!thread) throw new NotFoundException(`Thread ${id} not found`);
        return thread;
    }

    /**
     * Service-level AI suppression enforcement.
     */
    async validateAIAction(threadId: string): Promise<Thread> {
        const thread = await this.getThread(threadId);
        if (thread.ownership !== 'AI' || thread.is_locked || (thread as any).ai_suppressed) {
            this.logger.warn(`AI action suppressed for thread ${threadId}: ownership=${thread.ownership}, locked=${thread.is_locked}, suppressed=${(thread as any).ai_suppressed}`);
            throw new AISuppressionException();
        }
        return thread;
    }

    async appendMessage(threadId: string, dto: {
        sender_id: string;
        sender_type: 'USER' | 'AI' | 'HUMAN';
        content: string;
        domain?: string;
    }): Promise<Message> {
        // If AI is sending the message, enforce suppression
        if (dto.sender_type === 'AI') {
            await this.validateAIAction(threadId);
        }

        const message = await this.messageRepository.create({
            thread_id: threadId,
            sender_id: dto.sender_id,
            sender_type: dto.sender_type,
            content: dto.content,
        });

        await this.auditService.append({
            thread_id: threadId,
            actor_id: dto.sender_id,
            actor_type: dto.sender_type as any, // USER, AI, HUMAN match
            action: 'MESSAGE_APPENDED',
            payload: { sender_type: dto.sender_type, content_length: dto.content.length },
        });

        return message;
    }

    async updateThreadStatusWithVersionCheck(
        id: string,
        status: ThreadStatus,
        version: number,
    ): Promise<Thread> {
        try {
            const updatedThread = await this.threadRepository.updateAtomic(id, version, { status });

            await this.auditService.append({
                thread_id: id,
                actor_id: 'SYSTEM',
                actor_type: 'SYSTEM',
                action: 'STATUS_UPDATED',
                payload: { status, previous_version: version },
            });

            return updatedThread;
        } catch (error) {
            if (error.name === 'ConcurrencyException') {
                this.metricsService.incrementConcurrencyConflictCount(id);
            }
            throw error;
        }
    }

    async getAllThreads(): Promise<Thread[]> {
        return this.threadRepository.findAll();
    }

    async getThreadsByStatus(status: string): Promise<Thread[]> {
        return this.threadRepository.findByStatus(status);
    }

    async getMessages(threadId: string): Promise<Message[]> {
        return this.messageRepository.findByThread(threadId);
    }
}
