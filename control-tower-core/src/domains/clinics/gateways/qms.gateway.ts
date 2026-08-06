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
        this.logger.log(Client connected: \);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(Client disconnected: \);
    }

    @SubscribeMessage('join_queue_room')
    handleJoinRoom(@MessageBody() data: { tenantId: string, doctorId: string }, @ConnectedSocket() client: Socket) {
        const roomName = 	enant_\_doctor_\;
        client.join(roomName);
        this.logger.log(Client \ joined room: \);
        return { event: 'joined', room: roomName };
    }

    @SubscribeMessage('leave_queue_room')
    handleLeaveRoom(@MessageBody() data: { tenantId: string, doctorId: string }, @ConnectedSocket() client: Socket) {
        const roomName = 	enant_\_doctor_\;
        client.leave(roomName);
        this.logger.log(Client \ left room: \);
        return { event: 'left', room: roomName };
    }

    // Subscribe to internal NestJS EventEmitter events from QmsEngineService
    @OnEvent('queue.updated')
    handleQueueUpdatedEvent(payload: { tenantId: string, doctorId: string, appointmentId: string, status: string, token: string }) {
        const roomName = 	enant_\_doctor_\;
        this.logger.log(Broadcasting queue.updated to \);
        
        // Broadcast to all clients in this specific hospital/doctor room
        this.server.to(roomName).emit('queue_updated', payload);
    }
}
