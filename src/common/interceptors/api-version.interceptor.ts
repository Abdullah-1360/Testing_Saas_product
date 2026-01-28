import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response } from 'express';
import { API_VERSION_KEY, API_DEPRECATION_KEY, ApiVersionConfig } from '@/common/decorators/api-version.decorator';

@Injectable()
export class ApiVersionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ApiVersionInterceptor.name);

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest();

    // Get version configuration from decorator
    const versionConfig = this.reflector.getAllAndOverride<ApiVersionConfig>(
      API_VERSION_KEY,
      [context.getHandler(), context.getClass()]
    );

    const deprecationConfig = this.reflector.getAllAndOverride<any>(
      API_DEPRECATION_KEY,
      [context.getHandler(), context.getClass()]
    );

    return next.handle().pipe(
      tap(() => {
        // Add API version headers
        if (versionConfig) {
          response.setHeader('X-API-Version', versionConfig.version);
          
          if (versionConfig.description) {
            response.setHeader('X-API-Description', versionConfig.description);
          }
        }

        // Add deprecation headers if applicable
        const deprecation = deprecationConfig as any;
        if (deprecation?.deprecated) {
          response.setHeader('X-API-Deprecated', 'true');
          
          if (deprecation.deprecationDate) {
            response.setHeader(
              'X-API-Deprecation-Date',
              deprecation.deprecationDate.toISOString().split('T')[0]
            );
          }
          
          if (deprecation.replacedBy) {
            response.setHeader('X-API-Replacement', deprecation.replacedBy);
          }

          // Log deprecation warning
          this.logger.warn({
            message: 'Deprecated API endpoint accessed',
            endpoint: request.url,
            method: request.method,
            userAgent: request.get('user-agent'),
            ip: request.ip,
            deprecationDate: deprecation.deprecationDate,
            replacement: deprecation.replacedBy,
            timestamp: new Date().toISOString(),
          });
        }

        // Add standard API headers
        response.setHeader('X-API-Server', 'WP-AutoHealer');
        response.setHeader('X-API-Timestamp', new Date().toISOString());
        
        // Add security headers for API responses
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('X-Frame-Options', 'DENY');
        response.setHeader('X-XSS-Protection', '1; mode=block');
        
        // Add cache control for API responses
        if (request.method === 'GET') {
          response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          response.setHeader('Pragma', 'no-cache');
          response.setHeader('Expires', '0');
        }
      })
    );
  }
}