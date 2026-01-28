import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetentionService } from './retention.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { CreateRetentionPolicyDto, UpdateRetentionPolicyDto } from './dto';

describe('RetentionService', () => {
  let service: RetentionService;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let configService: jest.Mocked<ConfigService>;

  const mockRetentionPolicy = {
    id: 'test-policy-id',
    policyName: 'test-policy',
    retentionDays: 3,
    appliesTo: 'incidents',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      retentionPolicy: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      purgeAudit: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const mockAuditService = {
      logEvent: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RetentionService>(RetentionService);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRetentionPolicy', () => {
    const createDto: CreateRetentionPolicyDto = {
      policyName: 'test-policy',
      retentionDays: 3,
      appliesTo: 'incidents',
      isActive: true,
    };

    it('should create a retention policy successfully', async () => {
      prismaService.retentionPolicy.findUnique.mockResolvedValue(null);
      prismaService.retentionPolicy.create.mockResolvedValue(mockRetentionPolicy);

      const result = await service.createRetentionPolicy(createDto, 'user-id');

      expect(result).toEqual(mockRetentionPolicy);
      expect(prismaService.retentionPolicy.create).toHaveBeenCalledWith({
        data: {
          policyName: createDto.policyName,
          retentionDays: createDto.retentionDays,
          appliesTo: createDto.appliesTo,
          isActive: createDto.isActive,
        },
      });
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('should enforce hard cap of 1-7 days', async () => {
      const invalidDto = { ...createDto, retentionDays: 8 };

      await expect(service.createRetentionPolicy(invalidDto, 'user-id'))
        .rejects
        .toThrow(BadRequestException);

      const invalidDto2 = { ...createDto, retentionDays: 0 };

      await expect(service.createRetentionPolicy(invalidDto2, 'user-id'))
        .rejects
        .toThrow(BadRequestException);
    });

    it('should reject duplicate policy names', async () => {
      prismaService.retentionPolicy.findUnique.mockResolvedValue(mockRetentionPolicy);

      await expect(service.createRetentionPolicy(createDto, 'user-id'))
        .rejects
        .toThrow(BadRequestException);
    });
  });

  describe('updateRetentionPolicy', () => {
    const updateDto: UpdateRetentionPolicyDto = {
      retentionDays: 5,
    };

    it('should update a retention policy successfully', async () => {
      const updatedPolicy = { ...mockRetentionPolicy, retentionDays: 5 };
      
      prismaService.retentionPolicy.findUnique.mockResolvedValue(mockRetentionPolicy);
      prismaService.retentionPolicy.update.mockResolvedValue(updatedPolicy);

      const result = await service.updateRetentionPolicy('test-id', updateDto, 'user-id');

      expect(result).toEqual(updatedPolicy);
      expect(prismaService.retentionPolicy.update).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        data: { retentionDays: 5 },
      });
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('should enforce hard cap during update', async () => {
      prismaService.retentionPolicy.findUnique.mockResolvedValue(mockRetentionPolicy);

      const invalidUpdate = { retentionDays: 10 };

      await expect(service.updateRetentionPolicy('test-id', invalidUpdate, 'user-id'))
        .rejects
        .toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent policy', async () => {
      prismaService.retentionPolicy.findUnique.mockResolvedValue(null);

      await expect(service.updateRetentionPolicy('non-existent', updateDto, 'user-id'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('validateRetentionDays', () => {
    it('should validate retention days within hard cap', () => {
      expect(service.validateRetentionDays(1)).toBe(true);
      expect(service.validateRetentionDays(3)).toBe(true);
      expect(service.validateRetentionDays(7)).toBe(true);
    });

    it('should reject retention days outside hard cap', () => {
      expect(service.validateRetentionDays(0)).toBe(false);
      expect(service.validateRetentionDays(8)).toBe(false);
      expect(service.validateRetentionDays(-1)).toBe(false);
    });
  });

  describe('getOrCreateDefaultRetentionPolicy', () => {
    it('should return existing default policy', async () => {
      prismaService.retentionPolicy.findUnique.mockResolvedValue(mockRetentionPolicy);

      const result = await service.getOrCreateDefaultRetentionPolicy();

      expect(result).toEqual(mockRetentionPolicy);
      expect(prismaService.retentionPolicy.findUnique).toHaveBeenCalledWith({
        where: { policyName: 'default-retention' },
      });
    });

    it('should create default policy if it does not exist', async () => {
      prismaService.retentionPolicy.findUnique.mockResolvedValue(null);
      prismaService.retentionPolicy.create.mockResolvedValue(mockRetentionPolicy);
      configService.get.mockReturnValue(3);

      const result = await service.getOrCreateDefaultRetentionPolicy();

      expect(result).toEqual(mockRetentionPolicy);
      expect(prismaService.retentionPolicy.create).toHaveBeenCalledWith({
        data: {
          policyName: 'default-retention',
          retentionDays: 3,
          appliesTo: 'all',
          isActive: true,
        },
      });
    });
  });

  describe('getRetentionStatistics', () => {
    it('should return retention statistics', async () => {
      const mockStats = {
        totalPolicies: 5,
        activePolicies: 3,
        totalPurgeOperations: 10,
        lastPurgeDate: new Date(),
        averageRetentionDays: 4,
      };

      prismaService.retentionPolicy.count
        .mockResolvedValueOnce(5) // total policies
        .mockResolvedValueOnce(3); // active policies
      
      prismaService.purgeAudit.count.mockResolvedValue(10);
      prismaService.purgeAudit.findFirst.mockResolvedValue({
        executedAt: mockStats.lastPurgeDate,
      });
      prismaService.retentionPolicy.aggregate.mockResolvedValue({
        _avg: { retentionDays: 4.2 },
      });

      const result = await service.getRetentionStatistics();

      expect(result).toEqual({
        totalPolicies: 5,
        activePolicies: 3,
        totalPurgeOperations: 10,
        lastPurgeDate: mockStats.lastPurgeDate,
        averageRetentionDays: 4,
      });
    });
  });
});