import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantContext, TenantState } from '../context/tenant.context';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor() {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    let tenantState: TenantState = {};

    if (user) {
      const authHeader = request?.headers?.authorization;
      const raw_token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

      tenantState = {
        user_id: user.id || user.sub,
        clinic_id: user.clinic_id,
        role: user.role,
        is_super_admin: user.is_super_admin,
        is_clinic_admin: user.is_clinic_admin,
        raw_token,
      };
    }

    // Run the execution context with the tenant state
    return new Observable((subscriber) => {
      tenantContext.run(tenantState, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
