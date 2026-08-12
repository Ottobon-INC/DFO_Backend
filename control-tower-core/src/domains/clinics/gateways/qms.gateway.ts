import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: '/qms'
})
@Injectable()
export class QmsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private logger: Logger = new Logger('QmsGateway');

    handleConnection(client: Socket, ...args: any[]) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('join_queue_room')
    handleJoinRoom(@MessageBody() data: { tenantId: string, doctorId: string }, @ConnectedSocket() client: Socket) {
        const roomName = `tenant_${data.tenantId}_doctor_${data.doctorId}`;
        client.join(roomName);
        this.logger.log(`Client ${client.id} joined room: ${roomName}`);
        return { event: 'joined', room: roomName };
    }

    @SubscribeMessage('leave_queue_room')
    handleLeaveRoom(@MessageBody() data: { tenantId: string, doctorId: string }, @ConnectedSocket() client: Socket) {
        const roomName = `tenant_${data.tenantId}_doctor_${data.doctorId}`;
        client.leave(roomName);
        this.logger.log(`Client ${client.id} left room: ${roomName}`);
        return { event: 'left', room: roomName };
    }

    // Subscribe to internal NestJS EventEmitter events from QmsEngineService
    @OnEvent('queue.updated')
    handleQueueUpdatedEvent(payload: { tenantId: string, doctorId: string, appointmentId: string, status: string, token: string }) {
        const roomName = `tenant_${payload.tenantId}_doctor_${payload.doctorId}`;
        this.logger.log(`Broadcasting queue.updated to ${roomName}`);
        
        // Broadcast to all clients in this specific hospital/doctor room
        this.server.to(roomName).emit('queue_updated', payload);
    }
}
