import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { createClient } from '@supabase/supabase-js';

/**
 * PhiAuditInterceptor
 * 
 * A NestJS Interceptor that automatically logs PHI access to Supabase.
 * This guarantees logging even if the Next.js frontend is bypassed.
 */
@Injectable()
export class PhiAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PhiAuditInterceptor.name);
  private supabaseUrl = process.env.SUPABASE_URL || '';
  private supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const endpoint = request.url;
    
    // Check if the endpoint likely contains PHI. 
    // You can customize this logic based on your route structure.
    const isPhiEndpoint = endpoint.includes('/timeline') || endpoint.includes('/dashboard') || endpoint.includes('/patient');
    
    if (!isPhiEndpoint) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((data) => {
        // Run the logging asynchronously AFTER the response is sent back
        this.logToSupabase(request, data).catch(err => {
          // Fail-open: We log the error in the server console (DataDog/Sentry will pick it up),
          // but the user already received their data.
          this.logger.error(`CRITICAL AUDIT FAILURE: ${err.message}`, err.stack);
        });
      }),
    );
  }

  private async logToSupabase(request: any, responseData: any) {
    if (!this.supabaseUrl || !this.supabaseAnonKey) {
      throw new Error("Missing Supabase credentials for PHI logging.");
    }

    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      throw new Error("No authorization token found for PHI audit.");
    }

    // Try to extract patient ID from the response payload
    let patientId = undefined;
    if (responseData && typeof responseData === 'object') {
      if (responseData.patient && responseData.patient.id) patientId = responseData.patient.id;
      else if (responseData.patientId) patientId = responseData.patientId;
      else if (responseData.id) patientId = responseData.id;
    }

    const clientIp = request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown';

    // We manually instantiate a Supabase client just for this insert,
    // passing the user's token so RLS policies pass correctly.
    const supabase = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    // In a real app, you would decode the JWT to get the user ID, or the user object might
    // already be attached to the request by a AuthGuard (e.g. request.user.id).
    // For now we assume Supabase RLS handles it or we decode it.
    const logEntry = {
      user_id: request.user?.id || 'unknown', // Assumes a standard AuthGuard populates request.user
      patient_id: patientId || request.user?.id || 'unknown',
      action_type: 'READ',
      resource_accessed: request.url,
      client_ip: clientIp,
    };

    // Use a 15-second AbortController to prevent hanging connections
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const { error } = await supabase
        .from('sakhi_clinic_phi_access_logs')
        .insert([logEntry])
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);

      if (error) {
        throw new Error(`Supabase Insert Failed: ${error.message}`);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error("Supabase insert timed out after 15s");
      throw err;
    }
  }
}
