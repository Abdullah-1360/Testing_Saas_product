import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fc from 'fast-check';
import { RetentionService } from './retention.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';

describe('RetentionService Property-Based Tests', () => {
  let service: RetentionService;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let configService: jest.Mocked<ConfigService>;

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
      get: jest.fn().mockReturnValue(3),
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

  /**
   * Feature: wp-autohealer, Property 4: Retention Policy Hard Cap Enforcement
   * For any retention configuration attempt, values outside the 1-7 day range should be rejected and the hard cap should be enforced.
   * **Validates: Requirements 3.2**
   */
  it('should enforce hard cap of 1-7 days for any retention configuration', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        (retentionDays) => {
          const isValid = service.validateRetentionDays(retentionDays);
          
          if (retentionDays >= 1 && retentionDays <= 7) {
            expect(isValid).toBe(true);
          } else {
            expect(isValid).toBe(false);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 4: Retention Policy Hard Cap Enforcement (Edge Cases)
   * Test specific boundary conditions for the hard cap enforcement.
   * **Validates: Requirements 3.2**
   */
  it('should enforce hard cap boundaries correctly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 1, 7, 8, -1, 100, -100),
        (retentionDays) => {
          const isValid = service.validateRetentionDays(retentionDays);
          
          if (retentionDays === 1 || retentionDays === 7) {
            expect(isValid).toBe(true);
          } else if (retentionDays < 1 || retentionDays > 7) {
            expect(isValid).toBe(false);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 4: Retention Policy Creation Hard Cap
   * For any retention policy creation, the service should reject policies with retention days outside 1-7 range.
   * **Validates: Requirements 3.2**
   */
  it('should reject retention policy creation with invalid retention days', async () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          policyName: fc.string({ minLength: 1, maxLength: 100 }),
          retentionDays: fc.integer({ min: -100, max: 100 }),
          appliesTo: fc.constantFrom('incidents', 'commands', 'evidence', 'backups', 'all'),
          isActive: fc.boolean(),
        }),
        async (policyData) => {
          // Mock that no existing policy exists
          prismaService.retentionPolicy.findUnique.mockResolvedValue(null);

          if (policyData.retentionDays < 1 || policyData.retentionDays > 7) {
            // Should reject invalid retention days
            await expect(
              service.createRetentionPolicy(policyData, 'test-user')
            ).rejects.toThrow(/Retention period must be between 1 and 7 days/);
          } else {
            // Should accept valid retention days
            const mockPolicy = {
              id: 'test-id',
              ...policyData,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            
            prismaService.retentionPolicy.create.mockResolvedValue(mockPolicy);
            
            const result = await service.createRetentionPolicy(policyData, 'test-user');
            expect(result.retentionDays).toBe(policyData.retentionDays);
            expect(result.retentionDays).toBeGreaterThanOrEqual(1);
            expect(result.retentionDays).toBeLessThanOrEqual(7);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 4: Retention Policy Update Hard Cap
   * For any retention policy update, the service should reject updates with retention days outside 1-7 range.
   * **Validates: Requirements 3.2**
   */
  it('should reject retention policy updates with invalid retention days', async () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          retentionDays: fc.integer({ min: -50, max: 50 }),
        }),
        async (updateData) => {
          const existingPolicy = {
            id: 'test-id',
            policyName: 'test-policy',
            retentionDays: 3,
            appliesTo: 'incidents',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          prismaService.retentionPolicy.findUnique.mockResolvedValue(existingPolicy);

          if (updateData.retentionDays < 1 || updateData.retentionDays > 7) {
            // Should reject invalid retention days
            await expect(
              service.updateRetentionPolicy('test-id', updateData, 'test-user')
            ).rejects.toThrow(/Retention period must be between 1 and 7 days/);
          } else {
            // Should accept valid retention days
            const updatedPolicy = { ...existingPolicy, ...updateData };
            prismaService.retentionPolicy.update.mockResolvedValue(updatedPolicy);
            
            const result = await service.updateRetentionPolicy('test-id', updateData, 'test-user');
            expect(result.retentionDays).toBe(updateData.retentionDays);
            expect(result.retentionDays).toBeGreaterThanOrEqual(1);
            expect(result.retentionDays).toBeLessThanOrEqual(7);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Audit Trail Creation
   * For any retention policy operation, an audit event should be created.
   * **Validates: Requirements 2.5, 3.4**
   */
  it('should create audit trail for all retention policy operations', async () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          policyName: fc.string({ minLength: 1, maxLength: 100 }),
          retentionDays: fc.integer({ min: 1, max: 7 }), // Valid range only
          appliesTo: fc.constantFrom('incidents', 'commands', 'evidence', 'backups', 'all'),
          isActive: fc.boolean(),
        }),
        fc.string({ minLength: 1, maxLength: 50 }), // userId
        async (policyData, userId) => {
          // Mock successful policy creation
          prismaService.retentionPolicy.findUnique.mockResolvedValue(null);
          const mockPolicy = {
            id: 'test-id',
            ...policyData,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          prismaService.retentionPolicy.create.mockResolvedValue(mockPolicy);

          await service.createRetentionPolicy(policyData, userId);

          // Verify audit event was created
          expect(auditService.logEvent).toHaveBeenCalledWith({
            userId,
            action: 'CREATE_RETENTION_POLICY',
            resource: 'retention_policy',
            resourceId: mockPolicy.id,
            details: expect.objectContaining({
              policyName: policyData.policyName,
              retentionDays: policyData.retentionDays,
              appliesTo: policyData.appliesTo,
              isActive: policyData.isActive,
            }),
          });
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Policy Name Uniqueness
   * For any retention policy creation, duplicate policy names should be rejected.
   * **Validates: Requirements 3.1**
   */
  it('should reject duplicate policy names', async () => {
    fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 7 }),
        async (policyName, retentionDays) => {
          // Mock existing policy with same name
          const existingPolicy = {
            id: 'existing-id',
            policyName,
            retentionDays: 3,
            appliesTo: 'incidents',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          prismaService.retentionPolicy.findUnique.mockResolvedValue(existingPolicy);

          const newPolicyData = {
            policyName,
            retentionDays,
            appliesTo: 'commands',
            isActive: true,
          };

          await expect(
            service.createRetentionPolicy(newPolicyData, 'test-user')
          ).rejects.toThrow(/already exists/);
        }
      ),
      { numRuns: 10 }
    );
  });
});