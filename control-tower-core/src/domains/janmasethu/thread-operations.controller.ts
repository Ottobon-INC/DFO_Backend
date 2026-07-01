import {
    Controller, Post, Get, Body, Param, Request, UseGuards, UnauthorizedException, BadRequestException
} from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ThreadOperationsRepository } from './thread-operations.repository';
import { JanmasethuDispatchService } from './channel/janmasethu-dispatch.service';
import { JanmasethuAssignmentService } from './janmasethu.assignment';
import { JanmasethuRole } from './janmasethu.types';

@Controller('threads')
@UseGuards(JwtAuthGuard)
export class ThreadOperationsController {
    constructor(
        private readonly repo: ThreadOperationsRepository,
        private readonly dispatchService: JanmasethuDispatchService,
        private readonly assignmentService: JanmasethuAssignmentService,
    ) { }


    @Get()
    async getThreads(@Request() req: any) {
        const user = req.user;
        const data = await this.repo.findThreads(user);
        return { success: true, data };
    }

    @Get('clinicians')
    async getClinicians() {
        const data = await this.repo.findClinicians();
        return { success: true, data };
    }
    @Get(':id')
    async getThreadById(@Param('id') id: string) {
        const thread = await this.repo.findThreadById(id);
        if (!thread) throw new BadRequestException('Thread not found');
        return { success: true, data: thread };
    }

    @Get(':id/messages')
    async getMessages(@Param('id') id: string) {
        const data = await this.repo.findMessagesByThreadId(id);
        return { success: true, data };
    }

    @Post(':id/assign')
    async assignThread(
        @Param('id') id: string,
        @Body() body: { assignTo?: string; role?: string; ownerId?: string; ownerType?: string },
        @Request() req: any
    ) {
        const user = req.user;
        if (user.role !== 'CRO' && user.role !== 'ADMIN' && user.role !== 'DOCTOR' && user.role !== 'NURSE') {
            throw new UnauthorizedException(`Only CROs, Admins, Doctors, and Nurses can assign threads. Your role: ${user.role}`);
        }
        const targetUserId = body.ownerId || body.assignTo;
        const targetRole = body.ownerType || body.role;
        if (!targetUserId || !targetRole) {
            throw new BadRequestException('ownerId (assignTo) and ownerType (role) are required');
        }

        // Use the Assignment Service for full SLA and Event orchestration
        await this.assignmentService.assignThread(id, targetUserId, targetRole as JanmasethuRole, {
            id: user.id,
            role: user.role,
        });

        return { success: true };
    }

    @Post(':id/escalate')
    async escalateThread(
        @Param('id') id: string,
        @Body() body: { reason: string; status: string; riskScore: number },
        @Request() req: any
    ) {
        const user = req.user;
        if (user.role !== 'CRO' && user.role !== 'ADMIN' && user.role !== 'NURSE') {
            throw new UnauthorizedException('Access denied');
        }
        await this.repo.escalateThread(id, body.reason, body.status, body.riskScore || 50, user.name || user.email);
        return { success: true };
    }

    @Post(':id/reply')
    async replyToThread(
        @Param('id') id: string,
        @Body() body: { message: string },
        @Request() req: any
    ) {
        const user = req.user;
        const thread = await this.repo.findThreadById(id);
        if (!thread) throw new BadRequestException('Thread not found');

        // Enforce ownership: only the assigned clinician (or CRO role) can reply to an assigned thread
        if (thread.current_owner_type === 'DOCTOR' || thread.current_owner_type === 'NURSE') {
            const isOwner = thread.current_owner_id === user.id;
            if (!isOwner && user.role !== 'CRO' && user.role !== 'ADMIN') {
                throw new UnauthorizedException('Only the assigned clinician can reply to this thread.');
            }
        }

        const reply = await this.repo.replyToThread(id, user.role, user.id, body.message);

        // Dispatch to patient external channel
        await this.dispatchService.dispatchResponse(thread.channel, thread.user_id, body.message);

        return { success: true, data: reply };
    }

    @Post(':id/resolve')
    async resolveThread(
        @Param('id') id: string,
        @Request() req: any
    ) {
        const user = req.user;
        const thread = await this.repo.findThreadById(id);
        if (!thread) throw new BadRequestException('Thread not found');

        // Only the assigned clinician (or CRO) can resolve a thread.
        if (thread.current_owner_type === 'DOCTOR' || thread.current_owner_type === 'NURSE') {
            const isOwner = thread.current_owner_id === user.id;
            if (!isOwner && user.role !== 'CRO' && user.role !== 'ADMIN') {
                throw new UnauthorizedException('Only the assigned clinician can resolve this thread.');
            }
        } else if (user.role !== 'DOCTOR' && user.role !== 'CRO' && user.role !== 'ADMIN') {
            throw new UnauthorizedException('Only Doctors, CROs, or Admins can resolve threads');
        }

        await this.repo.resolveThread(id, user.id);
        return { success: true };
    }

    @Post(':id/refresh-summary')
    async refreshSummary(
        @Param('id') id: string,
        @Body() body: { clinicalSummary: string; handoffSummary: string }
    ) {
        await this.repo.refreshSummary(id, body.clinicalSummary, body.handoffSummary);
        return { success: true };
    }
}
