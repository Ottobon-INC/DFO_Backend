import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { RealtimeEventsController } from '../api/realtime-events.controller';
import { JanmasethuRepository } from '../janmasethu.repository';
import { CreateSupportTicketDto } from './dto/support-engagement.dto';
import { OwnershipType } from '../../../types';

@Injectable()
export class SupportEngagementService {
    private readonly logger = new Logger(SupportEngagementService.name);

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
        private readonly repository: JanmasethuRepository,
    ) {}

    async createSupportTicket(dto: CreateSupportTicketDto) {
        this.logger.log(`Creating support ticket for patient: ${dto.patient_name || 'unknown'}`);
        
        const { data, error } = await this.supabase
            .from('dfo_support_tickets')
            .insert([{
                thread_id: dto.thread_id || null,
                patient_id: dto.patient_id || null,
                patient_phone: dto.patient_phone || '',
                patient_name: dto.patient_name || '',
                category: dto.category,
                priority: dto.priority || 'LOW',
                status: 'OPEN',
                source: dto.source || 'web',
                escalation_metadata: {}
            }])
            .select()
            .single();

        if (error) {
            this.logger.error(`Failed to create support ticket: ${error.message}`);
            throw error;
        }

        // Auditing
        if (dto.thread_id) {
            await this.repository.insertAuditLog({
                thread_id: dto.thread_id,
                actor_id: 'SYSTEM',
                actor_type: 'SYSTEM',
                action: 'SUPPORT_TICKET_CREATED',
                payload: { ticket_id: data.id, category: dto.category, priority: dto.priority },
            });
        }

        RealtimeEventsController.broadcast('SUPPORT_TICKET_CREATED', data);
        return data;
    }

    async assignSupportOwner(ticketId: string, userId: string, actorId: string) {
        this.logger.log(`Assigning ticket ${ticketId} to user ${userId}`);

        const { data: ticket, error: fetchError } = await this.supabase
            .from('dfo_support_tickets')
            .select('*')
            .eq('id', ticketId)
            .maybeSingle();

        if (fetchError || !ticket) {
            throw new NotFoundException(`Support ticket ${ticketId} not found`);
        }

        const updates: any = {
            assigned_user_id: userId,
            updated_at: new Date().toISOString()
        };

        if (ticket.status === 'OPEN') {
            updates.status = 'IN_PROGRESS';
        }

        const { data: updatedTicket, error: updateError } = await this.supabase
            .from('dfo_support_tickets')
            .update(updates)
            .eq('id', ticketId)
            .select()
            .single();

        if (updateError) throw updateError;

        if (ticket.thread_id) {
            // Also sync the assigned user to the conversation thread
            const thread = await this.repository.findThreadById(ticket.thread_id);
            if (thread) {
                await this.repository.updateThreadAtomic(ticket.thread_id, thread.version, {
                    assigned_user_id: userId
                });
            }

            await this.repository.insertAuditLog({
                thread_id: ticket.thread_id,
                actor_id: actorId,
                actor_type: 'HUMAN',
                action: 'SUPPORT_TICKET_ASSIGNED',
                payload: { ticket_id: ticketId, assigned_user_id: userId },
            });
        }

        RealtimeEventsController.broadcast('SUPPORT_TICKET_UPDATED', updatedTicket);
        return updatedTicket;
    }

    async escalateToHuman(ticketId: string, reason: string, actorId: string) {
        this.logger.log(`Escalating support ticket ${ticketId} to human. Reason: ${reason}`);

        const { data: ticket, error: fetchError } = await this.supabase
            .from('dfo_support_tickets')
            .select('*')
            .eq('id', ticketId)
            .maybeSingle();

        if (fetchError || !ticket) {
            throw new NotFoundException(`Support ticket ${ticketId} not found`);
        }

        // Lock thread and set ownership to HUMAN
        if (ticket.thread_id) {
            const thread = await this.repository.findThreadById(ticket.thread_id);
            if (thread) {
                // Takeover ownership atomically
                await this.repository.updateThreadAtomic(ticket.thread_id, thread.version, {
                    ownership: OwnershipType.HUMAN,
                    is_locked: true
                });

                await this.repository.insertAuditLog({
                    thread_id: ticket.thread_id,
                    actor_id: actorId,
                    actor_type: 'SYSTEM',
                    action: 'HUMAN_TAKEOVER',
                    payload: { reason, ticket_id: ticketId },
                });

                await this.repository.insertRoutingEvent({
                    thread_id: ticket.thread_id,
                    actor_id: actorId,
                    reason: `SUPPORT_ESCALATION: ${reason}`,
                });
            }
        }

        // Update ticket status to ESCALATED
        const { data: updatedTicket, error: updateError } = await this.supabase
            .from('dfo_support_tickets')
            .update({
                status: 'ESCALATED',
                priority: 'CRITICAL', // Escalate priority to CRITICAL on human escalation
                escalation_metadata: {
                    escalated_by: actorId,
                    escalation_reason: reason,
                    escalated_at: new Date().toISOString()
                },
                updated_at: new Date().toISOString()
            })
            .eq('id', ticketId)
            .select()
            .single();

        if (updateError) throw updateError;

        RealtimeEventsController.broadcast('SUPPORT_TICKET_UPDATED', updatedTicket);
        RealtimeEventsController.broadcast('SUPPORT_TICKET_ESCALATED', { ticketId, reason });
        return updatedTicket;
    }

    async updateTicketStatus(ticketId: string, status?: string, priority?: string, actorId?: string) {
        this.logger.log(`Updating ticket ${ticketId} status to ${status}, priority to ${priority}`);

        const { data: ticket, error: fetchError } = await this.supabase
            .from('dfo_support_tickets')
            .select('*')
            .eq('id', ticketId)
            .maybeSingle();

        if (fetchError || !ticket) {
            throw new NotFoundException(`Support ticket ${ticketId} not found`);
        }

        const updates: any = {
            updated_at: new Date().toISOString()
        };

        if (status) updates.status = status;
        if (priority) updates.priority = priority;

        const { data: updatedTicket, error: updateError } = await this.supabase
            .from('dfo_support_tickets')
            .update(updates)
            .eq('id', ticketId)
            .select()
            .single();

        if (updateError) throw updateError;

        if (ticket.thread_id) {
            await this.repository.insertAuditLog({
                thread_id: ticket.thread_id,
                actor_id: actorId || 'SYSTEM',
                actor_type: 'HUMAN',
                action: 'SUPPORT_TICKET_UPDATED',
                payload: { ticket_id: ticketId, status, priority },
            });
        }

        RealtimeEventsController.broadcast('SUPPORT_TICKET_UPDATED', updatedTicket);
        return updatedTicket;
    }

    async sendSupportMessage(ticketId: string, senderId: string, senderType: 'USER' | 'HUMAN' | 'AI', content: string) {
        this.logger.log(`Sending support message for ticket ${ticketId}`);

        const { data: ticket, error: fetchError } = await this.supabase
            .from('dfo_support_tickets')
            .select('*')
            .eq('id', ticketId)
            .maybeSingle();

        if (fetchError || !ticket) {
            throw new NotFoundException(`Support ticket ${ticketId} not found`);
        }

        if (!ticket.thread_id) {
            throw new Error(`Ticket ${ticketId} is not linked to any conversation thread`);
        }

        // Create the message in conversation_messages
        const message = await this.repository.createMessage({
            thread_id: ticket.thread_id,
            sender_id: senderId,
            sender_type: senderType,
            content: content
        });

        // Insert audit log
        await this.repository.insertAuditLog({
            thread_id: ticket.thread_id,
            actor_id: senderId,
            actor_type: senderType === 'USER' ? 'HUMAN' : senderType, // Cast User to HUMAN for actor_type alignment
            action: 'MESSAGE_APPENDED',
            payload: { ticket_id: ticketId, content_length: content.length },
        });

        // Touch the ticket's updated_at
        await this.supabase
            .from('dfo_support_tickets')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', ticketId);

        RealtimeEventsController.broadcast('SUPPORT_MESSAGE_SENT', {
            ticketId,
            message
        });

        return message;
    }

    async getSupportConversation(ticketId: string) {
        const { data: ticket, error: fetchError } = await this.supabase
            .from('dfo_support_tickets')
            .select('*')
            .eq('id', ticketId)
            .maybeSingle();

        if (fetchError || !ticket) {
            throw new NotFoundException(`Support ticket ${ticketId} not found`);
        }

        if (!ticket.thread_id) {
            return [];
        }

        return this.repository.findMessagesByThreadId(ticket.thread_id);
    }

    async resolveSupportThread(ticketId: string, actorId: string) {
        this.logger.log(`Resolving support ticket ${ticketId}`);

        const { data: ticket, error: fetchError } = await this.supabase
            .from('dfo_support_tickets')
            .select('*')
            .eq('id', ticketId)
            .maybeSingle();

        if (fetchError || !ticket) {
            throw new NotFoundException(`Support ticket ${ticketId} not found`);
        }

        // Update ticket to RESOLVED
        const { data: updatedTicket, error: updateError } = await this.supabase
            .from('dfo_support_tickets')
            .update({
                status: 'RESOLVED',
                updated_at: new Date().toISOString()
            })
            .eq('id', ticketId)
            .select()
            .single();

        if (updateError) throw updateError;

        // Release the linked thread ownership back to AI and unlock it
        if (ticket.thread_id) {
            const thread = await this.repository.findThreadById(ticket.thread_id);
            if (thread) {
                await this.repository.updateThreadAtomic(ticket.thread_id, thread.version, {
                    ownership: OwnershipType.AI,
                    is_locked: false
                });

                await this.repository.insertAuditLog({
                    thread_id: ticket.thread_id,
                    actor_id: actorId,
                    actor_type: 'HUMAN',
                    action: 'RELEASE_CONTROL',
                    payload: { reason: 'SUPPORT_RESOLVED', ticket_id: ticketId },
                });
            }
        }

        RealtimeEventsController.broadcast('SUPPORT_TICKET_UPDATED', updatedTicket);
        RealtimeEventsController.broadcast('SUPPORT_TICKET_RESOLVED', { ticketId });
        return updatedTicket;
    }

    async getTickets(filters: { status?: string; priority?: string }) {
        let query = this.supabase.from('dfo_support_tickets').select('*');
        if (filters.status) {
            query = query.eq('status', filters.status);
        }
        if (filters.priority) {
            query = query.eq('priority', filters.priority);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }
}
