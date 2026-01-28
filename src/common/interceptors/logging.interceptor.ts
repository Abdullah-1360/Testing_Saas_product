import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { RedactionService } from '../services/redaction.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly redactionService: RedactionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    
    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';
    const startTime = Date.now();

    // Generate correlation ID for request tracking
    const correlationId = this.generateCorrelationId();
    (request as any)['correlationId'] = correlationId;
    response.setHeader('X-Correlation-ID', correlationId);

    return next.handle().pipe(
      tap({
        next: () => {
          const { statusCode } = response;
          const contentLength = response.get('content-length') || 0;
          const responseTime = Date.now() - startTime;

          // Create log context with potential sensitive data
          const logContext = {
            method,
            url,
            statusCode,
            contentLength,
            responseTime,
            ip,
            userAgent,
            correlationId,
            timestamp: new Date().toISOString(),
            // Only log request body in development and for non-sensitive endpoints
            ...(process.env['NODE_ENV'] === 'development' && 
                !this.isSensitiveEndpoint(url) && {
              requestBody: request.body,
            }),
          };

          // Redact sensitive information from log context
          const redactedContext = this.redactionService.redactObject(logContext);

          this.logger.log(redactedContext);
        },
        error: (error) => {
          const { statusCode } = response;
          const responseTime = Date.now() - startTime;

          const errorContext = {
            method,
            url,
            statusCode,
            responseTime,
            ip,
            userAgent,
            correlationId,
            error: error.message,
            timestamp: new Date().toISOString(),
          };

          // Redact sensitive information from error context
          const redactedContext = this.redactionService.redactObject(errorContext);

          this.logger.error(redactedContext);
        },
      })
    );
  }

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private isSensitiveEndpoint(url: string): boolean {
    const sensitivePatterns = [
      '/auth/login',
      '/auth/register',
      '/auth/mfa',
      '/users/password',
      '/servers',
      '/sites',
    ];

    return sensitivePatterns.some(pattern => url.includes(pattern));
  }
}