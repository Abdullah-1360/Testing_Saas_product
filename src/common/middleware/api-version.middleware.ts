import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ApiVersionMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    // Add API version headers
    res.setHeader('X-API-Version', 'v1');
    res.setHeader('X-API-Server', 'WP-AutoHealer');
    res.setHeader('X-API-Timestamp', new Date().toISOString());
    
    // Add security headers for API responses
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Add cache control for API responses
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    // Log API access for audit purposes
    this.logger.log({
      method: req.method,
      url: req.url,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    next();
  }
}