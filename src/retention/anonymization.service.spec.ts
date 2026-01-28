import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnonymizationService } from './anonymization.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';

describe('AnonymizationService', () => {
  let service: AnonymizationService;

  const mockPrismaService = {
    auditEvent: {
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    commandExecution: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    evidence: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    userSession: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    server: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockAuditService = {
    createAuditEvent: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnonymizationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AnonymizationService>(AnonymizationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeAnonymization', () => {
    it('should execute anonymization successfully', async () => {
      const config = {
        retentionDays: 3,
        dryRun: false,
        anonymizePersonalData: true,
        anonymizeCredentials: true,
        anonymizeIpAddresses: true,
      };

      // Mock audit events
      mockPrismaService.auditEvent.findMany.mockResolvedValue([
        { id: '1', ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' },
      ]);
      mockPrismaService.auditEvent.updateMany.mockResolvedValue({ count: 1 });

      // Mock command executions
      mockPrismaService.commandExecution.findMany.mockResolvedValue([
        { id: '1', command: 'mysql -u user -ppassword123', stdout: '', stderr: '' },
      ]);
      mockPrismaService.commandExecution.update.mockResolvedValue({});

      // Mock evidence
      mockPrismaService.evidence.findMany.mockResolvedValue([
        { id: '1', content: 'User email: user@example.com' },
      ]);
      mockPrismaService.evidence.update.mockResolvedValue({});

      // Mock user sessions
      mockPrismaService.userSession.updateMany.mockResolvedValue({ count: 1 });

      // Mock servers
      mockPrismaService.server.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.executeAnonymization(config, 'user-123');

      expect(result.success).toBe(true);
      expect(result.totalRecordsAnonymized).toBeGreaterThan(0);
      expect(result.tablesProcessed).toBe(5);
      expect(result.dryRun).toBe(false);
      expect(result.executedBy).toBe('user-123');

      // Verify audit event was created
      expect(mockAuditService.createAuditEvent).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'DATA_ANONYMIZATION',
        resource: 'data_anonymization',
        resourceId: expect.stringMatching(/^anonymization-\d+$/),
        details: expect.objectContaining({
          retentionDays: 3,
          totalRecordsAnonymized: expect.any(Number),
          tablesProcessed: 5,
          dryRun: false,
        }),
      });
    });

    it('should perform dry run without making changes', async () => {
      const config = {
        retentionDays: 3,
        dryRun: true,
        anonymizePersonalData: true,
        anonymizeCredentials: true,
        anonymizeIpAddresses: true,
      };

      // Mock count queries for dry run
      mockPrismaService.auditEvent.count.mockResolvedValue(5);
      mockPrismaService.commandExecution.count.mockResolvedValue(3);
      mockPrismaService.evidence.count.mockResolvedValue(2);
      mockPrismaService.userSession.count.mockResolvedValue(1);
      mockPrismaService.server.count.mockResolvedValue(0);

      const result = await service.executeAnonymization(config);

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.totalRecordsAnonymized).toBe(11); // Sum of all counts

      // Verify no actual updates were made
      expect(mockPrismaService.auditEvent.updateMany).not.toHaveBeenCalled();
      expect(mockPrismaService.commandExecution.update).not.toHaveBeenCalled();
      expect(mockPrismaService.evidence.update).not.toHaveBeenCalled();
      expect(mockPrismaService.userSession.updateMany).not.toHaveBeenCalled();
      expect(mockPrismaService.server.updateMany).not.toHaveBeenCalled();
    });

    it('should handle specific table anonymization', async () => {
      const config = {
        retentionDays: 3,
        tableName: 'audit_events',
        dryRun: false,
        anonymizePersonalData: true,
        anonymizeCredentials: true,
        anonymizeIpAddresses: true,
      };

      mockPrismaService.auditEvent.findMany.mockResolvedValue([
        { id: '1', ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' },
      ]);
      mockPrismaService.auditEvent.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.executeAnonymization(config);

      expect(result.success).toBe(true);
      expect(result.tablesProcessed).toBe(1);
      expect(result.results).toHaveLength(1);
      if (result.results[0]) {
        expect(result.results[0].tableName).toBe('audit_events');
      }
    });

    it('should handle errors gracefully', async () => {
      const config = {
        retentionDays: 3,
        dryRun: false,
        anonymizePersonalData: true,
        anonymizeCredentials: true,
        anonymizeIpAddresses: true,
      };

      // Mock audit service to throw error
      mockAuditService.createAuditEvent.mockRejectedValue(new Error('Audit error'));

      await expect(service.executeAnonymization(config)).rejects.toThrow('Audit error');
    });
  });

  describe('getAnonymizationStatistics', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return anonymization statistics', async () => {
      mockPrismaService.auditEvent.count
        .mockResolvedValueOnce(10) // auditEventsWithPersonalData
        .mockResolvedValueOnce(5); // commandsWithCredentials
      
      mockPrismaService.commandExecution.count.mockResolvedValue(5);
      mockPrismaService.evidence.count.mockResolvedValue(8);
      mockPrismaService.auditEvent.findFirst.mockResolvedValue({
        timestamp: new Date('2024-01-15T10:00:00Z'),
      });

      const stats = await service.getAnonymizationStatistics();

      expect(stats).toEqual({
        totalRecordsWithPersonalData: 18, // 10 + 8
        totalRecordsWithCredentials: 5,
        lastAnonymizationDate: new Date('2024-01-15T10:00:00Z'),
        tablesWithSensitiveData: ['audit_events', 'command_executions', 'evidence', 'user_sessions', 'servers'],
      });
    });

    it('should handle no previous anonymization', async () => {
      // Explicitly reset and setup mocks
      mockPrismaService.auditEvent.count.mockReset();
      mockPrismaService.commandExecution.count.mockReset();
      mockPrismaService.evidence.count.mockReset();
      mockPrismaService.auditEvent.findFirst.mockReset();

      mockPrismaService.auditEvent.count.mockResolvedValue(0);
      mockPrismaService.commandExecution.count.mockResolvedValue(0);
      mockPrismaService.evidence.count.mockResolvedValue(0);
      mockPrismaService.auditEvent.findFirst.mockResolvedValue(null);

      const stats = await service.getAnonymizationStatistics();

      expect(stats.lastAnonymizationDate).toBeNull();
      expect(stats.totalRecordsWithPersonalData).toBe(0);
      expect(stats.totalRecordsWithCredentials).toBe(0);
    });
  });

  describe('credential anonymization', () => {
    it('should anonymize passwords in text', () => {
      const text = 'mysql -u user -ppassword123 database';
      const anonymized = (service as any).anonymizeCredentialsInText(text);
      
      expect(anonymized).toBe('mysql -u user -p*** database');
    });

    it('should anonymize API keys in text', () => {
      const text = 'curl -H "Authorization: Bearer sk-1234567890abcdef"';
      const anonymized = (service as any).anonymizeCredentialsInText(text);
      
      expect(anonymized).toContain('bearer ***');
    });

    it('should anonymize database connection strings', () => {
      const text = 'mysql://user:password@localhost:3306/database';
      const anonymized = (service as any).anonymizeCredentialsInText(text);
      
      expect(anonymized).toBe('mysql://***:***@localhost:3306/database');
    });
  });

  describe('personal data anonymization', () => {
    it('should anonymize email addresses', () => {
      const text = 'User email: user@example.com and admin@test.org';
      const anonymized = (service as any).anonymizePersonalDataInText(text);
      
      expect(anonymized).toBe('User email: ***@***.*** and ***@***.***');
    });

    it('should anonymize IP addresses', () => {
      const text = 'Request from 192.168.1.100 and 10.0.0.1';
      const anonymized = (service as any).anonymizePersonalDataInText(text);
      
      expect(anonymized).toBe('Request from XXX.XXX.XXX.XXX and XXX.XXX.XXX.XXX');
    });

    it('should anonymize phone numbers', () => {
      const text = 'Call 555-123-4567 or (555) 987-6543';
      const anonymized = (service as any).anonymizePersonalDataInText(text);
      
      expect(anonymized).toBe('Call XXX-XXX-XXXX or (XXX) XXX-XXXX');
    });

    it('should anonymize user paths', () => {
      const text = 'File at /home/john/documents/file.txt';
      const anonymized = (service as any).anonymizePersonalDataInText(text);
      
      expect(anonymized).toBe('File at /home/***/documents/file.txt');
    });
  });
});