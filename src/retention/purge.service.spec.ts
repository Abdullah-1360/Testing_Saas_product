import { Test, TestingModule } from '@nestjs/testing';
import { PurgeService } from './purge.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { RetentionService } from './retention.service';
import { ManualPurgeDto } from './dto';

describe('PurgeService', () => {
  let service: PurgeService;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let retentionService: jest.Mocked<RetentionService>;

  const mockRetentionPolicy = {
    id: 'test-policy-id',
    policyName: 'default-retention',
    retentionDays: 3,
    appliesTo: 'all',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      incident: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      incidentEvent: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      commandExecution: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      evidence: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      backupArtifact: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      fileChange: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      verificationResult: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditEvent: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      purgeAudit: {
        create: jest.fn(),
      },
    };

    const mockAuditService = {
      logEvent: jest.fn(),
    };

    const mockRetentionService = {
      getOrCreateDefaultRetentionPolicy: jest.fn(),
      getActiveRetentionPolicies: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurgeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RetentionService, useValue: mockRetentionService },
      ],
    }).compile();

    service = module.get<PurgeService>(PurgeService);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditService);
    retentionService = module.get(RetentionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeManualPurge', () => {
    const purgeDto: ManualPurgeDto = {
      retentionDays: 3,
      dryRun: false,
    };

    beforeEach(() => {
      retentionService.getOrCreateDefaultRetentionPolicy.mockResolvedValue(mockRetentionPolicy);
      
      // Mock database operations
      prismaService.incident.count.mockResolvedValue(10);
      prismaService.incident.deleteMany.mockResolvedValue({ count: 10 });
      
      prismaService.incidentEvent.count.mockResolvedValue(25);
      prismaService.incidentEvent.deleteMany.mockResolvedValue({ count: 25 });
      
      prismaService.commandExecution.count.mockResolvedValue(15);
      prismaService.commandExecution.deleteMany.mockResolvedValue({ count: 15 });
      
      prismaService.evidence.count.mockResolvedValue(8);
      prismaService.evidence.deleteMany.mockResolvedValue({ count: 8 });
      
      prismaService.backupArtifact.count.mockResolvedValue(5);
      prismaService.backupArtifact.deleteMany.mockResolvedValue({ count: 5 });
      
      prismaService.fileChange.count.mockResolvedValue(12);
      prismaService.fileChange.deleteMany.mockResolvedValue({ count: 12 });
      
      prismaService.verificationResult.count.mockResolvedValue(20);
      prismaService.verificationResult.deleteMany.mockResolvedValue({ count: 20 });
      
      prismaService.auditEvent.count.mockResolvedValue(30);
      prismaService.auditEvent.deleteMany.mockResolvedValue({ count: 30 });
    });

    it('should execute manual purge successfully', async () => {
      const result = await service.executeManualPurge(purgeDto, 'user-id');

      expect(result.success).toBe(true);
      expect(result.totalRecordsPurged).toBe(125); // Sum of all mocked counts
      expect(result.tablesProcessed).toBe(8);
      expect(result.dryRun).toBe(false);
      expect(result.results).toHaveLength(8);

      // Verify audit event was logged
      expect(auditService.logEvent).toHaveBeenCalledWith({
        userId: 'user-id',
        action: 'MANUAL_DATA_PURGE',
        resource: 'data_purge',
        resourceId: expect.stringMatching(/^purge-\d+$/),
        details: expect.objectContaining({
          retentionDays: 3,
          totalRecordsPurged: 125,
          tablesProcessed: 8,
          dryRun: false,
        }),
      });
    });

    it('should perform dry run without deleting data', async () => {
      const dryRunDto = { ...purgeDto, dryRun: true };
      
      const result = await service.executeManualPurge(dryRunDto, 'user-id');

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.totalRecordsPurged).toBe(125); // Count operations still run

      // Verify no delete operations were called
      expect(prismaService.incident.deleteMany).not.toHaveBeenCalled();
      expect(prismaService.incidentEvent.deleteMany).not.toHaveBeenCalled();
      expect(prismaService.commandExecution.deleteMany).not.toHaveBeenCalled();
      
      // But count operations should have been called
      expect(prismaService.incident.count).toHaveBeenCalled();
      expect(prismaService.incidentEvent.count).toHaveBeenCalled();
      expect(prismaService.commandExecution.count).toHaveBeenCalled();
    });

    it('should purge specific table when tableName is provided', async () => {
      const specificTableDto = { ...purgeDto, tableName: 'incidents' };
      
      const result = await service.executeManualPurge(specificTableDto, 'user-id');

      expect(result.success).toBe(true);
      expect(result.tablesProcessed).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].tableName).toBe('incidents');

      // Only incidents table should be processed
      expect(prismaService.incident.deleteMany).toHaveBeenCalled();
      expect(prismaService.incidentEvent.deleteMany).not.toHaveBeenCalled();
    });

    it('should use custom cutoff date when provided', async () => {
      const customCutoffDate = '2024-01-01T00:00:00.000Z';
      const customDto = { ...purgeDto, cutoffDate: customCutoffDate };
      
      const result = await service.executeManualPurge(customDto, 'user-id');

      expect(result.success).toBe(true);
      expect(result.results[0].cutoffDate).toBe(customCutoffDate);

      // Verify the cutoff date was used in database operations
      expect(prismaService.incident.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: new Date(customCutoffDate) },
        },
      });
    });

    it('should create purge audit records when not dry run', async () => {
      await service.executeManualPurge(purgeDto, 'user-id');

      // Should create audit records for each table
      expect(prismaService.purgeAudit.create).toHaveBeenCalledTimes(8);
      
      // Verify audit record structure
      expect(prismaService.purgeAudit.create).toHaveBeenCalledWith({
        data: {
          policyId: mockRetentionPolicy.id,
          tableName: expect.any(String),
          recordsPurged: expect.any(Number),
          cutoffDate: expect.any(Date),
          executedBy: 'user-id',
        },
      });
    });

    it('should not create purge audit records during dry run', async () => {
      const dryRunDto = { ...purgeDto, dryRun: true };
      
      await service.executeManualPurge(dryRunDto, 'user-id');

      // Should not create audit records during dry run
      expect(prismaService.purgeAudit.create).not.toHaveBeenCalled();
    });
  });

  describe('executeAutomaticPurge', () => {
    const mockActivePolicies = [
      {
        id: 'policy-1',
        policyName: 'incidents-policy',
        retentionDays: 3,
        appliesTo: 'incidents',
        isActive: true,
      },
      {
        id: 'policy-2',
        policyName: 'commands-policy',
        retentionDays: 5,
        appliesTo: 'commands',
        isActive: true,
      },
    ];

    beforeEach(() => {
      retentionService.getActiveRetentionPolicies.mockResolvedValue(mockActivePolicies);
      
      // Mock database operations for different tables
      prismaService.incident.deleteMany.mockResolvedValue({ count: 10 });
      prismaService.incidentEvent.deleteMany.mockResolvedValue({ count: 25 });
      prismaService.commandExecution.deleteMany.mockResolvedValue({ count: 15 });
      
      prismaService.purgeAudit.create.mockResolvedValue({
        id: 'audit-id',
        policyId: 'policy-1',
        tableName: 'incidents',
        recordsPurged: 10,
        cutoffDate: new Date(),
        executedAt: new Date(),
        executedBy: 'system',
      });
    });

    it('should execute automatic purge for all active policies', async () => {
      const operations = await service.executeAutomaticPurge();

      expect(operations).toHaveLength(2);
      expect(operations[0].success).toBe(true);
      expect(operations[1].success).toBe(true);
      
      // Verify policies were retrieved
      expect(retentionService.getActiveRetentionPolicies).toHaveBeenCalled();
      
      // Verify purge audit records were created
      expect(prismaService.purgeAudit.create).toHaveBeenCalled();
    });

    it('should handle policy execution failures gracefully', async () => {
      // Mock one policy to fail
      prismaService.incident.deleteMany.mockRejectedValueOnce(new Error('Database error'));
      
      const operations = await service.executeAutomaticPurge();

      expect(operations).toHaveLength(2);
      expect(operations.some(op => !op.success)).toBe(true);
      expect(operations.some(op => op.success)).toBe(true);
    });
  });
});