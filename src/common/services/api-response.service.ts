import { Injectable } from '@nestjs/common';

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

export interface PaginationOptions {
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class ApiResponseService {
  /**
   * Create a standardized success response
   */
  createResponse<T>(
    data: T,
    message: string,
    statusCode: number = 200,
    correlationId?: string
  ): ApiResponseFormat<T> {
    return {
      statusCode,
      message,
      data,
      timestamp: new Date().toISOString(),
      correlationId,
    };
  }

  /**
   * Create a simple success response
   */
  success(message: string, data?: any): ApiResponseFormat {
    return this.createResponse(data, message, 200);
  }

  /**
   * Create a standardized paginated response
   */
  createPaginatedResponse<T>(
    data: T[],
    pagination: PaginationOptions,
    message: string = 'Resources retrieved successfully',
    correlationId?: string
  ): ApiResponseFormat<T[]> {
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    
    return {
      statusCode: 200,
      message,
      data,
      timestamp: new Date().toISOString(),
      correlationId,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages,
      },
    };
  }

  /**
   * Parse and validate pagination parameters
   */
  parsePaginationQuery(query: any): {
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
  parseFilterQuery(query: Record<string, any>): Record<string, any> {
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
   * Get standard success messages
   */
  getStandardMessages() {
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