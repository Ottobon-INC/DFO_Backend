import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Injectable()
export class JanmasethuResponseInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            map((data) => ({
                success: true,
                data: data,
                timestamp: new Date().toISOString(),
            })),
            catchError((err) => {
                const status =
                    err instanceof HttpException
                        ? err.getStatus()
                        : HttpStatus.INTERNAL_SERVER_ERROR;

                return throwError(() => new HttpException({
                    success: false,
                    error: err.message || 'Internal Server Error',
                    code: status,
                    timestamp: new Date().toISOString(),
                }, status));
            }),
        );
    }
}
