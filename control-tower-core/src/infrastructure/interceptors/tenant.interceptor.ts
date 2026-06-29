import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import * as jwt from 'jsonwebtoken';
import { tenantContext, TenantState } from '../context/tenant.context';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantInterceptor.name);
  private readonly jwtSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'fallback_secret_do_not_use_in_prod';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request?.headers?.authorization;

    let tenantState: TenantState = {};

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        // Decode without verifying if we just want to extract it globally fail-soft.
        // We do verify it to ensure we aren't parsing malicious spoofed payloads, 
        // but we catch errors to not fail the request if it's invalid.
        const decoded = jwt.verify(token, this.jwtSecret) as any;
        
        tenantState = {
          user_id: decoded.user_id || decoded.sub,
          clinic_id: decoded.clinic_id,
          role: decoded.role,
          is_super_admin: decoded.is_super_admin,
          is_clinic_admin: decoded.is_clinic_admin,
        };
      } catch (error) {
        // Fail-soft: if token is expired or invalid, we don't throw an error here.
        // The existing AuthGuards will handle throwing the 401.
        this.logger.debug('Failed to verify JWT in TenantInterceptor. Proceeding without context.');
      }
    }

    // Run the execution context with the tenant state
    return new Observable((subscriber) => {
      tenantContext.run(tenantState, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
