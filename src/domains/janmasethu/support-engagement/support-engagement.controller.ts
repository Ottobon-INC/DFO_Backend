import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, UseInterceptors, Request, Logger, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JanmasethuResponseInterceptor } from '../utils/response.interceptor';
import { SupportEngagementService } from './support-engagement.service';
import { CreateSupportTicketDto, AssignSupportOwnerDto, EscalateSupportDto, UpdateTicketStatusDto, SendSupportMessageDto } from './dto/support-engagement.dto';

@Controller('janmasethu/support-engagement')
@UseGuards(JwtAuthGuard)
@UseInterceptors(JanmasethuResponseInterceptor)
export class SupportEngagementController {
    private readonly logger = new Logger(SupportEngagementController.name);

    constructor(private readonly supportService: SupportEngagementService) {}

    @Post('tickets')
    async createTicket(@Body() dto: CreateSupportTicketDto) {
        try {
            return await this.supportService.createSupportTicket(dto);
        } catch (error) {
            this.logger.error(`Failed to create support ticket: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }

    @Get('tickets')
    async getTickets(@Query() query: { status?: string; priority?: string }) {
        try {
            return await this.supportService.getTickets(query);
        } catch (error) {
            this.logger.error(`Failed to fetch support tickets: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }

    @Post('tickets/:id/assign')
    async assignOwner(
        @Param('id') id: string,
        @Body() dto: AssignSupportOwnerDto,
        @Request() req: any
    ) {
        try {
            const actorId = req.user?.id || 'SYSTEM';
            return await this.supportService.assignSupportOwner(id, dto.userId, actorId);
        } catch (error) {
            this.logger.error(`Failed to assign ticket: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }

    @Post('tickets/:id/escalate')
    async escalateTicket(
        @Param('id') id: string,
        @Body() dto: EscalateSupportDto,
        @Request() req: any
    ) {
        try {
            const actorId = req.user?.id || 'SYSTEM';
            return await this.supportService.escalateToHuman(id, dto.reason, actorId);
        } catch (error) {
            this.logger.error(`Failed to escalate ticket: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }

    @Patch('tickets/:id/status')
    async updateStatus(
        @Param('id') id: string,
        @Body() dto: UpdateTicketStatusDto,
        @Request() req: any
    ) {
        try {
            const actorId = req.user?.id || 'SYSTEM';
            return await this.supportService.updateTicketStatus(id, dto.status, dto.priority, actorId);
        } catch (error) {
            this.logger.error(`Failed to update ticket: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }

    @Post('tickets/:id/message')
    async sendMessage(
        @Param('id') id: string,
        @Body() dto: SendSupportMessageDto,
        @Request() req: any
    ) {
        try {
            const senderId = req.user?.id || 'SYSTEM';
            const senderType = dto.senderType || 'HUMAN';
            return await this.supportService.sendSupportMessage(id, senderId, senderType, dto.content);
        } catch (error) {
            this.logger.error(`Failed to send message: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }

    @Get('tickets/:id/conversation')
    async getConversation(@Param('id') id: string) {
        try {
            return await this.supportService.getSupportConversation(id);
        } catch (error) {
            this.logger.error(`Failed to fetch conversation: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }

    @Post('tickets/:id/resolve')
    async resolveTicket(
        @Param('id') id: string,
        @Request() req: any
    ) {
        try {
            const actorId = req.user?.id || 'SYSTEM';
            return await this.supportService.resolveSupportThread(id, actorId);
        } catch (error) {
            this.logger.error(`Failed to resolve ticket: ${error.message}`);
            throw new BadRequestException(error.message);
        }
    }
}
