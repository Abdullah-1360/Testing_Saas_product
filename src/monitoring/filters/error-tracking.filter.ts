import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorTrackingService, ErrorType, ErrorSeverity } from '../error-tracking.service';

@Catch()
export class ErrorTrackingFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorTrackingFilter.name);

  constructor(private readonly errorTrackingService: ErrorTrackingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorType = ErrorType.APPLICATION_ERROR;
    let severity = ErrorSeverity.HIGH;

    // Determine error details based on exception type
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
      
      // Categorize HTTP exceptions
      if (status >= 500) {
        severity = ErrorSeverity.HIGH;
        errorType = ErrorType.APPLICATION_ERROR;
      } else if (status === 401) {
        severity = ErrorSeverity.MEDIUM;
        errorType = ErrorType.AUTHENTICATION_ERROR;
      } else if (status === 403) {
        severity = ErrorSeverity.MEDIUM;
        errorType = ErrorType.AUTHORIZATION_ERROR;
      } else if (status === 400) {
        severity = ErrorSeverity.LOW;
        errorType = ErrorType.VALIDATION_ERROR;
      } else if (status === 429) {
        severity = ErrorSeverity.MEDIUM;
        errorType = ErrorType.RATE_LIMIT_ERROR;
      } else {
        severity = ErrorSeverity.LOW;
        errorType = ErrorType.APPLICATION_ERROR;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      
      // Categorize based on error message patterns
      if (this.isDatabaseError(exception)) {
        errorType = ErrorType.DATABASE_ERROR;
        severity = ErrorSeverity.HIGH;
      } else if (this.isNetworkError(exception)) {
        errorType = ErrorType.NETWORK_ERROR;
        severity = ErrorSeverity.MEDIUM;
      } else if (this.isTimeoutError(exception)) {
        errorType = ErrorType.TIMEOUT_ERROR;
        severity = ErrorSeverity.MEDIUM;
      } else {
        errorType = ErrorType.APPLICATION_ERROR;
        severity = ErrorSeverity.HIGH;
      }
    }

    // Record the error for monitoring
    this.errorTrackingService.recordError({
      type: errorType,
      severity,
      message,
      stack: exception instanceof Error ? exception.stack : undefined,
      context: {
        url: request.url,
        method: request.method,
        userAgent: request.get('user-agent'),
        ip: request.ip,
        statusCode: status,
        component: 'http_handler',
      },
      userId: (request as any).user?.id,
      requestId: (request as any).requestId,
      timestamp: new Date(),
    });

    // Log the error
    this.logger.error(
      `HTTP ${status} Error: ${message}`,
      {
        url: request.url,
        method: request.method,
        statusCode: status,
        userAgent: request.get('user-agent'),
        ip: request.ip,
        stack: exception instanceof Error ? exception.stack : undefined,
      },
    );

    // Send error response
    const errorResponse = {
      statusCode: status,
      message: this.sanitizeErrorMessage(message),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }

  /**
   * Check if error is database-related
   */
  private isDatabaseError(error: Error): boolean {
    const dbErrorPatterns = [
      'connection',
      'database',
      'prisma',
      'postgresql',
      'sql',
      'constraint',
      'foreign key',
      'unique',
    ];

    const errorMessage = error.message.toLowerCase();
    return dbErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Check if error is network-related
   */
  private isNetworkError(error: Error): boolean {
    const networkErrorPatterns = [
      'econnrefused',
      'enotfound',
      'etimedout',
      'econnreset',
      'network',
      'fetch',
      'request failed',
    ];

    const errorMessage = error.message.toLowerCase();
    return networkErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Check if error is timeout-related
   */
  private isTimeoutError(error: Error): boolean {
    const timeoutErrorPatterns = [
      'timeout',
      'timed out',
      'deadline exceeded',
      'request timeout',
    ];

    const errorMessage = error.message.toLowerCase();
    return timeoutErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Sanitize error message to avoid exposing sensitive information
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove potential sensitive information
    let sanitized = message;

    // Remove file paths
    sanitized = sanitized.replace(/\/[^\s]+/g, '[path]');
    
    // Remove potential passwords or tokens
    sanitized = sanitized.replace(/password[=:]\s*\S+/gi, 'password=***');
    sanitized = sanitized.replace(/token[=:]\s*\S+/gi, 'token=***');
    sanitized = sanitized.replace(/key[=:]\s*\S+/gi, 'key=***');
    sanitized = sanitized.replace(/secret[=:]\s*\S+/gi, 'secret=***');

    return sanitized;
  }
}