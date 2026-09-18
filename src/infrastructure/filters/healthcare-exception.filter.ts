import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HealthcareExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HealthcareExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception.message || 'Internal server error';

    const errorResponse = {
      success: false,
      error: typeof message === 'string' ? message : (message as any).message || message,
      code: (message as any).error || 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    this.logger.error(
      `[HealthcareException] ${request.method} ${request.url} - Status: ${status} - Error: ${JSON.stringify(
        errorResponse,
      )}`,
      exception.stack,
    );

    response.status(status).json(errorResponse);
  }
}
