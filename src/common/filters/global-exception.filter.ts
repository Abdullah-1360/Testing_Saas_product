import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RedactionService } from '../services/redaction.service';

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly redactionService: RedactionService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, any>;
        message = (responseObj as any)['message'] || (responseObj as any)['error'] || message;
        code = (responseObj as any)['code'] || this.getErrorCode(exception);
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      code = 'APPLICATION_ERROR';
    }

    // Log error with context (with secret redaction)
    const errorContext = {
      message: exception instanceof Error ? exception.message : 'Unknown error',
      stack: exception instanceof Error ? exception.stack : undefined,
      url: request.url,
      method: request.method,
      userAgent: request.get('user-agent'),
      ip: request.ip,
      timestamp: new Date().toISOString(),
      statusCode: status,
      code,
    };

    // Redact sensitive information from error context
    const redactedContext = this.redactionService.redactObject(errorContext);
    
    this.logger.error(redactedContext);

    // Redact sensitive information from response message
    const sanitizedMessage = this.redactionService.redactText(message);

    // Send error response
    response.status(status).json({
      statusCode: status,
      message: sanitizedMessage,
      code,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(process.env['NODE_ENV'] === 'development' && {
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
    });
  }

  private getErrorCode(exception: HttpException): string {
    const status = exception.getStatus();
    
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_ERROR';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMIT_EXCEEDED';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'INTERNAL_ERROR';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'SERVICE_UNAVAILABLE';
      default:
        return 'HTTP_ERROR';
    }
  }
}