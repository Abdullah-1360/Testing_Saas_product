import { Controller, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { EnhancedRateLimitGuard } from '@/common/guards/enhanced-rate-limit.guard';
import { AuditInterceptor } from '@/audit/audit.interceptor';

export interface ApiResponseFormat<T = any> {
  statusCode: number;
  message: string;
  data?: T;
  timestamp: string;
  correlationId?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface FilterQuery {
  [key: string]: any;
}

/**
 * Base controller for versioned API endpoints
 * Provides consistent response formatting, authentication, authorization, and rate limiting
 */
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, EnhancedRateLimitGuard)
@UseInterceptors(AuditInterceptor)
@ApiResponse({ 
  status: 401, 
  description: 'Unauthorized - Authentication required',
  schema: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', example: 401 },
      message: { type: 'string', example: 'Authentication required' },
      code: { type: 'string', example: 'UNAUTHORIZED' },
      timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      path: { type: 'string', example: '/api/v1/users' },
    },
  },
})
@ApiResponse({ 
  status: 403, 
  description: 'Forbidden - Insufficient permissions',
  schema: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', example: 403 },
      message: { type: 'string', example: 'Insufficient permissions' },
      code: { type: 'string', example: 'FORBIDDEN' },
      timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      path: { type: 'string', example: '/api/v1/users' },
    },
  },
})
@ApiResponse({ 
  status: 429, 
  description: 'Too Many Requests - Rate limit exceeded',
  schema: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', example: 429 },
      message: { type: 'string', example: 'Rate limit exceeded' },
      code: { type: 'string', example: 'RATE_LIMIT_EXCEEDED' },
      retryAfter: { type: 'number', example: 60 },
      limit: { type: 'number', example: 100 },
      windowMs: { type: 'number', example: 60000 },
      timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      path: { type: 'string', example: '/api/v1/users' },
    },
  },
})
@Controller({ version: '1' })
export abstract class VersionedApiController {
  /**
   * Create a standardized success response
   */
  protected createResponse<T>(
    data: T,
    message: string,
    statusCode: number = 200,
    pagination?: ApiResponseFormat['pagination']
  ): ApiResponseFormat<T> {
    const response: ApiResponseFormat<T> = {
      statusCode,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    if (pagination) {
      response.pagination = pagination;
    }

    return response;
  }

  /**
   * Create a standardized paginated response
   */
  protected createPaginatedResponse<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
    message: string = 'Resources retrieved successfully'
  ): ApiResponseFormat<T[]> {
    const totalPages = Math.ceil(total / limit);
    
    return this.createResponse(
      data,
      message,
      200,
      {
        page,
        limit,
        total,
        totalPages,
      }
    );
  }

  /**
   * Parse and validate pagination parameters
   */
  protected parsePaginationQuery(query: PaginationQuery): {
    page: number;
    limit: number;
    skip: number;
    sortBy?: string;
    sortOrder: 'asc' | 'desc';
  } {
    const page = Math.max(1, parseInt(String(query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(query.limit)) || 10));
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

    return {
      page,
      limit,
      skip,
      sortBy: query.sortBy,
      sortOrder,
    };
  }

  /**
   * Parse filter parameters and sanitize them
   */
  protected parseFilterQuery(query: FilterQuery): Record<string, any> {
    const filters: Record<string, any> = {};

    // Remove pagination and sorting parameters
    const excludeKeys = ['page', 'limit', 'sortBy', 'sortOrder'];
    
    for (const [key, value] of Object.entries(query)) {
      if (!excludeKeys.includes(key) && value !== undefined && value !== '') {
        // Handle different filter types
        if (typeof value === 'string') {
          // Handle boolean strings
          if (value === 'true') {
            filters[key] = true;
          } else if (value === 'false') {
            filters[key] = false;
          } else if (value.includes(',')) {
            // Handle comma-separated values as array
            filters[key] = { in: value.split(',').map(v => v.trim()) };
          } else {
            // Handle string search (case-insensitive)
            filters[key] = { contains: value, mode: 'insensitive' };
          }
        } else {
          filters[key] = value;
        }
      }
    }

    return filters;
  }

  /**
   * Validate UUID format
   */
  protected validateUuid(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  /**
   * Create standardized error messages for common scenarios
   */
  protected getStandardMessages() {
    return {
      created: 'Resource created successfully',
      retrieved: 'Resource retrieved successfully',
      updated: 'Resource updated successfully',
      deleted: 'Resource deleted successfully',
      notFound: 'Resource not found',
      listRetrieved: 'Resources retrieved successfully',
      operationCompleted: 'Operation completed successfully',
    };
  }
}