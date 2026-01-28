import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RateLimitService } from '../services/rate-limit.service';

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    
    // Get user from request (if authenticated)
    const user = (request as any).user;
    const userRole = user?.role?.name as string | undefined;
    
    // Create identifier (user ID or IP address)
    const identifier = user?.id || this.getClientIp(request);
    
    // Check rate limit
    const result = this.rateLimitService.checkRateLimit(identifier, userRole);
    
    // Add rate limit headers to response
    response.setHeader('X-RateLimit-Limit', result.limit);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

    if (!result.allowed) {
      response.setHeader('Retry-After', result.retryAfter || 60);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: result.retryAfter,
          limit: result.limit,
          timestamp: new Date().toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    return true;
  }

  private getClientIp(request: Request): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (request.headers['x-real-ip'] as string) ||
      request.connection.remoteAddress ||
      (request.socket as any)?.remoteAddress ||
      'unknown'
    );
  }
}