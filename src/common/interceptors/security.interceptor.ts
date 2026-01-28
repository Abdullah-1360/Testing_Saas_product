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
import { SecurityMonitoringService, SecurityEventType, SecuritySeverity } from '@/security/security-monitoring.service';

@Injectable()
export class SecurityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SecurityInterceptor.name);

  constructor(
    private readonly securityMonitoringService: SecurityMonitoringService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    
    const startTime = Date.now();
    const requestId = request.headers['x-request-id'] as string;
    const sourceIp = this.getClientIp(request);
    const userAgent = request.headers['user-agent'];
    const userId = (request as any).user?.id;

    // Check for suspicious patterns in the request
    this.checkSuspiciousPatterns(request, requestId, sourceIp, userId);

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        
        // Log successful requests for analysis
        this.logRequestMetrics(request, response, duration, sourceIp, userId);
        
        // Check for suspicious response patterns
        this.checkResponsePatterns(request, response, data, sourceIp, userId, requestId);
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        
        // Record security events based on error types
        this.handleSecurityError(error, request, sourceIp, userId, requestId, duration);
        
        throw error;
      }),
    );
  }

  /**
   * Extract client IP address from request
   */
  private getClientIp(request: Request): string {
    return (
      request.headers['x-forwarded-for'] as string ||
      request.headers['x-real-ip'] as string ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Check for suspicious patterns in incoming requests
   */
  private checkSuspiciousPatterns(
    request: Request,
    requestId: string,
    sourceIp: string,
    userId?: string,
  ): void {
    const url = request.url;
    const method = request.method;
    const userAgent = request.headers['user-agent'] || '';
    const body = request.body;
    const query = request.query;

    // SQL Injection patterns
    const sqlInjectionPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      /((\%27)|(\'))\s*((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
      /(\%27)|(\')|(--)|(\%23)|(#)/i,
      /((\%3D)|(=))[^\n]*((\%27)|(\')|(--)|(\%3B)|(;))/i,
    ];

    // XSS patterns
    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe[^>]*>.*?<\/iframe>/gi,
      /eval\s*\(/gi,
    ];

    // Directory traversal patterns
    const directoryTraversalPatterns = [
      /\.\.\//g,
      /\.\.\\/g,
      /%2e%2e%2f/gi,
      /%2e%2e%5c/gi,
    ];

    // Command injection patterns
    const commandInjectionPatterns = [
      /[;&|`$(){}[\]]/,
      /\b(cat|ls|pwd|whoami|id|uname|ps|netstat|ifconfig|ping|wget|curl)\b/i,
    ];

    const requestContent = JSON.stringify({ url, body, query });

    // Check SQL injection
    if (sqlInjectionPatterns.some(pattern => pattern.test(requestContent))) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.SQL_INJECTION_ATTEMPT,
        severity: SecuritySeverity.CRITICAL,
        source: 'request_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url,
          method,
          userAgent,
          detectedPattern: 'sql_injection',
        },
      });
    }

    // Check XSS
    if (xssPatterns.some(pattern => pattern.test(requestContent))) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.XSS_ATTEMPT,
        severity: SecuritySeverity.HIGH,
        source: 'request_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url,
          method,
          userAgent,
          detectedPattern: 'xss',
        },
      });
    }

    // Check directory traversal
    if (directoryTraversalPatterns.some(pattern => pattern.test(requestContent))) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.DIRECTORY_TRAVERSAL,
        severity: SecuritySeverity.HIGH,
        source: 'request_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url,
          method,
          userAgent,
          detectedPattern: 'directory_traversal',
        },
      });
    }

    // Check command injection
    if (commandInjectionPatterns.some(pattern => pattern.test(requestContent))) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.COMMAND_INJECTION,
        severity: SecuritySeverity.CRITICAL,
        source: 'request_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url,
          method,
          userAgent,
          detectedPattern: 'command_injection',
        },
      });
    }

    // Check for suspicious user agents
    const suspiciousUserAgents = [
      /sqlmap/i,
      /nikto/i,
      /nmap/i,
      /dirb/i,
      /dirbuster/i,
      /havij/i,
      /libwww-perl/i,
      /python-requests/i,
      /curl/i,
      /wget/i,
    ];

    if (suspiciousUserAgents.some(pattern => pattern.test(userAgent))) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_REQUEST,
        severity: SecuritySeverity.MEDIUM,
        source: 'request_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url,
          method,
          userAgent,
          reason: 'suspicious_user_agent',
        },
      });
    }

    // Check for suspicious file access patterns
    const sensitiveFilePatterns = [
      /\.(env|config|ini|conf|log|bak|backup|sql|db)$/i,
      /\/\.(git|svn|hg)\//i,
      /\/(wp-config|config)\.php$/i,
      /\/etc\/(passwd|shadow|hosts)/i,
    ];

    if (sensitiveFilePatterns.some(pattern => pattern.test(url))) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_FILE_ACCESS,
        severity: SecuritySeverity.HIGH,
        source: 'request_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url,
          method,
          userAgent,
          filePath: url,
        },
      });
    }
  }

  /**
   * Check response patterns for security issues
   */
  private checkResponsePatterns(
    request: Request,
    response: Response,
    data: any,
    sourceIp: string,
    userId?: string,
    requestId?: string,
  ): void {
    // Check for potential data exfiltration (large responses)
    const responseSize = JSON.stringify(data || {}).length;
    
    if (responseSize > 1000000) { // 1MB
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.DATA_EXFILTRATION,
        severity: SecuritySeverity.MEDIUM,
        source: 'response_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url: request.url,
          method: request.method,
          responseSize,
          endpoint: request.route?.path,
        },
      });
    }

    // Check for error responses that might indicate probing
    if (response.statusCode >= 400 && response.statusCode < 500) {
      // Don't log every 404, but log patterns
      if (response.statusCode === 404) {
        // Only log if it's a suspicious 404 (looking for admin panels, etc.)
        const suspiciousUrls = [
          /\/admin/i,
          /\/wp-admin/i,
          /\/phpmyadmin/i,
          /\/manager/i,
          /\/console/i,
        ];

        if (suspiciousUrls.some(pattern => pattern.test(request.url))) {
          this.securityMonitoringService.recordSecurityEvent({
            type: SecurityEventType.SUSPICIOUS_REQUEST,
            severity: SecuritySeverity.LOW,
            source: 'response_interceptor',
            sourceIp,
            userId,
            requestId,
            timestamp: new Date(),
            metadata: {
              url: request.url,
              method: request.method,
              statusCode: response.statusCode,
              reason: 'suspicious_404',
            },
          });
        }
      }
    }
  }

  /**
   * Handle security-related errors
   */
  private handleSecurityError(
    error: any,
    request: Request,
    sourceIp: string,
    userId?: string,
    requestId?: string,
    duration?: number,
  ): void {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = error.status || error.statusCode || 500;

    // Authentication failures
    if (statusCode === 401 || errorMessage.includes('authentication')) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.AUTHENTICATION_FAILURE,
        severity: SecuritySeverity.MEDIUM,
        source: 'error_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url: request.url,
          method: request.method,
          userAgent: request.headers['user-agent'],
          errorMessage: errorMessage.substring(0, 200), // Limit length
          statusCode,
          duration,
        },
      });
    }

    // Authorization failures
    if (statusCode === 403 || errorMessage.includes('authorization') || errorMessage.includes('forbidden')) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.UNAUTHORIZED_ACCESS,
        severity: SecuritySeverity.HIGH,
        source: 'error_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url: request.url,
          method: request.method,
          endpoint: request.route?.path,
          userAgent: request.headers['user-agent'],
          errorMessage: errorMessage.substring(0, 200),
          statusCode,
          duration,
        },
      });
    }

    // Rate limiting
    if (statusCode === 429) {
      this.securityMonitoringService.recordSecurityEvent({
        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        severity: SecuritySeverity.LOW,
        source: 'error_interceptor',
        sourceIp,
        userId,
        requestId,
        timestamp: new Date(),
        metadata: {
          url: request.url,
          method: request.method,
          userAgent: request.headers['user-agent'],
          statusCode,
          duration,
        },
      });
    }
  }

  /**
   * Log request metrics for analysis
   */
  private logRequestMetrics(
    request: Request,
    response: Response,
    duration: number,
    sourceIp: string,
    userId?: string,
  ): void {
    // Log slow requests that might indicate attacks
    if (duration > 5000) { // 5 seconds
      this.logger.warn('Slow request detected', {
        url: request.url,
        method: request.method,
        duration,
        sourceIp,
        userId,
        statusCode: response.statusCode,
      });
    }

    // Log high-privilege operations
    const sensitiveEndpoints = [
      /\/users/i,
      /\/servers/i,
      /\/incidents/i,
      /\/auth/i,
      /\/admin/i,
    ];

    if (sensitiveEndpoints.some(pattern => pattern.test(request.url))) {
      this.logger.log('Sensitive endpoint access', {
        url: request.url,
        method: request.method,
        sourceIp,
        userId,
        statusCode: response.statusCode,
        duration,
      });
    }
  }
}