import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RedactionService } from '../services/redaction.service';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';

export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
  correlationId?: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(
    private readonly redactionService: RedactionService,
    private readonly reflector: Reflector,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<ApiResponse<T>> {
    const skipTransform = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If skip transform is set, return data as-is without wrapping or redacting
    if (skipTransform) {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    return next.handle().pipe(
      map((data) => {
        // Redact sensitive information from response data
        const redactedData = this.redactionService.redactObject(data);

        return {
          statusCode: response.statusCode,
          message: this.getSuccessMessage(context),
          data: redactedData,
          timestamp: new Date().toISOString(),
          correlationId: (request as any)['correlationId'],
        };
      })
    );
  }

  private getSuccessMessage(context: ExecutionContext): string {
    const handler = context.getHandler().name;

    // Generate appropriate success messages based on handler names
    const messageMap: Record<string, string> = {
      create: 'Resource created successfully',
      findAll: 'Resources retrieved successfully',
      findOne: 'Resource retrieved successfully',
      update: 'Resource updated successfully',
      remove: 'Resource deleted successfully',
      login: 'Authentication successful',
      logout: 'Logout successful',
      register: 'Registration successful',
      getProfile: 'Profile retrieved successfully',
      updateProfile: 'Profile updated successfully',
      getHealth: 'Health check successful',
      getAppInfo: 'Application information retrieved successfully',
      getVersion: 'Version information retrieved successfully',
    };

    return messageMap[handler] || 'Operation completed successfully';
  }
}