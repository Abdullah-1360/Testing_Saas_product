import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { User } from '@/users/entities/user.entity';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RoleBasedRateLimit {
  ['SUPER_ADMIN']: RateLimitConfig;
  ['ADMIN']: RateLimitConfig;
  ['ENGINEER']: RateLimitConfig;
  ['VIEWER']: RateLimitConfig;
  anonymous: RateLimitConfig;
}

export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (config: Partial<RoleBasedRateLimit>) =>
  (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(RATE_LIMIT_KEY, config, target, propertyKey);
    return descriptor;
  };

@Injectable()
export class EnhancedRateLimitGuard implements CanActivate {
  private readonly requestCounts = new Map<string, { count: number; resetTime: number }>();
  
  // Default rate limits per role (requests per minute)
  private readonly defaultLimits: RoleBasedRateLimit = {
    ['SUPER_ADMIN']: { windowMs: 60000, maxRequests: 1000 },
    ['ADMIN']: { windowMs: 60000, maxRequests: 500 },
    ['ENGINEER']: { windowMs: 60000, maxRequests: 300 },
    ['VIEWER']: { windowMs: 60000, maxRequests: 100 },
    anonymous: { windowMs: 60000, maxRequests: 20 },
  };

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user as User | undefined;
    
    // Get rate limit configuration from decorator or use defaults
    const customLimits = this.reflector.getAllAndOverride<Partial<RoleBasedRateLimit>>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()]
    );

    const rateLimits = { ...this.defaultLimits, ...customLimits };
    
    // Determine user role for rate limiting
    const userRole = user?.role || 'anonymous';
    const limit = rateLimits[userRole as keyof RoleBasedRateLimit];

    if (!limit) {
      return true; // No rate limit configured
    }

    // Create unique key for user/IP combination
    const key = user ? `user:${user.id}` : `ip:${this.getClientIp(request)}`;
    
    const now = Date.now();
    const windowStart = now - limit.windowMs;
    
    // Get or initialize request count for this key
    let requestData = this.requestCounts.get(key);
    
    if (!requestData || requestData.resetTime <= now) {
      // Initialize or reset the counter
      requestData = {
        count: 0,
        resetTime: now + limit.windowMs,
      };
    }

    // Clean up expired entries periodically
    this.cleanupExpiredEntries(now);

    // Check if limit is exceeded
    if (requestData.count >= limit.maxRequests) {
      const resetTimeSeconds = Math.ceil((requestData.resetTime - now) / 1000);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: resetTimeSeconds,
          limit: limit.maxRequests,
          windowMs: limit.windowMs,
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // Increment counter
    requestData.count++;
    this.requestCounts.set(key, requestData);

    // Add rate limit headers to response
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', limit.maxRequests);
    response.setHeader('X-RateLimit-Remaining', limit.maxRequests - requestData.count);
    response.setHeader('X-RateLimit-Reset', Math.ceil(requestData.resetTime / 1000));
    response.setHeader('X-RateLimit-Window', limit.windowMs);

    return true;
  }

  private getClientIp(request: Request): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (request.headers['x-real-ip'] as string) ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }

  private cleanupExpiredEntries(now: number): void {
    // Clean up expired entries every 100 requests to prevent memory leaks
    if (Math.random() < 0.01) {
      for (const [key, data] of this.requestCounts.entries()) {
        if (data.resetTime <= now) {
          this.requestCounts.delete(key);
        }
      }
    }
  }
}