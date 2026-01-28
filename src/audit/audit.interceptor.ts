import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { AuditService } from './audit.service';
import { Reflector } from '@nestjs/core';

// Decorator to skip audit logging for specific endpoints
export const SKIP_AUDIT_KEY = 'skipAudit';
export const SkipAudit = () => Reflector.createDecorator<boolean>({ key: SKIP_AUDIT_KEY });

// Decorator to specify custom audit action
export const AUDIT_ACTION_KEY = 'auditAction';
export const AuditAction = (action: string) => Reflector.createDecorator<string>({ key: AUDIT_ACTION_KEY, transform: () => action });

// Decorator to specify resource type for audit
export const AUDIT_RESOURCE_KEY = 'auditResource';
export const AuditResource = (resource: string) => Reflector.createDecorator<string>({ key: AUDIT_RESOURCE_KEY, transform: () => resource });

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    
    // Check if audit logging should be skipped
    const skipAudit = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipAudit) {
      return next.handle();
    }

    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';
    const startTime = Date.now();

    // Generate trace ID and correlation ID if not present
    const traceId = (request as any)['traceId'] || this.auditService.generateTraceId();
    const correlationId = (request as any)['correlationId'] || this.auditService.generateCorrelationId();
    
    // Set trace and correlation IDs on request for downstream use
    (request as any)['traceId'] = traceId;
    (request as any)['correlationId'] = correlationId;
    
    // Set headers for client tracking
    response.setHeader('X-Trace-ID', traceId);
    response.setHeader('X-Correlation-ID', correlationId);

    // Get user information
    const user = (request as any)['user'];
    const userId = user?.id;

    // Determine action and resource type
    const customAction = this.reflector.getAllAndOverride<string>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const customResource = this.reflector.getAllAndOverride<string>(AUDIT_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const action = customAction || this.getActionFromMethod(method);
    const resourceType = customResource || this.getResourceTypeFromUrl(url);
    const resourceId = this.extractResourceId(url);

    return next.handle().pipe(
      tap({
        next: (data) => {
          const responseTime = Date.now() - startTime;
          const { statusCode } = response;

          // Only log successful operations (2xx status codes)
          if (statusCode >= 200 && statusCode < 300) {
            this.logAuditEvent(
              action,
              resourceType,
              resourceId,
              userId,
              {
                method,
                url,
                statusCode,
                responseTime,
                success: true,
                dataSize: this.getDataSize(data),
              },
              ip,
              userAgent,
              traceId,
              correlationId,
            ).catch(error => {
              this.logger.error('Failed to log successful audit event', {
                error: error.message,
                traceId,
                correlationId,
              });
            });
          }
        },
        error: (error) => {
          const responseTime = Date.now() - startTime;
          const statusCode = error.status || 500;

          // Log failed operations
          this.logAuditEvent(
            action,
            resourceType,
            resourceId,
            userId,
            {
              method,
              url,
              statusCode,
              responseTime,
              success: false,
              error: error.message,
              errorType: error.constructor.name,
            },
            ip,
            userAgent,
            traceId,
            correlationId,
          ).catch(auditError => {
            this.logger.error('Failed to log failed audit event', {
              error: auditError.message,
              originalError: error.message,
              traceId,
              correlationId,
            });
          });
        },
      }),
      catchError((error) => {
        // Re-throw the original error after logging
        throw error;
      }),
    );
  }

  private async logAuditEvent(
    action: string,
    resource: string,
    resourceId: string | undefined,
    userId: string | undefined,
    details: Record<string, any>,
    ipAddress: string,
    userAgent: string,
    traceId: string,
    correlationId: string,
  ): Promise<void> {
    try {
      // Skip logging audit events for audit endpoints to prevent infinite loops
      if (resource === 'AUDIT' || action.includes('AUDIT')) {
        return;
      }

      await this.auditService.createAuditEvent({
        userId,
        action,
        resource: resource,
        resourceId,
        details,
        ipAddress,
        userAgent,
        traceId,
        correlationId,
      });
    } catch (error) {
      this.logger.error('Failed to create audit event', {
        error: error.message,
        action,
        resource,
        resourceId,
        userId,
        traceId,
        correlationId,
      });
    }
  }

  private getActionFromMethod(method: string): string {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'READ';
      case 'POST':
        return 'CREATE';
      case 'PUT':
      case 'PATCH':
        return 'UPDATE';
      case 'DELETE':
        return 'DELETE';
      default:
        return 'UNKNOWN';
    }
  }

  private getResourceTypeFromUrl(url: string): string {
    // Remove query parameters and leading slash
    const cleanUrl = url.split('?')[0].replace(/^\//, '');
    const segments = cleanUrl.split('/');

    if (segments.length === 0) {
      return 'UNKNOWN';
    }

    // Map URL segments to resource types
    const resourceMap: Record<string, string> = {
      'auth': 'AUTH',
      'users': 'USER',
      'servers': 'SERVER',
      'sites': 'SITE',
      'incidents': 'INCIDENT',
      'evidence': 'EVIDENCE',
      'backup': 'BACKUP',
      'verification': 'VERIFICATION',
      'audit': 'AUDIT',
      'jobs': 'JOB',
      'ssh': 'SSH',
    };

    const firstSegment = segments[0].toLowerCase();
    return resourceMap[firstSegment] || firstSegment.toUpperCase();
  }

  private extractResourceId(url: string): string | undefined {
    // Remove query parameters
    const cleanUrl = url.split('?')[0];
    const segments = cleanUrl.split('/').filter(s => s.length > 0);

    // Look for UUID patterns in URL segments
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    for (const segment of segments) {
      if (uuidPattern.test(segment)) {
        return segment;
      }
    }

    // If no UUID found, check for numeric IDs
    const numericPattern = /^\d+$/;
    for (const segment of segments) {
      if (numericPattern.test(segment)) {
        return segment;
      }
    }

    return undefined;
  }

  private getDataSize(data: any): number {
    if (!data) return 0;
    
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }
}