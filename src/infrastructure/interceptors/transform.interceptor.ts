import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface StandardizedResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, StandardizedResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<StandardizedResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true,
        data: data || null,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
