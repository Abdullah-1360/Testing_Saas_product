import { Test, TestingModule } from '@nestjs/testing';
import { ApiResponseService } from './api-response.service';

describe('ApiResponseService', () => {
  let service: ApiResponseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiResponseService],
    }).compile();

    service = module.get<ApiResponseService>(ApiResponseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('success', () => {
    it('should create success response with data', () => {
      const data = { id: 1, name: 'Test' };
      const result = service.success(data);

      expect(result).toEqual({
        success: true,
        data,
        message: 'Operation completed successfully',
        timestamp: expect.any(String),
      });
    });

    it('should create success response with custom message', () => {
      const data = { id: 1, name: 'Test' };
      const message = 'Custom success message';
      const result = service.success(data, message);

      expect(result).toEqual({
        success: true,
        data,
        message,
        timestamp: expect.any(String),
      });
    });

    it('should create success response without data', () => {
      const result = service.success();

      expect(result).toEqual({
        success: true,
        data: null,
        message: 'Operation completed successfully',
        timestamp: expect.any(String),
      });
    });

    it('should include valid ISO timestamp', () => {
      const result = service.success();
      const timestamp = new Date(result.timestamp);

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeCloseTo(Date.now(), -3); // Within 1 second
    });
  });

  describe('error', () => {
    it('should create error response with message', () => {
      const message = 'Something went wrong';
      const result = service.error(message);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'INTERNAL_ERROR',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create error response with custom code', () => {
      const message = 'Validation failed';
      const code = 'VALIDATION_ERROR';
      const result = service.error(message, code);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code,
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create error response with details', () => {
      const message = 'Validation failed';
      const code = 'VALIDATION_ERROR';
      const details = { field: 'email', reason: 'Invalid format' };
      const result = service.error(message, code, details);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code,
          details,
        },
        timestamp: expect.any(String),
      });
    });

    it('should include valid ISO timestamp', () => {
      const result = service.error('Test error');
      const timestamp = new Date(result.timestamp);

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeCloseTo(Date.now(), -3); // Within 1 second
    });
  });

  describe('paginated', () => {
    it('should create paginated response with data', () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const pagination = {
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
      };

      const result = service.paginated(data, pagination);

      expect(result).toEqual({
        success: true,
        data,
        pagination,
        message: 'Data retrieved successfully',
        timestamp: expect.any(String),
      });
    });

    it('should create paginated response with custom message', () => {
      const data = [{ id: 1 }];
      const pagination = {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      };
      const message = 'Users retrieved successfully';

      const result = service.paginated(data, pagination, message);

      expect(result).toEqual({
        success: true,
        data,
        pagination,
        message,
        timestamp: expect.any(String),
      });
    });

    it('should handle empty data array', () => {
      const data: any[] = [];
      const pagination = {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      };

      const result = service.paginated(data, pagination);

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('should calculate correct pagination metadata', () => {
      const data = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
      const pagination = {
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      };

      const result = service.paginated(data, pagination);

      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });
  });

  describe('created', () => {
    it('should create created response with data', () => {
      const data = { id: 1, name: 'New Item' };
      const result = service.created(data);

      expect(result).toEqual({
        success: true,
        data,
        message: 'Resource created successfully',
        timestamp: expect.any(String),
      });
    });

    it('should create created response with custom message', () => {
      const data = { id: 1, name: 'New User' };
      const message = 'User created successfully';
      const result = service.created(data, message);

      expect(result).toEqual({
        success: true,
        data,
        message,
        timestamp: expect.any(String),
      });
    });

    it('should create created response without data', () => {
      const result = service.created();

      expect(result).toEqual({
        success: true,
        data: null,
        message: 'Resource created successfully',
        timestamp: expect.any(String),
      });
    });
  });

  describe('updated', () => {
    it('should create updated response with data', () => {
      const data = { id: 1, name: 'Updated Item' };
      const result = service.updated(data);

      expect(result).toEqual({
        success: true,
        data,
        message: 'Resource updated successfully',
        timestamp: expect.any(String),
      });
    });

    it('should create updated response with custom message', () => {
      const data = { id: 1, name: 'Updated User' };
      const message = 'User profile updated';
      const result = service.updated(data, message);

      expect(result).toEqual({
        success: true,
        data,
        message,
        timestamp: expect.any(String),
      });
    });
  });

  describe('deleted', () => {
    it('should create deleted response', () => {
      const result = service.deleted();

      expect(result).toEqual({
        success: true,
        data: null,
        message: 'Resource deleted successfully',
        timestamp: expect.any(String),
      });
    });

    it('should create deleted response with custom message', () => {
      const message = 'User account deleted';
      const result = service.deleted(message);

      expect(result).toEqual({
        success: true,
        data: null,
        message,
        timestamp: expect.any(String),
      });
    });
  });

  describe('notFound', () => {
    it('should create not found response', () => {
      const result = service.notFound();

      expect(result).toEqual({
        success: false,
        error: {
          message: 'Resource not found',
          code: 'NOT_FOUND',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create not found response with custom message', () => {
      const message = 'User not found';
      const result = service.notFound(message);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'NOT_FOUND',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create not found response with details', () => {
      const message = 'User not found';
      const details = { userId: '123' };
      const result = service.notFound(message, details);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'NOT_FOUND',
          details,
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('unauthorized', () => {
    it('should create unauthorized response', () => {
      const result = service.unauthorized();

      expect(result).toEqual({
        success: false,
        error: {
          message: 'Unauthorized access',
          code: 'UNAUTHORIZED',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create unauthorized response with custom message', () => {
      const message = 'Invalid credentials';
      const result = service.unauthorized(message);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'UNAUTHORIZED',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('forbidden', () => {
    it('should create forbidden response', () => {
      const result = service.forbidden();

      expect(result).toEqual({
        success: false,
        error: {
          message: 'Access forbidden',
          code: 'FORBIDDEN',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create forbidden response with custom message', () => {
      const message = 'Insufficient permissions';
      const result = service.forbidden(message);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'FORBIDDEN',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('validation', () => {
    it('should create validation error response', () => {
      const errors = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Password too short' },
      ];

      const result = service.validation(errors);

      expect(result).toEqual({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: { errors },
        },
        timestamp: expect.any(String),
      });
    });

    it('should create validation error response with custom message', () => {
      const errors = [{ field: 'name', message: 'Name is required' }];
      const message = 'Form validation failed';

      const result = service.validation(errors, message);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'VALIDATION_ERROR',
          details: { errors },
        },
        timestamp: expect.any(String),
      });
    });

    it('should handle empty errors array', () => {
      const result = service.validation([]);

      expect(result.error.details).toEqual({ errors: [] });
    });
  });

  describe('conflict', () => {
    it('should create conflict response', () => {
      const result = service.conflict();

      expect(result).toEqual({
        success: false,
        error: {
          message: 'Resource conflict',
          code: 'CONFLICT',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create conflict response with custom message', () => {
      const message = 'Email already exists';
      const result = service.conflict(message);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'CONFLICT',
          details: null,
        },
        timestamp: expect.any(String),
      });
    });

    it('should create conflict response with details', () => {
      const message = 'Email already exists';
      const details = { email: 'test@example.com' };
      const result = service.conflict(message, details);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'CONFLICT',
          details,
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('rateLimit', () => {
    it('should create rate limit response', () => {
      const resetTime = Date.now() + 60000;
      const result = service.rateLimit(resetTime);

      expect(result).toEqual({
        success: false,
        error: {
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          details: { resetTime },
        },
        timestamp: expect.any(String),
      });
    });

    it('should create rate limit response with custom message', () => {
      const resetTime = Date.now() + 60000;
      const message = 'Too many requests';
      const result = service.rateLimit(resetTime, message);

      expect(result).toEqual({
        success: false,
        error: {
          message,
          code: 'RATE_LIMIT_EXCEEDED',
          details: { resetTime },
        },
        timestamp: expect.any(String),
      });
    });
  });
});