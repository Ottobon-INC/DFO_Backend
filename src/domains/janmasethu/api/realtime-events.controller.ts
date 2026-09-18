import { Controller, Sse, MessageEvent, Logger } from '@nestjs/common';
import { Observable, interval, map, Subject } from 'rxjs';

@Controller('janmasethu/realtime')
export class RealtimeEventsController {
    private readonly logger = new Logger('RealtimeEvents');
    private static eventSubject = new Subject<MessageEvent>();

    @Sse('events')
    sse(): Observable<MessageEvent> {
        this.logger.log('Clinician connected to real-time event stream.');

        // Merge a 30s heartbeat with the actual event stream
        return new Observable<MessageEvent>((subscriber) => {
            const subscription = RealtimeEventsController.eventSubject.subscribe(subscriber);
            const heartbeat = interval(30000).subscribe(() => {
                subscriber.next({ data: { type: 'HEARTBEAT', timestamp: new Date() } });
            });

            return () => {
                subscription.unsubscribe();
                heartbeat.unsubscribe();
                this.logger.log('Clinician disconnected from real-time stream.');
            };
        });
    }

    /**
     * STATIC HELPER TO BROADCAST EVENTS FROM ANY SERVICE
     */
    static broadcast(type: string, payload: any) {
        this.eventSubject.next({
            data: {
                type,
                payload,
                timestamp: new Date().toISOString()
            }
        });
    }
}
