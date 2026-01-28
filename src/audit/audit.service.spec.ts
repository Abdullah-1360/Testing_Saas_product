import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '@/database/prisma.service';
import { RedactionService } from '@/common/services/redaction.service';

describe('AuditService', () => {
  let service: AuditService;

  const mockPrismaService = {
    auditEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const mockRedactionService = {
    redactObject: jest.fn(),
    redactCommand: jest.fn(),
    redactText: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: RedactionService,
          useValue: mockRedactionService,
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateTraceId', () => {
    it('should generate a unique trace ID', () => {
      const traceId1 = service.generateTraceId();
      const traceId2 = service.generateTraceId();

      expect(traceId1).toMatch(/^trace-\d+-[a-z0-9]{8}$/);
      expect(traceId2).toMatch(/^trace-\d+-[a-z0-9]{8}$/);
      expect(traceId1).not.toBe(traceId2);
    });
  });

  describe('generateCorrelationId', () => {
    it('should generate a unique correlation ID', () => {
      const corrId1 = service.generateCorrelationId();
      const corrId2 = service.generateCorrelationId();

      expect(corrId1).toMatch(/^corr-\d+-[a-z0-9]{8}$/);
      expect(corrId2).toMatch(/^corr-\d+-[a-z0-9]{8}$/);
      expect(corrId1).not.toBe(corrId2);
    });
  });

  describe('createAuditEvent', () => {
    it('should create an audit event with redacted details', async () => {
      const mockAuditEvent: AuditEvent = {
        id: 'audit-1',
        userId: 'user-1',
        action: 'DATA_READ',
        resource: 'USER',
        resourceId: 'user-1',
        details: { redacted: true },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        timestamp: new Date(),
      };

      mockRedactionService.redactObject.mockReturnValue({ redacted: true });
      mockPrismaService.auditEvent.create.mockResolvedValue(mockAuditEvent);

      const result = await service.createAuditEvent({
        userId: 'user-1',
        action: 'DATA_READ',
        resource: 'USER',
        resourceId: 'user-1',
        details: { password: 'secret123' },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      expect(mockRedactionService.redactObject).toHaveBeenCalledWith({ password: 'secret123' });
      expect(mockPrismaService.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'DATA_READ',
          resource: 'USER',
          resourceId: 'user-1',
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
          details: expect.objectContaining({
            redacted: true,
            traceId: expect.stringMatching(/^trace-/),
            correlationId: expect.stringMatching(/^corr-/),
            timestamp: expect.any(String),
          }),
        }),
      });
      expect(result).toBe(mockAuditEvent);
    });

    it('should generate trace and correlation IDs if not provided', async () => {
      const mockAuditEvent: AuditEvent = {
        id: 'audit-1',
        userId: 'user-1',
        action: 'DATA_READ',
        resource: 'USER',
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        timestamp: new Date(),
      };

      mockPrismaService.auditEvent.create.mockResolvedValue(mockAuditEvent);

      await service.createAuditEvent({
        userId: 'user-1',
        action: 'DATA_READ',
        resource: 'USER',
      });

      expect(mockPrismaService.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: expect.objectContaining({
            traceId: expect.stringMatching(/^trace-/),
            correlationId: expect.stringMatching(/^corr-/),
          }),
        }),
      });
    });

    it('should handle errors gracefully', async () => {
      mockPrismaService.auditEvent.create.mockRejectedValue(new Error('Database error'));

      await expect(service.createAuditEvent({
        action: 'DATA_READ',
        resource: 'USER',
      })).rejects.toThrow('Database error');
    });
  });

  describe('getAuditEvents', () => {
    it('should return paginated audit events with redacted data', async () => {
      const mockEvents = [
        {
          id: 'audit-1',
          userId: 'user-1',
          action: 'DATA_READ',
          resource: 'USER',
          resourceId: 'user-1',
          details: { password: 'secret123' },
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          timestamp: new Date(),
          user: {
            id: 'user-1',
            email: 'test@example.com',
            role: 'ADMIN',
          },
        },
      ];

      mockPrismaService.auditEvent.count.mockResolvedValue(1);
      mockPrismaService.auditEvent.findMany.mockResolvedValue(mockEvents);
      mockRedactionService.redactObject.mockReturnValue({ redacted: true });
      mockRedactionService.redactText.mockReturnValue('Mozilla/***');

      const result = await service.getAuditEvents({}, 1, 10);

      expect(result).toEqual({
        events: [
          expect.objectContaining({
            id: 'audit-1',
            details: { redacted: true },
            userAgent: 'Mozilla/***',
          }),
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('should apply filters correctly', async () => {
      mockPrismaService.auditEvent.count.mockResolvedValue(0);
      mockPrismaService.auditEvent.findMany.mockResolvedValue([]);

      await service.getAuditEvents({
        userId: 'user-1',
        action: 'DATA_READ',
        resource: 'USER',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });

      expect(mockPrismaService.auditEvent.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          action: {
            contains: 'DATA_READ',
            mode: 'insensitive',
          },
          resource: 'USER',
          timestamp: {
            gte: new Date('2024-01-01'),
            lte: new Date('2024-01-31'),
          },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
        skip: 0,
        take: 50,
      });
    });
  });

  describe('logAuthenticationEvent', () => {
    it('should create authentication audit event', async () => {
      const mockAuditEvent: AuditEvent = {
        id: 'audit-1',
        userId: 'user-1',
        action: 'AUTH_LOGIN',
        resource: 'USER',
        resourceId: 'user-1',
        details: { category: 'authentication' },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        timestamp: new Date(),
      };

      mockRedactionService.redactObject.mockReturnValue({ category: 'authentication' });
      mockPrismaService.auditEvent.create.mockResolvedValue(mockAuditEvent);

      const result = await service.logAuthenticationEvent(
        'LOGIN',
        'user-1',
        { loginMethod: 'password' },
        '127.0.0.1',
        'test-agent',
        'trace-123',
        'corr-456',
      );

      expect(mockPrismaService.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'AUTH_LOGIN',
          resource: 'USER',
          details: expect.objectContaining({
            category: 'authentication',
          }),
        }),
      });
      expect(result).toBe(mockAuditEvent);
    });
  });

  describe('logSSHCommandEvent', () => {
    it('should create SSH command audit event with redacted command', async () => {
      const mockAuditEvent: AuditEvent = {
        id: 'audit-1',
        userId: 'user-1',
        action: 'SSH_COMMAND_EXECUTED',
        resource: 'SERVER',
        resourceId: 'server-1',
        details: {
          command: 'mysql -u root -p***',
          result: { stdout: 'success' },
          category: 'ssh_command',
        },
        ipAddress: null,
        userAgent: null,
        timestamp: new Date(),
      };

      mockRedactionService.redactCommand.mockReturnValue('mysql -u root -p***');
      mockRedactionService.redactObject.mockReturnValue({ stdout: 'success' });
      mockPrismaService.auditEvent.create.mockResolvedValue(mockAuditEvent);

      const result = await service.logSSHCommandEvent(
        'mysql -u root -psecret123',
        'server-1',
        { stdout: 'success', exitCode: 0 },
        'user-1',
        'incident-1',
        'trace-123',
        'corr-456',
      );

      expect(mockRedactionService.redactCommand).toHaveBeenCalledWith('mysql -u root -psecret123');
      expect(mockRedactionService.redactObject).toHaveBeenCalledWith({ stdout: 'success', exitCode: 0 });
      expect(result).toBe(mockAuditEvent);
    });
  });

  describe('getAuditStatistics', () => {
    it('should return audit statistics', async () => {
      const mockGroupByAction = [
        { action: 'DATA_READ', _count: { action: 10 } },
        { action: 'DATA_CREATE', _count: { action: 5 } },
      ];

      const mockGroupByResourceType = [
        { resource: 'USER', _count: { resource: 8 } },
        { resource: 'SERVER', _count: { resource: 7 } },
      ];

      const mockGroupByUser = [
        { userId: 'user-1', _count: { userId: 12 } },
        { userId: 'user-2', _count: { userId: 3 } },
      ];

      const mockRecentEvents = [
        {
          id: 'audit-1',
          userId: 'user-1',
          action: 'DATA_READ',
          resource: 'USER',
          resourceId: null,
          details: null,
          ipAddress: null,
          userAgent: null,
          timestamp: new Date(),
          user: { email: 'test@example.com' },
        },
      ];

      mockPrismaService.auditEvent.count.mockResolvedValue(15);
      mockPrismaService.auditEvent.groupBy
        .mockResolvedValueOnce(mockGroupByAction)
        .mockResolvedValueOnce(mockGroupByResourceType)
        .mockResolvedValueOnce(mockGroupByUser);
      mockPrismaService.auditEvent.findMany.mockResolvedValue(mockRecentEvents);
      mockRedactionService.redactObject.mockReturnValue(null);

      const result = await service.getAuditStatistics();

      expect(result).toEqual({
        totalEvents: 15,
        eventsByAction: {
          'DATA_READ': 10,
          'DATA_CREATE': 5,
        },
        eventsByResourceType: {
          'USER': 8,
          'SERVER': 7,
        },
        eventsByUser: {
          'user-1': 12,
          'user-2': 3,
        },
        recentEvents: mockRecentEvents,
      });
    });
  });
});