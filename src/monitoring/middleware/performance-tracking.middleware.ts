import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PerformanceMonitoringService } from '../performance-monitoring.service';

@Injectable()
export class PerformanceTrackingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PerformanceTrackingMiddleware.name);

  constructor(
    private readonly performanceService: PerformanceMonitoringService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const performanceService = this.performanceService;

    // Override res.send to capture response metrics
    const originalSend = res.send;
    res.send = function(body) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const statusCode = res.statusCode;
      const method = req.method;
      const route = req.route?.path || req.path;

      // Record the HTTP request metrics
      try {
        performanceService.recordHttpRequest(method, route, statusCode, duration);
      } catch (error) {
        // Don't let monitoring errors affect the request
        console.error('Failed to record HTTP request metrics:', error);
      }

      // Call the original send method
      return originalSend.call(this, body);
    };

    next();
  }
}

// Helper function to extract route pattern from request
function getRoutePattern(req: Request): string {
  // Try to get the route pattern from the route object
  if (req.route?.path) {
    return req.route.path;
  }

  // Fallback to path with parameter normalization
  let path = req.path;
  
  // Replace UUIDs with :id
  path = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
  
  // Replace numeric IDs with :id
  path = path.replace(/\/\d+/g, '/:id');
  
  return path;
}