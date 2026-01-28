import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { LoggerService } from '@/common/services/logger.service';

describe('AuditController', () => {
  let controller: AuditController;

  const mockAuditService = {
    getAuditEvents: jest.fn(),
    getAuditEventById: jest.fn(),
    getAuditStatistics: jest.fn(),
    logDataAccessEvent: jest.fn(),
    prisma: {
      auditEvent: {
        findMany: jest.fn(),
      },
    },
  };

  const mockLoggerService = {
    error: jest.fn(),
    log: jest.fn(),
  };

  const mockRequest = {
    user: {
      id: 'user-1',
      email: 'test@example.com',
      role: 'ADMIN',
    },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-user-agent'),
    traceId: 'trace-123',
    correlationId: 'corr-456',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: LoggerService,
          useValue: mockLoggerService,
        },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAuditEvents', () => {
    it('should return paginated audit events', async () => {
      const mockResult = {
        events: [
          {
            id: 'audit-1',
            action: 'DATA_READ',
            resource: 'USER',
            timestamp: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      };

      mockAuditService.getAuditEvents.mockResolvedValue(mockResult);
      mockAuditService.logDataAccessEvent.mockResolvedValue({});

      const result = await controller.getAuditEvents(
        1, 50, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        mockRequest,
      );

      expect(result).toEqual({
        success: true,
        data: mockResult,
      });

      expect(mockAuditService.getAuditEvents).toHaveBeenCalledWith({}, 1, 50);
      expect(mockAuditService.logDataAccessEvent).toHaveBeenCalledWith(
        'READ',
        'user-1',
        'AUDIT_EVENT',
        undefined,
        expect.objectContaining({
          filter: {},
          page: 1,
          limit: 50,
          resultCount: 1,
        }),
        '127.0.0.1',
        'test-user-agent',
        'trace-123',
        'corr-456',
      );
    });

    it('should apply filters correctly', async () => {
      const mockResult = {
        events: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      };

      mockAuditService.getAuditEvents.mockResolvedValue(mockResult);
      mockAuditService.logDataAccessEvent.mockResolvedValue({});

      await controller.getAuditEvents(
        1, 10, 'user-1', 'DATA_READ', 'USER', 'resource-1',
        '2024-01-01', '2024-01-31', '127.0.0.1', 'trace-123', 'corr-456',
        mockRequest,
      );

      expect(mockAuditService.getAuditEvents).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'DATA_READ',
        resource: 'USER',
        resourceId: 'resource-1',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        ipAddress: '127.0.0.1',
        traceId: 'trace-123',
        correlationId: 'corr-456',
      }, 1, 10);
    });

    it('should validate pagination parameters', async () => {
      await expect(
        controller.getAuditEvents(0, 50, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, undefined, mockRequest)
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getAuditEvents(1, 0, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, undefined, mockRequest)
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getAuditEvents(1, 101, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, undefined, mockRequest)
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate date parameters', async () => {
      await expect(
        controller.getAuditEvents(1, 50, undefined, undefined, undefined, undefined,
          'invalid-date', undefined, undefined, undefined, undefined, mockRequest)
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getAuditEvents(1, 50, undefined, undefined, undefined, undefined,
          undefined, 'invalid-date', undefined, undefined, undefined, mockRequest)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAuditEventById', () => {
    it('should return audit event by ID', async () => {
      const mockEvent = {
        id: 'audit-1',
        action: 'DATA_READ',
        resource: 'USER',
        timestamp: new Date(),
      };

      mockAuditService.getAuditEventById.mockResolvedValue(mockEvent);
      mockAuditService.logDataAccessEvent.mockResolvedValue({});

      const result = await controller.getAuditEventById('audit-1', mockRequest);

      expect(result).toEqual({
        success: true,
        data: mockEvent,
      });

      expect(mockAuditService.getAuditEventById).toHaveBeenCalledWith('audit-1');
      expect(mockAuditService.logDataAccessEvent).toHaveBeenCalledWith(
        'READ',
        'user-1',
        'AUDIT_EVENT',
        'audit-1',
        { eventId: 'audit-1' },
        '127.0.0.1',
        'test-user-agent',
        'trace-123',
        'corr-456',
      );
    });

    it('should throw error if audit event not found', async () => {
      mockAuditService.getAuditEventById.mockResolvedValue(null);

      await expect(
        controller.getAuditEventById('non-existent', mockRequest)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAuditStatistics', () => {
    it('should return audit statistics', async () => {
      const mockStatistics = {
        totalEvents: 100,
        eventsByAction: { 'DATA_READ': 50, 'DATA_CREATE': 30 },
        eventsByResourceType: { 'USER': 40, 'SERVER': 35 },
        eventsByUser: { 'user-1': 60, 'user-2': 40 },
        recentEvents: [],
      };

      mockAuditService.getAuditStatistics.mockResolvedValue(mockStatistics);
      mockAuditService.logDataAccessEvent.mockResolvedValue({});

      const result = await controller.getAuditStatistics(
        '2024-01-01',
        '2024-01-31',
        mockRequest,
      );

      expect(result).toEqual({
        success: true,
        data: mockStatistics,
      });

      expect(mockAuditService.getAuditStatistics).toHaveBeenCalledWith(
        new Date('2024-01-01'),
        new Date('2024-01-31'),
      );
    });

    it('should validate date parameters', async () => {
      await expect(
        controller.getAuditStatistics('invalid-date', undefined, mockRequest)
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getAuditStatistics(undefined, 'invalid-date', mockRequest)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMyAuditEvents', () => {
    it('should return current user audit events', async () => {
      const mockResult = {
        events: [
          {
            id: 'audit-1',
            userId: 'user-1',
            action: 'DATA_READ',
            resource: 'USER',
            timestamp: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      };

      mockAuditService.getAuditEvents.mockResolvedValue(mockResult);
      mockAuditService.logDataAccessEvent.mockResolvedValue({});

      const result = await controller.getMyAuditEvents(
        1, 50, undefined, undefined, undefined, undefined, mockRequest,
      );

      expect(result).toEqual({
        success: true,
        data: mockResult,
      });

      expect(mockAuditService.getAuditEvents).toHaveBeenCalledWith({
        userId: 'user-1',
      }, 1, 50);
    });

    it('should not create infinite loop for audit access events', async () => {
      const mockResult = {
        events: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      };

      mockAuditService.getAuditEvents.mockResolvedValue(mockResult);

      await controller.getMyAuditEvents(
        1, 50, 'DATA_READ', 'AUDIT_EVENT', undefined, undefined, mockRequest,
      );

      // Should not call logDataAccessEvent to prevent infinite loop
      expect(mockAuditService.logDataAccessEvent).not.toHaveBeenCalled();
    });
  });

  describe('getAuditActions', () => {
    it('should return available audit actions', async () => {
      const mockActions = [
        { action: 'AUTH_LOGIN' },
        { action: 'DATA_READ' },
        { action: 'SECURITY_FAILED_LOGIN' },
        { action: 'INCIDENT_CREATED' },
        { action: 'SSH_COMMAND_EXECUTED' },
      ];

      mockAuditService.prisma.auditEvent.findMany.mockResolvedValue(mockActions);

      const result = await controller.getAuditActions();

      expect(result).toEqual({
        success: true,
        data: {
          actions: ['AUTH_LOGIN', 'DATA_READ', 'SECURITY_FAILED_LOGIN', 'INCIDENT_CREATED', 'SSH_COMMAND_EXECUTED'],
          categories: {
            authentication: ['AUTH_LOGIN'],
            authorization: [],
            data_access: ['DATA_READ'],
            system: [],
            security: ['SECURITY_FAILED_LOGIN'],
            incident: ['INCIDENT_CREATED'],
            ssh: ['SSH_COMMAND_EXECUTED'],
          },
        },
      });
    });
  });

  describe('getResourceTypes', () => {
    it('should return available resource types', async () => {
      const mockResourceTypes = [
        { resource: 'USER' },
        { resource: 'SERVER' },
        { resource: 'INCIDENT' },
      ];

      mockAuditService.prisma.auditEvent.findMany.mockResolvedValue(mockResourceTypes);

      const result = await controller.getResourceTypes();

      expect(result).toEqual({
        success: true,
        data: {
          resourceTypes: ['USER', 'SERVER', 'INCIDENT'],
        },
      });
    });
  });
});