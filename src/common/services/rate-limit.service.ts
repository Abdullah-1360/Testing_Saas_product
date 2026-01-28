import { Injectable, Logger } from '@nestjs/common';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly requestCounts = new Map<string, { count: number; resetTime: number }>();
  
  // Rate limits per role (requests per minute)
  private readonly rateLimits = {
    ['SUPER_ADMIN']: { windowMs: 60000, maxRequests: 1000 },
    ['ADMIN']: { windowMs: 60000, maxRequests: 500 },
    ['ENGINEER']: { windowMs: 60000, maxRequests: 300 },
    ['VIEWER']: { windowMs: 60000, maxRequests: 100 },
    anonymous: { windowMs: 60000, maxRequests: 20 },
  };

  checkRateLimit(
    identifier: string,
    userRole?: string
  ): RateLimitResult {
    const role = userRole || 'anonymous';
    const limit = this.rateLimits[role as keyof typeof this.rateLimits];
    
    if (!limit) {
      return {
        allowed: true,
        limit: 0,
        remaining: 0,
        resetTime: 0,
      };
    }

    const now = Date.now();
    const key = `${role}:${identifier}`;
    
    // Get or initialize request count
    let requestData = this.requestCounts.get(key);
    
    if (!requestData || requestData.resetTime <= now) {
      requestData = {
        count: 0,
        resetTime: now + limit.windowMs,
      };
    }

    // Clean up expired entries periodically
    this.cleanupExpiredEntries(now);

    // Check if limit is exceeded
    if (requestData.count >= limit.maxRequests) {
      const retryAfter = Math.ceil((requestData.resetTime - now) / 1000);
      
      return {
        allowed: false,
        limit: limit.maxRequests,
        remaining: 0,
        resetTime: requestData.resetTime,
        retryAfter,
      };
    }

    // Increment counter
    requestData.count++;
    this.requestCounts.set(key, requestData);

    return {
      allowed: true,
      limit: limit.maxRequests,
      remaining: limit.maxRequests - requestData.count,
      resetTime: requestData.resetTime,
    };
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

  getRateLimitInfo(userRole?: string) {
    const role = userRole || 'anonymous';
    return this.rateLimits[role as keyof typeof this.rateLimits];
  }
}